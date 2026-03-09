import { z } from "zod";

export const bookmarkMediaSchema = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string(),
  thumbnailUrl: z.string().optional(),
  mirroredUrl: z.string().optional(),
  storageKey: z.string().optional(),
  contentHash: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  status: z.enum(["pending", "uploaded", "failed"]).optional(),
});

export const bookmarkSchema = z.object({
  id: z.string(),
  url: z.string(),
  text: z.string(),
  authorName: z.string(),
  authorHandle: z.string(),
  authorId: z.string().optional(),
  createdAt: z.string(),
  lang: z.string().optional(),
  links: z.array(z.string()).default([]),
  media: z.array(bookmarkMediaSchema).default([]),
  source: z.string(),
  raw: z.unknown().optional(),
  summary: z.string().optional(),
  categorySlug: z.string().optional(),
  categoryName: z.string().optional(),
  categoryConfidence: z.number().optional(),
  categoryReason: z.string().optional(),
  manualCategorySlug: z.string().optional(),
  importedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const categorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string(),
  source: z.enum(["llm", "manual"]).default("llm"),
  count: z.number().optional(),
});

export const importEnvelopeSchema = z.object({
  source: z.string().default("manual"),
  bookmarks: z.array(bookmarkSchema.or(z.record(z.string(), z.unknown()))),
  snapshot: z.unknown().optional(),
  classify: z.boolean().default(true),
});

export const classificationRequestSchema = z.object({
  ids: z.array(z.string()).optional(),
  limit: z.number().min(1).max(100).optional(),
});

export const overrideRequestSchema = z.object({
  bookmarkId: z.string(),
  categoryName: z.string().min(1),
});

export const syncTriggerRequestSchema = z.object({
  maxPages: z.number().int().min(1).max(20).optional(),
  classify: z.boolean().optional(),
});

export const mediaAssetSchema = z.object({
  bookmarkId: z.string(),
  mediaId: z.string(),
  sourceUrl: z.string(),
  normalizedUrl: z.string(),
  thumbnailUrl: z.string().optional(),
  mediaType: z.string(),
  contentHash: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  r2Key: z.string().optional(),
  status: z.enum(["pending", "uploaded", "failed"]),
  lastError: z.string().optional(),
  attemptCount: z.number().int().nonnegative().default(1),
  updatedAt: z.string().optional(),
});

export const agentPushEnvelopeSchema = z.object({
  source: z.string().default("agent"),
  bookmarks: z.array(bookmarkSchema),
  categories: z.array(categorySchema).optional(),
  classify: z.boolean().default(true),
  stats: z
    .object({
      fetchedBookmarks: z.number().int().nonnegative().optional(),
      newBookmarks: z.number().int().nonnegative().optional(),
      fetchedPages: z.number().int().nonnegative().optional(),
      classifiedBookmarks: z.number().int().nonnegative().optional(),
      stoppedReason: z.string().optional(),
      mirroredMedia: z.number().int().nonnegative().optional(),
      pendingMedia: z.number().int().nonnegative().optional(),
      failedMedia: z.number().int().nonnegative().optional(),
      snapshotKey: z.string().optional(),
    })
    .optional(),
});

export const agentExportRequestSchema = z.object({
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
  needsMedia: z.boolean().optional(),
});

export const alertEventSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  fingerprint: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  resolved: z.boolean().default(false),
});

export const consolidationRequestSchema = z.object({
  ids: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

export type BookmarkMedia = z.infer<typeof bookmarkMediaSchema>;
export type BookmarkRecord = z.infer<typeof bookmarkSchema>;
export type CategoryRecord = z.infer<typeof categorySchema>;
export type ImportEnvelope = z.infer<typeof importEnvelopeSchema>;
export type SyncTriggerRequest = z.infer<typeof syncTriggerRequestSchema>;
export type MediaAssetRecord = z.infer<typeof mediaAssetSchema>;
export type AgentPushEnvelope = z.infer<typeof agentPushEnvelopeSchema>;
export type AgentExportRequest = z.infer<typeof agentExportRequestSchema>;
export type AlertEvent = z.infer<typeof alertEventSchema>;
export type ConsolidationRequest = z.infer<typeof consolidationRequestSchema>;

export type BookmarkFilters = {
  q?: string;
  category?: string;
  author?: string;
  media?: "all" | "only" | "none";
  limit?: number;
  offset?: number;
};

export function slugifyCategoryName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function colorFromSlug(slug: string): string {
  const palette = [
    "#C64F38",
    "#275D73",
    "#6A7B45",
    "#8D5A97",
    "#CB8A2E",
    "#486C9F",
    "#B04D70",
    "#4B7967",
  ];
  const hash = [...slug].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function coerceString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function parseJsonValue<T>(value: unknown): T | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}

function coerceStringArray(value: unknown): string[] {
  const parsedArray = parseJsonValue<unknown[]>(value);
  if (parsedArray) {
    return coerceStringArray(parsedArray);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : undefined))
    .filter((item): item is string => Boolean(item));
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    const hit = coerceString(value);
    if (hit) {
      return hit;
    }
  }

  return undefined;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `h${(hash >>> 0).toString(16)}`;
}

function inferUrl(authorHandle: string | undefined, id: string): string {
  const handle = authorHandle && authorHandle !== "unknown" ? authorHandle : "i";
  return `https://x.com/${handle}/status/${id}`;
}

function resolveTwitterRawTweet(raw: unknown): Record<string, unknown> {
  const record = asRecord(raw) ?? {};
  const metadata = asRecord(record.metadata) ?? parseJsonValue<Record<string, unknown>>(record.metadata);

  if (metadata) {
    return resolveTwitterRawTweet(metadata);
  }

  if (record.tweet_results) {
    const timelineResult = asRecord(record.tweet_results);
    return resolveTwitterRawTweet(timelineResult?.result);
  }

  if (record.result) {
    return resolveTwitterRawTweet(record.result);
  }

  if (record.__typename === "TweetWithVisibilityResults" && record.tweet) {
    return resolveTwitterRawTweet(record.tweet);
  }

  return record;
}

function getNestedRecord(record: Record<string, unknown>, path: string[]): Record<string, unknown> | undefined {
  let current: unknown = record;

  for (const key of path) {
    const candidate = asRecord(current);
    if (!candidate) {
      return undefined;
    }
    current = candidate[key];
  }

  return asRecord(current);
}

function getRawAuthor(record: Record<string, unknown>): Record<string, unknown> {
  return (
    getNestedRecord(record, ["core", "user_results", "result"]) ??
    asRecord(record.tweetBy) ??
    asRecord(record.user) ??
    {}
  );
}

function getRawEntities(record: Record<string, unknown>): Record<string, unknown> {
  return (
    asRecord(record.entities) ??
    getNestedRecord(record, ["legacy", "entities"]) ??
    {}
  );
}

function getRawExtendedEntities(record: Record<string, unknown>): Record<string, unknown> {
  return (
    asRecord(record.extended_entities) ??
    getNestedRecord(record, ["legacy", "extended_entities"]) ??
    {}
  );
}

function pickBestVideoVariant(candidate: Record<string, unknown>): string | undefined {
  const videoInfo =
    asRecord(candidate.video_info) ??
    getNestedRecord(candidate, ["video_info"]) ??
    getNestedRecord(candidate, ["media_info", "video_info"]);
  const variants = Array.isArray(videoInfo?.variants) ? (videoInfo.variants as unknown[]) : [];

  const ranked = variants
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((variant) => ({
      url: coerceString(variant.url),
      contentType: coerceString(variant.content_type),
      bitrate: Number(variant.bitrate ?? 0),
    }))
    .filter((variant) => variant.url && variant.contentType === "video/mp4")
    .sort((left, right) => right.bitrate - left.bitrate);

  return ranked[0]?.url;
}

function getNoteTweetText(record: Record<string, unknown>): string | undefined {
  return firstString([
    getNestedRecord(record, ["note_tweet", "note_tweet_results", "result"])?.text,
    getNestedRecord(record, ["note_tweet", "note_tweet_results", "result", "richtext"])?.text,
    getNestedRecord(record, ["metadata", "note_tweet", "note_tweet_results", "result"])?.text,
  ]);
}

export function normalizeBookmark(raw: unknown, source = "manual"): BookmarkRecord {
  const record = resolveTwitterRawTweet(raw);
  const author = getRawAuthor(record);
  const legacy = getNestedRecord(record, ["legacy"]) ?? {};
  const entities = getRawEntities(record);
  const extendedEntities = getRawExtendedEntities(record);

  const id =
    firstString([
      record.id,
      record.id_str,
      record.tweet_id,
      record.rest_id,
      record.conversationId,
      record.conversation_id_str,
    ]) ??
    hashString(JSON.stringify(raw));

  const authorHandle =
    firstString([
      author.userName,
      author.username,
      author.screen_name,
      getNestedRecord(author, ["core"])?.screen_name,
      getNestedRecord(author, ["legacy"])?.screen_name,
      record.authorHandle,
      record.screen_name,
    ]) ??
    "unknown";

  const authorName =
    firstString([
      author.fullName,
      author.name,
      getNestedRecord(author, ["core"])?.name,
      getNestedRecord(author, ["legacy"])?.name,
      record.authorName,
      record.name,
    ]) ?? authorHandle;

  const createdAt =
    firstString([
      record.createdAt,
      record.created_at,
      record.bookmarked_at,
      legacy.created_at,
    ]) ??
    new Date().toISOString();

  const linkObjects = entities.urls as unknown;

  const links =
    Array.isArray(linkObjects)
      ? linkObjects
          .map((item) => {
            if (typeof item === "string") {
              return item;
            }
            if (typeof item === "object" && item !== null) {
              const candidate = item as Record<string, unknown>;
              return firstString([candidate.expanded_url, candidate.url, candidate.display_url]);
            }
            return undefined;
          })
          .filter((item): item is string => Boolean(item))
      : coerceStringArray(record.links);

  const mediaSource =
    Array.isArray(record.media)
      ? record.media
      : Array.isArray(parseJsonValue<unknown[]>(record.media))
        ? (parseJsonValue<unknown[]>(record.media) ?? [])
      : Array.isArray(extendedEntities.media)
        ? ((extendedEntities.media as unknown[]) ?? [])
        : [];

  const media = mediaSource
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return undefined;
      }

      const candidate = item as Record<string, unknown>;
      const type = firstString([candidate.type]) ?? "unknown";
      const previewUrl = firstString([
        candidate.thumbnailUrl,
        candidate.thumbnail,
        candidate.media_url_https,
        candidate.media_url,
      ]);
      const directVideoUrl = pickBestVideoVariant(candidate);
      const url =
        type === "video" || type === "animated_gif" || type === "gif"
          ? firstString([directVideoUrl, previewUrl, candidate.original, candidate.expanded_url])
          : firstString([
              candidate.original,
              candidate.media_url_https,
              candidate.media_url,
              candidate.url,
              candidate.expanded_url,
            ]);

      if (!url) {
        return undefined;
      }

      return {
        id: firstString([candidate.id, candidate.id_str]) ?? hashString(url),
        type,
        url,
        thumbnailUrl: previewUrl,
      };
    })
    .filter(Boolean) as BookmarkMedia[];

  const text =
    firstString([
      record.fullText,
      record.full_text,
      record.text,
      record.note_tweet_text,
      getNoteTweetText(record),
      legacy.full_text,
    ]) ?? "";

  const url =
    firstString([record.url, record.tweet_url, record.expanded_url]) ??
    inferUrl(authorHandle, id);

  return bookmarkSchema.parse({
    id,
    url,
    text,
    authorName,
    authorHandle: authorHandle.replace(/^@/, ""),
    authorId: firstString([author.id, author.id_str, author.rest_id, record.authorId, record.user_id]),
    createdAt: new Date(createdAt).toISOString(),
    lang: firstString([record.lang, legacy.lang]),
    links,
    media,
    source,
    raw,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function normalizeBookmarks(input: unknown, source = "manual"): BookmarkRecord[] {
  if (!Array.isArray(input)) {
    throw new Error("Expected an array of bookmarks");
  }

  return input.map((item) => normalizeBookmark(item, source));
}
