import { afterEach, describe, expect, it, vi } from "vitest";

const { getMediaAssetByHash, syncMirroredMediaIntoBookmark, upsertMediaAsset } = vi.hoisted(() => ({
  getMediaAssetByHash: vi.fn(),
  syncMirroredMediaIntoBookmark: vi.fn(),
  upsertMediaAsset: vi.fn(),
}));

vi.mock("./db", () => ({
  getMediaAssetByHash,
  syncMirroredMediaIntoBookmark,
  upsertMediaAsset,
}));

import { reconcileBookmarkMedia } from "./media-sync";
import type { BookmarkRecord } from "../shared/schema";
import type { Env } from "./env";

function makeBookmark(): BookmarkRecord {
  return {
    id: "1",
    url: "https://x.com/test/status/1",
    text: "bookmark",
    authorName: "Test",
    authorHandle: "test",
    createdAt: "2026-03-18T00:00:00.000Z",
    links: [],
    media: [
      {
        id: "m1",
        type: "photo",
        url: "https://example.com/original.jpg",
        thumbnailUrl: "https://example.com/thumb.jpg",
        mirroredUrl: "/api/media/media/existing.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4096,
      },
    ],
    source: "twitter-web-sync",
    importedAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
  };
}

function makeEnv(): Env {
  return {
    APP_TITLE: "Bookmark Bureau",
    ASSETS: undefined as unknown as Fetcher,
    DB: {} as D1Database,
    DEFAULT_IMPORT_SOURCE: "test",
    GEMINI_MODEL: "gemini-test",
  };
}

describe("reconcileBookmarkMedia", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("backfills media_assets rows for already mirrored media without downloading again", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await reconcileBookmarkMedia(makeEnv(), makeBookmark());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upsertMediaAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookmarkId: "1",
        mediaId: "m1",
        r2Key: "media/existing.jpg",
        status: "uploaded",
      }),
    );
    expect(syncMirroredMediaIntoBookmark).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mirrored: 0, failed: 0, backfilled: 1 });
  });
});
