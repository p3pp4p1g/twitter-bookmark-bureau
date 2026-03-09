import { config as loadDotenv } from "dotenv";
import { classifyBookmarksWithGeminiSafe } from "../worker/gemini";
import type { BookmarkRecord, CategoryRecord } from "../shared/schema";
import type { Env } from "../worker/env";
import { getAgentConfig } from "./config";
import { pushBookmarks } from "./worker-client";

loadDotenv();
loadDotenv({ path: ".env.local", override: true });

const EXPORT_PAGE_SIZE = Number(process.env.CLASSIFY_EXPORT_PAGE_SIZE ?? 25);
const CLASSIFY_BATCH_SIZE = Number(process.env.CLASSIFY_BATCH_LIMIT ?? 8);
const PAUSE_MS = Number(process.env.CLASSIFY_BATCH_DELAY_MS ?? 1200);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeCategories(categories: CategoryRecord[]) {
  const map = new Map<string, CategoryRecord>();
  for (const category of categories) {
    map.set(category.slug, category);
  }
  return [...map.values()];
}

function stripRaw(bookmark: BookmarkRecord): BookmarkRecord {
  const { raw: _raw, ...rest } = bookmark;
  return {
    ...rest,
    categoryName: rest.categoryName?.slice(0, 120),
    summary: rest.summary?.slice(0, 280),
    categoryReason: rest.categoryReason?.slice(0, 600),
  };
}

async function postOverride(
  baseUrl: string,
  siteCookie: string,
  bookmarkId: string,
  categoryName: string,
) {
  const response = await fetch(`${baseUrl}/api/overrides`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: siteCookie,
    },
    body: JSON.stringify({ bookmarkId, categoryName }),
  });

  if (!response.ok) {
    throw new Error(`Override failed: ${response.status} ${await response.text()}`);
  }
}

async function pushAssignmentsWithFallback(
  config: ReturnType<typeof getAgentConfig>,
  siteCookie: string,
  bookmarks: BookmarkRecord[],
  categories: CategoryRecord[],
): Promise<number> {
  try {
    await pushBookmarks(config, {
      source: "local-llm-reclassification",
      bookmarks: bookmarks.map(stripRaw),
      categories,
      classify: false,
      stats: {
        fetchedBookmarks: bookmarks.length,
        newBookmarks: 0,
        fetchedPages: 0,
        classifiedBookmarks: bookmarks.length,
        stoppedReason: "local_llm_reclassification_batch",
      },
    });
    return bookmarks.length;
  } catch (error) {
    if (bookmarks.length === 1) {
      try {
        await pushBookmarks(config, {
          source: "local-llm-reclassification",
          bookmarks: bookmarks.map(stripRaw),
          classify: false,
          stats: {
            fetchedBookmarks: 1,
            newBookmarks: 0,
            fetchedPages: 0,
            classifiedBookmarks: 1,
            stoppedReason: "local_llm_reclassification_single_without_categories",
          },
        });
        return 1;
      } catch (singleError) {
        console.error(
          JSON.stringify(
            {
              overrideFallbackBookmarkId: bookmarks[0].id,
              error: singleError instanceof Error ? singleError.message : String(singleError),
            },
            null,
            2,
          ),
        );
        await postOverride(
          config.baseUrl,
          siteCookie,
          bookmarks[0].id,
          bookmarks[0].categoryName ?? "Needs Review",
        );
        return 1;
      }
    }

    const midpoint = Math.ceil(bookmarks.length / 2);
    const left: number = await pushAssignmentsWithFallback(
      config,
      siteCookie,
      bookmarks.slice(0, midpoint),
      categories,
    );
    const right: number = await pushAssignmentsWithFallback(
      config,
      siteCookie,
      bookmarks.slice(midpoint),
      categories,
    );
    return left + right;
  }
}

async function loginSite(baseUrl: string, sitePsk: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ psk: sitePsk }),
  });

  if (!response.ok) {
    throw new Error(`Failed to authenticate site session: ${response.status}`);
  }

  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Site login succeeded without a session cookie");
  }

  return cookie;
}

async function fetchCategories(baseUrl: string, siteCookie: string): Promise<CategoryRecord[]> {
  const response = await fetch(`${baseUrl}/api/categories`, {
    headers: { cookie: siteCookie },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch categories: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { items: CategoryRecord[] };
  return payload.items.map((category) => ({
    slug: category.slug,
    name: category.name,
    description: category.description,
    color: category.color,
    source: category.source,
  }));
}

async function fetchUncategorizedBookmarks(baseUrl: string, ingestKey: string) {
  const items: BookmarkRecord[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const response = await fetch(
      `${baseUrl}/api/admin/bookmarks/export?limit=${EXPORT_PAGE_SIZE}&offset=${offset}`,
      {
        headers: { authorization: `Bearer ${ingestKey}` },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch export page offset=${offset}: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as { items: BookmarkRecord[]; total: number };
    total = payload.total;

    for (const bookmark of payload.items) {
      if (!bookmark.manualCategorySlug && !bookmark.categorySlug) {
        items.push(bookmark);
      }
    }

    if (!payload.items.length) {
      break;
    }

    offset += payload.items.length;
  }

  return items;
}

async function main() {
  const config = getAgentConfig();
  const sitePsk = required("SITE_PSK");
  const geminiKey = required("GEMINI_API_KEY");
  const geminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";

  const siteCookie = await loginSite(config.baseUrl, sitePsk);
  let categories = dedupeCategories(await fetchCategories(config.baseUrl, siteCookie));
  const uncategorized = await fetchUncategorizedBookmarks(config.baseUrl, config.ingestKey);

  console.log(JSON.stringify({ uncategorized: uncategorized.length, batchSize: CLASSIFY_BATCH_SIZE }, null, 2));

  const env = {
    APP_TITLE: "Bookmark Bureau",
    ASSETS: undefined,
    DB: undefined,
    DEFAULT_IMPORT_SOURCE: "agent",
    GEMINI_API_KEY: geminiKey,
    GEMINI_MODEL: geminiModel,
  } as unknown as Env;

  let totalClassified = 0;

  for (let index = 0; index < uncategorized.length; index += CLASSIFY_BATCH_SIZE) {
    const batch = uncategorized.slice(index, index + CLASSIFY_BATCH_SIZE);
    const classification = await classifyBookmarksWithGeminiSafe(env, batch, categories);

    const pushed = await pushAssignmentsWithFallback(
      config,
      siteCookie,
      classification.assignments,
      classification.categories,
    );

    categories = dedupeCategories([...categories, ...classification.categories]);
    totalClassified += pushed;

    console.log(
      JSON.stringify(
        {
          processed: Math.min(index + batch.length, uncategorized.length),
          total: uncategorized.length,
          classifiedThisBatch: pushed,
          totalClassified,
        },
        null,
        2,
      ),
    );

    await sleep(PAUSE_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
