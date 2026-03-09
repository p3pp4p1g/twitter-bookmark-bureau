import type { AgentConfig } from "./config";

async function discoverChatId(botToken: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as {
    result?: Array<{
      message?: {
        chat?: {
          id?: number;
          type?: string;
        };
      };
    }>;
  };

  const latestPrivateChat = [...(payload.result ?? [])]
    .reverse()
    .find((item) => item.message?.chat?.id && item.message?.chat?.type === "private");

  return latestPrivateChat?.message?.chat?.id
    ? String(latestPrivateChat.message.chat.id)
    : undefined;
}

async function resolveChatId(config: AgentConfig, allowConfigured = true) {
  if (allowConfigured && config.telegramChatId) {
    return config.telegramChatId;
  }
  if (!config.telegramBotToken) {
    return undefined;
  }
  return discoverChatId(config.telegramBotToken);
}

export async function sendTelegramMessage(config: AgentConfig, message: string) {
  if (!config.telegramBotToken) {
    return;
  }

  let chatId = await resolveChatId(config, true);
  if (!chatId) {
    return;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          disable_notification: false,
        }),
      },
    );

    if (response.ok) {
      return;
    }

    const body = await response.text();
    const canRetryDiscovery = attempt === 0 && /chat not found/i.test(body);
    if (!canRetryDiscovery) {
      console.warn(`Telegram notify skipped: ${response.status} ${body}`);
      return;
    }

    chatId = await resolveChatId(config, false);
    if (!chatId) {
      console.warn(`Telegram notify skipped: ${response.status} ${body}`);
      return;
    }
  }
}
