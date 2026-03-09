import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

type Overview = {
  bookmarkCount: number;
  categoryCount: number;
  uncategorizedCount: number;
  latestImportAt?: string;
};

type SessionPayload = {
  appTitle: string;
  baseUrl: string;
  protectedByPsk: boolean;
  hasGemini: boolean;
  hasIngestKey: boolean;
  hasTwitterSyncAuth: boolean;
  overview: Overview;
  syncStatus: SyncStatus;
  opsStatus: {
    media: {
      totalAssets: number;
      uploadedAssets: number;
      pendingAssets: number;
      failedAssets: number;
      bookmarksMissingMedia: number;
    };
    activeAlerts: Array<{
      code: string;
      severity: "info" | "warning" | "error";
      message: string;
    }>;
  };
};

type Category = {
  slug: string;
  name: string;
  description?: string;
  color: string;
  count: number;
};

type Bookmark = {
  id: string;
  url: string;
  text: string;
  authorName: string;
  authorHandle: string;
  createdAt: string;
  links: string[];
  media: Array<{
    id: string;
    type: string;
    url: string;
    thumbnailUrl?: string;
    mirroredUrl?: string;
    mimeType?: string;
    sizeBytes?: number;
    status?: "pending" | "uploaded" | "failed";
  }>;
  summary?: string;
  categorySlug?: string;
  categoryName?: string;
  categoryColor?: string;
  categoryConfidence?: number;
  categoryReason?: string;
  manualCategorySlug?: string;
  source: string;
};

type SyncStats = {
  fetchedBookmarks: number;
  newBookmarks: number;
  fetchedPages: number;
  classifiedBookmarks: number;
  stoppedReason: string;
  snapshotKey?: string;
};

type SyncStatus = {
  source: string;
  status: "idle" | "running" | "success" | "error";
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastCursor?: string;
  stats?: SyncStats;
  updatedAt?: string;
};

const BOOKMARK_PREVIEW_LENGTH = 343;

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

function formatDate(value?: string) {
  if (!value) {
    return "never";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatSyncState(status?: SyncStatus["status"]) {
  switch (status) {
    case "running":
      return "Syncing";
    case "success":
      return "Healthy";
    case "error":
      return "Needs attention";
    default:
      return "Idle";
  }
}

function getCollapsedBookmarkText(text: string) {
  if (text.length <= BOOKMARK_PREVIEW_LENGTH) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, BOOKMARK_PREVIEW_LENGTH).trimEnd()}...`,
    truncated: true,
  };
}

function isVideoAsset(item: Bookmark["media"][number]) {
  const url = item.mirroredUrl ?? item.url;
  return item.type === "video" && /\.mp4(\?|$)/i.test(url);
}

function hasUsableMirroredAsset(item: Bookmark["media"][number]) {
  return Boolean(
    item.mirroredUrl &&
      item.mimeType !== "text/html" &&
      (item.sizeBytes === undefined || item.sizeBytes >= 1024),
  );
}

function getPreviewUrl(item: Bookmark["media"][number]) {
  const mirrored = hasUsableMirroredAsset(item) ? item.mirroredUrl : undefined;
  if (item.type === "photo") {
    return mirrored ?? item.thumbnailUrl ?? item.url;
  }
  return item.thumbnailUrl ?? mirrored ?? item.url;
}

function BookmarkCard({
  bookmark,
  categories,
  onOverride,
  expanded,
  onExpand,
}: {
  bookmark: Bookmark;
  categories: Category[];
  onOverride: (bookmarkId: string, categoryName: string) => Promise<void>;
  expanded: boolean;
  onExpand: (bookmarkId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(bookmark.categoryName ?? "");
  const [saving, setSaving] = useState(false);
  const collapsed = getCollapsedBookmarkText(bookmark.text || "Bookmark without tweet text.");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) {
      return;
    }

    setSaving(true);
    try {
      await onOverride(bookmark.id, value.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="bookmark-card">
      <div className="bookmark-card__meta">
        <div>
          <p className="bookmark-card__eyebrow">@{bookmark.authorHandle}</p>
          <h3>{bookmark.authorName}</h3>
        </div>
        <time>{formatDate(bookmark.createdAt)}</time>
      </div>

      <div className="bookmark-card__text-block">
        <p className="bookmark-card__text">
          {expanded ? (
            bookmark.text || "Bookmark without tweet text."
          ) : (
            <>
              {collapsed.text}
              {collapsed.truncated ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="bookmark-card__expand"
                    onClick={() => onExpand(bookmark.id)}
                  >
                    continua...
                  </button>
                </>
              ) : null}
            </>
          )}
        </p>
      </div>

      {bookmark.links.length ? (
        <div className="bookmark-card__links">
          {bookmark.links.slice(0, 3).map((link) => (
            <a key={link} href={link} target="_blank" rel="noreferrer">
              {extractDomain(link)}
            </a>
          ))}
        </div>
      ) : null}

      {bookmark.media.length ? (
        <div className="bookmark-card__media">
          {bookmark.media.slice(0, 3).map((item) => (
            <a
              key={item.id}
              className="bookmark-card__media-frame"
              href={(hasUsableMirroredAsset(item) ? item.mirroredUrl : undefined) ?? item.url}
              target="_blank"
              rel="noreferrer"
            >
              {isVideoAsset(item) ? (
                <video
                  className="bookmark-card__media-preview"
                  src={(hasUsableMirroredAsset(item) ? item.mirroredUrl : undefined) ?? item.url}
                  poster={item.thumbnailUrl}
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  className="bookmark-card__media-preview"
                  src={getPreviewUrl(item)}
                  alt={`${bookmark.authorHandle} media`}
                  loading="lazy"
                />
              )}
              <span className="bookmark-card__media-badge">
                {item.type}
                {item.status === "uploaded" ? " archived" : ""}
              </span>
            </a>
          ))}
        </div>
      ) : null}

      <div className="bookmark-card__footer">
        <a className="bookmark-card__open" href={bookmark.url} target="_blank" rel="noreferrer">
          Open in X
        </a>
      </div>

      <div className="bookmark-card__curation">
        {bookmark.categoryName ? (
          <div className="bookmark-card__category">
            <span
              className="pill pill--category"
              style={
                bookmark.categoryColor
                  ? ({ "--pill-color": bookmark.categoryColor } as React.CSSProperties)
                  : undefined
              }
            >
              {bookmark.categoryName}
            </span>
          </div>
        ) : null}
        <button type="button" className="button button--ghost" onClick={() => setEditing((state) => !state)}>
          {editing ? "Close editor" : "Override category"}
        </button>
        {editing ? (
          <form className="bookmark-card__form" onSubmit={submit}>
            <input
              list={`categories-${bookmark.id}`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Type a category name"
            />
            <datalist id={`categories-${bookmark.id}`}>
              {categories.map((category) => (
                <option key={category.slug} value={category.name} />
              ))}
            </datalist>
            <button type="submit" className="button" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

export default function App() {
  const PAGE_SIZE = 21;
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [mediaFilter, setMediaFilter] = useState<"all" | "only" | "none">("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBookmarks, setExpandedBookmarks] = useState<Record<string, boolean>>({});

  const deferredQuery = useDeferredValue(query);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestKeyRef = useRef("");

  function buildBookmarkParams(offset = 0, limit = PAGE_SIZE) {
    const params = new URLSearchParams();
    if (deferredQuery.trim()) {
      params.set("q", deferredQuery.trim());
    }
    if (selectedCategory) {
      params.set("category", selectedCategory);
    }
    if (mediaFilter !== "all") {
      params.set("media", mediaFilter);
    }
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    return params;
  }

  async function loadBookmarks() {
    setLoading(true);
    setError(null);

    try {
      const requestKey = JSON.stringify({
        q: deferredQuery.trim(),
        category: selectedCategory,
        media: mediaFilter,
      });
      requestKeyRef.current = requestKey;
      const params = buildBookmarkParams(0, PAGE_SIZE);

      const [sessionPayload, categoriesPayload, bookmarksPayload] = await Promise.all([
        fetchJson<SessionPayload>("/api/session"),
        fetchJson<{ items: Category[] }>("/api/categories"),
        fetchJson<{ items: Bookmark[] }>(`/api/bookmarks?${params.toString()}`),
      ]);

      if (requestKeyRef.current !== requestKey) {
        return;
      }

      setSession(sessionPayload);
      setCategories(categoriesPayload.items);
      setBookmarks(bookmarksPayload.items);
      setHasMore(bookmarksPayload.items.length === PAGE_SIZE);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load archive");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBookmarks();
  }, [deferredQuery, selectedCategory, mediaFilter]);

  const activeCategory = useMemo(
    () => categories.find((category) => category.slug === selectedCategory),
    [categories, selectedCategory],
  );

  async function loadMoreBookmarks() {
    if (loading || loadingMore || !hasMore) {
      return;
    }

    setLoadingMore(true);
    try {
      const requestKey = requestKeyRef.current;
      const params = buildBookmarkParams(bookmarks.length, PAGE_SIZE);
      const bookmarksPayload = await fetchJson<{ items: Bookmark[] }>(`/api/bookmarks?${params.toString()}`);

      if (requestKeyRef.current !== requestKey) {
        return;
      }

      setBookmarks((current) => {
        const seen = new Set(current.map((bookmark) => bookmark.id));
        const next = bookmarksPayload.items.filter((bookmark) => !seen.has(bookmark.id));
        return [...current, ...next];
      });
      setHasMore(bookmarksPayload.items.length === PAGE_SIZE);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load more bookmarks");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreBookmarks();
        }
      },
      { rootMargin: "240px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [bookmarks.length, hasMore, loading, loadingMore, deferredQuery, selectedCategory, mediaFilter]);

  async function handleOverride(bookmarkId: string, categoryName: string) {
    await fetchJson<{ ok: true }>("/api/overrides", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarkId, categoryName }),
    });

    await loadBookmarks();
  }

  function onSearchChange(value: string) {
    startTransition(() => {
      setQuery(value);
    });
  }

  function handleExpandBookmark(bookmarkId: string) {
    setExpandedBookmarks((current) => {
      if (current[bookmarkId]) {
        return current;
      }
      return {
        ...current,
        [bookmarkId]: true,
      };
    });
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero__copy">
          <p className="hero__eyebrow">private research desk</p>
          <h1>{session?.appTitle ?? "Bookmark Bureau"}</h1>
          <p className="hero__lede">
            A personal archive for X/Twitter bookmarks, classified with Gemini and arranged like a desk full of annotated clippings.
          </p>
        </div>

        <div className="hero__stats">
          <div className="stat">
            <span>Bookmarks</span>
            <strong>{session?.overview.bookmarkCount ?? 0}</strong>
          </div>
          <div className="stat">
            <span>Categories</span>
            <strong>{session?.overview.categoryCount ?? 0}</strong>
          </div>
          <div className="stat">
            <span>Unsorted</span>
            <strong>{session?.overview.uncategorizedCount ?? 0}</strong>
          </div>
          <div className="stat stat--wide">
            <span>Latest import</span>
            <strong>{formatDate(session?.overview.latestImportAt)}</strong>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="filters-panel">
          <div className="panel panel--stacked">
            <label className="field">
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="AI agents, design systems, datasets..."
              />
            </label>

            <div className="field">
              <span>Media</span>
              <div className="toggle-group">
                {(["all", "only", "none"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={mediaFilter === option ? "button" : "button button--ghost"}
                    onClick={() => setMediaFilter(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="panel categories-panel">
            <div className="panel__header">
              <h2>Category ribbons</h2>
              {activeCategory ? (
                <button type="button" className="button button--ghost" onClick={() => setSelectedCategory("")}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="category-list">
              {categories.map((category) => (
                <button
                  key={category.slug}
                  type="button"
                  className={
                    selectedCategory === category.slug
                      ? "category-ribbon category-ribbon--active"
                      : "category-ribbon"
                  }
                  style={{ "--ribbon-color": category.color } as React.CSSProperties}
                  onClick={() => setSelectedCategory(category.slug)}
                >
                  <span>{category.name}</span>
                  <strong>{category.count}</strong>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="results-panel">
          {error ? <div className="panel error-banner">{error}</div> : null}
          {loading ? <div className="panel loading-banner">Loading archive...</div> : null}

          <div className="bookmark-grid">
            {bookmarks.map((bookmark) => (
              <BookmarkCard
                key={bookmark.id}
                bookmark={bookmark}
                categories={categories}
                onOverride={handleOverride}
                expanded={Boolean(expandedBookmarks[bookmark.id])}
                onExpand={handleExpandBookmark}
              />
            ))}
          </div>
          {!loading && !bookmarks.length ? (
            <div className="panel loading-banner">No bookmarks for the current filters.</div>
          ) : null}
          <div ref={sentinelRef} className="infinite-sentinel" aria-hidden="true" />
          {loadingMore ? <div className="panel loading-banner">Loading more bookmarks...</div> : null}
          {!hasMore && bookmarks.length > 0 ? (
            <div className="panel loading-banner">End of archive for current filters.</div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
