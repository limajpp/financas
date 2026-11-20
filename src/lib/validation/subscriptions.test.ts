import { describe, expect, it } from "vitest";

import { ruleEditSchema } from "./subscriptions";

const accountId = "0192f5a0-0000-7000-8000-000000000001";
const cardId = "0192f5a0-0000-7000-8000-000000000002";
const base = { amountCents: 3_990, dayOfMonth: 8, method: "PIX", accountId, categoryId: "" };

describe("ruleEditSchema", () => {
  it("drops the field the method doesn't use; blanks are absent", () => {
    expect(ruleEditSchema.parse({ ...base, cardId })).toMatchObject({
      accountId,
      cardId: null,
      categoryId: null,
      description: null,
    });
    expect(ruleEditSchema.parse({ ...base, method: "CREDIT", cardId })).toMatchObject({
      accountId: null,
      cardId,
    });
  });

  it("asks for the account or the card, and a day from 1 to 31", () => {
    const issue = (input: object) => ruleEditSchema.safeParse(input).error?.issues[0]?.message;
    expect(issue({ ...base, method: "CREDIT" })).toBe("Escolha o cartão.");
    expect(issue({ ...base, accountId: "" })).toBe("Escolha a conta.");
    expect(issue({ ...base, dayOfMonth: 32 })).toBe("Escolha um dia de 1 a 31.");
    expect(issue({ ...base, amountCents: 0 })).toBe("O valor precisa ser maior que zero.");
  });
});
