import { z } from "zod";

import { ALIAS_MAX } from "@/domain/counterparty-memory";
import { isCalendarDate } from "@/domain/dates";
import { DOCUMENT_ERROR_MESSAGES, parseDocument } from "@/domain/document";
import { MAX_AMOUNT_CENTS } from "@/domain/money";
import {
  COUNTERPARTY_NAME_MAX,
  DESCRIPTION_MAX,
  ENTRY_TYPES,
  type EntryInput,
  PAYMENT_METHODS,
} from "@/domain/transactions";

/** A blank value (an empty select or field) counts as absent. */
const optional = <T extends z.ZodType>(schema: T) =>
  z
    .preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullish())
    .transform((v) => v ?? null);

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { error: message })
    .nullish()
    .transform((v) => (v ? v : null));

/**
 * An expense or income. The amount comes in cents (the keypad builds it). Credit purchases point
 * to a card, every other method to an account: the field the method doesn't use is dropped.
 */
export const entrySchema = z
  .object({
    type: z.enum(ENTRY_TYPES, { error: "Tipo inválido." }),
    amountCents: z
      .number({ error: "Informe o valor." })
      .int({ error: "Valor inválido." })
      .min(1, { error: "O valor precisa ser maior que zero." })
      .max(MAX_AMOUNT_CENTS, { error: "O valor pode ser no máximo R$ 20.000.000,00." }),
    date: z
      .string({ error: "Informe a data." })
      .min(1, { error: "Informe a data.", abort: true })
      .refine(isCalendarDate, { error: "Data inválida." }),
    method: z.enum(PAYMENT_METHODS, { error: "Escolha a forma de pagamento." }),
    accountId: optional(z.uuid({ error: "Conta não encontrada." })),
    cardId: optional(z.uuid({ error: "Cartão não encontrado." })),
    invoiceDueDate: optional(z.string().refine(isCalendarDate, { error: "Fatura inválida." })),
    categoryId: optional(z.uuid({ error: "Categoria não encontrada." })),
    counterparty: optionalText(
      COUNTERPARTY_NAME_MAX,
      `O estabelecimento pode ter no máximo ${COUNTERPARTY_NAME_MAX} caracteres.`,
    ),
    description: optionalText(
      DESCRIPTION_MAX,
      `A descrição pode ter no máximo ${DESCRIPTION_MAX} caracteres.`,
    ),
    counterpartyAlias: optionalText(
      ALIAS_MAX,
      `O nome no extrato pode ter no máximo ${ALIAS_MAX} caracteres.`,
    ),
    counterpartyDocument: optionalText(40, DOCUMENT_ERROR_MESSAGES.INVALID_LENGTH).transform(
      (text, ctx) => {
        if (text === null) return null;
        const parsed = parseDocument(text);
        if (parsed.ok) return parsed.document;
        ctx.addIssue({ code: "custom", message: DOCUMENT_ERROR_MESSAGES[parsed.error] });
        return z.NEVER;
      },
    ),
  })
  .transform((entry, ctx): EntryInput => {
    // The alias and the CPF/CNPJ belong to the counterparty: they need one.
    if (
      entry.counterparty === null &&
      (entry.counterpartyAlias !== null || entry.counterpartyDocument !== null)
    ) {
      const what = entry.counterpartyAlias !== null ? "o nome no extrato" : "o CPF/CNPJ";
      ctx.addIssue({
        code: "custom",
        path: ["counterparty"],
        message: `Informe o que foi para guardar ${what}.`,
      });
      return z.NEVER;
    }
    if (entry.method === "CREDIT") {
      if (!entry.cardId) {
        ctx.addIssue({ code: "custom", path: ["cardId"], message: "Escolha o cartão." });
        return z.NEVER;
      }
      return { ...entry, accountId: null };
    }
    if (!entry.accountId) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Escolha a conta." });
      return z.NEVER;
    }
    return { ...entry, cardId: null, invoiceDueDate: null };
  });

/** The id the device gives a new entry, so a retried create doesn't duplicate it. */
export const clientIdSchema = z.uuid({ error: "Identificador do lançamento inválido." });

export const transactionIdSchema = z.uuid({ error: "Lançamento não encontrado." });

export type EntryFormInput = z.input<typeof entrySchema>;
