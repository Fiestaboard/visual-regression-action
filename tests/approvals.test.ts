import { describe, it, expect } from 'vitest';
import { parseApprovalCommands, applyApprovals, shortHash, isApproveComment } from '../src/approvals';
import { CompareSummary } from '../src/types';

const OK = 'COLLABORATOR';

function comment(body: string, assoc = OK, created_at = '2026-09-05T12:00:00Z') {
  return { body, author_association: assoc, created_at };
}

describe('shortHash', () => {
  it('is a stable 12-char hex digest of the buffer', () => {
    const h = shortHash(Buffer.from('hello'));
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(shortHash(Buffer.from('hello'))).toBe(h);
    expect(shortHash(Buffer.from('other'))).not.toBe(h);
  });
});

describe('isApproveComment', () => {
  it('matches only /vrt approve commands', () => {
    expect(isApproveComment('/vrt approve a.png@abc123def456')).toBe(true);
    expect(isApproveComment('  /vrt approve all@1234567')).toBe(true);
    expect(isApproveComment('/vrt reject a.png')).toBe(false);
    expect(isApproveComment('looks good!')).toBe(false);
  });
});

describe('parseApprovalCommands', () => {
  it('collects name@hash entries from authorized commenters', () => {
    const a = parseApprovalCommands([
      comment('/vrt approve home.png@abcdefabcdef nav/menu.png@123456123456'),
      comment('unrelated chatter'),
    ]);
    expect(a.entries.get('home.png')).toEqual(['abcdefabcdef']);
    expect(a.entries.get('nav/menu.png')).toEqual(['123456123456']);
  });

  it('ignores commands from unauthorized associations', () => {
    const a = parseApprovalCommands([
      comment('/vrt approve home.png@abcdefabcdef', 'CONTRIBUTOR'),
      comment('/vrt approve home.png@abcdefabcdef', 'NONE'),
    ]);
    expect(a.entries.size).toBe(0);
  });

  it('accumulates across multiple comments and parses all@sha', () => {
    const a = parseApprovalCommands([
      comment('/vrt approve home.png@aaaaaaaaaaaa'),
      comment('/vrt approve home.png@bbbbbbbbbbbb all@1234567'),
    ]);
    expect(a.entries.get('home.png')).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
    expect(a.allShas).toEqual(['1234567']);
  });

  it('ignores malformed tokens and too-short sha pins', () => {
    const a = parseApprovalCommands([comment('/vrt approve nohash.png all@123 plain garbage@')]);
    expect(a.entries.size).toBe(0);
    expect(a.allShas).toEqual([]);
  });

  it('collects timestamps of bare "all" commands from authorized commenters', () => {
    const a = parseApprovalCommands([
      comment('/vrt approve all', OK, '2026-09-05T12:00:00Z'),
      comment('/vrt approve all', 'NONE', '2026-09-05T13:00:00Z'),
    ]);
    expect(a.allTimestamps).toEqual(['2026-09-05T12:00:00Z']);
  });
});

describe('applyApprovals', () => {
  const cur = Buffer.from('current-pixels');
  const base = Buffer.from('baseline-pixels');

  function summary(): CompareSummary {
    return {
      results: [
        { name: 'home.png', status: 'changed', diffRatio: 0.01, baselinePng: base, currentPng: cur, diffPng: cur },
        { name: 'old.png', status: 'removed', diffRatio: 0, baselinePng: base },
        { name: 'new.png', status: 'added', diffRatio: 0, currentPng: cur },
      ],
      changed: 1, added: 1, removed: 1, unchanged: 0, hasChanges: true,
    };
  }

  it('approves changed screenshots whose current hash matches', () => {
    const s = summary();
    const a = parseApprovalCommands([comment(`/vrt approve home.png@${shortHash(cur)}`)]);
    const n = applyApprovals(s, a, 'deadbeefcafe00');
    expect(n).toBe(1);
    expect(s.results[0].approved).toBe(true);
    expect(s.results[1].approved).toBeUndefined();
  });

  it('approves removed screenshots by baseline hash', () => {
    const s = summary();
    const a = parseApprovalCommands([comment(`/vrt approve old.png@${shortHash(base)}`)]);
    expect(applyApprovals(s, a, 'deadbeefcafe00')).toBe(1);
    expect(s.results[1].approved).toBe(true);
  });

  it('commit-pinned per-file entries approve regardless of capture bytes', () => {
    const s = summary();
    const a = parseApprovalCommands([comment('/vrt approve home.png@deadbee old.png@deadbeefcafe')]);
    expect(applyApprovals(s, a, 'deadbeefcafe00')).toBe(2);
    expect(s.results[0].approved).toBe(true);
    expect(s.results[1].approved).toBe(true);
  });

  it('commit-pinned entries are stale once the head moves', () => {
    const s = summary();
    const a = parseApprovalCommands([comment('/vrt approve home.png@deadbee')]);
    expect(applyApprovals(s, a, '0123456abcdef0')).toBe(0);
  });

  it('stale hashes do not approve', () => {
    const s = summary();
    const a = parseApprovalCommands([comment('/vrt approve home.png@000000000000')]);
    expect(applyApprovals(s, a, 'deadbeefcafe00')).toBe(0);
    expect(s.results[0].approved).toBeUndefined();
  });

  it('all@sha approves every changed/removed screenshot when the head sha matches', () => {
    const s = summary();
    const a = parseApprovalCommands([comment('/vrt approve all@deadbee')]);
    expect(applyApprovals(s, a, 'deadbeefcafe00')).toBe(2);
    expect(s.results[0].approved).toBe(true);
    expect(s.results[1].approved).toBe(true);
    expect(s.results[2].approved).toBeUndefined(); // added never needs approval
  });

  it('all@sha with a non-matching head approves nothing', () => {
    const s = summary();
    const a = parseApprovalCommands([comment('/vrt approve all@1234567')]);
    expect(applyApprovals(s, a, 'deadbeefcafe00')).toBe(0);
  });

  it('bare "all" approves everything when the comment is newer than the head commit', () => {
    const s = summary();
    const a = parseApprovalCommands([comment('/vrt approve all', OK, '2026-09-05T12:00:00Z')]);
    expect(applyApprovals(s, a, 'deadbeefcafe00', '2026-09-05T11:00:00Z')).toBe(2);
    expect(s.results[2].approved).toBeUndefined(); // added still exempt
  });

  it('bare "all" is stale once a newer commit is pushed', () => {
    const s = summary();
    const a = parseApprovalCommands([comment('/vrt approve all', OK, '2026-09-05T12:00:00Z')]);
    expect(applyApprovals(s, a, 'deadbeefcafe00', '2026-09-05T12:30:00Z')).toBe(0);
  });

  it('bare "all" approves nothing when the head commit time is unknown', () => {
    const s = summary();
    const a = parseApprovalCommands([comment('/vrt approve all', OK, '2026-09-05T12:00:00Z')]);
    expect(applyApprovals(s, a, 'deadbeefcafe00')).toBe(0);
  });
});
