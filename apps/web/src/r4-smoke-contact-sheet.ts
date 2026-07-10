import { stat } from "node:fs/promises";
import path from "node:path";

export type ContactSheetFreshnessStep = {
  screenshot: string;
};

export type ContactSheetFreshnessReport = {
  ok: boolean;
  contact_sheet: string;
  contact_sheet_missing: boolean;
  source_count: number;
  png_mtime_ms: number | null;
  newest_source_mtime_ms: number | null;
  stale_sources: string[];
  missing_sources: string[];
};

export async function contactSheetFreshness(input: {
  outputDir: string;
  steps: ContactSheetFreshnessStep[];
  htmlFilename?: string;
  pngFilename?: string;
}): Promise<ContactSheetFreshnessReport> {
  const htmlFilename = input.htmlFilename ?? "contact-sheet.html";
  const pngFilename = input.pngFilename ?? "contact-sheet.png";
  const pngPath = path.join(input.outputDir, pngFilename);
  const sourcePaths = [
    path.join(input.outputDir, htmlFilename),
    ...input.steps.map((step) => path.join(input.outputDir, step.screenshot))
  ];
  const png = await stat(pngPath).catch(() => undefined);
  const sourceStats = await Promise.all(
    sourcePaths.map(async (sourcePath) => ({
      name: path.basename(sourcePath),
      stat: await stat(sourcePath).catch(() => undefined)
    }))
  );
  const presentSourceMtimes = sourceStats
    .map((entry) => entry.stat?.mtimeMs)
    .filter((mtimeMs): mtimeMs is number => typeof mtimeMs === "number");
  const missingSources = sourceStats
    .filter((entry) => !entry.stat)
    .map((entry) => entry.name);
  const staleSources = png
    ? sourceStats
      .filter((entry) => entry.stat && entry.stat.mtimeMs > png.mtimeMs)
      .map((entry) => entry.name)
    : sourceStats.map((entry) => entry.name);
  return {
    ok: Boolean(png) && missingSources.length === 0 && staleSources.length === 0,
    contact_sheet: pngFilename,
    contact_sheet_missing: !png,
    source_count: sourcePaths.length,
    png_mtime_ms: png?.mtimeMs ?? null,
    newest_source_mtime_ms: presentSourceMtimes.length ? Math.max(...presentSourceMtimes) : null,
    stale_sources: staleSources,
    missing_sources: missingSources
  };
}
