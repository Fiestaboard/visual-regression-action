// The contract between the action and the report UI (report-ui/). The action
// serializes one ReportData as JSON into the prebuilt template's
// <script type="application/json" id="vrt-data"> tag; the React app reads it
// back on load. Keep this file free of Node imports — the UI bundles it too.

export type ReportStatus = 'changed' | 'added' | 'removed' | 'unchanged';

export interface ReportItem {
  name: string;
  status: ReportStatus;
  /** Fraction of differing pixels (0 unless changed). */
  diffRatio: number;
  /** Already accepted by a /vrt approve comment or a ticked PR checkbox. */
  approved: boolean;
  /** PNG data URIs — present per status: changed has all four, added only current, removed only baseline. */
  baseline?: string;
  current?: string;
  diff?: string;
  /** Transparent PNG of only the changed pixels (overlay view). */
  mask?: string;
}

export interface ReportData {
  version: 1;
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
  /** Sorted changed → added → removed → unchanged, then by name. */
  items: ReportItem[];
}

export const REPORT_DATA_PLACEHOLDER = '__VRT_DATA__';
