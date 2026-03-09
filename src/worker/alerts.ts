import { recordAlertEvent } from "./db";
import type { Env } from "./env";
import { sendTelegramMessage } from "./telegram";

type AlertSeverity = "info" | "warning" | "error";

export async function notifyInfo(env: Env, message: string) {
  try {
    await sendTelegramMessage(env, message);
  } catch (error) {
    console.warn("Telegram info notify failed", error);
  }
}

export async function reportAlert(
  env: Env,
  payload: {
    code: string;
    severity: AlertSeverity;
    fingerprint: string;
    message: string;
    metadata?: Record<string, unknown>;
    resolved?: boolean;
  },
) {
  const result = await recordAlertEvent(env.DB, {
    code: payload.code,
    severity: payload.severity,
    fingerprint: payload.fingerprint,
    message: payload.message,
    metadata: payload.metadata,
    resolved: payload.resolved ?? false,
  });

  if (result.shouldNotify) {
    try {
      await sendTelegramMessage(env, payload.message);
    } catch (error) {
      console.warn("Telegram alert notify failed", error);
    }
  }

  return result;
}

export async function resolveAlert(
  env: Env,
  payload: {
    code: string;
    fingerprint: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
) {
  return reportAlert(env, {
    code: payload.code,
    severity: "info",
    fingerprint: payload.fingerprint,
    message: payload.message,
    metadata: payload.metadata,
    resolved: true,
  });
}
