import { describe, expect, it } from "vitest";

import { saoPauloDayBounds, todayInSaoPaulo } from "./dates";
import { afterPushFailure, readPushPayload, reminderBody, reminderPayload } from "./reminder";

describe("reminderBody", () => {
  it("muda conforme o que foi registrado no dia", () => {
    expect(reminderBody(0)).toBe("Nenhum lançamento hoje. Teve algum gasto?");
    expect(reminderBody(1)).toBe("Você registrou 1 lançamento hoje. Faltou algum?");
    expect(reminderBody(7)).toBe("Você registrou 7 lançamentos hoje. Faltou algum?");
  });

  it("abre o registro e substitui o lembrete anterior", () => {
    expect(reminderPayload(2)).toMatchObject({
      title: "Registrou tudo hoje?",
      url: "/registrar",
      tag: "daily-reminder",
    });
  });
});

describe("saoPauloDayBounds", () => {
  it("o dia de São Paulo vai das 03:00 UTC às 03:00 UTC do dia seguinte", () => {
    expect(saoPauloDayBounds("2026-11-14")).toEqual({
      start: new Date("2026-11-14T03:00:00Z"),
      end: new Date("2026-11-15T03:00:00Z"),
    });
  });

  it("às 21h30 de São Paulo já é outro dia em UTC, mas o dia é o de São Paulo", () => {
    const cron = new Date("2026-11-15T00:30:00Z");
    const today = todayInSaoPaulo(cron);
    expect(today).toBe("2026-11-14");
    const { start, end } = saoPauloDayBounds(today);
    expect(cron >= start && cron < end).toBe(true);
    // 23:59 in São Paulo still counts; 00:00 is the next day.
    expect(new Date("2026-11-15T02:59:59Z") < end).toBe(true);
    expect(new Date("2026-11-15T03:00:00Z") < end).toBe(false);
  });
});

describe("afterPushFailure", () => {
  it("404 e 410 apagam a inscrição; o resto tenta de novo amanhã", () => {
    expect(afterPushFailure(410)).toBe("REMOVE");
    expect(afterPushFailure(404)).toBe("REMOVE");
    for (const status of [400, 413, 429, 500, 503, undefined]) {
      expect(afterPushFailure(status), String(status)).toBe("KEEP");
    }
  });
});

describe("readPushPayload", () => {
  it("usa o que veio do servidor", () => {
    expect(readPushPayload(reminderPayload(3))).toEqual(reminderPayload(3));
  });

  it("payload vazio ou inválido vira o lembrete padrão (o iOS exige mostrar algo)", () => {
    for (const data of [null, undefined, "texto", 42, {}]) {
      expect(readPushPayload(data)).toMatchObject({
        title: "Registrou tudo hoje?",
        url: "/registrar",
      });
    }
  });

  it("só abre caminhos do próprio app", () => {
    for (const url of ["https://outro.site", "//outro.site/x", "javascript:alert(1)"]) {
      expect(readPushPayload({ ...reminderPayload(0), url }).url).toBe("/registrar");
    }
    expect(readPushPayload({ ...reminderPayload(0), url: "/lancamentos" }).url).toBe(
      "/lancamentos",
    );
  });
});
