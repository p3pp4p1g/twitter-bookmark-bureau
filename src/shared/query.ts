import type { BookmarkFilters } from "./schema";

export function buildBookmarkQuery(filters: BookmarkFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    clauses.push(
      "(b.text LIKE ? OR b.author_name LIKE ? OR b.author_handle LIKE ? OR b.url LIKE ?)",
    );
    const token = `%${filters.q}%`;
    params.push(token, token, token, token);
  }

  if (filters.category) {
    clauses.push("COALESCE(b.manual_category_slug, b.category_slug) = ?");
    params.push(filters.category);
  }

  if (filters.author) {
    clauses.push("b.author_handle = ?");
    params.push(filters.author);
  }

  if (filters.media === "only") {
    clauses.push("b.has_media = 1");
  }

  if (filters.media === "none") {
    clauses.push("b.has_media = 0");
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  return {
    sql: `
      SELECT
        b.id,
        b.url,
        b.text,
        b.author_name,
        b.author_handle,
        b.author_id,
        b.created_at,
        b.lang,
        b.links_json,
        b.media_json,
        b.summary,
        b.category_slug,
        b.category_name,
        b.category_confidence,
        b.category_reason,
        b.manual_category_slug,
        c.name AS active_category_name,
        c.color AS active_category_color,
        b.source,
        b.imported_at,
        b.updated_at
      FROM bookmarks b
      LEFT JOIN categories c ON c.slug = COALESCE(b.manual_category_slug, b.category_slug)
      ${whereClause}
      ORDER BY datetime(b.created_at) DESC
      LIMIT ? OFFSET ?
    `,
    params: [...params, limit, offset],
  };
}
