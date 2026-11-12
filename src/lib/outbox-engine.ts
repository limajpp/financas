import { type OutboxItem, retryDelay } from "@/domain/outbox";

import { listOutbox, watchOutbox } from "./outbox-db";
import { type FlushOutcome, flushOutbox } from "./outbox-sync";

/** The queue as the indicator shows it. */
export type OutboxState = {
  /** The signed-in user, once the session has loaded. */
  userId: string | null;
  /** The user's queue, oldest first. */
  items: OutboxItem[];
  /** The last attempt got a 401: the entries wait for a new login. */
  sessionExpired: boolean;
  sending: boolean;
};

export const EMPTY_OUTBOX: OutboxState = {
  userId: null,
  items: [],
  sessionExpired: false,
  sending: false,
};

/** Another tab is sending: look again after this long. */
const BUSY_RECHECK_MS = 2_000;

const pendingKeyOf = (items: readonly OutboxItem[]) =>
  items
    .filter((item) => item.status === "PENDING")
    .map((item) => item.clientId)
    .join(",");

/**
 * The offline queue for the whole app (docs/specs/tasks/16-offline-queue.md): keeps the list in
 * step with IndexedDB and sends it when the app opens, the connection comes back, the app returns
 * to the front, or a new entry is queued. After a failure it tries again with a growing wait.
 *
 * It lives outside React's state on purpose. The session (and so the queue) loads while the page
 * below is still hydrating, and a context value changing above a page in that state makes React
 * throw the page's HTML away and render it again, losing what was already typed. So the context
 * holds this one object, which never changes, and only the indicator subscribes to the state.
 */
export class OutboxEngine {
  private state = EMPTY_OUTBOX;
  private listeners = new Set<() => void>();
  private userWaiters: ((userId: string) => void)[] = [];
  private stopWatching: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private pendingKey = "";
  private started = false;
  private inFlight: Promise<FlushOutcome | null> | null = null;
  private onSynced: (count: number) => void = () => {};

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;

  private set(patch: Partial<OutboxState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** The signed-in user right now, or null while the session is still loading. */
  userId = () => this.state.userId;

  /** The signed-in user, as soon as the session says who it is. */
  whenUser = (): Promise<string> => {
    const { userId } = this.state;
    if (userId) return Promise.resolve(userId);
    return new Promise((resolve) => this.userWaiters.push(resolve));
  };

  /** The session loaded: follows this user's queue (another user's is never shown or sent). */
  signedIn(userId: string) {
    for (const resolve of this.userWaiters.splice(0)) resolve(userId);
    if (this.state.userId === userId) return;
    this.failures = 0;
    this.set({ userId, items: [], sessionExpired: false });
    this.watch();
  }

  private watch() {
    this.stopWatching?.();
    this.stopWatching = null;
    // Forgotten on purpose: the first answer below sends whatever is pending.
    this.pendingKey = "";
    const { userId } = this.state;
    if (!this.started || !userId) return;
    this.stopWatching = watchOutbox(userId, (items) => {
      if (this.state.userId !== userId) return;
      this.set({ items });
      // A new pending entry (or the queue found when the app opens) is sent right away. The key
      // only changes when the set of pending entries does, so a failed attempt doesn't loop here.
      const key = pendingKeyOf(items);
      if (key === this.pendingKey) return;
      this.pendingKey = key;
      if (key && navigator.onLine) void this.flush();
    });
  }

  private onOnline = () => {
    if (this.pendingKey) void this.flush();
  };
  private onVisible = () => {
    if (document.visibilityState === "visible" && navigator.onLine && this.pendingKey) {
      void this.flush();
    }
  };

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = this.started ? setTimeout(() => void this.flush(), ms) : null;
  }

  /**
   * While the app's layout is on screen (Next keeps it alive, hidden, behind the login screen, so
   * this runs again after every sign-in). `onSynced` is called after entries were sent: the screen
   * behind may list them or show a balance. Returns the cleanup.
   */
  start(onSynced: (count: number) => void) {
    this.onSynced = onSynced;
    this.started = true;
    // Back from the login screen: the session is new, and what waited for it is sent again.
    this.failures = 0;
    if (this.state.sessionExpired) this.set({ sessionExpired: false });
    this.watch();
    window.addEventListener("online", this.onOnline);
    document.addEventListener("visibilitychange", this.onVisible);
    return () => {
      this.started = false;
      this.stopWatching?.();
      this.stopWatching = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      window.removeEventListener("online", this.onOnline);
      document.removeEventListener("visibilitychange", this.onVisible);
    };
  }

  /**
   * Sends what's pending now. Null without a user yet. Calls made while a send is running get
   * that send's result.
   */
  flush = (): Promise<FlushOutcome | null> => {
    this.inFlight ??= this.send().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  };

  private async send(): Promise<FlushOutcome | null> {
    const { userId } = this.state;
    if (!userId) return null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.set({ sending: true });
    let outcome: FlushOutcome;
    try {
      outcome = await flushOutbox(userId);
      // An entry queued right after the send's last look at the queue missed it (and its own
      // request to send was answered with this one). A few rounds at most.
      for (let round = 0; round < 5 && outcome.status === "DONE"; round++) {
        if (!pendingKeyOf(await listOutbox(userId))) break;
        const more = await flushOutbox(userId);
        outcome = {
          status: more.status,
          synced: outcome.synced + more.synced,
          rejected: outcome.rejected + more.rejected,
        };
      }
    } catch {
      // IndexedDB failed mid-way: like any other failure, try again later.
      outcome = { status: "FAILED", synced: 0, rejected: 0 };
    } finally {
      this.set({ sending: false });
    }

    if (outcome.synced > 0) this.onSynced(outcome.synced);
    if (outcome.status === "BUSY") {
      // Another tab is sending. It may not see an entry queued just now: look again soon.
      this.schedule(BUSY_RECHECK_MS);
      return outcome;
    }
    this.set({ sessionExpired: outcome.status === "UNAUTHORIZED" });
    if (outcome.status === "FAILED") {
      this.failures++;
      this.schedule(retryDelay(this.failures));
    } else {
      // DONE, or UNAUTHORIZED: trying again without a new login would only get another 401. The
      // next sign-in starts the engine again, and that sends the queue.
      this.failures = 0;
    }
    return outcome;
  }
}

/** What the screens call: who is signed in, and "send now". */
export type Outbox = Pick<OutboxEngine, "userId" | "whenUser" | "flush">;
