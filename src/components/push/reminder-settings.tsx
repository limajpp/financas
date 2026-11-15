"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deletePushSubscriptionAction,
  pushSubscriptionStatusAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "@/app/(app)/configuracoes/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { isIos } from "@/lib/install-hint";
import { applicationServerKey, currentPushSubscription, sameServerKey } from "@/lib/push-client";
import {
  availabilityMessage,
  type ReminderAvailability,
  reminderAvailability,
} from "@/lib/reminder-availability";

function detect(publicKey: string | null): { availability: ReminderAvailability; ios: boolean } {
  const ios = isIos(navigator.userAgent, navigator.maxTouchPoints);
  const availability = reminderAvailability({
    hasKeys: publicKey !== null,
    production: process.env.NODE_ENV === "production",
    isIos: ios,
    standalone:
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches,
    hasPushApi: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    permission: "Notification" in window ? Notification.permission : null,
  });
  return { availability, ios };
}

/** "Lembrete diário" in the settings: on or off for this device, and a test notification. */
export function ReminderSettings({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<{
    availability: ReminderAvailability;
    ios: boolean;
    on: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      const found = detect(publicKey);
      let on = false;
      if (found.availability === "READY") {
        const subscription = await currentPushSubscription().catch(() => null);
        if (subscription) on = await pushSubscriptionStatusAction(subscription.endpoint);
      }
      if (alive) setState({ ...found, on });
    })().catch(() => {
      if (alive) setState({ ...detect(publicKey), on: false });
    });
    return () => {
      alive = false;
    };
  }, [publicKey]);

  function turnOn() {
    startTransition(async () => {
      // Asked first, straight from the tap: iOS only shows the prompt for a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((s) => s && { ...s, ...detect(publicKey) });
        if (permission === "default") toast.error("Permita as notificações para ligar o lembrete.");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        // Made with an old key (rotated): every send would fail. Start over.
        if (subscription && !sameServerKey(subscription, publicKey!)) {
          await subscription.unsubscribe().catch(() => {});
          subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey!),
        });
        const result = await savePushSubscriptionAction(subscription.toJSON());
        if (!result.ok) {
          await subscription.unsubscribe().catch(() => {});
          toast.error(result.error);
          return;
        }
        setState((s) => s && { ...s, on: true });
        toast.success("Lembrete ligado. Ele chega todo dia por volta das 21h.");
      } catch {
        toast.error("Não foi possível ligar o lembrete. Verifique a conexão e tente de novo.");
      }
    });
  }

  function turnOff() {
    startTransition(async () => {
      try {
        const subscription = await currentPushSubscription();
        if (subscription) {
          const result = await deletePushSubscriptionAction(subscription.endpoint);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          await subscription.unsubscribe().catch(() => {});
        }
        setState((s) => s && { ...s, on: false });
        toast.success("Lembrete desligado neste aparelho.");
      } catch {
        toast.error("Não foi possível desligar o lembrete. Verifique a conexão.");
      }
    });
  }

  function sendTest() {
    startTransition(async () => {
      try {
        const subscription = await currentPushSubscription();
        if (!subscription) {
          setState((s) => s && { ...s, on: false });
          toast.error("A inscrição deste aparelho expirou. Ligue de novo.");
          return;
        }
        const result = await sendTestPushAction(subscription.endpoint);
        if (result.ok) {
          toast.success("Notificação de teste enviada.");
          return;
        }
        if (result.expired) {
          await subscription.unsubscribe().catch(() => {});
          setState((s) => s && { ...s, on: false });
        }
        toast.error(result.error);
      } catch {
        toast.error("Não foi possível enviar. Verifique a conexão.");
      }
    });
  }

  const reason = state ? availabilityMessage(state.availability, state.ios) : null;
  const disabled = !state || state.availability !== "READY" || pending;

  return (
    <section aria-labelledby="lembrete" className="mt-6 rounded-md border px-4 py-3">
      <h2 id="lembrete" className="font-medium">
        Lembrete diário
      </h2>
      <div className="mt-3 flex items-center justify-between gap-4">
        <Label htmlFor="lembrete-switch" className="font-normal">
          Lembrar às 21h neste aparelho
        </Label>
        <Switch
          id="lembrete-switch"
          checked={state?.on ?? false}
          disabled={disabled}
          aria-describedby={reason ? "lembrete-motivo" : "lembrete-dica"}
          onCheckedChange={(checked) => (checked ? turnOn() : turnOff())}
        />
      </div>
      {reason ? (
        <p id="lembrete-motivo" className="mt-2 text-sm text-muted-foreground">
          {reason}
        </p>
      ) : (
        <p id="lembrete-dica" className="mt-2 text-sm text-muted-foreground">
          Uma notificação por noite perguntando se faltou registrar algum gasto.
        </p>
      )}
      {state?.on && state.availability === "READY" && (
        <Button variant="outline" size="sm" className="mt-3" disabled={pending} onClick={sendTest}>
          Enviar notificação de teste
        </Button>
      )}
    </section>
  );
}
