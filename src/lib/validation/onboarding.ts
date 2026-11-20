import { z } from "zod";

import { isCalendarDate } from "@/domain/dates";
import { MAX_AMOUNT_CENTS } from "@/domain/money";
import type { OngoingPurchaseInput, SubscriptionRuleInput } from "@/domain/onboarding";
import { COUNTERPARTY_NAME_MAX } from "@/domain/transactions";

import { ruleEditSchema } from "./subscriptions";

const cents = (min: number) =>
  z
    .number({ error: "Informe o valor." })
    .int({ error: "Valor inválido." })
    .min(min, { error: "O valor precisa ser maior que zero." })
    .max(MAX_AMOUNT_CENTS, { error: "O valor pode ser no máximo R$ 20.000.000,00." });

const counterpartyText = z
  .string()
  .trim()
  .max(COUNTERPARTY_NAME_MAX, {
    error: `O nome pode ter no máximo ${COUNTERPARTY_NAME_MAX} caracteres.`,
  });

/** What the bank shows on one invoice today (zero deletes the opening balance). */
export const openingBalanceSchema = z.object({
  cardId: z.uuid({ error: "Cartão não encontrado." }),
  dueDate: z.string().refine(isCalendarDate, { error: "Fatura inválida." }),
  amountCents: cents(0),
});

const count = (message: string) =>
  z.number({ error: message }).int({ error: message }).min(1, { error: message });

/** A purchase in installments that started before the app ("3 de 10"). */
export const ongoingPurchaseSchema = z
  .object({
    clientId: z.uuid({ error: "Dados inválidos." }),
    cardId: z.uuid({ error: "Escolha o cartão." }),
    counterparty: counterpartyText.nullish().transform((v) => (v ? v : null)),
    categoryId: z
      .preprocess(
        (v) => (v === "" ? null : v),
        z.uuid({ error: "Categoria não encontrada." }).nullish(),
      )
      .transform((v) => v ?? null),
    current: count("Informe a parcela atual."),
    total: count("Informe o total de parcelas."),
    amountCents: cents(1),
  })
  .transform(({ clientId, ...input }): { clientId: string; input: OngoingPurchaseInput } => ({
    clientId,
    input,
  }));

/** A subscription already running: what its edit form takes (task 19), plus what it is. */
export const subscriptionRuleSchema = z
  .object({
    counterparty: counterpartyText.min(1, { error: "Informe o que é a assinatura." }),
    rule: ruleEditSchema,
  })
  .transform(({ counterparty, rule }): SubscriptionRuleInput => ({ ...rule, counterparty }));
