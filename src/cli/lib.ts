import { parse as parseCsv } from "csv-parse/sync";
import { config as loadDotenv } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";

loadDotenv();
loadDotenv({ path: ".env.local", override: true });

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function readImportFile(filePath: string): Promise<unknown[]> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, "utf8");

  if (absolutePath.endsWith(".csv")) {
    return parseCsv(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as unknown[];
  }

  const parsed = JSON.parse(content) as unknown;

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "bookmarks" in parsed &&
    Array.isArray((parsed as { bookmarks: unknown[] }).bookmarks)
  ) {
    return (parsed as { bookmarks: unknown[] }).bookmarks;
  }

  throw new Error("Unsupported import file format. Expected JSON array, { bookmarks: [] }, or CSV.");
}

export async function postImport(payload: unknown) {
  const baseUrl = requiredEnv("BOOKMARK_BUREAU_BASE_URL");
  const ingestKey = requiredEnv("INGEST_API_KEY");

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/admin/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ingestKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Import failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function postClassifyPending(payload: { limit?: number; ids?: string[] } = {}) {
  const baseUrl = requiredEnv("BOOKMARK_BUREAU_BASE_URL");
  const ingestKey = requiredEnv("INGEST_API_KEY");

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/admin/classify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ingestKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Classification failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<{ ok: true; classified: number }>;
}

export async function postConsolidate(payload: { limit?: number; ids?: string[] } = {}) {
  const baseUrl = requiredEnv("BOOKMARK_BUREAU_BASE_URL");
  const ingestKey = requiredEnv("INGEST_API_KEY");

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/admin/consolidate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ingestKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Consolidation failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<{ ok: true; result: { processed: number; changed: number } }>;
}
