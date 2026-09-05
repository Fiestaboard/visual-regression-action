export function resolveMode(
  modeInput: string,
  eventName: string,
  ref: string,
  defaultBranch: string
): 'baseline' | 'compare' | 'approve' {
  if (modeInput === 'baseline' || modeInput === 'compare' || modeInput === 'approve') return modeInput;
  if (modeInput !== 'auto') {
    throw new Error(`Invalid mode "${modeInput}". Use "auto", "baseline", "compare", or "approve".`);
  }
  if (eventName === 'pull_request' || eventName === 'pull_request_target') return 'compare';
  if (eventName === 'push' && ref === `refs/heads/${defaultBranch}`) return 'baseline';
  if (eventName === 'issue_comment') return 'approve';
  throw new Error(
    `Cannot auto-detect mode for event "${eventName}" on ref "${ref}". ` +
      `Set an explicit mode: "baseline", "compare", or "approve".`
  );
}
