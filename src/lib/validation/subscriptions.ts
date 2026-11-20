import { z } from "zod";

import { MAX_AMOUNT_CENTS } from "@/domain/money";
import type { RuleEditInput } from "@/domain/subscriptions";
import { DESCRIPTION_MAX, PAYMENT_METHODS } from "@/domain/transactions";

/** A blank value (an empty select or field) counts as absent. */
const optionalId = (message: string) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.uuid({ error: message }).nullish(),
    )
    .transform((v) => v ?? null);

/**
 * The subscription's edit form (task 19). Credit points to a card, any other method to an
 * account: the field the method doesn't use is dropped.
 */
export const ruleEditSchema = z
  .object({
    amountCents: z
      .number({ error: "Informe o valor." })
      .int({ error: "Valor inválido." })
      .min(1, { error: "O valor precisa ser maior que zero." })
      .max(MAX_AMOUNT_CENTS, { error: "O valor pode ser no máximo R$ 20.000.000,00." }),
    dayOfMonth: z
      .number({ error: "Escolha o dia." })
      .int({ error: "Escolha um dia de 1 a 31." })
      .min(1, { error: "Escolha um dia de 1 a 31." })
      .max(31, { error: "Escolha um dia de 1 a 31." }),
    method: z.enum(PAYMENT_METHODS, { error: "Escolha a forma de pagamento." }),
    accountId: optionalId("Conta não encontrada."),
    cardId: optionalId("Cartão não encontrado."),
    categoryId: optionalId("Categoria não encontrada."),
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX, {
        error: `A observação pode ter no máximo ${DESCRIPTION_MAX} caracteres.`,
      })
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .transform((edit, ctx): RuleEditInput => {
    if (edit.method === "CREDIT") {
      if (!edit.cardId) {
        ctx.addIssue({ code: "custom", path: ["cardId"], message: "Escolha o cartão." });
        return z.NEVER;
      }
      return { ...edit, accountId: null };
    }
    if (!edit.accountId) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Escolha a conta." });
      return z.NEVER;
    }
    return { ...edit, cardId: null };
  });
