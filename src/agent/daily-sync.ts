import { getAgentConfig } from "./config";
import { notifyInfo, reportAlert, resolveAlert } from "./alerts";
import { fetchBookmarksPage } from "./twitter";
import { countPendingMedia, reconcileBookmarkMedia } from "./media";
import { fetchAllRemoteBookmarks, fetchOpsStatus, pushBookmarks } from "./worker-client";
import type { BookmarkRecord } from "../shared/schema";

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|auth|ct0|cookie/i.test(message)) {
    return {
      code: "x-session",
      fingerprint: "x-session",
      message: `Bookmark Bureau: sessao do X caiu. ${message}`,
    };
  }

  if (/response contained errors|format|graphql/i.test(message)) {
    return {
      code: "x-format",
      fingerprint: "x-format",
      message: `Bookmark Bureau: resposta do X mudou ou falhou. ${message}`,
    };
  }

  return {
    code: "agent-sync",
    fingerprint: "agent-sync",
    message: `Bookmark Bureau: sync diario falhou. ${message}`,
  };
}

async function main() {
  const config = getAgentConfig();
  if (!config.xApiKey) {
    throw new Error("X_API_KEY is required for daily sync");
  }

  await notifyInfo(config, "Bookmark Bureau: sync diario iniciado.");

  try {
    const remoteBookmarks = await fetchAllRemoteBookmarks(config);
    const existingIds = new Set(remoteBookmarks.map((bookmark) => bookmark.id));

    const runSeenIds = new Set<string>();
    const newBookmarks: BookmarkRecord[] = [];
    let cursor: string | undefined;
    let fetchedBookmarks = 0;
    let fetchedPages = 0;
    let stoppedReason = "reached_page_limit";

    for (let pageIndex = 0; pageIndex < config.pageLimit; pageIndex += 1) {
      const page = await fetchBookmarksPage(config.xApiKey, cursor);
      fetchedPages += 1;
      fetchedBookmarks += page.bookmarks.length;

      const dedupedPage = page.bookmarks.filter((bookmark) => {
        if (runSeenIds.has(bookmark.id)) {
          return false;
        }
        runSeenIds.add(bookmark.id);
        return true;
      });

      const pageNew = dedupedPage.filter((bookmark) => !existingIds.has(bookmark.id));
      newBookmarks.push(...pageNew);
      cursor = page.nextCursor;

      if (!page.nextCursor) {
        stoppedReason = "cursor_exhausted";
        break;
      }

      if (!pageNew.length) {
        stoppedReason = "encountered_known_page";
        break;
      }
    }

    let imported = 0;
    let classified = 0;
    if (newBookmarks.length) {
      const result = await pushBookmarks(config, {
        source: "wsl-daily-sync",
        bookmarks: newBookmarks,
        classify: true,
        stats: {
          fetchedBookmarks,
          newBookmarks: newBookmarks.length,
          fetchedPages,
          stoppedReason,
        },
      });
      imported = result.imported;
      classified = result.classified;
    }

    const remoteAfterSync = await fetchAllRemoteBookmarks(config);
    const targets = remoteAfterSync.filter((bookmark) => bookmark.media.length > 0).slice(0, config.mediaBackfillLimit);
    let mirrored = 0;
    let failed = 0;

    for (const bookmark of targets) {
      const result = await reconcileBookmarkMedia(config, bookmark);
      mirrored += result.mirrored;
      failed += result.failed;
    }

    const pendingMedia = countPendingMedia(remoteAfterSync);
    const opsStatus = await fetchOpsStatus(config);

    await resolveAlert(config, {
      code: "x-session",
      fingerprint: "x-session",
      message: `Bookmark Bureau: sessao do X valida. sync diario ok. novos=${imported} midias=${mirrored}.`,
      metadata: {
        imported,
        mirrored,
        pendingMedia,
      },
    });
    await resolveAlert(config, {
      code: "x-format",
      fingerprint: "x-format",
      message: `Bookmark Bureau: parsing do X normalizado novamente.`,
    });
    await resolveAlert(config, {
      code: "agent-sync",
      fingerprint: "agent-sync",
      message: `Bookmark Bureau: sync diario voltou ao normal.`,
    });

    await notifyInfo(
      config,
      `Bookmark Bureau: sync concluido. novos=${imported} classificados=${classified} midias=${mirrored} pendentes=${opsStatus.media.bookmarksMissingMedia} paginas=${fetchedPages} motivo=${stoppedReason}`,
    );
  } catch (error) {
    const classified = classifyError(error);
    console.error(classified.message);
    await reportAlert(config, {
      code: classified.code,
      severity: "error",
      fingerprint: classified.fingerprint,
      message: classified.message,
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
