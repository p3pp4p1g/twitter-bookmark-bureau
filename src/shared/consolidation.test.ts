import { describe, expect, it } from "vitest";
import { consolidateClassification } from "./consolidation";
import type { BookmarkRecord } from "./schema";

function makeBookmark(input: Partial<BookmarkRecord>): BookmarkRecord {
  return {
    id: input.id ?? "1",
    url: input.url ?? "https://x.com/test/status/1",
    text: input.text ?? "",
    authorName: input.authorName ?? "Test",
    authorHandle: input.authorHandle ?? "test",
    createdAt: input.createdAt ?? new Date("2026-03-07T00:00:00.000Z").toISOString(),
    links: input.links ?? [],
    media: input.media ?? [],
    source: input.source ?? "test",
    summary: input.summary,
    categorySlug: input.categorySlug,
    categoryName: input.categoryName,
    categoryConfidence: input.categoryConfidence,
    categoryReason: input.categoryReason,
    manualCategorySlug: input.manualCategorySlug,
    importedAt: input.importedAt ?? new Date("2026-03-07T00:00:00.000Z").toISOString(),
    updatedAt: input.updatedAt ?? new Date("2026-03-07T00:00:00.000Z").toISOString(),
  };
}

describe("consolidateClassification", () => {
  it("routes female-focused image prompts into the girl prompt category", () => {
    const result = consolidateClassification(
      [
        makeBookmark({
          text: "Prompt: beautiful young woman portrait, cinematic light, glossy skin",
          categorySlug: "ai-image-generation-prompts",
          categoryName: "AI Image Generation Prompts",
        }),
      ],
      [],
    );

    expect(result.assignments[0]?.categorySlug).toBe("girl-ai-image-generation-prompts");
    expect(result.assignments[0]?.categoryName).toBe("Girl AI Image Generation Prompts");
  });

  it("merges fragmented video categories into AI Video Generation", () => {
    const result = consolidateClassification(
      [
        makeBookmark({
          text: "New motion control workflow for AI animation with video input",
          categorySlug: "ai-animation-video",
          categoryName: "AI Animation & Video",
          media: [{ id: "m1", type: "video", url: "https://example.com/video.mp4" }],
        }),
      ],
      [],
    );

    expect(result.assignments[0]?.categorySlug).toBe("ai-video-generation");
    expect(result.assignments[0]?.categoryName).toBe("AI Video Generation");
  });

  it("preserves manual overrides during consolidation", () => {
    const bookmark = makeBookmark({
      text: "Prompt: anime girl portrait",
      categorySlug: "ai-image-generation-prompts",
      categoryName: "AI Image Generation Prompts",
      manualCategorySlug: "my-custom-category",
    });

    const result = consolidateClassification([bookmark], []);
    expect(result.assignments[0]?.categorySlug).toBe("ai-image-generation-prompts");
    expect(result.assignments[0]?.manualCategorySlug).toBe("my-custom-category");
  });
});
