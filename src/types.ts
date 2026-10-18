export type Status = 'changed' | 'added' | 'removed' | 'unchanged';

export interface ScreenshotResult {
  /** Relative path within the screenshots dir, posix separators. */
  name: string;
  status: Status;
  /** Fraction of pixels differing (0 for added/removed/unchanged). */
  diffRatio: number;
  baselinePng?: Buffer;
  currentPng?: Buffer;
  /**
   * Changed only, when the change is local: the band of rows the report shows
   * instead of the whole page, cut from baseline and current alike. The full
   * PNGs above are still what approvals hash.
   */
  crop?: { top: number; height: number; baselinePng: Buffer; currentPng: Buffer };
  /** True when a `/vrt approve` PR comment pinned this exact content. */
  approved?: boolean;
}

export interface CompareSummary {
  results: ScreenshotResult[];
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
  /** True iff changed + removed > 0. Added screenshots never count. */
  hasChanges: boolean;
}
