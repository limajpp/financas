/** Whether this device can turn the daily reminder on, and if not, why (task 17). */
export type ReminderAvailability =
  "READY" | "UNAVAILABLE" | "IOS_NOT_INSTALLED" | "UNSUPPORTED" | "DENIED";

export function reminderAvailability(input: {
  /** The server has VAPID keys. */
  hasKeys: boolean;
  /** A production build: the service worker only exists there (task 15). */
  production: boolean;
  isIos: boolean;
  /** Opened from the home screen. */
  standalone: boolean;
  /** The browser has service workers, PushManager and Notification. */
  hasPushApi: boolean;
  permission: NotificationPermission | null;
}): ReminderAvailability {
  if (!input.hasKeys || !input.production) return "UNAVAILABLE";
  // On iOS, push exists only for a web app on the home screen (16.4+).
  if (input.isIos && !input.standalone) return "IOS_NOT_INSTALLED";
  if (!input.hasPushApi) return "UNSUPPORTED";
  if (input.permission === "denied") return "DENIED";
  return "READY";
}

export function availabilityMessage(availability: ReminderAvailability, isIos: boolean) {
  switch (availability) {
    case "UNAVAILABLE":
      return "Lembretes indisponíveis neste ambiente.";
    case "IOS_NOT_INSTALLED":
      return "No iPhone, o lembrete só funciona com o app instalado na Tela de Início.";
    case "UNSUPPORTED":
      return "Este navegador não recebe notificações.";
    case "DENIED":
      return isIos
        ? "As notificações estão bloqueadas. Libere em Ajustes › Notificações › Finanças."
        : "As notificações estão bloqueadas. Libere nas configurações do navegador.";
    case "READY":
      return null;
  }
}
