import { describe, expect, it } from "vitest";
import { normalizeBookmark } from "./schema";

describe("normalizeBookmark", () => {
  it("normalizes twitter-web-exporter flat rows", () => {
    const bookmark = normalizeBookmark(
      {
        id: "1900000000000000001",
        created_at: "2026-03-05 10:20:30",
        full_text: "Interesting thread about retrieval systems",
        screen_name: "exampleuser",
        name: "Example User",
        user_id: "42",
        url: "https://x.com/exampleuser/status/1900000000000000001",
        media: JSON.stringify([
          {
            type: "photo",
            original: "https://pbs.twimg.com/media/example.jpg?name=orig",
            thumbnail: "https://pbs.twimg.com/media/example.jpg?name=thumb",
          },
        ]),
      },
      "twitter-web-exporter",
    );

    expect(bookmark.id).toBe("1900000000000000001");
    expect(bookmark.authorHandle).toBe("exampleuser");
    expect(bookmark.authorName).toBe("Example User");
    expect(bookmark.authorId).toBe("42");
    expect(bookmark.text).toBe("Interesting thread about retrieval systems");
    expect(bookmark.media[0]?.url).toContain("orig");
    expect(bookmark.media[0]?.thumbnailUrl).toContain("thumb");
    expect(bookmark.source).toBe("twitter-web-exporter");
  });

  it("normalizes raw graphql tweets from the X web client", () => {
    const bookmark = normalizeBookmark(
      {
        rest_id: "1900000000000000002",
        core: {
          user_results: {
            result: {
              rest_id: "84",
              core: {
                name: "Research Desk",
                screen_name: "researchdesk",
              },
            },
          },
        },
        legacy: {
          created_at: "Thu Mar 06 12:00:00 +0000 2026",
          full_text: "Fresh raw tweet payload",
          lang: "en",
          entities: {
            urls: [{ expanded_url: "https://example.com/post" }],
          },
          extended_entities: {
            media: [
              {
                id_str: "m1",
                type: "photo",
                media_url_https: "https://pbs.twimg.com/media/raw.jpg",
              },
            ],
          },
        },
      },
      "twitter-web-sync",
    );

    expect(bookmark.id).toBe("1900000000000000002");
    expect(bookmark.authorHandle).toBe("researchdesk");
    expect(bookmark.authorName).toBe("Research Desk");
    expect(bookmark.links).toEqual(["https://example.com/post"]);
    expect(bookmark.media).toHaveLength(1);
    expect(bookmark.lang).toBe("en");
    expect(bookmark.url).toBe("https://x.com/researchdesk/status/1900000000000000002");
  });
});
