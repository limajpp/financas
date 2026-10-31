"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { CATEGORY_ERROR_MESSAGES } from "@/domain/categories";
import { type ActionResult, zodFailure } from "@/lib/action-result";
import {
  categoryIdSchema,
  createCategorySchema,
  updateCategorySchema,
} from "@/lib/validation/categories";
import {
  type CategoryResult,
  createCategory,
  setCategoryArchived,
  updateCategory,
} from "@/server/categories";
import { getCurrentSpace } from "@/server/session";

export type CategoryActionResult = ActionResult;

function done(result: CategoryResult): CategoryActionResult {
  if (!result.ok) {
    const error = CATEGORY_ERROR_MESSAGES[result.error];
    return {
      ok: false,
      error,
      fieldErrors: result.error === "DUPLICATE_NAME" ? { name: error } : undefined,
    };
  }
  refresh();
  return { ok: true };
}

export async function createCategoryAction(input: unknown): Promise<CategoryActionResult> {
  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  const space = await getCurrentSpace();
  return done(await createCategory(space.id, parsed.data));
}

export async function updateCategoryAction(
  id: unknown,
  input: unknown,
): Promise<CategoryActionResult> {
  const parsedId = categoryIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: CATEGORY_ERROR_MESSAGES.NOT_FOUND };
  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  const space = await getCurrentSpace();
  return done(await updateCategory(space.id, parsedId.data, parsed.data));
}

export async function setCategoryArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<CategoryActionResult> {
  const parsedId = categoryIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: CATEGORY_ERROR_MESSAGES.NOT_FOUND };
  const parsedArchived = z.boolean().safeParse(archived);
  if (!parsedArchived.success) return { ok: false, error: "Dados inválidos." };
  const space = await getCurrentSpace();
  return done(await setCategoryArchived(space.id, parsedId.data, parsedArchived.data));
}
