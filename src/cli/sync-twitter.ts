import { Rettiwt } from "rettiwt-api";
import { normalizeBookmarks } from "../shared/schema";
import { postImport, requiredEnv } from "./lib";

async function fetchBookmarks(apiKey: string, maxPages = 10) {
  const rettiwt = new Rettiwt({ apiKey });
  const collected: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await rettiwt.user.bookmarks(100, cursor);

    for (const tweet of page.list) {
      const serializable =
        typeof (tweet as { toJSON?: () => unknown }).toJSON === "function"
          ? (tweet as { toJSON: () => unknown }).toJSON()
          : tweet;

      const id = (serializable as { id?: string }).id;
      if (id && seen.has(id)) {
        continue;
      }

      if (id) {
        seen.add(id);
      }

      collected.push(serializable);
    }

    if (!page.next) {
      break;
    }

    cursor = page.next;
  }

  return collected;
}

async function main() {
  const apiKey = requiredEnv("X_API_KEY");
  const maxPages = Number(process.env.X_BOOKMARK_PAGE_LIMIT ?? 10);
  const source = "rettiwt";
  const rawBookmarks = await fetchBookmarks(apiKey, maxPages);
  const bookmarks = normalizeBookmarks(rawBookmarks, source);

  const result = await postImport({
    source,
    bookmarks,
    snapshot: {
      fetchedAt: new Date().toISOString(),
      rawBookmarks,
    },
    classify: true,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
