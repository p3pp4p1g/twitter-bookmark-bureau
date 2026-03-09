import { createHash } from "node:crypto";
import type { BookmarkRecord, BookmarkMedia } from "../shared/schema";
import type { AgentConfig } from "./config";
import { uploadMediaAsset } from "./worker-client";

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

function findRawMediaCandidate(bookmark: BookmarkRecord, media: BookmarkMedia) {
  const raw = asRecord(bookmark.raw);
  const legacy = asRecord(raw?.legacy);
  const extendedEntities = asRecord(raw?.extended_entities) ?? asRecord(legacy?.extended_entities);
  const entities = asRecord(raw?.entities) ?? asRecord(legacy?.entities);
  const mediaList = [
    ...(Array.isArray(extendedEntities?.media) ? (extendedEntities?.media as unknown[]) : []),
    ...(Array.isArray(entities?.media) ? (entities?.media as unknown[]) : []),
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
    // For the bureau we mirror a stable preview image, not the full video payload.
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

export async function reconcileBookmarkMedia(
  config: AgentConfig,
  bookmark: BookmarkRecord,
) {
  let mirrored = 0;
  let failed = 0;

  for (const media of bookmark.media) {
    if (media.mirroredUrl && !isBrokenMirroredMedia(media)) {
      continue;
    }

    const source = resolveMediaSource(bookmark, media);
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
      await uploadMediaAsset(config, {
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
    } catch {
      failed += 1;
    }
  }

  return { mirrored, failed };
}

export function countPendingMedia(bookmarks: BookmarkRecord[]) {
  return bookmarks.reduce(
    (count, bookmark) =>
      count + bookmark.media.filter((media: BookmarkMedia) => !media.mirroredUrl || isBrokenMirroredMedia(media)).length,
    0,
  );
}
