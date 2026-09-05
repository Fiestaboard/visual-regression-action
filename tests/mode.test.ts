import { describe, it, expect } from 'vitest';
import { resolveMode } from '../src/mode';

describe('resolveMode', () => {
  it('honors explicit modes regardless of event', () => {
    expect(resolveMode('baseline', 'pull_request', 'refs/pull/1/merge', 'main')).toBe('baseline');
    expect(resolveMode('compare', 'push', 'refs/heads/main', 'main')).toBe('compare');
  });

  it('auto: pull_request events compare', () => {
    expect(resolveMode('auto', 'pull_request', 'refs/pull/1/merge', 'main')).toBe('compare');
    expect(resolveMode('auto', 'pull_request_target', 'refs/heads/main', 'main')).toBe('compare');
  });

  it('auto: push to default branch is baseline', () => {
    expect(resolveMode('auto', 'push', 'refs/heads/main', 'main')).toBe('baseline');
  });

  it('auto: push to non-default branch throws', () => {
    expect(() => resolveMode('auto', 'push', 'refs/heads/feature', 'main')).toThrow(/explicit/i);
  });

  it('auto: other events throw', () => {
    expect(() => resolveMode('auto', 'workflow_dispatch', 'refs/heads/main', 'main')).toThrow(/explicit/i);
  });

  it('invalid mode input throws', () => {
    expect(() => resolveMode('bogus', 'push', 'refs/heads/main', 'main')).toThrow(/mode/i);
  });
});
