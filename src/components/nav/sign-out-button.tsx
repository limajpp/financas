"use client";

import { LogOut } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { signOutAction } from "@/app/(auth)/actions";
import { useOutbox } from "@/components/outbox/outbox-provider";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clearOutbox, listOutbox } from "@/lib/outbox-db";

/**
 * "Sair". Nothing financial stays on the device afterwards: the saved screens go (task 15) and so
 * does the offline queue. With entries still in it, they are sent first; if some remain, the user
 * decides whether to lose them.
 */
export function SignOutButton({ className }: { className?: string }) {
  const outbox = useOutbox();
  const [left, setLeft] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  /** Signs out on the server (it redirects to the login) and empties this user's queue. */
  async function leave() {
    // Next keeps this layout alive behind the login screen: the question must not come back
    // with the next sign-in.
    setLeft(null);
    try {
      const userId = outbox.userId();
      if (userId) await clearOutbox(userId).catch(() => {});
      await signOutAction();
    } catch {
      toast.error("Não foi possível sair. Verifique a conexão.");
    }
  }

  function signOut() {
    if (!navigator.onLine) {
      toast.error("Sem conexão. Não é possível sair agora.");
      return;
    }
    startTransition(async () => {
      let remaining = 0;
      const userId = outbox.userId();
      if (userId) {
        try {
          if ((await listOutbox(userId)).length > 0) {
            await outbox.flush();
            remaining = (await listOutbox(userId)).length;
          }
        } catch {
          // No IndexedDB: there is no queue to lose.
        }
      }
      if (remaining > 0) {
        setLeft(remaining);
        return;
      }
      await leave();
    });
  }

  return (
    <>
      <form
        action={signOutAction}
        onSubmit={(event) => {
          // Without JavaScript the form still signs out.
          event.preventDefault();
          signOut();
        }}
        className={className}
      >
        <Button
          type="submit"
          variant="ghost"
          disabled={pending}
          className="w-full justify-start gap-2"
        >
          <LogOut aria-hidden className="size-4" />
          Sair
        </Button>
      </form>
      <Dialog open={left !== null} onOpenChange={(open) => !open && setLeft(null)}>
        <ResponsiveDialogContent>
          <DialogHeader>
            <DialogTitle>Sair e apagar lançamentos?</DialogTitle>
            <DialogDescription>
              {left === 1
                ? "Há 1 lançamento que ainda não foi enviado. Sair vai apagá-lo deste aparelho."
                : `Há ${left} lançamentos que ainda não foram enviados. Sair vai apagá-los deste aparelho.`}
            </DialogDescription>
          </DialogHeader>
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => setLeft(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => startTransition(leave)}
            >
              Sair e apagar
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </Dialog>
    </>
  );
}
