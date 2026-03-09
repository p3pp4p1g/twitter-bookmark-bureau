import { getAgentConfig } from "./config";
import { notifyInfo, reportAlert, resolveAlert } from "./alerts";
import { reconcileBookmarkMedia } from "./media";
import { fetchAllRemoteBookmarks, fetchOpsStatus } from "./worker-client";

async function main() {
  const config = getAgentConfig();

  try {
    const bookmarks = await fetchAllRemoteBookmarks(config, { needsMedia: true });
    let mirrored = 0;
    let failed = 0;

    for (const bookmark of bookmarks.filter((item) => item.media.length > 0)) {
      const result = await reconcileBookmarkMedia(config, bookmark);
      mirrored += result.mirrored;
      failed += result.failed;
    }

    const opsStatus = await fetchOpsStatus(config);
    await resolveAlert(config, {
      code: "media-reconcile",
      fingerprint: "media-reconcile",
      message: `Bookmark Bureau: reconciliacao de midia concluida. midias=${mirrored} falhas=${failed} pendentes=${opsStatus.media.bookmarksMissingMedia}.`,
      metadata: {
        mirrored,
        failed,
        mediaSummary: opsStatus.media,
      },
    });

    if (mirrored || failed || opsStatus.media.bookmarksMissingMedia) {
      await notifyInfo(
        config,
        `Bookmark Bureau: reconciliacao de midia. midias=${mirrored} falhas=${failed} pendentes=${opsStatus.media.bookmarksMissingMedia}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportAlert(config, {
      code: "media-reconcile",
      severity: "error",
      fingerprint: "media-reconcile",
      message: `Bookmark Bureau: reconciliacao de midia falhou. ${message}`,
    });
    console.error(message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
