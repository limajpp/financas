import { z } from "zod";

import { cleanAliases } from "@/domain/counterparties";
import { ALIAS_MAX, MAX_ALIASES } from "@/domain/counterparty-memory";
import { DOCUMENT_ERROR_MESSAGES, parseDocument } from "@/domain/document";
import { COUNTERPARTY_NAME_MAX, DESCRIPTION_MAX } from "@/domain/transactions";
import type { MemoryInput } from "@/server/counterparties";

export const counterpartyIdSchema = z.uuid({ error: "Estabelecimento não encontrado." });

/** The counterparty's memory (task 20): name, aliases, CPF/CNPJ and the defaults. */
export const memorySchema = z
  .object({
    name: z
      .string({ error: "Informe o nome." })
      .trim()
      .min(1, { error: "Informe o nome." })
      .max(COUNTERPARTY_NAME_MAX, {
        error: `O nome pode ter no máximo ${COUNTERPARTY_NAME_MAX} caracteres.`,
      }),
    aliases: z
      .array(
        z
          .string({ error: "Apelido inválido." })
          .max(ALIAS_MAX, { error: `Um apelido pode ter no máximo ${ALIAS_MAX} caracteres.` }),
        { error: "Apelidos inválidos." },
      )
      .default([]),
    document: z
      .string()
      .trim()
      .max(40, { error: DOCUMENT_ERROR_MESSAGES.INVALID_LENGTH })
      .nullish()
      .transform((text, ctx) => {
        if (!text) return null;
        const parsed = parseDocument(text);
        if (parsed.ok) return parsed.document;
        ctx.addIssue({ code: "custom", message: DOCUMENT_ERROR_MESSAGES[parsed.error] });
        return z.NEVER;
      }),
    defaultCategoryId: z
      .preprocess(
        (v) => (v === "" ? null : v),
        z.uuid({ error: "Categoria não encontrada." }).nullish(),
      )
      .transform((v) => v ?? null),
    defaultDescription: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX, {
        error: `A observação pode ter no máximo ${DESCRIPTION_MAX} caracteres.`,
      })
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .transform((input, ctx): MemoryInput => {
    const aliases = cleanAliases(input.name, input.aliases);
    if (aliases.length > MAX_ALIASES) {
      ctx.addIssue({
        code: "custom",
        path: ["aliases"],
        message: `São no máximo ${MAX_ALIASES} apelidos.`,
      });
      return z.NEVER;
    }
    return { ...input, aliases };
  });
