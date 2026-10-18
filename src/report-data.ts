// The contract between the action and the report UI (report-ui/). Keep this
// file free of Node imports — the UI bundles it too.
//
// The report streams. The action fills the prebuilt template in two places:
//
//   1. <script type="application/json" id="vrt-data"> holds one ReportData:
//      names, stats, image sizes — no pixels, so it stays small and the
//      reviewer can draw the whole list as soon as it arrives.
//   2. After the app's script, one element per image, in review order:
//        <i hidden id="vrt-img-N" data-png="BASE64"></i>
//      An attribute is complete by the time its element enters the DOM, so the
//      UI can take each image the moment it is parsed while the rest of the
//      file is still downloading.
//
// Diff and overlay images are not shipped at all: the UI computes them from
// baseline and current, in a worker, with the same threshold the action used.

export type ReportStatus = 'changed' | 'added' | 'removed' | 'unchanged';

/** One embedded PNG: the id of its element, and its size so layout never jumps while it loads. */
export interface ImageRef {
  id: string;
  width: number;
  height: number;
}

/**
 * A changed screenshot whose change is local ships only a band of rows from
 * baseline and current (the same rows from both), not the whole page.
 */
export interface Crop {
  /** First row of the band in the full screenshot. */
  top: number;
  /** Rows in the band; equal to the shipped images' height. */
  height: number;
  /** Height of the full screenshot. */
  fullHeight: number;
}

export interface ReportItem {
  name: string;
  status: ReportStatus;
  /** Fraction of differing pixels (0 unless changed). */
  diffRatio: number;
  /** Already accepted by a /vrt approve comment or a ticked PR checkbox. */
  approved: boolean;
  /** Present per status: changed has both, added only current, removed only baseline. */
  baseline?: ImageRef;
  current?: ImageRef;
  /** Changed only, when just a band of the page is shipped. */
  crop?: Crop;
}

export interface ReportData {
  version: 2;
  repo: string;
  runUrl: string;
  /** Full head commit sha. */
  sha: string;
  /** 7-char commit pin used by /vrt approve name@pin entries. */
  pin: string;
  baselineRunUrl?: string;
  missingBaseline: boolean;
  /** PR to post approval commands on (absent outside pull requests). */
  prUrl?: string;
  /** pixelmatch threshold the action compared with — the UI's diff uses the same. */
  threshold: number;
  /** Sorted changed → added → removed → unchanged, then by name. */
  items: ReportItem[];
}

export const REPORT_DATA_PLACEHOLDER = '__VRT_DATA__';
/** An HTML comment in the template, so an unfilled template still renders cleanly. */
export const REPORT_IMAGES_PLACEHOLDER = '<!--__VRT_IMAGES__-->';
export const IMAGE_ID_PREFIX = 'vrt-img-';
