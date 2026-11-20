import type { CategoryType } from "@/domain/categories";

/** A category as the settings screen receives it (serializable, children nested). */
export type CategoryView = {
  id: string;
  parentId: string | null;
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  isFixed: boolean;
  archived: boolean;
  children: CategoryView[];
};
