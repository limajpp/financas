import { z } from "zod";

import { ALIAS_MAX } from "@/domain/counterparty-memory";
import { isCalendarDate } from "@/domain/dates";
import { DOCUMENT_ERROR_MESSAGES, parseDocument } from "@/domain/document";
import { INSTALLMENTS_MAX, INSTALLMENTS_MIN } from "@/domain/installments";
import { MAX_AMOUNT_CENTS } from "@/domain/money";
import {
  COUNTERPARTY_NAME_MAX,
  DESCRIPTION_MAX,
  CARD_PAYMENT_METHODS,
  type CardPaymentInput,
  ENTRY_TYPES,
  type EntryInput,
  PAYMENT_METHODS,
  TRANSFER_METHODS,
  type TransferInput,
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

const amountCents = z
  .number({ error: "Informe o valor." })
  .int({ error: "Valor inválido." })
  .min(1, { error: "O valor precisa ser maior que zero." })
  .max(MAX_AMOUNT_CENTS, { error: "O valor pode ser no máximo R$ 20.000.000,00." });

const date = z
  .string({ error: "Informe a data." })
  .min(1, { error: "Informe a data.", abort: true })
  .refine(isCalendarDate, { error: "Data inválida." });

const description = optionalText(
  DESCRIPTION_MAX,
  `A descrição pode ter no máximo ${DESCRIPTION_MAX} caracteres.`,
);

/**
 * An expense or income. The amount comes in cents (the keypad builds it). Credit purchases point
 * to a card, every other method to an account: the field the method doesn't use is dropped.
 */
export const entrySchema = z
  .object({
    type: z.enum(ENTRY_TYPES, { error: "Tipo inválido." }),
    amountCents,
    date,
    method: z.enum(PAYMENT_METHODS, { error: "Escolha a forma de pagamento." }),
    accountId: optional(z.uuid({ error: "Conta não encontrada." })),
    cardId: optional(z.uuid({ error: "Cartão não encontrado." })),
    invoiceDueDate: optional(z.string().refine(isCalendarDate, { error: "Fatura inválida." })),
    categoryId: optional(z.uuid({ error: "Categoria não encontrada." })),
    counterparty: optionalText(
      COUNTERPARTY_NAME_MAX,
      `O estabelecimento pode ter no máximo ${COUNTERPARTY_NAME_MAX} caracteres.`,
    ),
    description,
    counterpartyAlias: optionalText(
      ALIAS_MAX,
      `O nome no extrato pode ter no máximo ${ALIAS_MAX} caracteres.`,
    ),
    installments: optional(
      z
        .number({ error: "Escolha de 2 a 24 parcelas." })
        .int({ error: "Escolha de 2 a 24 parcelas." })
        .min(INSTALLMENTS_MIN, { error: "Escolha de 2 a 24 parcelas." })
        .max(INSTALLMENTS_MAX, { error: "Escolha de 2 a 24 parcelas." }),
    ),
    subscription: z.boolean({ error: "Dados inválidos." }).default(false),
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
    if (entry.subscription && entry.type !== "EXPENSE") {
      ctx.addIssue({
        code: "custom",
        path: ["subscription"],
        message: "Só despesas podem ser assinaturas.",
      });
      return z.NEVER;
    }
    if (entry.subscription && entry.installments !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["subscription"],
        message: "Uma compra parcelada não pode ser assinatura.",
      });
      return z.NEVER;
    }
    if (entry.installments !== null && (entry.type !== "EXPENSE" || entry.method !== "CREDIT")) {
      ctx.addIssue({
        code: "custom",
        path: ["installments"],
        message: "Só compras no crédito podem ser parceladas.",
      });
      return z.NEVER;
    }
    if (entry.method === "CREDIT") {
      if (!entry.cardId) {
        ctx.addIssue({ code: "custom", path: ["cardId"], message: "Escolha o cartão." });
        return z.NEVER;
      }
      // Installments follow the card's invoices: no manual invoice choice.
      return {
        ...entry,
        accountId: null,
        invoiceDueDate: entry.installments !== null ? null : entry.invoiceDueDate,
      };
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

/** Money between two of your accounts. */
export const transferSchema = z
  .object({
    amountCents,
    date,
    method: z.enum(TRANSFER_METHODS, { error: "Escolha Pix, TED ou dinheiro." }),
    accountId: z.uuid({ error: "Escolha a conta de origem." }),
    toAccountId: z.uuid({ error: "Escolha a conta de destino." }),
    description,
  })
  .refine((t) => t.accountId !== t.toAccountId, {
    path: ["toAccountId"],
    error: "Escolha contas diferentes.",
  }) satisfies z.ZodType<TransferInput>;

/** Paying a card's invoice (identified by its due date) from an account. */
export const cardPaymentSchema = z.object({
  amountCents,
  date,
  method: z.enum(CARD_PAYMENT_METHODS, { error: "Escolha Pix, boleto, débito ou TED." }),
  accountId: z.uuid({ error: "Escolha a conta que paga." }),
  cardId: z.uuid({ error: "Cartão não encontrado." }),
  invoiceDueDate: z
    .string({ error: "Escolha a fatura." })
    .refine(isCalendarDate, { error: "Escolha a fatura." }),
  description,
}) satisfies z.ZodType<CardPaymentInput>;
