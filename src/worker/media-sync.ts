import { createHash } from "node:crypto";
import type { BookmarkRecord, BookmarkMedia, MediaAssetRecord } from "../shared/schema";
import {
  getMediaAssetByHash,
  syncMirroredMediaIntoBookmark,
  upsertMediaAsset,
} from "./db";
import type { Env } from "./env";

type MirroredMediaUpload = {
  bookmarkId: string;
  mediaId: string;
  sourceUrl: string;
  normalizedUrl: string;
  thumbnailUrl?: string;
  mediaType: string;
  contentHash?: string;
  mimeType?: string;
  sizeBytes?: number;
  buffer: ArrayBuffer;
};

function normalizeMediaUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function inferMimeType(url: string, contentTypeHeader: string | null) {
  const contentType = contentTypeHeader?.toLowerCase() ?? "";
  if (contentType) {
    return contentType.split(";")[0];
  }
  if (url.includes(".png")) return "image/png";
  if (url.includes(".gif")) return "image/gif";
  if (url.includes(".webp")) return "image/webp";
  if (url.includes(".mp4")) return "video/mp4";
  return "image/jpeg";
}

function isBrokenMirroredMedia(media: BookmarkMedia) {
  return (
    Boolean(media.mirroredUrl) &&
    (media.mimeType === "text/html" ||
      media.sizeBytes === undefined ||
      media.sizeBytes < 1024 ||
      media.status === "failed")
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function extractMediaStorageKey(media: BookmarkMedia) {
  if (media.storageKey) {
    return media.storageKey;
  }

  if (!media.mirroredUrl) {
    return undefined;
  }

  const marker = "/api/media/";
  if (media.mirroredUrl.startsWith(marker)) {
    return media.mirroredUrl.slice(marker.length) || undefined;
  }

  try {
    const parsed = new URL(media.mirroredUrl);
    return parsed.pathname.startsWith(marker)
      ? parsed.pathname.slice(marker.length) || undefined
      : undefined;
  } catch {
    return undefined;
  }
}

function findRawMediaCandidate(bookmark: BookmarkRecord, media: BookmarkMedia) {
  const raw = asRecord(bookmark.raw);
  const legacy = asRecord(raw?.legacy);
  const extendedEntities = asRecord(raw?.extended_entities) ?? asRecord(legacy?.extended_entities);
  const entities = asRecord(raw?.entities) ?? asRecord(legacy?.entities);
  const mediaList = [
    ...(Array.isArray(extendedEntities?.media) ? (extendedEntities.media as unknown[]) : []),
    ...(Array.isArray(entities?.media) ? (entities.media as unknown[]) : []),
  ];

  return mediaList
    .map((item) => asRecord(item))
    .find((candidate) => {
      if (!candidate) {
        return false;
      }
      const candidateId = String(candidate.id ?? candidate.id_str ?? "");
      const candidateUrl = String(candidate.media_url_https ?? candidate.media_url ?? "");
      return candidateId === media.id || candidateUrl === media.thumbnailUrl || candidateUrl === media.url;
    });
}

function resolveMediaSource(bookmark: BookmarkRecord, media: BookmarkMedia) {
  const rawCandidate = findRawMediaCandidate(bookmark, media);
  const rawPreview = rawCandidate
    ? String(rawCandidate.media_url_https ?? rawCandidate.media_url ?? media.thumbnailUrl ?? media.url)
    : media.thumbnailUrl ?? media.url;

  if (media.type === "photo") {
    return {
      downloadUrl: rawPreview,
      normalizedUrl: normalizeMediaUrl(rawPreview),
      mediaType: "photo",
    };
  }

  if (media.type === "video" || media.type === "gif" || media.type === "animated_gif") {
    return {
      downloadUrl: rawPreview,
      normalizedUrl: normalizeMediaUrl(rawPreview),
      mediaType: media.type === "animated_gif" ? "gif" : media.type,
    };
  }

  return {
    downloadUrl: media.thumbnailUrl ?? media.url,
    normalizedUrl: normalizeMediaUrl(media.thumbnailUrl ?? media.url),
    mediaType: media.type,
  };
}

function buildExistingMirroredAsset(
  bookmark: BookmarkRecord,
  media: BookmarkMedia,
  source: ReturnType<typeof resolveMediaSource>,
): MediaAssetRecord {
  return {
    bookmarkId: bookmark.id,
    mediaId: media.id,
    sourceUrl: media.url,
    normalizedUrl: source.normalizedUrl,
    thumbnailUrl: media.thumbnailUrl,
    mediaType: source.mediaType,
    contentHash: media.contentHash,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    r2Key: extractMediaStorageKey(media),
    status: "uploaded",
    attemptCount: 1,
  };
}

async function downloadMedia(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      referer: "https://x.com/",
    },
  });

  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${url}`);
  }

  const buffer = await response.arrayBuffer();
  const contentHash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  return {
    buffer,
    contentHash,
    mimeType: inferMimeType(url, response.headers.get("content-type")),
    sizeBytes: buffer.byteLength,
  };
}

export async function storeMirroredMedia(env: Env, payload: MirroredMediaUpload) {
  const bucket = env.MEDIA_BUCKET ?? env.RAW_BOOKMARKS;
  if (!bucket) {
    throw new Error("Media bucket is not configured");
  }

  const existingByHash = payload.contentHash
    ? await getMediaAssetByHash(env.DB, payload.contentHash)
    : null;
  const extension =
    payload.mimeType?.includes("png")
      ? "png"
      : payload.mimeType?.includes("gif")
        ? "gif"
        : payload.mimeType?.includes("webp")
          ? "webp"
          : payload.mimeType?.includes("mp4")
            ? "mp4"
            : "jpg";
  const r2Key =
    existingByHash?.r2_key && typeof existingByHash.r2_key === "string"
      ? existingByHash.r2_key
      : `media/${payload.contentHash ?? `${payload.bookmarkId}-${payload.mediaId}`}.${extension}`;

  if (!existingByHash?.r2_key) {
    await bucket.put(r2Key, payload.buffer, {
      httpMetadata: {
        contentType: payload.mimeType,
      },
    });
  }

  const asset = {
    bookmarkId: payload.bookmarkId,
    mediaId: payload.mediaId,
    sourceUrl: payload.sourceUrl,
    normalizedUrl: payload.normalizedUrl,
    thumbnailUrl: payload.thumbnailUrl,
    mediaType: payload.mediaType,
    contentHash: payload.contentHash,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    r2Key,
    status: "uploaded" as const,
    attemptCount: 1,
  };

  await upsertMediaAsset(env.DB, asset);
  await syncMirroredMediaIntoBookmark(env.DB, asset);

  return { r2Key, mirroredUrl: `/api/media/${r2Key}` };
}

export async function reconcileBookmarkMedia(
  env: Env,
  bookmark: BookmarkRecord,
) {
  let mirrored = 0;
  let failed = 0;
  let backfilled = 0;

  for (const media of bookmark.media) {
    const source = resolveMediaSource(bookmark, media);

    if (media.mirroredUrl && !isBrokenMirroredMedia(media)) {
      const existingAsset = buildExistingMirroredAsset(bookmark, media, source);
      await upsertMediaAsset(env.DB, existingAsset);
      await syncMirroredMediaIntoBookmark(env.DB, existingAsset);
      backfilled += 1;
      continue;
    }

    const candidateUrl = source.downloadUrl;
    if (!candidateUrl) {
      failed += 1;
      continue;
    }

    try {
      const downloaded = await downloadMedia(candidateUrl);
      if (downloaded.mimeType === "text/html" || downloaded.sizeBytes < 1024) {
        throw new Error(`Invalid media payload from ${candidateUrl}`);
      }

      await storeMirroredMedia(env, {
        bookmarkId: bookmark.id,
        mediaId: media.id,
        sourceUrl: media.url,
        normalizedUrl: source.normalizedUrl,
        thumbnailUrl: media.thumbnailUrl,
        mediaType: source.mediaType,
        contentHash: downloaded.contentHash,
        mimeType: downloaded.mimeType,
        sizeBytes: downloaded.sizeBytes,
        buffer: downloaded.buffer,
      });
      mirrored += 1;
    } catch (error) {
      console.warn(`Media reconcile failed for ${bookmark.id}/${media.id}`, error);
      const message = error instanceof Error ? error.message : String(error);
      const failedAsset = {
        bookmarkId: bookmark.id,
        mediaId: media.id,
        sourceUrl: media.url,
        normalizedUrl: source.normalizedUrl,
        thumbnailUrl: media.thumbnailUrl,
        mediaType: source.mediaType,
        status: "failed" as const,
        lastError: message,
        attemptCount: 1,
      };
      await upsertMediaAsset(env.DB, failedAsset);
      await syncMirroredMediaIntoBookmark(env.DB, failedAsset);
      failed += 1;
    }
  }

  return { mirrored, failed, backfilled };
}
