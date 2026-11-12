"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { EMPTY_OUTBOX, type Outbox, OutboxEngine, type OutboxState } from "@/lib/outbox-engine";

// One engine for the app, and it never changes: see OutboxEngine on why the queue's state isn't
// a context value.
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
  return useSyncExternalStore(engine.subscribe, engine.getState, () => EMPTY_OUTBOX);
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
