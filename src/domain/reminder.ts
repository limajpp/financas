/** The daily reminder (docs/specs/tasks/17-push-reminder.md): what it says and where it leads. */

export const REMINDER_TITLE = "Registrou tudo hoje?";
export const REMINDER_URL = "/registrar";
/** A new reminder replaces the previous one instead of piling up. */
export const REMINDER_TAG = "daily-reminder";

export const TEST_TITLE = "Finanças";
export const TEST_BODY = "Teste do Finanças: as notificações estão funcionando.";
export const TEST_TAG = "test";

/** What the service worker shows. Only counts, never amounts or names: the lock screen is public. */
export type PushPayload = { title: string; body: string; url: string; tag: string };

/** The reminder's text, from how many entries the user registered today. */
export function reminderBody(registeredToday: number): string {
  if (registeredToday <= 0) return "Nenhum lançamento hoje. Teve algum gasto?";
  if (registeredToday === 1) return "Você registrou 1 lançamento hoje. Faltou algum?";
  return `Você registrou ${registeredToday} lançamentos hoje. Faltou algum?`;
}

export function reminderPayload(registeredToday: number): PushPayload {
  return {
    title: REMINDER_TITLE,
    body: reminderBody(registeredToday),
    url: REMINDER_URL,
    tag: REMINDER_TAG,
  };
}

/**
 * What to do with a subscription after the push service answered: 404 and 410 mean it's gone
 * (uninstalled, permission revoked); anything else (429, 5xx, network) may pass tomorrow.
 */
export function afterPushFailure(statusCode: number | undefined): "REMOVE" | "KEEP" {
  return statusCode === 404 || statusCode === 410 ? "REMOVE" : "KEEP";
}

/** How the reminder message from the server becomes a notification, or the default one. */
export function readPushPayload(data: unknown): PushPayload {
  const fallback = reminderPayload(0);
  fallback.body = "Confira se faltou registrar algum gasto.";
  if (typeof data !== "object" || data === null) return fallback;
  const value = data as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof value[key] === "string" && value[key] && (value[key] as string).length <= max
      ? (value[key] as string)
      : null;
  const url = text("url", 200);
  return {
    title: text("title", 100) ?? fallback.title,
    body: text("body", 300) ?? fallback.body,
    // Only a path of this app: the payload can't send the user elsewhere.
    url: url && /^\/(?![/\\])[^\s\\]*$/.test(url) ? url : fallback.url,
    tag: text("tag", 50) ?? fallback.tag,
  };
}
