import { isCronAuthorized } from "@/lib/cron-auth";
import { runDailyCron } from "@/server/cron";

/**
 * Called by Vercel Cron once a day (vercel.json), with `Authorization: Bearer <CRON_SECRET>`.
 * The proxy lets /api/cron through, so the route answers 401 instead of redirecting to the login.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  return Response.json(await runDailyCron());
}
