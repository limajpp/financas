import type { z } from "zod";

/** What a form's Server Action returns: ok, or a pt-BR message (and per-field messages). */
export type ActionResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Partial<Record<string, string>> };

export type ActionFailure = Extract<ActionResult, { ok: false }>;

/** A Zod failure as an ActionResult, keeping the first message of each field. */
export function zodFailure(error: z.ZodError): ActionFailure {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos.", fieldErrors };
}
