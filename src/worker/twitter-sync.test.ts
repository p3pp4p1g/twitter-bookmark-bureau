import { beforeEach, describe, expect, it, vi } from "vitest";

const findExistingBookmarkIds = vi.fn();
const getBookmarksForClassification = vi.fn();
const getBookmarksForMediaReconciliation = vi.fn();
const getOpsStatus = vi.fn();
const getSyncStatus = vi.fn();
const listCategories = vi.fn();
const markSyncFinished = vi.fn();
const markSyncStarted = vi.fn();
const notifyInfo = vi.fn();
const recordImportRun = vi.fn();
const reportAlert = vi.fn();
const resolveAlert = vi.fn();
const reconcileBookmarkMedia = vi.fn();
const upsertCategories = vi.fn();
const upsertBookmarks = vi.fn();
const classifyBookmarksWithGeminiSafe = vi.fn();

vi.mock("./db", () => ({
  findExistingBookmarkIds,
  getBookmarksForClassification,
  getBookmarksForMediaReconciliation,
  getOpsStatus,
  getSyncStatus,
  listCategories,
  markSyncFinished,
  markSyncStarted,
  recordImportRun,
  upsertBookmarks,
  upsertCategories,
}));

vi.mock("./gemini", () => ({
  classifyBookmarksWithGeminiSafe,
}));

vi.mock("./alerts", () => ({
  notifyInfo,
  reportAlert,
  resolveAlert,
}));

vi.mock("./media-sync", () => ({
  reconcileBookmarkMedia,
}));

describe("classifyPendingBookmarks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSyncStatus.mockResolvedValue({
      source: "twitter-web-sync",
      status: "idle",
    });
    getBookmarksForMediaReconciliation.mockResolvedValue([]);
    getOpsStatus.mockResolvedValue({
      media: {
        totalAssets: 0,
        uploadedAssets: 0,
        pendingAssets: 0,
        failedAssets: 0,
        bookmarksMissingMedia: 0,
      },
      activeAlerts: [],
    });
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

  it("drains a limited historical media backlog during the daily worker sync", async () => {
    findExistingBookmarkIds.mockResolvedValue(new Set(["1900000000000000001"]));
    getBookmarksForMediaReconciliation.mockResolvedValue([
      {
        id: "backlog-1",
        url: "https://x.com/test/status/backlog-1",
        text: "backlog media",
        authorName: "Test",
        authorHandle: "test",
        createdAt: "2026-03-18T00:00:00.000Z",
        links: [],
        media: [{ id: "m1", type: "photo", url: "https://example.com/image.jpg" }],
        source: "twitter-web-sync",
        importedAt: "2026-03-18T00:00:00.000Z",
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
    ]);
    reconcileBookmarkMedia.mockResolvedValue({ mirrored: 0, failed: 0, backfilled: 1 });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            timeline: {
              entries: [
                {
                  __typename: "TimelineTweet",
                  tweet_results: {
                    result: {
                      __typename: "Tweet",
                      rest_id: "1900000000000000001",
                      legacy: {
                        full_text: "hello",
                        created_at: "2026-04-09T12:00:00.000Z",
                      },
                      core: {
                        user_results: {
                          result: {
                            legacy: {
                              screen_name: "test",
                              name: "Test",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      }),
    );

    const { runScheduledTwitterSync } = await import("./twitter-sync");

    await runScheduledTwitterSync({
      APP_TITLE: "Bookmark Bureau",
      ASSETS: undefined as unknown as Fetcher,
      DB: {} as D1Database,
      DEFAULT_IMPORT_SOURCE: "test",
      GEMINI_MODEL: "gemini-test",
      MEDIA_BACKLOG_DRAIN_LIMIT: "5",
      X_API_KEY: "auth_token=test; ct0=csrf;",
    });

    expect(getBookmarksForMediaReconciliation).toHaveBeenCalledWith(expect.anything(), {
      limit: 5,
      excludeIds: [],
    });
    expect(reconcileBookmarkMedia).toHaveBeenCalledWith(
      expect.objectContaining({ MEDIA_BACKLOG_DRAIN_LIMIT: "5" }),
      expect.objectContaining({ id: "backlog-1" }),
    );
    expect(resolveAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: "media-sync",
        metadata: expect.objectContaining({
          backfilled: 1,
          backlogProcessed: 1,
        }),
      }),
    );
    expect(notifyInfo).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.stringContaining("corrigidas=1"),
    );
  });

  it("records a partial import run when bookmarks were persisted before a later failure", async () => {
    findExistingBookmarkIds.mockResolvedValue(new Set());
    listCategories.mockResolvedValue([]);
    classifyBookmarksWithGeminiSafe.mockRejectedValue(new Error("Gemini timeout"));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            timeline: {
              entries: [
                {
                  __typename: "TimelineTweet",
                  tweet_results: {
                    result: {
                      __typename: "Tweet",
                      rest_id: "1900000000000000001",
                      legacy: {
                        full_text: "hello",
                        created_at: "2026-04-09T12:00:00.000Z",
                      },
                      core: {
                        user_results: {
                          result: {
                            legacy: {
                              screen_name: "test",
                              name: "Test",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      }),
    );

    const { runTwitterBookmarksSync } = await import("./twitter-sync");

    await expect(
      runTwitterBookmarksSync({
        APP_TITLE: "Bookmark Bureau",
        ASSETS: undefined as unknown as Fetcher,
        DB: {} as D1Database,
        DEFAULT_IMPORT_SOURCE: "test",
        GEMINI_API_KEY: "test-key",
        GEMINI_MODEL: "gemini-test",
        X_API_KEY: "auth_token=test; ct0=csrf;",
      }),
    ).rejects.toThrow("Gemini timeout");

    expect(upsertBookmarks).toHaveBeenCalledTimes(1);
    expect(recordImportRun).toHaveBeenCalledTimes(1);
    expect(recordImportRun.mock.calls[0]?.[2]).toMatchObject({
      fetchedBookmarks: 1,
      newBookmarks: 1,
      fetchedPages: 1,
      classifiedBookmarks: 0,
      stoppedReason: "cursor_exhausted",
      syncResult: "partial-failure",
      syncError: "Gemini timeout",
    });
    expect(markSyncFinished).toHaveBeenCalledWith(
      expect.anything(),
      "twitter-web-sync",
      expect.objectContaining({
        status: "error",
        error: "Gemini timeout",
        stats: expect.objectContaining({
          newBookmarks: 1,
        }),
      }),
    );
  });
});
