import { beforeEach, describe, expect, it, vi } from "vitest";

const getBookmarksForClassification = vi.fn();
const listCategories = vi.fn();
const upsertCategories = vi.fn();
const upsertBookmarks = vi.fn();
const classifyBookmarksWithGeminiSafe = vi.fn();

vi.mock("./db", () => ({
  findExistingBookmarkIds: vi.fn(),
  getBookmarksForClassification,
  getOpsStatus: vi.fn(),
  getSyncStatus: vi.fn(),
  listCategories,
  markSyncFinished: vi.fn(),
  markSyncStarted: vi.fn(),
  recordImportRun: vi.fn(),
  upsertBookmarks,
  upsertCategories,
}));

vi.mock("./gemini", () => ({
  classifyBookmarksWithGeminiSafe,
}));

vi.mock("./alerts", () => ({
  notifyInfo: vi.fn(),
  reportAlert: vi.fn(),
  resolveAlert: vi.fn(),
}));

vi.mock("./media-sync", () => ({
  reconcileBookmarkMedia: vi.fn(),
}));

describe("classifyPendingBookmarks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("keeps classifying uncategorized backlog until the queue is empty", async () => {
    const firstBatch = [
      {
        id: "1",
        url: "https://x.com/test/status/1",
        text: "bookmark",
        authorName: "Test",
        authorHandle: "test",
        createdAt: "2026-03-18T00:00:00.000Z",
        links: [],
        media: [],
        source: "twitter-web-sync",
        importedAt: "2026-03-18T00:00:00.000Z",
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
    ];

    getBookmarksForClassification.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce([]);
    listCategories.mockResolvedValue([]);
    classifyBookmarksWithGeminiSafe.mockResolvedValue({
      categories: [
        {
          slug: "needs-review",
          name: "Needs Review",
          color: "#275D73",
          source: "manual",
        },
      ],
      assignments: [
        {
          ...firstBatch[0],
          categorySlug: "needs-review",
          categoryName: "Needs Review",
          categoryConfidence: 0,
          categoryReason: "Gemini could not classify this bookmark automatically.",
        },
      ],
    });

    const { classifyPendingBookmarks } = await import("./twitter-sync");
    const totalClassified = await classifyPendingBookmarks({
      APP_TITLE: "Bookmark Bureau",
      ASSETS: undefined as unknown as Fetcher,
      DB: {} as D1Database,
      DEFAULT_IMPORT_SOURCE: "test",
      GEMINI_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-test",
    });

    expect(totalClassified).toBe(1);
    expect(getBookmarksForClassification).toHaveBeenCalledTimes(2);
    expect(upsertCategories).toHaveBeenCalledTimes(1);
    expect(upsertBookmarks).toHaveBeenCalledTimes(1);
  });
});
