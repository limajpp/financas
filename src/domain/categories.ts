/**
 * Category rules: a two-level tree per space. Pure functions only (no Prisma, no I/O).
 */

export const CATEGORY_TYPES = ["EXPENSE", "INCOME"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

/** lucide-react icon names a category can use. The UI maps each name to its component. */
export const CATEGORY_ICONS = [
  "House",
  "Building2",
  "Lightbulb",
  "Wrench",
  "Utensils",
  "ShoppingCart",
  "UtensilsCrossed",
  "Bike",
  "Croissant",
  "Coffee",
  "Car",
  "Fuel",
  "Bus",
  "CarTaxiFront",
  "ParkingCircle",
  "HeartPulse",
  "Stethoscope",
  "Pill",
  "GraduationCap",
  "BookOpen",
  "Plane",
  "Ticket",
  "Palette",
  "Gamepad2",
  "Music",
  "ShoppingBag",
  "Shirt",
  "Laptop",
  "Sofa",
  "Sparkles",
  "Scissors",
  "Dumbbell",
  "Repeat",
  "Tv",
  "Smartphone",
  "Wifi",
  "PawPrint",
  "Baby",
  "Gift",
  "HandHeart",
  "Receipt",
  "Landmark",
  "Percent",
  "Briefcase",
  "Wallet",
  "TrendingUp",
  "Undo2",
  "PiggyBank",
  "Coins",
  "Banknote",
  "Tag",
  "CircleEllipsis",
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** Palette keys. The UI turns each key into theme colors. */
export const CATEGORY_COLORS = [
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "sky",
  "blue",
  "violet",
  "pink",
  "slate",
] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export const CATEGORY_NAME_MAX = 40;

/** The fields the rules look at. */
export type CategoryNode = {
  id: string;
  parentId: string | null;
  name: string;
  type: CategoryType;
  isFixed: boolean;
  archivedAt: Date | null;
};

export type CategoryError =
  | "PARENT_NOT_FOUND"
  | "PARENT_IS_SUBCATEGORY"
  | "PARENT_ARCHIVED"
  | "TYPE_MISMATCH"
  | "DUPLICATE_NAME";

export const CATEGORY_ERROR_MESSAGES: Record<CategoryError | "NOT_FOUND", string> = {
  NOT_FOUND: "Categoria não encontrada.",
  PARENT_NOT_FOUND: "Categoria principal não encontrada.",
  PARENT_IS_SUBCATEGORY: "Uma subcategoria não pode ter subcategorias.",
  PARENT_ARCHIVED: "A categoria principal está arquivada. Desarquive-a primeiro.",
  TYPE_MISMATCH: "A subcategoria precisa ser do mesmo tipo da categoria principal.",
  DUPLICATE_NAME: "Já existe uma categoria com esse nome aqui.",
};

export type RuleResult<T = void> = { ok: true; value: T } | { ok: false; error: CategoryError };

/** Comparison key: no accents, no case, single spaces. "  Saúde " → "saude". */
export function normalizeCategoryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Siblings share the parent (or, at the top level, the type). */
function isSibling(
  a: Pick<CategoryNode, "parentId" | "type">,
  b: Pick<CategoryNode, "parentId" | "type">,
) {
  return a.parentId === b.parentId && (a.parentId !== null || a.type === b.type);
}

function hasDuplicateName(
  candidate: Pick<CategoryNode, "parentId" | "type" | "name"> & { id?: string },
  existing: readonly CategoryNode[],
) {
  const key = normalizeCategoryName(candidate.name);
  return existing.some(
    (c) =>
      c.id !== candidate.id && isSibling(c, candidate) && normalizeCategoryName(c.name) === key,
  );
}

/**
 * Checks a new category against the space's categories. A subcategory takes its parent's type;
 * the returned type is the one to store.
 */
export function validateNewCategory(
  input: { name: string; type: CategoryType; parentId: string | null },
  existing: readonly CategoryNode[],
): RuleResult<{ type: CategoryType }> {
  let type = input.type;
  if (input.parentId !== null) {
    const parent = existing.find((c) => c.id === input.parentId);
    if (!parent) return { ok: false, error: "PARENT_NOT_FOUND" };
    if (parent.parentId !== null) return { ok: false, error: "PARENT_IS_SUBCATEGORY" };
    if (parent.archivedAt !== null) return { ok: false, error: "PARENT_ARCHIVED" };
    if (parent.type !== input.type) return { ok: false, error: "TYPE_MISMATCH" };
    type = parent.type;
  }
  if (hasDuplicateName({ name: input.name, parentId: input.parentId, type }, existing)) {
    return { ok: false, error: "DUPLICATE_NAME" };
  }
  return { ok: true, value: { type } };
}

/** Checks a rename of `category` (parent and type never change). */
export function validateRename(
  category: CategoryNode,
  name: string,
  existing: readonly CategoryNode[],
): RuleResult {
  if (hasDuplicateName({ ...category, name }, existing)) {
    return { ok: false, error: "DUPLICATE_NAME" };
  }
  return { ok: true, value: undefined };
}

/** A subcategory can only come back once its parent is active. */
export function validateUnarchive(
  category: CategoryNode,
  existing: readonly CategoryNode[],
): RuleResult {
  if (category.parentId === null) return { ok: true, value: undefined };
  const parent = existing.find((c) => c.id === category.parentId);
  if (parent?.archivedAt != null) return { ok: false, error: "PARENT_ARCHIVED" };
  return { ok: true, value: undefined };
}

/** Income is never fixed: the flag only exists for the fixed × variable expense indicator. */
export function fixedFlagFor(type: CategoryType, isFixed: boolean): boolean {
  return type === "EXPENSE" && isFixed;
}

/** Fixed if the category or its parent is marked (expenses only). */
export function isFixedEffective(
  category: Pick<CategoryNode, "type" | "isFixed">,
  parent?: Pick<CategoryNode, "isFixed"> | null,
): boolean {
  return category.type === "EXPENSE" && (category.isFixed || (parent?.isFixed ?? false));
}

/** Archived if the category or its parent is archived. */
export function isArchivedEffective(
  category: Pick<CategoryNode, "archivedAt">,
  parent?: Pick<CategoryNode, "archivedAt"> | null,
): boolean {
  return category.archivedAt !== null || (parent?.archivedAt ?? null) !== null;
}

export type CategoryTreeNode<T extends CategoryNode> = T & { children: T[] };

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Top-level categories in pt-BR alphabetical order, each with its sorted children. */
export function buildCategoryTree<T extends CategoryNode>(
  categories: readonly T[],
): CategoryTreeNode<T>[] {
  const byName = (a: T, b: T) => collator.compare(a.name, b.name);
  return categories
    .filter((c) => c.parentId === null)
    .sort(byName)
    .map((parent) => ({
      ...parent,
      children: categories.filter((c) => c.parentId === parent.id).sort(byName),
    }));
}

/** The tree a picker offers: one type, nothing archived (directly or through the parent). */
export function selectableTree<T extends CategoryNode>(
  categories: readonly T[],
  type: CategoryType,
): CategoryTreeNode<T>[] {
  return buildCategoryTree(categories.filter((c) => c.type === type))
    .filter((parent) => parent.archivedAt === null)
    .map((parent) => ({
      ...parent,
      children: parent.children.filter((c) => c.archivedAt === null),
    }));
}
