import fs from "node:fs/promises";
import path from "node:path";
import { getAgentConfig } from "./config";
import { notifyInfo, reportAlert, resolveAlert } from "./alerts";
import { reconcileBookmarkMedia, countPendingMedia } from "./media";
import { fetchAllRemoteBookmarks, fetchOpsStatus, pushBookmarks } from "./worker-client";
import { readImportFile } from "../cli/lib";
import { normalizeBookmarks } from "../shared/schema";

const BACKFILL_ERROR_FINGERPRINT = "agent-backfill-run";

function classifyErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|auth|ct0|cookie/i.test(message)) {
    return {
      code: "x-session",
      fingerprint: "x-session",
      message: `Bookmark Bureau: sessao do X invalida no backfill. ${message}`,
    };
  }
  return {
    code: "agent-backfill",
    fingerprint: BACKFILL_ERROR_FINGERPRINT,
    message: `Bookmark Bureau: backfill falhou. ${message}`,
  };
}

async function pickExportPath(explicitPath?: string) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      // fall through to auto-discovery
    }
  }

  const directory = path.resolve("manual_export");
  const entries = await fs.readdir(directory);
  const candidates = entries
    .filter((entry) => entry.endsWith(".json") || entry.endsWith(".csv"))
    .sort()
    .reverse();

  if (!candidates.length) {
    throw new Error("No manual export file found in ./manual_export");
  }

  return path.join(directory, candidates[0]);
}

async function main() {
  const config = getAgentConfig();
  const exportPath = await pickExportPath(config.backfillExportPath);

  await notifyInfo(config, `Bookmark Bureau: backfill iniciado. arquivo=${path.basename(exportPath)}`);

  try {
    const [remoteBookmarks, importedRaw] = await Promise.all([
      fetchAllRemoteBookmarks(config),
      readImportFile(exportPath),
    ]);

    const remoteIds = new Set(remoteBookmarks.map((bookmark) => bookmark.id));
    const normalized = normalizeBookmarks(importedRaw, "manual-backfill");
    const missing = normalized.filter((bookmark) => !remoteIds.has(bookmark.id));

    let imported = 0;
    for (let index = 0; index < missing.length; index += config.backfillChunkSize) {
      const chunk = missing.slice(index, index + config.backfillChunkSize);
      if (!chunk.length) {
        continue;
      }

      const result = await pushBookmarks(config, {
        source: "manual-backfill",
        bookmarks: chunk,
        classify: true,
        stats: {
          fetchedBookmarks: normalized.length,
          newBookmarks: chunk.length,
          fetchedPages: 0,
          stoppedReason: "manual_backfill_chunk",
        },
      });
      imported += result.imported;
    }

    const remoteAfterImport = await fetchAllRemoteBookmarks(config);
    const mediaTargets = remoteAfterImport.filter((bookmark) => bookmark.media.length > 0);
    const initialPendingMedia = countPendingMedia(remoteAfterImport);
    let mirrored = 0;
    let failed = 0;
    let nextTelegramMilestone = 30;

    for (const bookmark of mediaTargets) {
      const result = await reconcileBookmarkMedia(config, bookmark);
      mirrored += result.mirrored;
      failed += result.failed;

      while (mirrored >= nextTelegramMilestone) {
        await notifyInfo(
          config,
          `Bookmark Bureau: fase 1 mídia ${mirrored}/${initialPendingMedia} espelhadas. falhas=${failed}`,
        );
        nextTelegramMilestone += 30;
      }
    }

    const opsStatus = await fetchOpsStatus(config);
    const pendingMedia = Math.max(initialPendingMedia - mirrored, 0);

    await resolveAlert(config, {
      code: "agent-backfill",
      fingerprint: BACKFILL_ERROR_FINGERPRINT,
      message: `Bookmark Bureau: backfill concluido. importados=${imported}, midias=${mirrored}, pendentes=${pendingMedia}, falhas_midias=${failed}.`,
      metadata: {
        imported,
        mirrored,
        pendingMedia,
        failed,
        mediaSummary: opsStatus.media,
      },
    });

    await notifyInfo(
      config,
      `Bookmark Bureau: backfill concluido. novos=${imported} midias=${mirrored} pendentes=${opsStatus.media.bookmarksMissingMedia} falhas_midias=${failed}`,
    );
  } catch (error) {
    const classified = classifyErrorMessage(error);
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
