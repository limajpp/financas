import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/daily/route";
import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { pushSubscriptionSchema } from "@/lib/validation/push";
import { entrySchema } from "@/lib/validation/transactions";
import { cardSchema } from "@/lib/validation/cards";
import { createAccount } from "@/server/accounts";
import { createCard } from "@/server/cards";
import { runDailyCron } from "@/server/cron";
import {
  deletePushSubscription,
  hasPushSubscription,
  savePushSubscription,
  sendDailyReminders,
  sendTestPush,
} from "@/server/push";
import * as recurring from "@/server/recurring";
import { ensurePersonalSpace } from "@/server/spaces";
import { createTransaction } from "@/server/transactions";
import { resetDatabase } from "@/test/db";

const push = vi.hoisted(() => {
  class WebPushError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return { sendNotification: vi.fn(), WebPushError };
});
vi.mock("web-push", () => ({ default: push }));

const SECRET = "segredo-de-teste";

beforeEach(async () => {
  await resetDatabase();
  push.sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
  vi.stubEnv("VAPID_PUBLIC_KEY", "chave-publica-de-teste");
  vi.stubEnv("VAPID_PRIVATE_KEY", "chave-privada-de-teste");
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("VAPID_SUBJECT", "https://financas.example");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => db.$disconnect());

/** `at` as the current time (Date only, so Prisma's timers keep working). */
function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

async function user(email: string) {
  const row = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(row.id);
  return { userId: row.id, spaceId: space.id };
}

const endpoint = (id: string) => `https://web.push.apple.com/${id}`;
function subscription(id: string) {
  return pushSubscriptionSchema.parse({
    endpoint: endpoint(id),
    keys: { p256dh: `p256dh-${id}`, auth: `auth-${id}` },
  });
}

async function account(spaceId: string) {
  const result = await createAccount(
    spaceId,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: "2026-10-01",
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.account.id;
}

async function expense(s: { userId: string; spaceId: string }, accountId: string, extra = {}) {
  const result = await createTransaction(
    s.spaceId,
    s.userId,
    randomUUID(),
    entrySchema.parse({
      type: "EXPENSE",
      amountCents: 1_000,
      date: "2026-11-01",
      method: "PIX",
      accountId,
      ...extra,
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

const sentTo = () =>
  push.sendNotification.mock.calls.map(([sub, payload]) => ({
    endpoint: (sub as { endpoint: string }).endpoint,
    payload: JSON.parse(payload as string),
  }));

describe("rota do cron", () => {
  const call = (authorization?: string) =>
    GET(
      new Request("http://localhost/api/cron/daily", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("recusa sem o cabeçalho, com segredo errado e sem segredo configurado", async () => {
    const spy = vi.spyOn(recurring, "generateRecurring");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer errado")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    expect(push.sendNotification).not.toHaveBeenCalled();
  });

  it("com o segredo certo, gera e envia", async () => {
    const ana = await user("ana@example.com");
    await savePushSubscription(ana.userId, subscription("a"), null);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      spaces: { generated: 1, failed: 0 },
      reminders: { sent: 1, removed: 0, failed: 0 },
    });
  });
});

describe("lembrete diário", () => {
  it("conta o que cada usuário registrou no dia de São Paulo", async () => {
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    const azul = await account(ana.spaceId);
    // Yesterday 23:59 and today 00:00 in São Paulo, then today 20:00.
    at("2026-11-14T02:59:00Z");
    await expense(ana, azul);
    at("2026-11-14T03:00:00Z");
    await expense(ana, azul);
    at("2026-11-14T23:00:00Z");
    await expense(ana, azul);
    await savePushSubscription(ana.userId, subscription("ana-iphone"), "iPhone");
    await savePushSubscription(ana.userId, subscription("ana-mac"), "Mac");
    await savePushSubscription(bia.userId, subscription("bia"), null);

    // The cron at 21h30 in São Paulo: already the next day in UTC.
    at("2026-11-15T00:30:00Z");
    expect(await sendDailyReminders()).toEqual({ sent: 3, removed: 0, failed: 0, skipped: false });
    const sent = sentTo();
    expect(sent.find((s) => s.endpoint === endpoint("ana-iphone"))?.payload).toEqual({
      title: "Registrou tudo hoje?",
      body: "Você registrou 2 lançamentos hoje. Faltou algum?",
      url: "/registrar",
      tag: "daily-reminder",
    });
    expect(sent.find((s) => s.endpoint === endpoint("ana-mac"))?.payload.body).toBe(
      "Você registrou 2 lançamentos hoje. Faltou algum?",
    );
    expect(sent.find((s) => s.endpoint === endpoint("bia"))?.payload.body).toBe(
      "Nenhum lançamento hoje. Teve algum gasto?",
    );
    // TTL of 12 h: a reminder that arrived the next noon would confuse.
    // TTL 12 h and a 10 s limit per send (a stuck push service mustn't hold the cron).
    expect(push.sendNotification.mock.calls[0]![2]).toMatchObject({ TTL: 43_200, timeout: 10_000 });
    expect(await db.pushSubscription.count({ where: { lastSentAt: { not: null } } })).toBe(3);
  });

  it("não conta as cobranças geradas pelo cron nem cada parcela de uma compra", async () => {
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    at("2026-10-05T15:00:00Z");
    await expense(ana, azul, {
      date: "2026-10-05",
      amountCents: 3_990,
      counterparty: "Streaming",
      subscription: true,
    });
    const card = await createCard(
      ana.spaceId,
      cardSchema.parse({ name: "Cartão Roxo", accountId: azul, closingDay: 3, dueDay: 10 }),
    );
    if (!card.ok) throw new Error(card.error);
    // Today: one purchase in 10 installments.
    at("2026-11-05T15:00:00Z");
    await expense(ana, azul, {
      date: "2026-11-05",
      method: "CREDIT",
      accountId: undefined,
      cardId: card.card.id,
      installments: 10,
    });
    await savePushSubscription(ana.userId, subscription("a"), null);

    // The cron of the charge day: it generates November's charge, then counts.
    at("2026-11-06T00:10:00Z");
    await runDailyCron();
    expect(await db.transaction.count({ where: { recurringMonth: "2026-11" } })).toBe(1);
    expect(sentTo()[0]!.payload.body).toBe("Você registrou 1 lançamento hoje. Faltou algum?");
  });

  it("410 e 404 apagam a inscrição; 500 mantém; uma falha não impede as outras", async () => {
    const ana = await user("ana@example.com");
    for (const id of ["gone", "missing", "broken", "ok"]) {
      await savePushSubscription(ana.userId, subscription(id), null);
    }
    push.sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === endpoint("gone")) throw new push.WebPushError("Gone", 410);
      if (sub.endpoint === endpoint("missing")) throw new push.WebPushError("Not found", 404);
      if (sub.endpoint === endpoint("broken")) throw new push.WebPushError("Server", 500);
      return { statusCode: 201 };
    });
    expect(await sendDailyReminders()).toEqual({ sent: 1, removed: 2, failed: 1, skipped: false });
    const left = await db.pushSubscription.findMany({ select: { endpoint: true } });
    expect(left.map((r) => r.endpoint).sort()).toEqual([endpoint("broken"), endpoint("ok")]);
  });

  it("sem chaves VAPID, não envia nada", async () => {
    const ana = await user("ana@example.com");
    await savePushSubscription(ana.userId, subscription("a"), null);
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await sendDailyReminders()).toMatchObject({ sent: 0, skipped: true });
    expect(push.sendNotification).not.toHaveBeenCalled();
  });
});

describe("cron: assinaturas", () => {
  it("gera as cobranças vencidas de cada espaço, e a falha de um não impede o outro", async () => {
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    for (const s of [ana, bia]) {
      at("2026-10-05T15:00:00Z");
      await expense(s, await account(s.spaceId), {
        date: "2026-10-05",
        amountCents: 3_990,
        counterparty: "Streaming",
        subscription: true,
      });
    }
    const real = recurring.generateRecurring;
    vi.spyOn(recurring, "generateRecurring").mockImplementation(async (spaceId, today) => {
      if (spaceId === ana.spaceId) throw new Error("falha de teste");
      return real(spaceId, today);
    });

    at("2026-11-06T00:10:00Z"); // 21h10 on 2026-11-05 in São Paulo.
    expect(await runDailyCron()).toMatchObject({ spaces: { generated: 1, failed: 1 } });
    const months = async (spaceId: string) =>
      (
        await db.transaction.findMany({
          where: { spaceId, recurringRuleId: { not: null } },
          orderBy: { date: "asc" },
          select: { recurringMonth: true },
        })
      ).map((t) => t.recurringMonth);
    expect(await months(bia.spaceId)).toEqual(["2026-10", "2026-11"]);
    expect(await months(ana.spaceId)).toEqual(["2026-10"]);
  });
});

describe("inscrições", () => {
  it("salvar faz upsert pelo endpoint e passa a inscrição para quem está logado", async () => {
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    await savePushSubscription(ana.userId, subscription("x"), "iPhone");
    await savePushSubscription(ana.userId, subscription("x"), "iPhone");
    expect(await db.pushSubscription.count()).toBe(1);
    await savePushSubscription(bia.userId, subscription("x"), "iPhone");
    expect(await db.pushSubscription.findMany({ select: { userId: true } })).toEqual([
      { userId: bia.userId },
    ]);
    expect(await hasPushSubscription(ana.userId, endpoint("x"))).toBe(false);
    expect(await hasPushSubscription(bia.userId, endpoint("x"))).toBe(true);
  });

  it("apagar e o teste de envio só alcançam a inscrição do próprio usuário", async () => {
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    await savePushSubscription(bia.userId, subscription("bia"), null);
    await deletePushSubscription(ana.userId, endpoint("bia"));
    expect(await db.pushSubscription.count()).toBe(1);
    expect(await sendTestPush(ana.userId, endpoint("bia"))).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(push.sendNotification).not.toHaveBeenCalled();

    expect(await sendTestPush(bia.userId, endpoint("bia"))).toEqual({ ok: true });
    expect(sentTo()[0]!.payload).toMatchObject({ tag: "test", url: "/configuracoes" });
    await deletePushSubscription(bia.userId, endpoint("bia"));
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("o teste de envio numa inscrição expirada a apaga", async () => {
    const ana = await user("ana@example.com");
    await savePushSubscription(ana.userId, subscription("a"), null);
    push.sendNotification.mockRejectedValue(new push.WebPushError("Gone", 410));
    expect(await sendTestPush(ana.userId, endpoint("a"))).toEqual({ ok: false, error: "EXPIRED" });
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("apagar o usuário apaga as inscrições", async () => {
    const ana = await user("ana@example.com");
    await savePushSubscription(ana.userId, subscription("a"), null);
    await db.user.delete({ where: { id: ana.userId } });
    expect(await db.pushSubscription.count()).toBe(0);
  });
});
