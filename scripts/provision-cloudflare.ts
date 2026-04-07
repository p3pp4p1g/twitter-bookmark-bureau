import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv();
loadDotenv({ path: ".env.local", override: true });
loadDotenv({ path: ".env.local.example", override: false });

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const wranglerConfig = path.join(cwd, "wrangler.toml");

type D1Database = {
  uuid: string;
  name: string;
};

type R2Bucket = {
  name: string;
};

async function runWrangler(args: string[], stdin?: string, configPath?: string) {
  const wranglerArgs = configPath ? ["wrangler", "--config", configPath, ...args] : ["wrangler", ...args];
  if (stdin === undefined) {
    return execFileAsync("npx", wranglerArgs, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
    });
  }

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("npx", wranglerArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `Wrangler exited with code ${code}`));
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

function patchToml(content: string, databaseId: string, bucketName: string) {
  return content
    .replace(/database_id = ".*"/, `database_id = "${databaseId}"`)
    .replace(/bucket_name = ".*"/, `bucket_name = "${bucketName}"`)
    .replace(/preview_bucket_name = ".*"/, `preview_bucket_name = "${bucketName}"`);
}

function parseDatabaseId(stdout: string): string {
  const match = stdout.match(/database_id\s*=\s*"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error(`Unable to parse database_id from Wrangler output:\n${stdout}`);
  }
  return match[1];
}

async function readAccountId() {
  const toml = await fs.readFile(wranglerConfig, "utf8");
  const match = toml.match(/^account_id\s*=\s*"([^"]+)"/m);
  if (!match?.[1]) {
    throw new Error("Missing account_id in wrangler.toml");
  }
  return match[1];
}

function getApiToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error("Missing CLOUDFLARE_API_TOKEN");
  }
  return token;
}

async function cfApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; errors?: Array<{ message?: string }>; result?: T }
    | null;

  if (!response.ok || !body?.success) {
    const message =
      body?.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `${response.status} ${response.statusText}`;
    throw new Error(`Cloudflare API request failed: ${message}`);
  }

  return body.result as T;
}

async function findD1Database(accountId: string, name: string) {
  const databases = await cfApi<D1Database[]>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`,
  );
  return databases.find((database) => database.name === name);
}

async function findR2Bucket(accountId: string, name: string) {
  const result = await cfApi<{ buckets: R2Bucket[] } | R2Bucket[]>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
  );

  const buckets = Array.isArray(result) ? result : result.buckets;
  return buckets.find((bucket) => bucket.name === name);
}

async function maybePutSecret(name: string, configPath: string) {
  const value = process.env[name];
  if (!value) {
    return false;
  }

  await runWrangler(["secret", "put", name], value, configPath);
  return true;
}

async function main() {
  try {
    const whoami = await runWrangler(["whoami"]);
    if (/not authenticated/i.test(`${whoami.stdout}\n${whoami.stderr}`)) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "Wrangler is not authenticated for non-interactive use. Set CLOUDFLARE_API_TOKEN first.",
    );
  }

  const accountId = await readAccountId();
  const d1Name = process.env.CF_D1_NAME || "twitter-bookmarks";
  const bucketName =
    process.env.CF_R2_BUCKET_NAME || `twitter-bookmarks-raw-${Date.now().toString(36)}`;

  const existingDatabase = await findD1Database(accountId, d1Name);
  const databaseId =
    existingDatabase?.uuid ??
    parseDatabaseId((await runWrangler(["d1", "create", d1Name, "--location", "enam"])).stdout);

  const existingBucket = await findR2Bucket(accountId, bucketName);
  if (!existingBucket) {
    await runWrangler(["r2", "bucket", "create", bucketName, "--location", "enam"]);
  }

  const originalToml = await fs.readFile(wranglerConfig, "utf8");
  const patchedToml = patchToml(originalToml, databaseId, bucketName);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bookmark-bureau-cf-"));
  const tempWranglerConfig = path.join(tempDir, "wrangler.toml");

  await fs.writeFile(tempWranglerConfig, patchedToml, "utf8");

  try {
    await runWrangler(["d1", "migrations", "apply", d1Name, "--remote"], undefined, tempWranglerConfig);

    const secrets = await Promise.all([
      maybePutSecret("SITE_PSK", tempWranglerConfig),
      maybePutSecret("SESSION_SECRET", tempWranglerConfig),
      maybePutSecret("INGEST_API_KEY", tempWranglerConfig),
      maybePutSecret("GEMINI_API_KEY", tempWranglerConfig),
      maybePutSecret("X_API_KEY", tempWranglerConfig),
    ]);

    console.log(
      JSON.stringify(
        {
          ok: true,
          d1Name,
          databaseId,
          bucketName,
          uploadedSecretCount: secrets.filter(Boolean).length,
          migrationApplied: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
