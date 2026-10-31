import { z } from "zod";

import { CARD_NAME_MAX } from "@/domain/cards";
import { MAX_AMOUNT_TEXT, parseBRL } from "@/domain/money";

const cycleDay = (label: string) =>
  z.coerce
    .number({ error: `Escolha o dia do ${label}.` })
    .int({ error: `Escolha o dia do ${label}.` })
    .min(1, { error: `Escolha o dia do ${label}.` })
    .max(31, { error: `Escolha o dia do ${label}.` });

/** The card form as typed. The limit is optional text in Brazilian format; output is in cents. */
export const cardSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Informe o nome." })
    .max(CARD_NAME_MAX, { error: `O nome pode ter no máximo ${CARD_NAME_MAX} caracteres.` }),
  accountId: z.uuid({ error: "Escolha a conta que paga a fatura." }),
  closingDay: cycleDay("fechamento"),
  dueDay: cycleDay("vencimento"),
  limit: z
    .string()
    .trim()
    .max(MAX_AMOUNT_TEXT, { error: "Limite inválido. Use o formato 1.234,56." })
    .default("")
    .transform((text, ctx) => {
      if (text === "") return null;
      const cents = parseBRL(text);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: "custom", message: "Limite inválido. Use um valor maior que zero." });
        return z.NEVER;
      }
      return cents;
    }),
});

export const cardIdSchema = z.uuid({ error: "Cartão não encontrado." });

export type CardFormInput = z.input<typeof cardSchema>;
export type CardInput = z.output<typeof cardSchema>;
