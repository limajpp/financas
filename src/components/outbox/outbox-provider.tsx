"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { type OutboxItem, retryDelay } from "@/domain/outbox";
import { watchOutbox } from "@/lib/outbox-db";
import { type FlushOutcome, flushOutbox } from "@/lib/outbox-sync";

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

const EMPTY: OutboxState = { userId: null, items: [], sessionExpired: false, sending: false };

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
class OutboxEngine {
  private state = EMPTY;
  private listeners = new Set<() => void>();
  private resolveUser: (userId: string) => void = () => {};
  private userKnown = new Promise<string>((resolve) => (this.resolveUser = resolve));
  private stopWatching: (() => void) | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private pendingKey = "";
  private started = false;
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
  /** Resolves once the session says who is signed in. */
  whenUser = () => this.userKnown;

  /** The session loaded: starts following this user's queue. */
  signedIn(userId: string) {
    if (this.state.userId === userId) return;
    this.resolveUser(userId);
    this.pendingKey = "";
    this.set({ userId, items: [], sessionExpired: false });
    this.watch();
  }

  private watch() {
    this.stopWatching?.();
    this.stopWatching = null;
    const { userId } = this.state;
    if (!this.started || !userId) return;
    this.stopWatching = watchOutbox(userId, (items) => {
      this.set({ items });
      // A new pending entry (or the queue found when the app opens) is sent right away. The key
      // only changes when the set of pending entries does, so a failed attempt doesn't loop here.
      const key = items
        .filter((item) => item.status === "PENDING")
        .map((item) => item.clientId)
        .join(",");
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

  /**
   * While the app's layout is on screen. `onSynced` is called after entries were sent: the screen
   * behind may list them or show a balance. Returns the cleanup.
   */
  start(onSynced: (count: number) => void) {
    this.onSynced = onSynced;
    this.started = true;
    this.watch();
    window.addEventListener("online", this.onOnline);
    document.addEventListener("visibilitychange", this.onVisible);
    return () => {
      this.started = false;
      this.stopWatching?.();
      this.stopWatching = null;
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      window.removeEventListener("online", this.onOnline);
      document.removeEventListener("visibilitychange", this.onVisible);
    };
  }

  /** Sends what's pending now. Null without a user yet. */
  flush = async (): Promise<FlushOutcome | null> => {
    const { userId } = this.state;
    if (!userId) return null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.set({ sending: true });
    let outcome: FlushOutcome;
    try {
      outcome = await flushOutbox(userId);
    } catch {
      // IndexedDB failed mid-way: like any other failure, try again later.
      outcome = { status: "FAILED", synced: 0, rejected: 0 };
    } finally {
      this.set({ sending: false });
    }
    if (outcome.status === "BUSY") return outcome;

    if (outcome.synced > 0) this.onSynced(outcome.synced);
    this.set({ sessionExpired: outcome.status === "UNAUTHORIZED" });
    if (outcome.status === "FAILED") {
      this.failures++;
      if (this.started) {
        this.retry = setTimeout(() => void this.flush(), retryDelay(this.failures));
      }
    } else {
      this.failures = 0;
    }
    return outcome;
  };
}

export type Outbox = Pick<OutboxEngine, "userId" | "whenUser" | "flush">;

const OutboxContext = createContext<OutboxEngine | null>(null);

function useEngine() {
  const engine = useContext(OutboxContext);
  if (!engine) throw new Error("A fila offline precisa do OutboxProvider.");
  return engine;
}

/** What the screens call: who is signed in, and "send now". Never causes a re-render. */
export function useOutbox(): Outbox {
  return useEngine();
}

/** The queue's state, for the indicator. Re-renders only the component that calls it. */
export function useOutboxState(): OutboxState {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, engine.getState, () => EMPTY);
}

export function OutboxProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [engine] = useState(() => new OutboxEngine());
  useEffect(
    () =>
      engine.start((count) => {
        toast(count === 1 ? "1 lançamento sincronizado" : `${count} lançamentos sincronizados`);
        router.refresh();
      }),
    [engine, router],
  );
  return <OutboxContext value={engine}>{children}</OutboxContext>;
}

/** Tells the queue who is signed in. Rendered by the layout once the session has loaded. */
export function OutboxUser({ userId }: { userId: string }) {
  const engine = useEngine();
  useEffect(() => engine.signedIn(userId), [engine, userId]);
  return null;
}
