import { z } from "zod";

import { ACCOUNT_NAME_MAX } from "@/domain/accounts";
import { isCalendarDate } from "@/domain/dates";
import { MAX_AMOUNT_TEXT, parseBRL } from "@/domain/money";
import { PALETTE_COLORS } from "@/domain/palette";

/**
 * The account form as typed: the amount is text in Brazilian format, and `negative` flips its
 * sign (the iPhone decimal keypad has no minus key). Output is in cents.
 */
export const accountSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: "Informe o nome." })
      .max(ACCOUNT_NAME_MAX, {
        error: `O nome pode ter no máximo ${ACCOUNT_NAME_MAX} caracteres.`,
      }),
    color: z.enum(PALETTE_COLORS, { error: "Cor inválida." }),
    initialBalance: z
      .string({ error: "Informe o saldo inicial." })
      .trim()
      .min(1, { error: "Informe o saldo inicial." })
      .max(MAX_AMOUNT_TEXT, { error: "Valor inválido. Use o formato 1.234,56." })
      .transform((text, ctx) => {
        const cents = parseBRL(text);
        if (cents === null) {
          ctx.addIssue({ code: "custom", message: "Valor inválido. Use o formato 1.234,56." });
          return z.NEVER;
        }
        return cents;
      }),
    negative: z.boolean().default(false),
    initialBalanceDate: z
      .string({ error: "Informe a data." })
      .min(1, { error: "Informe a data.", abort: true })
      .refine(isCalendarDate, { error: "Data inválida." }),
  })
  .transform(({ initialBalance, negative, ...rest }) => {
    const magnitude = Math.abs(initialBalance);
    // A minus typed in the field also counts; zero stays unsigned.
    const isNegative = (negative || initialBalance < 0) && magnitude !== 0;
    return { ...rest, initialBalanceCents: isNegative ? -magnitude : magnitude };
  });

export const accountIdSchema = z.uuid({ error: "Conta não encontrada." });

export type AccountFormInput = z.input<typeof accountSchema>;
export type AccountInput = z.output<typeof accountSchema>;
