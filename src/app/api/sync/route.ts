import { syncRequestSchema } from "@/lib/validation/sync";
import { getCurrentSpace, getSession } from "@/server/session";
import { syncItems } from "@/server/sync";

const json = (status: number, error: string) => Response.json({ error }, { status });

/** The host the browser asked for: behind the Vercel proxy it comes in `x-forwarded-host`. */
function requestHost(request: Request) {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

/** Browsers send `Origin` on every POST: another site's page can't use the session cookie here. */
function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}

/**
 * Receives the offline queue (docs/specs/tasks/16-offline-queue.md) and answers item by item.
 * The space is the signed-in user's: nothing in the body chooses it.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json(403, "Origem não permitida.");
  // No redirect to the login here (the proxy lets this route through): the queue reads the 401.
  const session = await getSession();
  if (!session) return json(401, "Sessão expirada. Entre de novo.");

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json(400, "Envie os lançamentos em JSON.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, "Envie os lançamentos em JSON.");
  }
  const parsed = syncRequestSchema.safeParse(body);
  if (!parsed.success) return json(400, "Lote inválido.");

  const space = await getCurrentSpace();
  const results = await syncItems(space.id, session.user.id, parsed.data.items);
  return Response.json({ results });
}
