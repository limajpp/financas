import "server-only";

import {
  buildCategoryTree,
  type CategoryError,
  type CategoryType,
  fixedFlagFor,
  selectableTree,
  validateNewCategory,
  validateRename,
  validateUnarchive,
} from "@/domain/categories";
import { DEFAULT_CATEGORIES } from "@/domain/default-categories";
import { db } from "@/lib/db";
import type { CreateCategoryInput, UpdateCategoryInput } from "@/lib/validation/categories";

const categorySelect = {
  id: true,
  parentId: true,
  name: true,
  type: true,
  icon: true,
  color: true,
  isFixed: true,
  archivedAt: true,
} as const;

export type CategoryRow = Awaited<ReturnType<typeof spaceCategories>>[number];

export type CategoryResult =
  { ok: true; category: CategoryRow } | { ok: false; error: CategoryError | "NOT_FOUND" };

function spaceCategories(spaceId: string) {
  return db.category.findMany({ where: { spaceId }, select: categorySelect });
}

/**
 * Creates the default list once per space. The conditional UPDATE on categoriesSeededAt decides
 * which caller seeds; a concurrent caller waits on the row lock and then finds the mark set.
 */
export async function ensureDefaultCategories(spaceId: string) {
  await db.$transaction(async (tx) => {
    const claimed = await tx.space.updateMany({
      where: { id: spaceId, categoriesSeededAt: null },
      data: { categoriesSeededAt: new Date() },
    });
    if (claimed.count === 0) return;

    for (const parent of DEFAULT_CATEGORIES) {
      await tx.category.create({
        data: {
          spaceId,
          name: parent.name,
          type: parent.type,
          icon: parent.icon,
          color: parent.color,
          isFixed: fixedFlagFor(parent.type, parent.isFixed ?? false),
          children: {
            createMany: {
              data: (parent.children ?? []).map((child) => ({
                spaceId,
                name: child.name,
                type: parent.type,
                icon: child.icon ?? parent.icon,
                color: parent.color,
                isFixed: fixedFlagFor(parent.type, child.isFixed ?? false),
              })),
            },
          },
        },
      });
    }
  });
}

/** The space's categories as a tree. Without `includeArchived`, archived ones (and children of archived parents) are left out. */
export async function listCategories(spaceId: string, { includeArchived = false } = {}) {
  const tree = buildCategoryTree(await spaceCategories(spaceId));
  if (includeArchived) return tree;
  return tree
    .filter((parent) => parent.archivedAt === null)
    .map((parent) => ({
      ...parent,
      children: parent.children.filter((child) => child.archivedAt === null),
    }));
}

/** What a category picker offers for one type. */
export async function selectableCategories(spaceId: string, type: CategoryType) {
  return selectableTree(await spaceCategories(spaceId), type);
}

export async function createCategory(
  spaceId: string,
  input: CreateCategoryInput,
): Promise<CategoryResult> {
  const existing = await spaceCategories(spaceId);
  const checked = validateNewCategory(input, existing);
  if (!checked.ok) return checked;

  const category = await db.category.create({
    data: {
      spaceId,
      parentId: input.parentId,
      name: input.name,
      type: checked.value.type,
      icon: input.icon,
      color: input.color,
      isFixed: fixedFlagFor(checked.value.type, input.isFixed),
    },
    select: categorySelect,
  });
  return { ok: true, category };
}

/** Changes name, icon, color and the fixed flag. Parent and type never change. */
export async function updateCategory(
  spaceId: string,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryResult> {
  const existing = await spaceCategories(spaceId);
  const current = existing.find((c) => c.id === id);
  if (!current) return { ok: false, error: "NOT_FOUND" };

  const checked = validateRename(current, input.name, existing);
  if (!checked.ok) return checked;

  const category = await db.category.update({
    where: { id, spaceId },
    data: {
      name: input.name,
      icon: input.icon,
      color: input.color,
      isFixed: fixedFlagFor(current.type, input.isFixed),
    },
    select: categorySelect,
  });
  return { ok: true, category };
}

export async function setCategoryArchived(
  spaceId: string,
  id: string,
  archived: boolean,
): Promise<CategoryResult> {
  const existing = await spaceCategories(spaceId);
  const current = existing.find((c) => c.id === id);
  if (!current) return { ok: false, error: "NOT_FOUND" };

  if (!archived) {
    const checked = validateUnarchive(current, existing);
    if (!checked.ok) return checked;
  }

  const category = await db.category.update({
    where: { id, spaceId },
    data: { archivedAt: archived ? (current.archivedAt ?? new Date()) : null },
    select: categorySelect,
  });
  return { ok: true, category };
}
