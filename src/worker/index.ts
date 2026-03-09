import { Hono } from "hono";
import { classifyBookmarksWithGeminiSafe } from "./gemini";
import type { Env } from "./env";
import { getBaseUrl } from "./env";
import {
  loginWithPsk,
  logout,
  requireAdminAccess,
  requireIngestKey,
  requireSiteSession,
  siteGate,
} from "./auth";
import { renderAppShell } from "./templates";
import {
  getOpsStatus,
  getBookmarksForClassification,
  getOverview,
  getSyncStatus,
  listBookmarks,
  listBookmarksForAgent,
  listCategories,
  recordAlertEvent,
  recordImportRun,
  saveManualCategory,
  upsertBookmarks,
  upsertCategories,
} from "./db";
import {
  agentExportRequestSchema,
  agentPushEnvelopeSchema,
  alertEventSchema,
  categorySchema,
  consolidationRequestSchema,
  colorFromSlug,
  importEnvelopeSchema,
  normalizeBookmarks,
  overrideRequestSchema,
  slugifyCategoryName,
  syncTriggerRequestSchema,
} from "../shared/schema";
import { runCategoryConsolidation } from "./consolidation";
import { storeMirroredMedia } from "./media-sync";
import {
  handleScheduledTwitterSync,
  runScheduledTwitterSync,
  runTwitterBookmarksSync,
  TWITTER_BOOKMARKS_SOURCE,
} from "./twitter-sync";
const app = new Hono<{ Bindings: Env }>();

app.use("*", siteGate);

app.get("/api/session", async (c) => {
  const protectedByPsk = Boolean(c.env.SITE_PSK);
  const [overview, syncStatus] = await Promise.all([
    getOverview(c.env.DB).catch(() => ({
      bookmarkCount: 0,
      categoryCount: 0,
      uncategorizedCount: 0,
      latestImportAt: undefined,
    })),
    getSyncStatus(c.env.DB, TWITTER_BOOKMARKS_SOURCE).catch(() => ({
      source: TWITTER_BOOKMARKS_SOURCE,
      status: "idle" as const,
    })),
  ]);

  const opsStatus = await getOpsStatus(c.env.DB).catch(() => ({
    media: {
      totalAssets: 0,
      uploadedAssets: 0,
      pendingAssets: 0,
      failedAssets: 0,
      bookmarksMissingMedia: 0,
    },
    activeAlerts: [],
  }));

  return c.json({
    appTitle: c.env.APP_TITLE,
    baseUrl: getBaseUrl(c.req.raw),
    protectedByPsk,
    hasGemini: Boolean(c.env.GEMINI_API_KEY),
    hasIngestKey: Boolean(c.env.INGEST_API_KEY),
    hasTwitterSyncAuth: Boolean(c.env.X_API_KEY),
    overview,
    syncStatus,
    opsStatus,
  });
});

app.post("/api/auth/login", (c) => loginWithPsk(c));
app.post("/api/auth/logout", (c) => logout(c));

app.get("/api/bookmarks", async (c) => {
  const authError = await requireSiteSession(c);
  if (authError) {
    return authError;
  }

  const bookmarks = await listBookmarks(c.env.DB, {
    q: c.req.query("q") ?? undefined,
    category: c.req.query("category") ?? undefined,
    author: c.req.query("author") ?? undefined,
    media:
      c.req.query("media") === "only" || c.req.query("media") === "none"
        ? (c.req.query("media") as "only" | "none")
        : "all",
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : 50,
    offset: c.req.query("offset") ? Number(c.req.query("offset")) : 0,
  });

  return c.json({ items: bookmarks });
});

app.get("/api/categories", async (c) => {
  const authError = await requireSiteSession(c);
  if (authError) {
    return authError;
  }

  return c.json({ items: await listCategories(c.env.DB) });
});

app.get("/api/overview", async (c) => {
  const authError = await requireSiteSession(c);
  if (authError) {
    return authError;
  }

  return c.json(await getOverview(c.env.DB));
});

app.get("/api/sync/status", async (c) => {
  const authError = await requireSiteSession(c);
  if (authError) {
    return authError;
  }

  return c.json(await getSyncStatus(c.env.DB, TWITTER_BOOKMARKS_SOURCE));
});

app.get("/api/admin/bookmarks/export", async (c) => {
  const authError = requireIngestKey(c);
  if (authError) {
    return authError;
  }

  const parsed = agentExportRequestSchema.parse({
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    offset: c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
    needsMedia: c.req.query("needsMedia") === "1",
  });

  const result = await listBookmarksForAgent(c.env.DB, parsed);
  return c.json(result);
});

app.post("/api/overrides", async (c) => {
  const authError = await requireSiteSession(c);
  if (authError) {
    return authError;
  }

  const parsed = overrideRequestSchema.parse(await c.req.json());
  const slug = slugifyCategoryName(parsed.categoryName);
  const category = categorySchema.parse({
    slug,
    name: parsed.categoryName,
    color: colorFromSlug(slug),
    source: "manual",
  });

  await saveManualCategory(c.env.DB, parsed.bookmarkId, category);
  return c.json({ ok: true, category });
});

app.post("/api/admin/import", async (c) => {
  const authError = requireIngestKey(c);
  if (authError) {
    return authError;
  }

  const payload = importEnvelopeSchema.parse(await c.req.json());
  const bookmarks = normalizeBookmarks(payload.bookmarks, payload.source || c.env.DEFAULT_IMPORT_SOURCE);
  await upsertBookmarks(c.env.DB, bookmarks);

  let snapshotKey: string | undefined;
  if (c.env.RAW_BOOKMARKS) {
    snapshotKey = `imports/${new Date().toISOString()}-${payload.source}.json`;
    await c.env.RAW_BOOKMARKS.put(snapshotKey, JSON.stringify(payload.snapshot ?? payload.bookmarks));
  }

  let classificationCount = 0;
  if (payload.classify && c.env.GEMINI_API_KEY) {
    const categories = await listCategories(c.env.DB);
    const classification = await classifyBookmarksWithGeminiSafe(c.env, bookmarks, categories);
    await upsertCategories(c.env.DB, classification.categories);
    await upsertBookmarks(c.env.DB, classification.assignments);
    classificationCount = classification.assignments.length;
  }

  await recordImportRun(
    c.env.DB,
    payload.source,
    { bookmarkCount: bookmarks.length, classificationCount },
    snapshotKey,
  );

  return c.json({
    ok: true,
    imported: bookmarks.length,
    classified: classificationCount,
    snapshotKey,
  });
});

app.post("/api/admin/classify", async (c) => {
  const ingestError = requireIngestKey(c);
  if (ingestError) {
    return ingestError;
  }

  const body = await c.req.json().catch(() => ({}));
  const payload =
    body && typeof body === "object" ? (body as { ids?: string[]; limit?: number }) : {};
  const bookmarks = await getBookmarksForClassification(c.env.DB, payload.ids, payload.limit);

  if (!bookmarks.length) {
    return c.json({ ok: true, classified: 0 });
  }

  const categories = await listCategories(c.env.DB);
  const classification = await classifyBookmarksWithGeminiSafe(c.env, bookmarks, categories);
  await upsertCategories(c.env.DB, classification.categories);
  await upsertBookmarks(c.env.DB, classification.assignments);

  return c.json({ ok: true, classified: classification.assignments.length });
});

app.get("/api/admin/ops/status", async (c) => {
  const authError = requireIngestKey(c);
  if (authError) {
    return authError;
  }

  return c.json(await getOpsStatus(c.env.DB));
});

app.post("/api/admin/sync/push", async (c) => {
  const authError = requireIngestKey(c);
  if (authError) {
    return authError;
  }

  const payload = agentPushEnvelopeSchema.parse(await c.req.json());
  if (payload.categories?.length) {
    await upsertCategories(c.env.DB, payload.categories);
  }
  await upsertBookmarks(c.env.DB, payload.bookmarks);

  let classificationCount = 0;
  if (payload.classify && payload.bookmarks.length && c.env.GEMINI_API_KEY) {
    const categories = await listCategories(c.env.DB);
    const classification = await classifyBookmarksWithGeminiSafe(c.env, payload.bookmarks, categories);
    await upsertCategories(c.env.DB, classification.categories);
    await upsertBookmarks(c.env.DB, classification.assignments);
    classificationCount = classification.assignments.length;
  }

  await recordImportRun(
    c.env.DB,
    payload.source,
    {
      bookmarkCount: payload.bookmarks.length,
      classificationCount,
      ...(payload.stats ?? {}),
    },
  );

  return c.json({
    ok: true,
    imported: payload.bookmarks.length,
    classified: classificationCount,
  });
});

app.post("/api/admin/alerts", async (c) => {
  const authError = requireIngestKey(c);
  if (authError) {
    return authError;
  }

  const payload = alertEventSchema.parse(await c.req.json());
  const result = await recordAlertEvent(c.env.DB, payload);
  return c.json(result);
});

app.post("/api/admin/media/upload", async (c) => {
  const authError = requireIngestKey(c);
  if (authError) {
    return authError;
  }

  const form = await c.req.formData();
  const file = form.get("file");
  const bookmarkId = String(form.get("bookmarkId") ?? "");
  const mediaId = String(form.get("mediaId") ?? "");
  const sourceUrl = String(form.get("sourceUrl") ?? "");
  const normalizedUrl = String(form.get("normalizedUrl") ?? sourceUrl);
  const thumbnailUrl = String(form.get("thumbnailUrl") ?? "") || undefined;
  const mediaType = String(form.get("mediaType") ?? "unknown");
  const contentHash = String(form.get("contentHash") ?? "") || undefined;
  const mimeType = String(form.get("mimeType") ?? "") || undefined;
  const sizeBytes = Number(form.get("sizeBytes") ?? 0) || undefined;

  if (!(file instanceof File) || !bookmarkId || !mediaId || !sourceUrl) {
    return c.json({ ok: false, error: "Missing required media upload fields" }, 400);
  }

  const result = await storeMirroredMedia(c.env, {
    bookmarkId,
    mediaId,
    sourceUrl,
    normalizedUrl,
    thumbnailUrl,
    mediaType,
    contentHash,
    mimeType: mimeType ?? (file.type || undefined),
    sizeBytes: sizeBytes ?? file.size,
    buffer: await file.arrayBuffer(),
  });

  return c.json({ ok: true, ...result });
});

app.post("/api/admin/sync", async (c) => {
  const authError = await requireAdminAccess(c);
  if (authError) {
    return authError;
  }

  const body = await c.req.json().catch(() => ({}));
  const payload =
    body && typeof body === "object" ? syncTriggerRequestSchema.parse(body) : {};

  try {
    const result = await runTwitterBookmarksSync(c.env, payload);

    return c.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    const status = /not configured/i.test(message) ? 503 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

app.post("/api/admin/sync/daily", async (c) => {
  const authError = await requireAdminAccess(c);
  if (authError) {
    return authError;
  }

  try {
    await runScheduledTwitterSync(c.env);
    return c.json({ ok: true });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});

app.post("/api/admin/consolidate", async (c) => {
  const authError = await requireAdminAccess(c);
  if (authError) {
    return authError;
  }

  const body = await c.req.json().catch(() => ({}));
  const payload =
    body && typeof body === "object" ? consolidationRequestSchema.parse(body) : {};

  const result = await runCategoryConsolidation(c.env, payload);
  return c.json({ ok: true, result });
});

app.get("/api/media/*", async (c) => {
  const authError = await requireSiteSession(c);
  if (authError) {
    return authError;
  }

  const bucket = c.env.MEDIA_BUCKET ?? c.env.RAW_BOOKMARKS;
  if (!bucket) {
    return c.notFound();
  }

  const pathname = new URL(c.req.url).pathname;
  const key = pathname.replace(/^\/api\/media\//, "");
  const object = await bucket.get(key);
  if (!object) {
    return c.notFound();
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
});

app.get("*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  const isStaticAsset =
    pathname.startsWith("/assets/") || pathname === "/favicon.ico" || pathname === "/bookmark.png";

  if (isStaticAsset) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  c.header("Cache-Control", "no-store, private");
  return c.html(renderAppShell(c.env.APP_TITLE));
});

const worker: ExportedHandler<Env> = {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(handleScheduledTwitterSync(env));
  },
};

export default worker;
