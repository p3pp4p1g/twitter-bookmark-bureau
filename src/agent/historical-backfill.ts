import { getAgentConfig } from "./config";
import { notifyInfo, reportAlert, resolveAlert } from "./alerts";
import { fetchBookmarksPage } from "./twitter";
import { reconcileBookmarkMedia } from "./media";
import { fetchAllRemoteBookmarks, fetchOpsStatus, pushBookmarks } from "./worker-client";
import type { BookmarkRecord } from "../shared/schema";

type PushResult = {
  ok: true;
  imported: number;
  classified: number;
};

type CategorySummary = {
  slug: string;
  name: string;
  count: number;
};

async function fetchCategories(baseUrl: string, sitePsk: string) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ psk: sitePsk }),
  });

  if (!login.ok) {
    throw new Error(`Failed to authenticate for category fetch: ${login.status}`);
  }

  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Missing site session cookie");
  }

  const response = await fetch(`${baseUrl}/api/categories`, {
    headers: { cookie },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch categories: ${response.status}`);
  }

  const payload = (await response.json()) as { items: CategorySummary[] };
  return payload.items;
}

function summarizeNewCategories(before: CategorySummary[], after: CategorySummary[]) {
  const previous = new Set(before.map((category) => category.slug));
  return after.filter((category) => !previous.has(category.slug)).map((category) => category.name);
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|auth|ct0|cookie/i.test(message)) {
    return {
      code: "x-session",
      fingerprint: "x-session",
      message: `Bookmark Bureau: sessao do X caiu no backfill historico. ${message}`,
    };
  }

  if (/response contained errors|format|graphql|404|503/i.test(message)) {
    return {
      code: "x-format",
      fingerprint: "x-format",
      message: `Bookmark Bureau: endpoint do X falhou no backfill historico. ${message}`,
    };
  }

  return {
    code: "historical-backfill",
    fingerprint: "historical-backfill",
    message: `Bookmark Bureau: backfill historico falhou. ${message}`,
  };
}

async function pushWithFallback(
  config: ReturnType<typeof getAgentConfig>,
  bookmarks: BookmarkRecord[],
  stats: { fetchedBookmarks: number; fetchedPages: number },
): Promise<PushResult> {
  try {
    return await pushBookmarks(config, {
      source: "x-historical-backfill",
      bookmarks,
      classify: true,
      stats: {
        fetchedBookmarks: stats.fetchedBookmarks,
        newBookmarks: bookmarks.length,
        fetchedPages: stats.fetchedPages,
        stoppedReason: "historical_backfill_page",
      },
    });
  } catch (error) {
    if (bookmarks.length === 1) {
      const fallback = await pushBookmarks(config, {
        source: "x-historical-backfill",
        bookmarks,
        classify: false,
        stats: {
          fetchedBookmarks: stats.fetchedBookmarks,
          newBookmarks: 1,
          fetchedPages: stats.fetchedPages,
          stoppedReason: "historical_backfill_single_without_classification",
        },
      });

      return {
        ok: true,
        imported: fallback.imported,
        classified: 0,
      };
    }

    const midpoint = Math.ceil(bookmarks.length / 2);
    const left = await pushWithFallback(config, bookmarks.slice(0, midpoint), stats);
    const right = await pushWithFallback(config, bookmarks.slice(midpoint), stats);
    return {
      ok: true as const,
      imported: left.imported + right.imported,
      classified: left.classified + right.classified,
    };
  }
}

async function reconcilePendingMediaBacklog(config: ReturnType<typeof getAgentConfig>) {
  const bookmarks = await fetchAllRemoteBookmarks(config, { needsMedia: true });
  let mirrored = 0;
  let failed = 0;

  for (const bookmark of bookmarks.filter((item) => item.media.length > 0)) {
    const result = await reconcileBookmarkMedia(config, bookmark);
    mirrored += result.mirrored;
    failed += result.failed;
  }

  return { mirrored, failed };
}

async function main() {
  const config = getAgentConfig();
  if (!config.xApiKey) {
    throw new Error("X_API_KEY or AUTH_TWITTER_TOKEN + CT0_TWITTER is required");
  }

  const sitePsk = process.env.SITE_PSK?.trim();
  const [remoteBookmarks, categoriesBefore] = await Promise.all([
    fetchAllRemoteBookmarks(config),
    sitePsk ? fetchCategories(config.baseUrl, sitePsk) : Promise.resolve<CategorySummary[]>([]),
  ]);

  const existingIds = new Set(remoteBookmarks.map((bookmark) => bookmark.id));
  const oldestKnown = remoteBookmarks.reduce<string | undefined>((oldest, bookmark) => {
    if (!oldest || new Date(bookmark.createdAt).getTime() < new Date(oldest).getTime()) {
      return bookmark.createdAt;
    }
    return oldest;
  }, undefined);

  await notifyInfo(
    config,
    `Bookmark Bureau: backfill historico iniciado. base=${remoteBookmarks.length} antigo=${oldestKnown ?? "unknown"}`,
  );

  try {
    let cursor: string | undefined;
    let fetchedPages = 0;
    let fetchedBookmarks = 0;
    let imported = 0;
    let classified = 0;
    let mirrored = 0;
    let failedMedia = 0;
    let stagnantPages = 0;
    let nextProgress = 5;
    const runSeenIds = new Set<string>();

    while (true) {
      const page = await fetchBookmarksPage(config.xApiKey, cursor);
      fetchedPages += 1;
      fetchedBookmarks += page.bookmarks.length;

      const dedupedPage = page.bookmarks.filter((bookmark) => {
        if (runSeenIds.has(bookmark.id)) {
          return false;
        }

        runSeenIds.add(bookmark.id);
        return true;
      });

      const pageNew = dedupedPage.filter((bookmark) => !existingIds.has(bookmark.id));
      for (const bookmark of pageNew) {
        existingIds.add(bookmark.id);
      }

      if (pageNew.length) {
        const result = await pushWithFallback(config, pageNew, {
          fetchedBookmarks,
          fetchedPages,
        });
        imported += result.imported;
        classified += result.classified;

        for (const bookmark of pageNew.filter((bookmark) => bookmark.media.length > 0)) {
          const mediaResult = await reconcileBookmarkMedia(config, bookmark);
          mirrored += mediaResult.mirrored;
          failedMedia += mediaResult.failed;
        }

        stagnantPages = 0;
      } else {
        stagnantPages += 1;
      }

      if (fetchedPages >= nextProgress) {
        await notifyInfo(
          config,
          `Bookmark Bureau: backfill historico paginas=${fetchedPages} importados=${imported} midias=${mirrored} sem_novos=${stagnantPages}`,
        );
        nextProgress += 5;
      }

      cursor = page.nextCursor;
      if (!cursor) {
        break;
      }
    }

    const pendingMediaResult = await reconcilePendingMediaBacklog(config);
    mirrored += pendingMediaResult.mirrored;
    failedMedia += pendingMediaResult.failed;

    const categoriesAfter = sitePsk ? await fetchCategories(config.baseUrl, sitePsk) : [];
    const newCategories = summarizeNewCategories(categoriesBefore, categoriesAfter);
    const opsStatus = await fetchOpsStatus(config);

    await resolveAlert(config, {
      code: "historical-backfill",
      fingerprint: "historical-backfill",
      message: `Bookmark Bureau: backfill historico concluido. importados=${imported}, midias=${mirrored}, categorias_novas=${newCategories.length}.`,
      metadata: {
        fetchedPages,
        fetchedBookmarks,
        imported,
        classified,
        mirrored,
        failedMedia,
        newCategories,
        mediaSummary: opsStatus.media,
      },
    });

    await notifyInfo(
      config,
      `Bookmark Bureau: backfill historico concluido. paginas=${fetchedPages} importados=${imported} classificados=${classified} midias=${mirrored} categorias_novas=${newCategories.length} pendentes=${opsStatus.media.bookmarksMissingMedia}`,
    );

    if (newCategories.length) {
      await notifyInfo(config, `Bookmark Bureau: categorias novas no backfill historico: ${newCategories.join(", ")}`);
    }
  } catch (error) {
    const classified = classifyError(error);
    console.error(classified.message);
    await reportAlert(config, {
      code: classified.code,
      severity: "error",
      fingerprint: classified.fingerprint,
      message: classified.message,
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
