"use client";

import { CloudOff, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCalendarDate } from "@/domain/dates";
import { formatBRL } from "@/domain/money";
import { type OutboxItem, outboxLabel, summarize, viewOf } from "@/domain/outbox";
import { discardFromOutbox, discardMessage } from "@/lib/outbox-sync";
import { cn } from "@/lib/utils";

import { useOutbox, useOutboxState } from "./outbox-provider";

/**
 * "2 lançamentos aguardando sincronização": shown anywhere in the app while the offline queue
 * isn't empty. Opens the list, where a refused entry can be fixed or discarded.
 */
export function OutboxIndicator() {
  const { userId, items, sessionExpired, sending } = useOutboxState();
  const { flush } = useOutbox();
  const [open, setOpen] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);
  // The discard waiting for a send on its way.
  const [waiting, setWaiting] = useState<string | null>(null);
  if (!userId) return null;
  const summary = summarize(items, userId);
  const label = outboxLabel(summary, sessionExpired);
  const failed = summary.rejected > 0;

  async function sendNow() {
    if (!navigator.onLine) {
      toast.error("Sem conexão. Os lançamentos serão enviados quando ela voltar.");
      return;
    }
    const outcome = await flush();
    if (outcome?.status === "UNAUTHORIZED") toast.error("Sua sessão expirou. Entre de novo.");
    else if (outcome?.status === "FAILED" && outcome.synced === 0 && outcome.rejected === 0) {
      toast.error("Não foi possível enviar agora. Vamos tentar de novo.");
    }
  }

  async function discard(clientId: string) {
    setWaiting(clientId);
    let removed: OutboxItem | null;
    try {
      // Waits for a send on its way: an entry already in it can't be taken back here.
      removed = await discardFromOutbox(clientId);
    } catch {
      toast.error("Não foi possível descartar.");
      return;
    } finally {
      setWaiting(null);
    }
    setDiscarding(null);
    const message = discardMessage(removed, "Lançamento descartado.");
    if (message.kind === "error") toast.error(message.title);
    else toast(message.title, { description: message.description });
  }

  return (
    <>
      {label && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            // A slim strip at the top of the screen, in the flow: floating, it would cover the
            // register screen's Save button on a phone.
            "flex w-full items-center justify-center gap-2 border-b px-4 py-1.5 text-sm",
            failed
              ? "bg-destructive/10 text-destructive"
              : "bg-muted/60 text-muted-foreground hover:text-foreground",
          )}
        >
          {failed ? (
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
          ) : (
            <CloudOff aria-hidden className="size-4 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </button>
      )}
      <Dialog
        open={open && items.length > 0}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDiscarding(null);
        }}
      >
        <ResponsiveDialogContent>
          <DialogHeader>
            <DialogTitle>Lançamentos neste aparelho</DialogTitle>
            <DialogDescription>
              {sessionExpired
                ? "Sua sessão expirou. Entre de novo para enviar."
                : "Eles são enviados sozinhos quando há conexão."}
            </DialogDescription>
          </DialogHeader>
          <ul aria-label="Lançamentos aguardando" className="divide-y">
            {items.map((item) => (
              <OutboxRow
                key={item.clientId}
                item={item}
                confirming={discarding === item.clientId}
                onAskDiscard={() => setDiscarding(item.clientId)}
                onCancelDiscard={() => setDiscarding(null)}
                waiting={waiting === item.clientId}
                onDiscard={() => void discard(item.clientId)}
                onFix={() => setOpen(false)}
              />
            ))}
          </ul>
          {summary.pending > 0 && (
            <ResponsiveDialogFooter>
              <Button type="button" disabled={sending} onClick={() => void sendNow()}>
                {sending ? "Enviando…" : "Enviar agora"}
              </Button>
            </ResponsiveDialogFooter>
          )}
        </ResponsiveDialogContent>
      </Dialog>
    </>
  );
}

function OutboxRow({
  item,
  confirming,
  waiting,
  onAskDiscard,
  onCancelDiscard,
  onDiscard,
  onFix,
}: {
  item: OutboxItem;
  confirming: boolean;
  waiting: boolean;
  onAskDiscard: () => void;
  onCancelDiscard: () => void;
  onDiscard: () => void;
  onFix: () => void;
}) {
  const view = viewOf(item);
  const rejected = item.status === "REJECTED";
  return (
    <li className="grid gap-2 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{view.what ?? view.label}</p>
          <p className="text-sm text-muted-foreground">
            {view.what ? `${view.label} · ` : ""}
            {view.date ? formatCalendarDate(view.date) : "Sem data"}
          </p>
        </div>
        <p className="shrink-0 font-medium tabular-nums">{formatBRL(view.amountCents)}</p>
      </div>
      {rejected && (
        <p role="alert" className="text-sm text-destructive">
          {item.error ?? "O servidor recusou este lançamento."}
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-sm">
            {item.attempted
              ? "Um envio já foi tentado e pode ter chegado. Descartar só tira deste aparelho."
              : "Descartar este lançamento?"}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onCancelDiscard}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={waiting}
            onClick={onDiscard}
          >
            {waiting ? "Aguardando envio…" : "Sim, descartar"}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onAskDiscard}>
            Descartar
          </Button>
          {rejected && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/registrar?corrigir=${item.clientId}`} onClick={onFix}>
                Corrigir
              </Link>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
