"use server";

import { refresh } from "next/cache";
import type { z } from "zod";

import { CATEGORY_ERROR_MESSAGES } from "@/domain/categories";
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

export type CategoryActionResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Partial<Record<string, string>> };

function invalid(error: z.ZodError): CategoryActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos.", fieldErrors };
}

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
  if (!parsed.success) return invalid(parsed.error);
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
  if (!parsed.success) return invalid(parsed.error);
  const space = await getCurrentSpace();
  return done(await updateCategory(space.id, parsedId.data, parsed.data));
}

export async function setCategoryArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<CategoryActionResult> {
  const parsedId = categoryIdSchema.safeParse(id);
  if (!parsedId.success || typeof archived !== "boolean") {
    return { ok: false, error: CATEGORY_ERROR_MESSAGES.NOT_FOUND };
  }
  const space = await getCurrentSpace();
  return done(await setCategoryArchived(space.id, parsedId.data, archived));
}
