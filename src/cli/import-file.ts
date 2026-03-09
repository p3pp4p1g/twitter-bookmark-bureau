import { normalizeBookmarks } from "../shared/schema";
import { postImport, readImportFile } from "./lib";

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Usage: npm run import:file -- ./path/to/bookmarks.json");
  }

  const source = process.argv[3] ?? "manual";
  const classify = !process.argv.includes("--no-classify");
  const rawBookmarks = await readImportFile(inputPath);
  const bookmarks = normalizeBookmarks(rawBookmarks, source);

  const result = await postImport({
    source,
    bookmarks,
    snapshot: rawBookmarks,
    classify,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
