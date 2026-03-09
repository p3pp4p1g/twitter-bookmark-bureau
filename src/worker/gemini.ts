import { llmResponseSchema, toCategoryRecords } from "../shared/classification";
import { consolidateClassification } from "../shared/consolidation";
import { colorFromSlug, slugifyCategoryName, type BookmarkRecord, type CategoryRecord } from "../shared/schema";
import type { Env } from "./env";

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]+?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export async function classifyBookmarksWithGemini(
  env: Env,
  bookmarks: BookmarkRecord[],
  existingCategories: CategoryRecord[],
): Promise<{ categories: CategoryRecord[]; assignments: BookmarkRecord[] }> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  if (!bookmarks.length) {
    return { categories: [] as CategoryRecord[], assignments: [] as BookmarkRecord[] };
  }

  const prompt = `
You organize a personal archive of X/Twitter bookmarks.
Reuse existing categories whenever possible and keep the taxonomy compact.
Return JSON only with this shape:
{
  "categories": [{ "name": string, "description": string }],
  "assignments": [{ "id": string, "categoryName": string, "confidence": number, "reason": string, "summary": string }]
}

Rules:
- Prefer 4 to 8 categories total.
- Never invent IDs.
- Confidence is a float between 0 and 1.
- Summary must be one short sentence.
- Categories may be in Portuguese if the content suggests it.

Existing categories:
${JSON.stringify(existingCategories.map((category) => ({ name: category.name, description: category.description })))}

Bookmarks:
${JSON.stringify(
    bookmarks.map((bookmark) => ({
      id: bookmark.id,
      author: `@${bookmark.authorHandle}`,
      text: bookmark.text,
      links: bookmark.links,
      hasMedia: bookmark.media.length > 0,
    })),
  )}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed = llmResponseSchema.parse(JSON.parse(extractJson(content)));
  const categories = toCategoryRecords(parsed);
  const categoryByName = new Map(categories.map((category) => [category.name, category]));

  const consolidated = consolidateClassification(
    bookmarks.map((bookmark) => {
      const assignment = parsed.assignments.find((item) => item.id === bookmark.id);
      const category = assignment ? categoryByName.get(assignment.categoryName) : undefined;

      return {
        ...bookmark,
        summary: assignment?.summary ?? bookmark.summary,
        categorySlug: category?.slug ?? bookmark.categorySlug,
        categoryName: category?.name ?? bookmark.categoryName,
        categoryConfidence: assignment?.confidence ?? bookmark.categoryConfidence,
        categoryReason: assignment?.reason ?? bookmark.categoryReason,
        updatedAt: new Date().toISOString(),
      };
    }),
    categories,
  );

  return {
    categories: consolidated.categories,
    assignments: consolidated.assignments,
  };
}

function isRetriableGeminiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not configured|429|500|502|503|504|network|fetch failed/i.test(message);
}

function fallbackNeedsReview(bookmark: BookmarkRecord) {
  const slug = slugifyCategoryName("Needs Review");

  return {
    categories: [
      {
        slug,
        name: "Needs Review",
        description: "Bookmark that could not be categorized automatically and should be reviewed later.",
        color: colorFromSlug(slug),
        source: "manual" as const,
      },
    ],
    assignments: [
      {
        ...bookmark,
        summary: bookmark.summary ?? "Automatic categorization failed for this bookmark.",
        categorySlug: slug,
        categoryName: "Needs Review",
        categoryConfidence: 0,
        categoryReason: "Gemini could not classify this bookmark automatically.",
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

export async function classifyBookmarksWithGeminiSafe(
  env: Env,
  bookmarks: BookmarkRecord[],
  existingCategories: CategoryRecord[],
): Promise<{ categories: CategoryRecord[]; assignments: BookmarkRecord[] }> {
  try {
    return await classifyBookmarksWithGemini(env, bookmarks, existingCategories);
  } catch (error) {
    if (!bookmarks.length) {
      return { categories: [] as CategoryRecord[], assignments: [] as BookmarkRecord[] };
    }

    if (bookmarks.length === 1) {
      if (isRetriableGeminiError(error)) {
        throw error;
      }

      const fallback = fallbackNeedsReview(bookmarks[0]);
      const consolidated = consolidateClassification(fallback.assignments, fallback.categories);
      return {
        categories: consolidated.categories,
        assignments: consolidated.assignments,
      };
    }

    const midpoint = Math.ceil(bookmarks.length / 2);
    const left: { categories: CategoryRecord[]; assignments: BookmarkRecord[] } =
      await classifyBookmarksWithGeminiSafe(
        env,
        bookmarks.slice(0, midpoint),
        existingCategories,
      );
    const leftCategories = [
      ...existingCategories,
      ...left.categories.filter(
        (category: CategoryRecord, index: number, categories: CategoryRecord[]) =>
          categories.findIndex((candidate: CategoryRecord) => candidate.slug === category.slug) ===
          index,
      ),
    ];
    const right: { categories: CategoryRecord[]; assignments: BookmarkRecord[] } =
      await classifyBookmarksWithGeminiSafe(
        env,
        bookmarks.slice(midpoint),
        leftCategories,
      );

    const categoriesBySlug = new Map<string, CategoryRecord>();
    for (const category of [...left.categories, ...right.categories]) {
      categoriesBySlug.set(category.slug, category);
    }

    return {
      categories: [...categoriesBySlug.values()],
      assignments: [...left.assignments, ...right.assignments],
    };
  }
}
