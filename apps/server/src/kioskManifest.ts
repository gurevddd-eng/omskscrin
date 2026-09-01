import { exhibitGameFromRow, type KioskManifest } from "@stella/shared";
import { toFileDto } from "./routes/files.js";
import { parseSpecs } from "./routes/exhibits.js";
import { getGlobalAdsState } from "./routes/ads.js";
import { getGlobalTimelineState } from "./routes/timeline.js";

export const exhibitMediaInclude = {
  gallery: { orderBy: { sortOrder: "asc" as const }, include: { file: true } },
  heroImage: true,
  video: true,
  audio: true,
};

type MediaFileRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  hash: string;
};

export type ExhibitForManifest = {
  id: string;
  title: string;
  summary: string;
  body: string;
  specs: unknown;
  heroImageId: string | null;
  videoId: string | null;
  audioId: string | null;
  contentVersion: string;
  updatedAt: Date;
  gameTitle: string;
  gameShareFolder: string;
  gameExe: string;
  gallery: { fileId: string; file: MediaFileRow }[];
  heroImage: MediaFileRow | null;
  video: MediaFileRow | null;
  audio: MediaFileRow | null;
};

export async function buildKioskManifest(opts: {
  kioskId: string;
  hostname?: string;
  exhibit: ExhibitForManifest | null;
}): Promise<KioskManifest> {
  const exhibit = opts.exhibit;
  const [globalAds, timeline] = await Promise.all([getGlobalAdsState(), getGlobalTimelineState()]);
  const filesMap = new Map<string, MediaFileRow>();

  if (exhibit?.heroImage) filesMap.set(exhibit.heroImage.id, exhibit.heroImage);
  if (exhibit?.video) filesMap.set(exhibit.video.id, exhibit.video);
  if (exhibit?.audio) filesMap.set(exhibit.audio.id, exhibit.audio);
  for (const g of exhibit?.gallery ?? []) filesMap.set(g.file.id, g.file);
  for (const f of globalAds.files) filesMap.set(f.id, f);
  for (const f of timeline.files) filesMap.set(f.id, f);

  const files = [...filesMap.values()].map((f) => ({
    ...toFileDto(f),
    hash: f.hash,
  }));

  return {
    kioskId: opts.kioskId,
    hostname: opts.hostname,
    exhibit: exhibit
      ? {
          id: exhibit.id,
          title: exhibit.title,
          summary: exhibit.summary,
          body: exhibit.body,
          specs: parseSpecs(exhibit.specs),
          heroImageId: exhibit.heroImageId,
          galleryIds: exhibit.gallery.map((g) => g.fileId),
          videoId: exhibit.videoId,
          audioId: exhibit.audioId,
          contentVersion: exhibit.contentVersion,
          updatedAt: exhibit.updatedAt.toISOString(),
          game: exhibitGameFromRow(exhibit),
        }
      : null,
    adIds: globalAds.adIds,
    adsVersion: globalAds.adsVersion,
    timelinePages: timeline.pages.map((p) => ({
      id: p.id,
      label: p.label,
      sortOrder: p.sortOrder,
      imageIds: p.imageIds,
    })),
    timelineVersion: timeline.timelineVersion,
    blockKeyboard: globalAds.blockKeyboard,
    softwareEnabled: globalAds.softwareEnabled,
    themeMode: globalAds.themeMode,
    themeDarkFrom: globalAds.themeDarkFrom,
    themeDarkTo: globalAds.themeDarkTo,
    theme: globalAds.theme,
    settingsVersion: globalAds.settingsVersion,
    files,
    contentVersion: exhibit?.contentVersion ?? null,
    serverTime: new Date().toISOString(),
  };
}
