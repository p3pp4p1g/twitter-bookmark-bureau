import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv();
loadDotenv({ path: ".env.local", override: true });
loadDotenv({ path: ".env.local.example", override: false });

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalTwitterSessionKey() {
  const direct = process.env.X_API_KEY?.trim();
  if (direct) {
    return direct;
  }

  const authToken =
    process.env.AUTH_TWITTER_TOKEN?.trim() ||
    process.env.X_AUTH_TOKEN?.trim() ||
    process.env.TWITTER_AUTH_TOKEN?.trim();
  const ct0 =
    process.env.CT0_TWITTER?.trim() ||
    process.env.X_CT0?.trim() ||
    process.env.TWITTER_CT0?.trim();

  if (!authToken || !ct0) {
    return undefined;
  }

  return Buffer.from(`auth_token=${authToken}; ct0=${ct0};`, "utf8").toString("base64");
}

export type AgentConfig = {
  baseUrl: string;
  ingestKey: string;
  xApiKey?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  backfillExportPath?: string;
  pageLimit: number;
  backfillChunkSize: number;
  mediaBackfillLimit: number;
  stateDir: string;
};

export function getAgentConfig(): AgentConfig {
  return {
    baseUrl: required("BOOKMARK_BUREAU_BASE_URL").replace(/\/$/, ""),
    ingestKey: required("INGEST_API_KEY"),
    xApiKey: optionalTwitterSessionKey(),
    telegramBotToken:
      process.env.TELEGRAM_BOT_TOKEN?.trim() ||
      process.env.TELEGRAM_BOT_API?.trim() ||
      undefined,
    telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() || undefined,
    backfillExportPath: process.env.BACKFILL_EXPORT_PATH?.trim() || undefined,
    pageLimit: optionalInt("X_BOOKMARK_PAGE_LIMIT", 5),
    backfillChunkSize: optionalInt("AGENT_BACKFILL_CHUNK_SIZE", 100),
    mediaBackfillLimit: optionalInt("AGENT_MEDIA_BACKFILL_LIMIT", 250),
    stateDir: path.resolve(process.env.BOOKMARK_AGENT_STATE_DIR?.trim() || ".agent-state"),
  };
}
