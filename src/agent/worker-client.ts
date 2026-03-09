import type { AgentConfig } from "./config";
import type { AlertEvent, BookmarkRecord, CategoryRecord } from "../shared/schema";

type ExportResponse = {
  items: BookmarkRecord[];
  total: number;
};

function buildHeaders(config: AgentConfig) {
  return {
    authorization: `Bearer ${config.ingestKey}`,
  };
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function fetchRemoteBookmarks(
  config: AgentConfig,
  options: { limit?: number; offset?: number; needsMedia?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options.offset) {
    params.set("offset", String(options.offset));
  }
  if (options.needsMedia) {
    params.set("needsMedia", "1");
  }

  return fetchJson<ExportResponse>(`${config.baseUrl}/api/admin/bookmarks/export?${params.toString()}`, {
    headers: buildHeaders(config),
  });
}

export async function fetchAllRemoteBookmarks(
  config: AgentConfig,
  options: { needsMedia?: boolean } = {},
) {
  const items: BookmarkRecord[] = [];
  let offset = 0;
  const limit = 200;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await fetchRemoteBookmarks(config, {
      limit,
      offset,
      needsMedia: options.needsMedia,
    });
    total = page.total;
    items.push(...page.items);
    offset += limit;
  }

  return items;
}

export async function pushBookmarks(
  config: AgentConfig,
  payload: {
    source: string;
    bookmarks: BookmarkRecord[];
    categories?: CategoryRecord[];
    classify?: boolean;
    stats?: Record<string, unknown>;
  },
) {
  return fetchJson<{ ok: true; imported: number; classified: number }>(
    `${config.baseUrl}/api/admin/sync/push`,
    {
      method: "POST",
      headers: {
        ...buildHeaders(config),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function uploadMediaAsset(
  config: AgentConfig,
  payload: {
    bookmarkId: string;
    mediaId: string;
    sourceUrl: string;
    normalizedUrl: string;
    thumbnailUrl?: string;
    mediaType: string;
    contentHash: string;
    mimeType: string;
    sizeBytes: number;
    buffer: ArrayBuffer;
  },
) {
  const form = new FormData();
  form.set("bookmarkId", payload.bookmarkId);
  form.set("mediaId", payload.mediaId);
  form.set("sourceUrl", payload.sourceUrl);
  form.set("normalizedUrl", payload.normalizedUrl);
  if (payload.thumbnailUrl) {
    form.set("thumbnailUrl", payload.thumbnailUrl);
  }
  form.set("mediaType", payload.mediaType);
  form.set("contentHash", payload.contentHash);
  form.set("mimeType", payload.mimeType);
  form.set("sizeBytes", String(payload.sizeBytes));
  form.set(
    "file",
    new Blob([payload.buffer], { type: payload.mimeType }),
    `${payload.mediaId}.${payload.mimeType.split("/")[1] ?? "bin"}`,
  );

  return fetchJson<{ ok: true; r2Key: string; mirroredUrl: string }>(
    `${config.baseUrl}/api/admin/media/upload`,
    {
      method: "POST",
      headers: buildHeaders(config),
      body: form,
    },
  );
}

export async function recordAlert(config: AgentConfig, event: AlertEvent) {
  return fetchJson<{ event: Record<string, unknown>; shouldNotify: boolean }>(
    `${config.baseUrl}/api/admin/alerts`,
    {
      method: "POST",
      headers: {
        ...buildHeaders(config),
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );
}

export async function fetchOpsStatus(config: AgentConfig) {
  return fetchJson<{
    media: {
      totalAssets: number;
      uploadedAssets: number;
      pendingAssets: number;
      failedAssets: number;
      bookmarksMissingMedia: number;
    };
    activeAlerts: Array<Record<string, unknown>>;
  }>(`${config.baseUrl}/api/admin/ops/status`, {
    headers: buildHeaders(config),
  });
}
