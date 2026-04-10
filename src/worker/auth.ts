import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { renderLoginPage } from "./templates";

const SESSION_COOKIE = "bb_session";

type SessionPayload = {
  exp: number;
  iat: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64UrlEncode(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

async function importKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(payload: SessionPayload, secret: string): Promise<string> {
  const body = JSON.stringify(payload);
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${base64UrlEncode(body)}.${base64UrlEncode(signature)}`;
}

async function verifyPayload(token: string, secret: string): Promise<boolean> {
  const [bodyEncoded, signatureEncoded] = token.split(".");
  if (!bodyEncoded || !signatureEncoded) {
    return false;
  }

  const body = base64UrlDecode(bodyEncoded);
  const signatureBytes = Uint8Array.from(base64UrlDecode(signatureEncoded), (char) =>
    char.charCodeAt(0),
  );
  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(body),
  );

  if (!valid) {
    return false;
  }

  const payload = JSON.parse(body) as SessionPayload;
  return Date.now() < payload.exp;
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

function getSessionSecret(env: Env): string | undefined {
  return env.SESSION_SECRET ?? env.SITE_PSK;
}

function getIngestCredential(c: Context<{ Bindings: Env }>): string | undefined {
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const header = c.req.header("x-ingest-key");
  return bearer ?? header;
}

export async function hasSiteSession(c: Context<{ Bindings: Env }>): Promise<boolean> {
  if (!c.env.SITE_PSK) {
    return true;
  }

  const token = getCookie(c, SESSION_COOKIE);
  const secret = getSessionSecret(c.env);

  if (!token || !secret) {
    return false;
  }

  return verifyPayload(token, secret);
}

export const siteGate: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const requiresSiteSession =
    !!c.env.SITE_PSK &&
    !path.startsWith("/api/auth/login") &&
    !path.startsWith("/api/auth/logout") &&
    !path.startsWith("/api/admin/") &&
    !path.startsWith("/api/healthz") &&
    path !== "/bookmark.png" &&
    path !== "/favicon.ico";

  if (!requiresSiteSession) {
    await next();
    return;
  }

  const authenticated = await hasSiteSession(c);
  if (authenticated) {
    await next();
    return;
  }

  if (path.startsWith("/api/")) {
    c.header("Cache-Control", "no-store, private");
    return c.json({ error: "Authentication required" }, 401);
  }

  c.header("Cache-Control", "no-store, private");
  return c.html(renderLoginPage(c.env.APP_TITLE));
};

export async function loginWithPsk(c: Context<{ Bindings: Env }>) {
  const secret = getSessionSecret(c.env);
  const body = (await c.req.json().catch(() => ({}))) as { psk?: string };

  if (!c.env.SITE_PSK || !secret) {
    c.header("Cache-Control", "no-store, private");
    return c.json({ ok: true, protected: false });
  }

  if (!body.psk || !constantTimeEquals(body.psk, c.env.SITE_PSK)) {
    await sleep(350);
    c.header("Cache-Control", "no-store, private");
    return c.json({ ok: false, error: "Authentication failed" }, 401);
  }

  const now = Date.now();
  const token = await signPayload(
    {
      iat: now,
      exp: now + 1000 * 60 * 60 * 24 * 30,
    },
    secret,
  );

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 30,
  });

  c.header("Cache-Control", "no-store, private");
  return c.json({ ok: true, protected: true });
}

export function logout(c: Context<{ Bindings: Env }>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  c.header("Cache-Control", "no-store, private");
  return c.json({ ok: true });
}

export async function requireSiteSession(c: Context<{ Bindings: Env }>) {
  const authenticated = await hasSiteSession(c);
  if (!authenticated) {
    c.header("Cache-Control", "no-store, private");
    return c.json({ error: "Authentication required" }, 401);
  }

  return undefined;
}

export function requireIngestKey(c: Context<{ Bindings: Env }>) {
  if (!c.env.INGEST_API_KEY) {
    c.header("Cache-Control", "no-store, private");
    return c.json({ error: "Service unavailable" }, 503);
  }

  const candidate = getIngestCredential(c);

  if (!candidate || !constantTimeEquals(candidate, c.env.INGEST_API_KEY)) {
    c.header("Cache-Control", "no-store, private");
    return c.json({ error: "Authentication required" }, 401);
  }

  return undefined;
}

export async function requireAdminAccess(c: Context<{ Bindings: Env }>) {
  if (c.env.SITE_PSK && (await hasSiteSession(c))) {
    return undefined;
  }

  if (c.env.INGEST_API_KEY) {
    const candidate = getIngestCredential(c);
    if (candidate && constantTimeEquals(candidate, c.env.INGEST_API_KEY)) {
      return undefined;
    }
  }

  if (!c.env.SITE_PSK && !c.env.INGEST_API_KEY) {
    c.header("Cache-Control", "no-store, private");
    return c.json({ error: "Service unavailable" }, 503);
  }

  c.header("Cache-Control", "no-store, private");
  return c.json({ error: "Authentication required" }, 401);
}
