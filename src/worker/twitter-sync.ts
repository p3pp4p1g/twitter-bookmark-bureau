import { normalizeBookmarks, type BookmarkRecord } from "../shared/schema";
import {
  findExistingBookmarkIds,
  getSyncStatus,
  listCategories,
  markSyncFinished,
  markSyncStarted,
  recordImportRun,
  upsertBookmarks,
  upsertCategories,
  type SyncRunStats,
} from "./db";
import type { Env } from "./env";
import { classifyBookmarksWithGeminiSafe } from "./gemini";

const TWITTER_BOOKMARKS_SOURCE = "twitter-web-sync";
const TWITTER_BOOKMARKS_ENDPOINT =
  "https://x.com/i/api/graphql/uNowfj04D8HFVFMbjm6xrQ/Bookmarks";
const TWITTER_PUBLIC_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const TWITTER_BOOKMARKS_FEATURES = {
  graphql_timeline_v2_bookmark_timeline: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

type TwitterSyncOptions = {
  maxPages?: number;
  classify?: boolean;
};

export type TwitterSyncResult = SyncRunStats & {
  source: string;
  nextCursor?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function decodeApiKey(apiKey: string): string {
  if (apiKey.includes("auth_token=") && apiKey.includes("ct0=")) {
    return apiKey;
  }

  try {
    return atob(apiKey);
  } catch {
    return Buffer.from(apiKey, "base64").toString("utf8");
  }
}

function getCookieHeader(apiKey: string): string {
  const decoded = decodeApiKey(apiKey).trim();
  if (!decoded) {
    throw new Error("X_API_KEY is empty");
  }

  return decoded.endsWith(";") ? decoded : `${decoded};`;
}

function getCookieValue(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

function findByFilter<T>(data: unknown, key: string, value: string): T[] {
  let results: T[] = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      results = results.concat(findByFilter<T>(item, key, value));
    }
    return results;
  }

  if (!data || typeof data !== "object") {
    return results;
  }

  const record = data as Record<string, unknown>;
  if (record[key] === value) {
    results.push(record as T);
  }

  for (const nested of Object.values(record)) {
    results = results.concat(findByFilter<T>(nested, key, value));
  }

  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPayloadErrorMessages(payload: Record<string, unknown>) {
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  return errors
    .map((item) => asRecord(item)?.message)
    .filter((value): value is string => typeof value === "string");
}

function isRetriablePayloadError(message: string) {
  return /timeout|dependency/i.test(message);
}

function unwrapTweetUnion(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  if (record.__typename === "TweetWithVisibilityResults" && record.tweet) {
    return asRecord(record.tweet);
  }

  if (record.__typename === "Tweet" && record.legacy) {
    return record;
  }

  if (record.legacy) {
    return record;
  }

  return undefined;
}

function extractTimelineTweets(payload: unknown): Record<string, unknown>[] {
  const timelineTweets = findByFilter<Record<string, unknown>>(payload, "__typename", "TimelineTweet");
  const seen = new Set<string>();
  const tweets: Record<string, unknown>[] = [];

  for (const item of timelineTweets) {
    const tweetResults = asRecord(item.tweet_results);
    const tweet = unwrapTweetUnion(tweetResults?.result);
    const tweetId = tweet?.rest_id;

    if (!tweet || typeof tweetId !== "string" || seen.has(tweetId)) {
      continue;
    }

    seen.add(tweetId);
    tweets.push(tweet);
  }

  return tweets;
}

function extractBottomCursor(payload: unknown): string | undefined {
  const cursors = findByFilter<Record<string, unknown>>(payload, "cursorType", "Bottom");
  const cursor = cursors.find((item) => typeof item.value === "string");
  return cursor?.value as string | undefined;
}

async function fetchBookmarksPage(
  env: Env,
  cursor?: string,
  count = 40,
): Promise<{ bookmarks: BookmarkRecord[]; nextCursor?: string; rawTweets: Record<string, unknown>[] }> {
  if (!env.X_API_KEY) {
    throw new Error("X_API_KEY is not configured");
  }

  const cookieHeader = getCookieHeader(env.X_API_KEY);
  const csrfToken = getCookieValue(cookieHeader, "ct0");

  if (!csrfToken) {
    throw new Error("X_API_KEY is missing the ct0 cookie");
  }

  const url = new URL(TWITTER_BOOKMARKS_ENDPOINT);
  url.searchParams.set(
    "variables",
    JSON.stringify({
      count,
      cursor,
      includePromotedContent: false,
    }),
  );
  url.searchParams.set("features", JSON.stringify(TWITTER_BOOKMARKS_FEATURES));

  const headers = new Headers({
    accept: "*/*",
    authorization: `Bearer ${TWITTER_PUBLIC_BEARER_TOKEN}`,
    cookie: cookieHeader,
    referer: "https://x.com/i/bookmarks",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "x-csrf-token": csrfToken,
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "en",
  });

  let payload: Record<string, unknown> | undefined;
  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      lastError = await response.text();
      if (response.status !== 429 && response.status < 500) {
        break;
      }

      await sleep(1500 * (attempt + 1));
      continue;
    }

    payload = (await response.json()) as Record<string, unknown>;
    const errorMessages = getPayloadErrorMessages(payload);
    if (!errorMessages.length) {
      break;
    }

    lastError = `X bookmarks response contained errors: ${errorMessages.join("; ") || "unknown error"}`;
    if (!errorMessages.every((message) => isRetriablePayloadError(message))) {
      break;
    }

    payload = undefined;
    await sleep(1500 * (attempt + 1));
  }

  if (!payload) {
    throw new Error(lastError || "X bookmarks request failed");
  }

  const errorMessages = getPayloadErrorMessages(payload);
  if (errorMessages.length) {
    throw new Error(`X bookmarks response contained errors: ${errorMessages.join("; ") || "unknown error"}`);
  }

  const rawTweets = extractTimelineTweets(payload);

  return {
    bookmarks: normalizeBookmarks(rawTweets, TWITTER_BOOKMARKS_SOURCE),
    nextCursor: extractBottomCursor(payload),
    rawTweets,
  };
}

export async function runTwitterBookmarksSync(
  env: Env,
  options: TwitterSyncOptions = {},
): Promise<TwitterSyncResult> {
  if (!env.X_API_KEY) {
    throw new Error("X_API_KEY is not configured");
  }

  const currentStatus = await getSyncStatus(env.DB, TWITTER_BOOKMARKS_SOURCE);
  if (
    currentStatus.status === "running" &&
    currentStatus.lastAttemptAt &&
    Date.now() - new Date(currentStatus.lastAttemptAt).getTime() < 1000 * 60 * 30
  ) {
    throw new Error("A sync run is already in progress");
  }

  const maxPages = options.maxPages ?? 5;
  const shouldClassify = options.classify ?? true;

  await markSyncStarted(env.DB, TWITTER_BOOKMARKS_SOURCE);

  try {
    const runSeenIds = new Set<string>();
    const newBookmarks: BookmarkRecord[] = [];
    const rawPages: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    let fetchedBookmarks = 0;
    let fetchedPages = 0;
    let stoppedReason = "reached_page_limit";

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await fetchBookmarksPage(env, cursor);
      fetchedPages += 1;
      fetchedBookmarks += page.bookmarks.length;

      rawPages.push({
        cursor: cursor ?? null,
        nextCursor: page.nextCursor ?? null,
        items: page.rawTweets,
      });

      const dedupedPage = page.bookmarks.filter((bookmark) => {
        if (runSeenIds.has(bookmark.id)) {
          return false;
        }

        runSeenIds.add(bookmark.id);
        return true;
      });

      const existingIds = await findExistingBookmarkIds(
        env.DB,
        dedupedPage.map((bookmark) => bookmark.id),
      );
      const pageNewBookmarks = dedupedPage.filter((bookmark) => !existingIds.has(bookmark.id));
      newBookmarks.push(...pageNewBookmarks);
      cursor = page.nextCursor;

      if (!page.nextCursor) {
        stoppedReason = "cursor_exhausted";
        break;
      }

      if (!pageNewBookmarks.length) {
        stoppedReason = "encountered_known_page";
        break;
      }
    }

    if (newBookmarks.length) {
      await upsertBookmarks(env.DB, newBookmarks);
    }

    let classifiedBookmarks = 0;
    if (shouldClassify && newBookmarks.length && env.GEMINI_API_KEY) {
      const categories = await listCategories(env.DB);
      const classification = await classifyBookmarksWithGeminiSafe(env, newBookmarks, categories);
      await upsertCategories(env.DB, classification.categories);
      await upsertBookmarks(env.DB, classification.assignments);
      classifiedBookmarks = classification.assignments.length;
    }

    let snapshotKey: string | undefined;
    if (env.RAW_BOOKMARKS) {
      snapshotKey = `twitter-sync/${new Date().toISOString()}.json`;
      await env.RAW_BOOKMARKS.put(
        snapshotKey,
        JSON.stringify({
          source: TWITTER_BOOKMARKS_SOURCE,
          syncedAt: new Date().toISOString(),
          fetchedPages,
          fetchedBookmarks,
          newBookmarks: newBookmarks.length,
          items: rawPages,
        }),
      );
    }

    const stats: SyncRunStats = {
      fetchedBookmarks,
      newBookmarks: newBookmarks.length,
      fetchedPages,
      classifiedBookmarks,
      stoppedReason,
      snapshotKey,
    };

    await recordImportRun(env.DB, TWITTER_BOOKMARKS_SOURCE, stats, snapshotKey);
    await markSyncFinished(env.DB, TWITTER_BOOKMARKS_SOURCE, {
      status: "success",
      cursor,
      stats,
    });

    return {
      source: TWITTER_BOOKMARKS_SOURCE,
      nextCursor: cursor,
      ...stats,
    };
  } catch (error) {
    await markSyncFinished(env.DB, TWITTER_BOOKMARKS_SOURCE, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function handleScheduledTwitterSync(env: Env) {
  if (!env.X_API_KEY) {
    console.warn("Skipping scheduled twitter sync because X_API_KEY is not configured");
    return;
  }

  await runTwitterBookmarksSync(env);
}

export { TWITTER_BOOKMARKS_SOURCE };
