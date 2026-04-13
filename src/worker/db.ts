import type {
  AlertEvent,
  BookmarkRecord,
  CategoryRecord,
  BookmarkFilters,
  MediaAssetRecord,
} from "../shared/schema";
import { colorFromSlug } from "../shared/schema";
import { getCanonicalCategories } from "../shared/consolidation";
import { buildBookmarkQuery } from "../shared/query";

export type BookmarkView = {
  id: string;
  url: string;
  text: string;
  authorName: string;
  authorHandle: string;
  authorId?: string;
  createdAt: string;
  lang?: string;
  links: string[];
  media: Array<{
    id: string;
    type: string;
    url: string;
    thumbnailUrl?: string;
    mirroredUrl?: string;
    storageKey?: string;
    contentHash?: string;
    mimeType?: string;
    sizeBytes?: number;
    status?: "pending" | "uploaded" | "failed";
  }>;
  summary?: string;
  categorySlug?: string;
  categoryName?: string;
  categoryColor?: string;
  categoryConfidence?: number;
  categoryReason?: string;
  manualCategorySlug?: string;
  source: string;
  importedAt: string;
  updatedAt: string;
};

type CategoryRow = {
  slug: string;
  name: string;
  description?: string;
  color: string;
  source: "llm" | "manual";
  count: number;
};

type Overview = {
  bookmarkCount: number;
  categoryCount: number;
  uncategorizedCount: number;
  latestImportRunAt?: string;
  latestBookmarkImportedAt?: string;
  latestBookmarkCreatedAt?: string;
};

export type SyncRunStats = {
  fetchedBookmarks: number;
  newBookmarks: number;
  fetchedPages: number;
  classifiedBookmarks: number;
  stoppedReason: string;
  snapshotKey?: string;
};

export type SyncStatusView = {
  source: string;
  status: "idle" | "running" | "success" | "error";
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastCursor?: string;
  stats?: SyncRunStats;
  updatedAt?: string;
};

export type MediaBacklogSummary = {
  totalAssets: number;
  uploadedAssets: number;
  pendingAssets: number;
  failedAssets: number;
  bookmarksMissingMedia: number;
};

export type AlertEventView = {
  code: string;
  severity: "info" | "warning" | "error";
  fingerprint: string;
  message: string;
  metadata?: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  resolvedAt?: string;
  lastNotifiedAt?: string;
};

export type OpsStatusView = {
  media: MediaBacklogSummary;
  activeAlerts: AlertEventView[];
};

export type HealthStatus = "healthy" | "warning" | "error";

export type HealthCheckView = {
  key: string;
  label: string;
  status: HealthStatus;
  summary: string;
  observedAt: string;
};

export type StatusSnapshotView = {
  checkedAt: string;
  overview: Overview;
  syncStatus: SyncStatusView;
  opsStatus: OpsStatusView;
  checks: HealthCheckView[];
  overallStatus: HealthStatus;
};

export type PublicHealthView = {
  ok: boolean;
  status: HealthStatus;
  checkedAt: string;
  lastSuccessAt?: string;
};

const CANONICAL_CATEGORIES_BY_SLUG = new Map(
  getCanonicalCategories().map((category) => [category.slug, category]),
);

function humanizeCategorySlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function inferMissingCategory(slug: string, bookmarks: BookmarkRecord[]): CategoryRecord {
  const canonical = CANONICAL_CATEGORIES_BY_SLUG.get(slug);
  if (canonical) {
    return canonical;
  }

  const namedBookmark = bookmarks.find(
    (bookmark) => bookmark.manualCategorySlug === slug || bookmark.categorySlug === slug,
  );

  return {
    slug,
    name: namedBookmark?.categoryName?.trim() || humanizeCategorySlug(slug),
    description: undefined,
    color: colorFromSlug(slug),
    source: bookmarks.some((bookmark) => bookmark.manualCategorySlug === slug) ? "manual" : "llm",
  };
}

async function ensureReferencedCategories(db: D1Database, bookmarks: BookmarkRecord[]) {
  const bookmarksBySlug = new Map<string, BookmarkRecord[]>();

  for (const bookmark of bookmarks) {
    for (const slug of [bookmark.categorySlug, bookmark.manualCategorySlug]) {
      if (!slug) {
        continue;
      }

      const existing = bookmarksBySlug.get(slug);
      if (existing) {
        existing.push(bookmark);
      } else {
        bookmarksBySlug.set(slug, [bookmark]);
      }
    }
  }

  if (!bookmarksBySlug.size) {
    return;
  }

  const slugs = [...bookmarksBySlug.keys()];
  const existingRows = await db
    .prepare(
      `
        SELECT slug
        FROM categories
        WHERE slug IN (${slugs.map(() => "?").join(", ")})
      `,
    )
    .bind(...slugs)
    .all<{ slug: string }>();

  const existingSlugs = new Set((existingRows.results ?? []).map((row) => row.slug));
  const missingCategories = slugs
    .filter((slug) => !existingSlugs.has(slug))
    .map((slug) => inferMissingCategory(slug, bookmarksBySlug.get(slug) ?? []));

  if (missingCategories.length) {
    await upsertCategories(db, missingCategories);
  }
}

function rowToBookmarkRecord(row: Record<string, unknown>): BookmarkRecord {
  return {
    id: String(row.id),
    url: String(row.url),
    text: String(row.text ?? ""),
    authorName: String(row.author_name ?? ""),
    authorHandle: String(row.author_handle ?? ""),
    authorId: row.author_id ? String(row.author_id) : undefined,
    createdAt: String(row.created_at),
    lang: row.lang ? String(row.lang) : undefined,
    links: JSON.parse(String(row.links_json ?? "[]")) as string[],
    media: JSON.parse(String(row.media_json ?? "[]")) as BookmarkRecord["media"],
    source: String(row.source),
    raw: row.raw_json ? JSON.parse(String(row.raw_json)) : undefined,
    summary: row.summary ? String(row.summary) : undefined,
    categorySlug: row.category_slug ? String(row.category_slug) : undefined,
    categoryName: row.category_name ? String(row.category_name) : undefined,
    categoryConfidence:
      row.category_confidence !== null && row.category_confidence !== undefined
        ? Number(row.category_confidence)
        : undefined,
    categoryReason: row.category_reason ? String(row.category_reason) : undefined,
    manualCategorySlug: row.manual_category_slug ? String(row.manual_category_slug) : undefined,
    importedAt: String(row.imported_at),
    updatedAt: String(row.updated_at),
  };
}

function parseMediaJson(row: Record<string, unknown>) {
  return JSON.parse(String(row.media_json ?? "[]")) as BookmarkRecord["media"];
}

function hasUnmirroredMedia(media: BookmarkRecord["media"]) {
  return media.some(
    (item) =>
      item.type &&
      (!item.mirroredUrl ||
        item.mimeType === "text/html" ||
        item.sizeBytes === undefined ||
        item.sizeBytes < 1024 ||
        item.status === "failed"),
  );
}

export async function listBookmarks(db: D1Database, filters: BookmarkFilters) {
  const query = buildBookmarkQuery(filters);
  const rows = await db
    .prepare(query.sql)
    .bind(...query.params)
    .all<Record<string, unknown>>();

  const items = (rows.results ?? []).map((row) => ({
    id: String(row.id),
    url: String(row.url),
    text: String(row.text ?? ""),
    authorName: String(row.author_name ?? ""),
    authorHandle: String(row.author_handle ?? ""),
    authorId: row.author_id ? String(row.author_id) : undefined,
    createdAt: String(row.created_at),
    lang: row.lang ? String(row.lang) : undefined,
    links: JSON.parse(String(row.links_json ?? "[]")) as string[],
    media: parseMediaJson(row) as BookmarkView["media"],
    summary: row.summary ? String(row.summary) : undefined,
    categorySlug: row.manual_category_slug
      ? String(row.manual_category_slug)
      : row.category_slug
        ? String(row.category_slug)
        : undefined,
    categoryName: row.active_category_name
      ? String(row.active_category_name)
      : row.category_name
        ? String(row.category_name)
        : undefined,
    categoryColor: row.active_category_color ? String(row.active_category_color) : undefined,
    categoryConfidence:
      typeof row.category_confidence === "number"
        ? row.category_confidence
        : row.category_confidence
          ? Number(row.category_confidence)
          : undefined,
    categoryReason: row.category_reason ? String(row.category_reason) : undefined,
    manualCategorySlug: row.manual_category_slug ? String(row.manual_category_slug) : undefined,
    source: String(row.source),
    importedAt: String(row.imported_at),
    updatedAt: String(row.updated_at),
  }));

  return items;
}

export async function listBookmarksForAgent(
  db: D1Database,
  options: { limit?: number; offset?: number; needsMedia?: boolean } = {},
): Promise<{ items: BookmarkRecord[]; total: number }> {
  const limit = options.limit ?? 200;
  const offset = options.offset ?? 0;

  const [rows, totalRow] = await Promise.all([
    db
      .prepare(
        `
          SELECT *
          FROM bookmarks
          ORDER BY datetime(created_at) DESC
          LIMIT ?
          OFFSET ?
        `,
      )
      .bind(limit, offset)
      .all<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM bookmarks").first<Record<string, unknown>>(),
  ]);

  let items = (rows.results ?? []).map(rowToBookmarkRecord);
  if (options.needsMedia) {
    items = items.filter((bookmark) => bookmark.media.length > 0 && hasUnmirroredMedia(bookmark.media));
  }

  return {
    items,
    total: Number(totalRow?.count ?? 0),
  };
}

export async function getBookmarksForMediaReconciliation(
  db: D1Database,
  options: { limit?: number; excludeIds?: string[] } = {},
): Promise<BookmarkRecord[]> {
  const limit = options.limit ?? 25;
  const excludeIds = options.excludeIds ?? [];
  const exclusionClause = excludeIds.length
    ? ` AND b.id NOT IN (${excludeIds.map(() => "?").join(", ")})`
    : "";

  const rows = await db
    .prepare(
      `
        SELECT DISTINCT b.*
        FROM bookmarks b
        WHERE b.has_media = 1
          AND (
            EXISTS (
              SELECT 1
              FROM media_assets ma
              WHERE ma.bookmark_id = b.id
                AND ma.status != 'uploaded'
            )
            OR NOT EXISTS (
              SELECT 1
              FROM media_assets ma
              WHERE ma.bookmark_id = b.id
            )
          )${exclusionClause}
        ORDER BY datetime(b.imported_at) ASC
        LIMIT ?
      `
    )
    .bind(...excludeIds, limit)
    .all<Record<string, unknown>>();

  return (rows.results ?? []).map(rowToBookmarkRecord);
}

export async function listCategories(db: D1Database): Promise<CategoryRow[]> {
  const rows = await db
    .prepare(
      `
        SELECT
          c.slug,
          c.name,
          c.description,
          c.color,
          c.source,
          COUNT(b.id) AS count
        FROM categories c
        LEFT JOIN bookmarks b ON COALESCE(b.manual_category_slug, b.category_slug) = c.slug
        GROUP BY c.slug, c.name, c.description, c.color, c.source
        HAVING COUNT(b.id) > 0 OR c.source = 'manual'
        ORDER BY count DESC, c.name ASC
      `,
    )
    .all<CategoryRow>();

  return rows.results ?? [];
}

export async function getOverview(db: D1Database): Promise<Overview> {
  const [bookmarkCount, categoryCount, uncategorizedCount, latestImportRun, latestBookmarkImported, latestBookmarkCreated] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM bookmarks"),
    db.prepare(
      `
        SELECT COUNT(*) AS count
        FROM (
          SELECT c.slug
          FROM categories c
          LEFT JOIN bookmarks b ON COALESCE(b.manual_category_slug, b.category_slug) = c.slug
          GROUP BY c.slug, c.source
          HAVING COUNT(b.id) > 0 OR c.source = 'manual'
        )
      `,
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM bookmarks WHERE COALESCE(manual_category_slug, category_slug) IS NULL",
    ),
    db.prepare("SELECT MAX(created_at) AS latest_import FROM import_runs"),
    db.prepare("SELECT MAX(imported_at) AS latest_bookmark_imported FROM bookmarks"),
    db.prepare("SELECT MAX(created_at) AS latest_bookmark_created FROM bookmarks"),
  ]);

  return {
    bookmarkCount: Number((bookmarkCount.results?.[0] as Record<string, unknown>)?.count ?? 0),
    categoryCount: Number((categoryCount.results?.[0] as Record<string, unknown>)?.count ?? 0),
    uncategorizedCount: Number(
      (uncategorizedCount.results?.[0] as Record<string, unknown>)?.count ?? 0,
    ),
    latestImportRunAt:
      ((latestImportRun.results?.[0] as Record<string, unknown>)?.latest_import as string | null) ??
      undefined,
    latestBookmarkImportedAt:
      ((latestBookmarkImported.results?.[0] as Record<string, unknown>)?.latest_bookmark_imported as string | null) ??
      undefined,
    latestBookmarkCreatedAt:
      ((latestBookmarkCreated.results?.[0] as Record<string, unknown>)?.latest_bookmark_created as string | null) ??
      undefined,
  };
}

export async function upsertCategories(db: D1Database, categories: CategoryRecord[]) {
  if (!categories.length) {
    return;
  }

  const statements = categories.map((category) =>
    db
      .prepare(
        `
          INSERT INTO categories (slug, name, description, color, source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(slug) DO UPDATE SET
            name = excluded.name,
            description = COALESCE(excluded.description, categories.description),
            color = excluded.color,
            source = excluded.source,
            updated_at = CURRENT_TIMESTAMP
        `,
      )
      .bind(
        category.slug,
        category.name,
        category.description ?? null,
        category.color,
        category.source,
      ),
  );

  await db.batch(statements);
}

export async function upsertBookmarks(db: D1Database, bookmarks: BookmarkRecord[]) {
  if (!bookmarks.length) {
    return;
  }

  await ensureReferencedCategories(db, bookmarks);

  const statements = bookmarks.map((bookmark) =>
    db
      .prepare(
        `
          INSERT INTO bookmarks (
            id,
            url,
            text,
            author_name,
            author_handle,
            author_id,
            created_at,
            lang,
            links_json,
            media_json,
            has_media,
            source,
            raw_json,
            summary,
            category_slug,
            category_name,
            category_confidence,
            category_reason,
            manual_category_slug,
            imported_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            url = excluded.url,
            text = excluded.text,
            author_name = excluded.author_name,
            author_handle = excluded.author_handle,
            author_id = excluded.author_id,
            created_at = excluded.created_at,
            lang = excluded.lang,
            links_json = excluded.links_json,
            media_json = excluded.media_json,
            has_media = excluded.has_media,
            source = excluded.source,
            raw_json = excluded.raw_json,
            summary = COALESCE(excluded.summary, bookmarks.summary),
            category_slug = excluded.category_slug,
            category_name = excluded.category_name,
            category_confidence = excluded.category_confidence,
            category_reason = excluded.category_reason,
            manual_category_slug = COALESCE(excluded.manual_category_slug, bookmarks.manual_category_slug),
            imported_at = excluded.imported_at,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        bookmark.id,
        bookmark.url,
        bookmark.text,
        bookmark.authorName,
        bookmark.authorHandle,
        bookmark.authorId ?? null,
        bookmark.createdAt,
        bookmark.lang ?? null,
        JSON.stringify(bookmark.links),
        JSON.stringify(bookmark.media),
        bookmark.media.length > 0 ? 1 : 0,
        bookmark.source,
        bookmark.raw ? JSON.stringify(bookmark.raw) : null,
        bookmark.summary ?? null,
        bookmark.categorySlug ?? null,
        bookmark.categoryName ?? null,
        bookmark.categoryConfidence ?? null,
        bookmark.categoryReason ?? null,
        bookmark.manualCategorySlug ?? null,
        bookmark.importedAt ?? new Date().toISOString(),
        bookmark.updatedAt ?? new Date().toISOString(),
      ),
  );

  await db.batch(statements);
}

export async function saveManualCategory(
  db: D1Database,
  bookmarkId: string,
  category: CategoryRecord,
) {
  await upsertCategories(db, [category]);
  await db
    .prepare(
      `
        UPDATE bookmarks
        SET manual_category_slug = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .bind(category.slug, new Date().toISOString(), bookmarkId)
    .run();
}

export async function getBookmarksForClassification(
  db: D1Database,
  ids?: string[],
  limit = 24,
): Promise<BookmarkRecord[]> {
  const query =
    ids && ids.length
      ? db
          .prepare(
            `
              SELECT *
              FROM bookmarks
              WHERE id IN (${ids.map(() => "?").join(", ")})
              ORDER BY datetime(created_at) DESC
            `,
          )
          .bind(...ids)
      : db.prepare(
          `
            SELECT *
            FROM bookmarks
            WHERE manual_category_slug IS NULL
              AND category_slug IS NULL
            ORDER BY datetime(imported_at) DESC
            LIMIT ?
          `,
        ).bind(limit);

  const rows = await query.all<Record<string, unknown>>();

  return (rows.results ?? []).map(rowToBookmarkRecord);
}

export async function recordImportRun(
  db: D1Database,
  source: string,
  stats: Record<string, unknown>,
  snapshotKey?: string,
) {
  await db
    .prepare(
      `
        INSERT INTO import_runs (id, source, stats_json, snapshot_key, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .bind(crypto.randomUUID(), source, JSON.stringify(stats), snapshotKey ?? null, new Date().toISOString())
    .run();
}

export async function findExistingBookmarkIds(
  db: D1Database,
  ids: string[],
): Promise<Set<string>> {
  if (!ids.length) {
    return new Set();
  }

  const rows = await db
    .prepare(
      `
        SELECT id
        FROM bookmarks
        WHERE id IN (${ids.map(() => "?").join(", ")})
      `,
    )
    .bind(...ids)
    .all<{ id: string }>();

  return new Set((rows.results ?? []).map((row) => row.id));
}

export async function getBookmarksForConsolidation(
  db: D1Database,
  ids?: string[],
  limit = 1000,
): Promise<BookmarkRecord[]> {
  const query =
    ids && ids.length
      ? db
          .prepare(
            `
              SELECT *
              FROM bookmarks
              WHERE id IN (${ids.map(() => "?").join(", ")})
              ORDER BY datetime(imported_at) DESC
            `,
          )
          .bind(...ids)
      : db.prepare(
          `
            SELECT *
            FROM bookmarks
            ORDER BY datetime(imported_at) DESC
            LIMIT ?
          `,
        ).bind(limit);

  const rows = await query.all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToBookmarkRecord);
}

export async function pruneUnusedCategories(db: D1Database) {
  await db
    .prepare(
      `
        DELETE FROM categories
        WHERE slug NOT IN (
            SELECT DISTINCT slug FROM (
              SELECT category_slug AS slug
              FROM bookmarks
              WHERE category_slug IS NOT NULL
              UNION
              SELECT manual_category_slug AS slug
              FROM bookmarks
              WHERE manual_category_slug IS NOT NULL
            )
          )
      `,
    )
    .run();
}

export async function getSyncStatus(
  db: D1Database,
  source: string,
): Promise<SyncStatusView> {
  const row = await db
    .prepare(
      `
        SELECT *
        FROM sync_state
        WHERE source = ?
      `,
    )
    .bind(source)
    .first<Record<string, unknown>>();

  if (!row) {
    return {
      source,
      status: "idle",
    };
  }

  const statusValue = String(row.status ?? "idle");
  const stats = row.last_stats_json
    ? (JSON.parse(String(row.last_stats_json)) as SyncRunStats)
    : undefined;

  return {
    source,
    status:
      statusValue === "running" ||
      statusValue === "success" ||
      statusValue === "error"
        ? statusValue
        : "idle",
    lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : undefined,
    lastSuccessAt: row.last_success_at ? String(row.last_success_at) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    lastCursor: row.last_cursor ? String(row.last_cursor) : undefined,
    stats,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function markSyncStarted(db: D1Database, source: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `
        INSERT INTO sync_state (
          source,
          status,
          last_attempt_at,
          updated_at
        )
        VALUES (?, 'running', ?, ?)
        ON CONFLICT(source) DO UPDATE SET
          status = 'running',
          last_attempt_at = excluded.last_attempt_at,
          updated_at = excluded.updated_at
      `,
    )
    .bind(source, now, now)
    .run();
}

export async function markSyncFinished(
  db: D1Database,
  source: string,
  result: {
    status: "success" | "error";
    error?: string;
    cursor?: string;
    stats?: SyncRunStats;
  },
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `
        INSERT INTO sync_state (
          source,
          status,
          last_attempt_at,
          last_success_at,
          last_error,
          last_cursor,
          last_stats_json,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
          status = excluded.status,
          last_attempt_at = excluded.last_attempt_at,
          last_success_at = COALESCE(excluded.last_success_at, sync_state.last_success_at),
          last_error = excluded.last_error,
          last_cursor = excluded.last_cursor,
          last_stats_json = excluded.last_stats_json,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      source,
      result.status,
      now,
      result.status === "success" ? now : null,
      result.error ?? null,
      result.cursor ?? null,
      result.stats ? JSON.stringify(result.stats) : null,
      now,
    )
    .run();
}

export async function upsertMediaAsset(
  db: D1Database,
  asset: MediaAssetRecord,
) {
  const now = asset.updatedAt ?? new Date().toISOString();
  await db
    .prepare(
      `
        INSERT INTO media_assets (
          bookmark_id,
          media_id,
          source_url,
          normalized_url,
          thumbnail_url,
          media_type,
          content_hash,
          mime_type,
          size_bytes,
          r2_key,
          status,
          last_error,
          attempt_count,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bookmark_id, media_id) DO UPDATE SET
          source_url = excluded.source_url,
          normalized_url = excluded.normalized_url,
          thumbnail_url = excluded.thumbnail_url,
          media_type = excluded.media_type,
          content_hash = COALESCE(excluded.content_hash, media_assets.content_hash),
          mime_type = COALESCE(excluded.mime_type, media_assets.mime_type),
          size_bytes = COALESCE(excluded.size_bytes, media_assets.size_bytes),
          r2_key = COALESCE(excluded.r2_key, media_assets.r2_key),
          status = excluded.status,
          last_error = excluded.last_error,
          attempt_count = excluded.attempt_count,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      asset.bookmarkId,
      asset.mediaId,
      asset.sourceUrl,
      asset.normalizedUrl,
      asset.thumbnailUrl ?? null,
      asset.mediaType,
      asset.contentHash ?? null,
      asset.mimeType ?? null,
      asset.sizeBytes ?? null,
      asset.r2Key ?? null,
      asset.status,
      asset.lastError ?? null,
      asset.attemptCount,
      now,
      now,
    )
    .run();
}

export async function syncMirroredMediaIntoBookmark(
  db: D1Database,
  asset: MediaAssetRecord,
) {
  const row = await db
    .prepare("SELECT media_json FROM bookmarks WHERE id = ?")
    .bind(asset.bookmarkId)
    .first<Record<string, unknown>>();

  if (!row) {
    throw new Error(`Bookmark not found for media upload: ${asset.bookmarkId}`);
  }

  const media = parseMediaJson(row).map((item) =>
    item.id === asset.mediaId
      ? {
          ...item,
          mirroredUrl: asset.r2Key ? `/api/media/${asset.r2Key}` : item.mirroredUrl,
          storageKey: asset.r2Key,
          contentHash: asset.contentHash ?? item.contentHash,
          mimeType: asset.mimeType ?? item.mimeType,
          sizeBytes: asset.sizeBytes ?? item.sizeBytes,
          status: asset.status,
        }
      : item,
  );

  await db
    .prepare("UPDATE bookmarks SET media_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(media), new Date().toISOString(), asset.bookmarkId)
    .run();
}

export async function getMediaAssetByHash(db: D1Database, contentHash: string) {
  return db
    .prepare(
      `
        SELECT *
        FROM media_assets
        WHERE content_hash = ?
          AND r2_key IS NOT NULL
        LIMIT 1
      `,
    )
    .bind(contentHash)
    .first<Record<string, unknown>>();
}

export async function getMediaBacklogSummary(db: D1Database): Promise<MediaBacklogSummary> {
  const [totalsRow, missingByStatusRow, missingWithoutAssetsRow] = await Promise.all([
    db
      .prepare(
        `
          SELECT
            COUNT(*) AS total_assets,
            SUM(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END) AS uploaded_assets,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_assets,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_assets
          FROM media_assets
        `,
      )
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `
          SELECT COUNT(DISTINCT bookmark_id) AS count
          FROM media_assets
          WHERE status != 'uploaded'
        `,
      )
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM bookmarks b
          WHERE b.has_media = 1
            AND NOT EXISTS (
              SELECT 1
              FROM media_assets ma
              WHERE ma.bookmark_id = b.id
            )
        `,
      )
      .first<Record<string, unknown>>(),
  ]);

  return {
    totalAssets: Number(totalsRow?.total_assets ?? 0),
    uploadedAssets: Number(totalsRow?.uploaded_assets ?? 0),
    pendingAssets: Number(totalsRow?.pending_assets ?? 0),
    failedAssets: Number(totalsRow?.failed_assets ?? 0),
    bookmarksMissingMedia:
      Number(missingByStatusRow?.count ?? 0) + Number(missingWithoutAssetsRow?.count ?? 0),
  };
}

function getHoursSince(timestamp: string, now: number) {
  return (now - new Date(timestamp).getTime()) / (1000 * 60 * 60);
}

function deriveHealthChecks(
  overview: Overview,
  syncStatus: SyncStatusView,
  opsStatus: OpsStatusView,
  checkedAt: string,
): HealthCheckView[] {
  const checks: HealthCheckView[] = [];
  const now = new Date(checkedAt).getTime();

  if (!syncStatus.lastSuccessAt) {
    checks.push({
      key: "sync-freshness",
      label: "Daily sync",
      status: "error",
      summary: "No successful Worker sync has been recorded yet.",
      observedAt: checkedAt,
    });
  } else {
    const hoursSinceSuccess = getHoursSince(syncStatus.lastSuccessAt, now);
    const syncErroredRecently =
      syncStatus.status === "error" && syncStatus.lastAttemptAt === syncStatus.updatedAt;
    const status =
      syncErroredRecently || hoursSinceSuccess > 48
        ? "error"
        : hoursSinceSuccess > 30 || syncStatus.status === "running"
          ? "warning"
          : "healthy";

    checks.push({
      key: "sync-freshness",
      label: "Daily sync",
      status,
      summary:
        syncStatus.status === "running"
          ? `A sync run is in progress. Last success was ${hoursSinceSuccess.toFixed(1)}h ago.`
          : syncStatus.status === "error" && syncStatus.lastError
            ? `Last sync attempt failed. ${syncStatus.lastError}`
            : `Last successful sync was ${hoursSinceSuccess.toFixed(1)}h ago.`,
      observedAt: checkedAt,
    });
  }

  const importGapMs =
    overview.latestBookmarkImportedAt && syncStatus.lastSuccessAt
      ? new Date(overview.latestBookmarkImportedAt).getTime() - new Date(syncStatus.lastSuccessAt).getTime()
      : 0;
  checks.push({
    key: "import-consistency",
    label: "Import bookkeeping",
    status: importGapMs > 5 * 60 * 1000 ? "warning" : "healthy",
    summary:
      importGapMs > 5 * 60 * 1000
        ? "Bookmarks were ingested after the last completed sync. A run may have failed after persisting data."
        : "Import timestamps and sync completion look consistent.",
    observedAt: checkedAt,
  });

  checks.push({
    key: "classification-backlog",
    label: "Classification backlog",
    status:
      overview.uncategorizedCount > 10
        ? "error"
        : overview.uncategorizedCount > 0
          ? "warning"
          : "healthy",
    summary:
      overview.uncategorizedCount > 0
        ? `${overview.uncategorizedCount} bookmark(s) remain unsorted.`
        : "No unsorted bookmarks remain.",
    observedAt: checkedAt,
  });

  checks.push({
    key: "media-backlog",
    label: "Media mirror",
    status:
      opsStatus.media.failedAssets > 0
        ? "error"
        : opsStatus.media.bookmarksMissingMedia > 0 || opsStatus.media.pendingAssets > 0
          ? "warning"
          : "healthy",
    summary:
      opsStatus.media.failedAssets > 0
        ? `${opsStatus.media.failedAssets} media asset(s) failed to mirror.`
        : opsStatus.media.bookmarksMissingMedia > 0 || opsStatus.media.pendingAssets > 0
          ? `${opsStatus.media.bookmarksMissingMedia} bookmark(s) still need mirrored media.`
          : "Media mirror backlog is empty.",
    observedAt: checkedAt,
  });

  const errorAlerts = opsStatus.activeAlerts.filter((item) => item.severity === "error");
  checks.push({
    key: "alerts",
    label: "Active alerts",
    status:
      errorAlerts.length > 0
        ? "error"
        : opsStatus.activeAlerts.length > 0
          ? "warning"
          : "healthy",
    summary:
      errorAlerts.length > 0
        ? `${errorAlerts.length} unresolved error alert(s) need attention.`
        : opsStatus.activeAlerts.length > 0
          ? `${opsStatus.activeAlerts.length} alert(s) are still active.`
          : "No active alerts.",
    observedAt: checkedAt,
  });

  return checks;
}

function getOverallStatus(checks: HealthCheckView[]): HealthStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }
  return "healthy";
}

export async function getStatusSnapshot(
  db: D1Database,
  source: string,
): Promise<StatusSnapshotView> {
  const checkedAt = new Date().toISOString();
  const [overview, syncStatus, opsStatus] = await Promise.all([
    getOverview(db),
    getSyncStatus(db, source),
    getOpsStatus(db),
  ]);
  const checks = deriveHealthChecks(overview, syncStatus, opsStatus, checkedAt);

  return {
    checkedAt,
    overview,
    syncStatus,
    opsStatus,
    checks,
    overallStatus: getOverallStatus(checks),
  };
}

export async function getPublicHealth(
  db: D1Database,
  source: string,
): Promise<PublicHealthView> {
  const snapshot = await getStatusSnapshot(db, source);
  return {
    ok: snapshot.overallStatus !== "error",
    status: snapshot.overallStatus,
    checkedAt: snapshot.checkedAt,
    lastSuccessAt: snapshot.syncStatus.lastSuccessAt,
  };
}

function rowToAlertEvent(row: Record<string, unknown>): AlertEventView {
  return {
    code: String(row.code),
    severity:
      row.severity === "warning" || row.severity === "error" || row.severity === "info"
        ? row.severity
        : "error",
    fingerprint: String(row.fingerprint),
    message: String(row.message),
    metadata: row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : undefined,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    occurrenceCount: Number(row.occurrence_count ?? 1),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined,
    lastNotifiedAt: row.last_notified_at ? String(row.last_notified_at) : undefined,
  };
}

export async function listActiveAlertEvents(db: D1Database): Promise<AlertEventView[]> {
  const rows = await db
    .prepare(
      `
        SELECT *
        FROM alert_events
        WHERE resolved_at IS NULL
        ORDER BY last_seen_at DESC
      `,
    )
    .all<Record<string, unknown>>();

  return (rows.results ?? []).map(rowToAlertEvent);
}

export async function recordAlertEvent(
  db: D1Database,
  event: AlertEvent,
): Promise<{ event: AlertEventView; shouldNotify: boolean }> {
  const now = new Date().toISOString();
  const existing = await db
    .prepare("SELECT * FROM alert_events WHERE fingerprint = ?")
    .bind(event.fingerprint)
    .first<Record<string, unknown>>();

  if (!existing) {
    await db
      .prepare(
        `
          INSERT INTO alert_events (
            fingerprint,
            code,
            severity,
            message,
            metadata_json,
            first_seen_at,
            last_seen_at,
            occurrence_count,
            resolved_at,
            last_notified_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `,
      )
      .bind(
        event.fingerprint,
        event.code,
        event.severity,
        event.message,
        event.metadata ? JSON.stringify(event.metadata) : null,
        now,
        now,
        event.resolved ? now : null,
        now,
      )
      .run();

    const created = await db
      .prepare("SELECT * FROM alert_events WHERE fingerprint = ?")
      .bind(event.fingerprint)
      .first<Record<string, unknown>>();

    return {
      event: rowToAlertEvent(created ?? {}),
      shouldNotify: true,
    };
  }

  const existingResolved = Boolean(existing.resolved_at);
  const shouldNotify =
    event.resolved !== existingResolved ||
    event.message !== String(existing.message ?? "") ||
    event.severity !== String(existing.severity ?? "");

  await db
    .prepare(
      `
        UPDATE alert_events
        SET
          code = ?,
          severity = ?,
          message = ?,
          metadata_json = ?,
          last_seen_at = ?,
          occurrence_count = occurrence_count + 1,
          resolved_at = ?,
          last_notified_at = CASE WHEN ? THEN ? ELSE last_notified_at END
        WHERE fingerprint = ?
      `,
    )
    .bind(
      event.code,
      event.severity,
      event.message,
      event.metadata ? JSON.stringify(event.metadata) : null,
      now,
      event.resolved ? now : null,
      shouldNotify ? 1 : 0,
      shouldNotify ? now : null,
      event.fingerprint,
    )
    .run();

  const updated = await db
    .prepare("SELECT * FROM alert_events WHERE fingerprint = ?")
    .bind(event.fingerprint)
    .first<Record<string, unknown>>();

  return {
    event: rowToAlertEvent(updated ?? existing),
    shouldNotify,
  };
}

export async function getOpsStatus(db: D1Database): Promise<OpsStatusView> {
  const [media, activeAlerts] = await Promise.all([
    getMediaBacklogSummary(db),
    listActiveAlertEvents(db),
  ]);

  return {
    media,
    activeAlerts,
  };
}
