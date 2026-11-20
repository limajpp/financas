import { z } from "zod";

import { CATEGORY_ICONS, CATEGORY_NAME_MAX, CATEGORY_TYPES } from "@/domain/categories";
import { PALETTE_COLORS } from "@/domain/palette";

const name = z
  .string()
  .trim()
  .min(1, { error: "Informe o nome." })
  .max(CATEGORY_NAME_MAX, { error: `O nome pode ter no máximo ${CATEGORY_NAME_MAX} caracteres.` });

const appearance = {
  icon: z.enum(CATEGORY_ICONS, { error: "Ícone inválido." }),
  color: z.enum(PALETTE_COLORS, { error: "Cor inválida." }),
  isFixed: z.boolean(),
};

export const createCategorySchema = z.object({
  name,
  type: z.enum(CATEGORY_TYPES, { error: "Tipo inválido." }),
  parentId: z.uuid({ error: "Categoria principal inválida." }).nullable(),
  ...appearance,
});

export const updateCategorySchema = z.object({ name, ...appearance });

export const categoryIdSchema = z.uuid({ error: "Categoria não encontrada." });

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
