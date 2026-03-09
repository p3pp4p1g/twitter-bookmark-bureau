import type { Env } from "./env";

export async function sendTelegramMessage(env: Env, message: string) {
  if (!env.TELEGRAM_BOT_API || !env.TELEGRAM_CHAT_ID) {
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_API}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: message,
      disable_notification: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${response.status} ${await response.text()}`);
  }
}
