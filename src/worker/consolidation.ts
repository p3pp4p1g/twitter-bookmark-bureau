import { consolidateClassification, getCanonicalCategories } from "../shared/consolidation";
import type { BookmarkRecord } from "../shared/schema";
import {
  getBookmarksForConsolidation,
  pruneUnusedCategories,
  recordImportRun,
  upsertBookmarks,
  upsertCategories,
} from "./db";
import type { Env } from "./env";

export type ConsolidationRunResult = {
  processed: number;
  changed: number;
};

export async function runCategoryConsolidation(
  env: Env,
  options: { ids?: string[]; limit?: number } = {},
): Promise<ConsolidationRunResult> {
  const bookmarks = await getBookmarksForConsolidation(env.DB, options.ids, options.limit);

  if (!bookmarks.length) {
    return { processed: 0, changed: 0 };
  }

  const result = consolidateClassification(bookmarks, getCanonicalCategories());
  const changedAssignments: BookmarkRecord[] = result.assignments.filter((assignment, index) => {
    const original = bookmarks[index];
    return (
      assignment.categorySlug !== original.categorySlug ||
      assignment.categoryName !== original.categoryName
    );
  });

  if (result.categories.length) {
    await upsertCategories(env.DB, result.categories);
  }

  if (changedAssignments.length) {
    await upsertBookmarks(env.DB, changedAssignments);
  }

  await pruneUnusedCategories(env.DB);
  await recordImportRun(
    env.DB,
    "category-consolidation",
    {
      processed: bookmarks.length,
      changed: changedAssignments.length,
    },
  );

  return {
    processed: bookmarks.length,
    changed: changedAssignments.length,
  };
}
