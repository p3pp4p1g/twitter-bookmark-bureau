import type { AgentConfig } from "./config";
import { recordAlert } from "./worker-client";
import { sendTelegramMessage } from "./telegram";

type AlertSeverity = "info" | "warning" | "error";

export async function notifyInfo(config: AgentConfig, message: string) {
  try {
    await sendTelegramMessage(config, message);
  } catch (error) {
    console.warn("Telegram info notify failed", error);
  }
}

export async function reportAlert(
  config: AgentConfig,
  payload: {
    code: string;
    severity: AlertSeverity;
    fingerprint: string;
    message: string;
    metadata?: Record<string, unknown>;
    resolved?: boolean;
  },
) {
  const result = await recordAlert(config, {
    code: payload.code,
    severity: payload.severity,
    fingerprint: payload.fingerprint,
    message: payload.message,
    metadata: payload.metadata,
    resolved: payload.resolved ?? false,
  });

  if (result.shouldNotify) {
    try {
      await sendTelegramMessage(config, payload.message);
    } catch (error) {
      console.warn("Telegram alert notify failed", error);
    }
  }

  return result;
}

export async function resolveAlert(
  config: AgentConfig,
  payload: {
    code: string;
    fingerprint: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
) {
  return reportAlert(config, {
    code: payload.code,
    severity: "info",
    fingerprint: payload.fingerprint,
    message: payload.message,
    metadata: payload.metadata,
    resolved: true,
  });
}
