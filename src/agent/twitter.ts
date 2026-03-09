import { normalizeBookmarks, type BookmarkRecord } from "../shared/schema";

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

function getCookieHeader(apiKey: string) {
  const decoded = decodeApiKey(apiKey).trim();
  if (!decoded) {
    throw new Error("X_API_KEY is empty");
  }
  return decoded.endsWith(";") ? decoded : `${decoded};`;
}

function getCookieValue(cookieHeader: string, name: string) {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return record.legacy ? record : undefined;
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

export async function fetchBookmarksPage(
  apiKey: string,
  cursor?: string,
  count = 40,
): Promise<{ bookmarks: BookmarkRecord[]; nextCursor?: string }> {
  const cookieHeader = getCookieHeader(apiKey);
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

  let response: Response | undefined;
  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url.toString(), { headers });
    if (response.ok) {
      break;
    }

    lastError = await response.text();
    if (response.status !== 429 && response.status < 500) {
      break;
    }

    await sleep(1500 * (attempt + 1));
  }

  if (!response?.ok) {
    throw new Error(`X bookmarks request failed: ${response?.status ?? 0} ${lastError}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  if (errors.length) {
    const message = errors
      .map((item) => asRecord(item)?.message)
      .filter((value): value is string => typeof value === "string")
      .join("; ");
    throw new Error(`X bookmarks response contained errors: ${message || "unknown error"}`);
  }

  const rawTweets = extractTimelineTweets(payload);
  return {
    bookmarks: normalizeBookmarks(rawTweets, "x-daily-agent"),
    nextCursor: extractBottomCursor(payload),
  };
}
