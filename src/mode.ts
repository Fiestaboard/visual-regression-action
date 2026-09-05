export function resolveMode(
  modeInput: string,
  eventName: string,
  ref: string,
  defaultBranch: string
): 'baseline' | 'compare' {
  if (modeInput === 'baseline' || modeInput === 'compare') return modeInput;
  if (modeInput !== 'auto') {
    throw new Error(`Invalid mode "${modeInput}". Use "auto", "baseline", or "compare".`);
  }
  if (eventName === 'pull_request' || eventName === 'pull_request_target') return 'compare';
  if (eventName === 'push' && ref === `refs/heads/${defaultBranch}`) return 'baseline';
  throw new Error(
    `Cannot auto-detect mode for event "${eventName}" on ref "${ref}". ` +
      `Set an explicit mode: "baseline" or "compare".`
  );
}
