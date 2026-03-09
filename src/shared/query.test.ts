import { describe, expect, it } from "vitest";
import { buildBookmarkQuery } from "./query";
import { normalizeBookmark, slugifyCategoryName } from "./schema";

describe("slugifyCategoryName", () => {
  it("normalizes accents and punctuation", () => {
    expect(slugifyCategoryName("AI & Produtividade")).toBe("ai-produtividade");
  });
});

describe("normalizeBookmark", () => {
  it("normalizes a rettiwt-style bookmark", () => {
    const bookmark = normalizeBookmark({
      id: "123",
      fullText: "Interesting thread",
      createdAt: "2025-01-01T00:00:00.000Z",
      url: "https://x.com/someone/status/123",
      tweetBy: {
        fullName: "Someone",
        userName: "someone",
      },
      entities: {
        urls: ["https://example.com"],
      },
      media: [{ id: "m1", type: "photo", url: "https://pbs.twimg.com/a.jpg" }],
    });

    expect(bookmark.authorHandle).toBe("someone");
    expect(bookmark.links).toEqual(["https://example.com"]);
    expect(bookmark.media).toHaveLength(1);
  });
});

describe("buildBookmarkQuery", () => {
  it("builds a query with search and category filters", () => {
    const query = buildBookmarkQuery({
      q: "llm",
      category: "ai",
      media: "only",
      limit: 20,
    });

    expect(query.sql).toContain("COALESCE(b.manual_category_slug, b.category_slug) = ?");
    expect(query.sql).toContain("b.has_media = 1");
    expect(query.params).toHaveLength(7);
  });
});
