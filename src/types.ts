export type Status = 'changed' | 'added' | 'removed' | 'unchanged';

export interface ScreenshotResult {
  /** Relative path within the screenshots dir, posix separators. */
  name: string;
  status: Status;
  /** Fraction of pixels differing (0 for added/removed/unchanged). */
  diffRatio: number;
  baselinePng?: Buffer;
  currentPng?: Buffer;
  diffPng?: Buffer;
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
