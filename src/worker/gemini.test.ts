import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyBookmarksWithGemini } from "./gemini";
import type { BookmarkRecord, CategoryRecord } from "../shared/schema";
import type { Env } from "./env";

function makeBookmark(input: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id: input.id ?? "1",
    url: input.url ?? "https://x.com/test/status/1",
    text: input.text ?? "Test bookmark",
    authorName: input.authorName ?? "Test",
    authorHandle: input.authorHandle ?? "test",
    createdAt: input.createdAt ?? new Date("2026-03-18T00:00:00.000Z").toISOString(),
    links: input.links ?? [],
    media: input.media ?? [],
    source: input.source ?? "test",
    summary: input.summary,
    categorySlug: input.categorySlug,
    categoryName: input.categoryName,
    categoryConfidence: input.categoryConfidence,
    categoryReason: input.categoryReason,
    manualCategorySlug: input.manualCategorySlug,
    importedAt: input.importedAt ?? new Date("2026-03-18T00:00:00.000Z").toISOString(),
    updatedAt: input.updatedAt ?? new Date("2026-03-18T00:00:00.000Z").toISOString(),
  };
}

function makeCategory(input: Partial<CategoryRecord> & Pick<CategoryRecord, "slug" | "name">): CategoryRecord {
  return {
    slug: input.slug,
    name: input.name,
    description: input.description,
    color: input.color ?? "#275D73",
    source: input.source ?? "llm",
  };
}

function makeEnv(): Env {
  return {
    APP_TITLE: "Bookmark Bureau",
    ASSETS: undefined as unknown as Fetcher,
    DB: undefined as unknown as D1Database,
    DEFAULT_IMPORT_SOURCE: "test",
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "gemini-test",
  };
}

describe("classifyBookmarksWithGemini", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves assignments that reuse an existing category without repeating it in categories", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      categories: [],
                      assignments: [
                        {
                          id: "1",
                          categoryName: "AI Video Generation",
                          confidence: 0.93,
                          reason: "The bookmark is about generating videos with AI.",
                          summary: "AI video workflow.",
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await classifyBookmarksWithGemini(
      makeEnv(),
      [makeBookmark()],
      [makeCategory({ slug: "ai-video-generation", name: "AI Video Generation" })],
    );

    expect(result.assignments[0]?.categorySlug).toBe("ai-video-generation");
    expect(result.assignments[0]?.categoryName).toBe("AI Video Generation");
    expect(result.assignments[0]?.summary).toBe("AI video workflow.");
    expect(result.assignments[0]?.categoryReason).toBe(
      "The bookmark is about generating videos with AI.",
    );
  });

  it("falls back to Needs Review when Gemini omits an assignment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      categories: [],
                      assignments: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await classifyBookmarksWithGemini(makeEnv(), [makeBookmark()], []);

    expect(result.assignments[0]?.categorySlug).toBe("needs-review");
    expect(result.assignments[0]?.categoryName).toBe("Needs Review");
    expect(result.assignments[0]?.categoryConfidence).toBe(0);
    expect(result.categories.some((category) => category.slug === "needs-review")).toBe(true);
  });

  it("keeps a newly suggested non-canonical category when it is referenced by an assignment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      categories: [
                        {
                          name: "Career & Corporate Politics",
                          description: "Career dynamics and corporate politics inside larger companies.",
                        },
                      ],
                      assignments: [
                        {
                          id: "1",
                          categoryName: "Career & Corporate Politics",
                          confidence: 0.81,
                          reason: "The bookmark is about navigating corporate politics.",
                          summary: "Corporate politics career advice.",
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await classifyBookmarksWithGemini(makeEnv(), [makeBookmark()], []);

    expect(result.assignments[0]?.categorySlug).toBe("career-corporate-politics");
    expect(result.assignments[0]?.categoryName).toBe("Career & Corporate Politics");
    expect(result.categories).toContainEqual(
      expect.objectContaining({
        slug: "career-corporate-politics",
        name: "Career & Corporate Politics",
      }),
    );
  });
});
