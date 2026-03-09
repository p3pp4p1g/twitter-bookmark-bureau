export type Env = {
  APP_TITLE: string;
  ASSETS: Fetcher;
  DB: D1Database;
  DEFAULT_IMPORT_SOURCE: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  INGEST_API_KEY?: string;
  MEDIA_BUCKET?: R2Bucket;
  RAW_BOOKMARKS?: R2Bucket;
  SESSION_SECRET?: string;
  SITE_PSK?: string;
  X_API_KEY?: string;
};

export function getBaseUrl(request: Request): string {
  return new URL(request.url).origin;
}
