import { describe, it, expect } from 'vitest';
import { parseApprovalCommands, applyApprovals, shortHash, isApproveComment, checkboxItems, encodeItemMarker, boxTick, approvalsUnreadableMessage } from '../src/approvals';
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

  it('collects checked approve-all checkboxes only from the bot-authored report comment', () => {
    const bot = { login: 'github-actions[bot]' };
    const human = { login: 'attacker' };
    const a = parseApprovalCommands([
      { body: 'report…\n- [x] <!-- vrt:approve-all@abc1234 --> **Approve all**', author_association: 'NONE', user: bot },
      { body: '- [x] <!-- vrt:approve-all@deadbee --> fake', author_association: 'NONE', user: human },
    ]);
    expect(a.allShas).toEqual(['abc1234']);
  });

  it('collects ticked per-screenshot boxes from the bot comment as commit-pinned entries', () => {
    const bot = { login: 'github-actions[bot]' };
    const body = [
      '- [ ] <!-- vrt:approve-all@abc1234 --> **Approve all 2 changes**',
      '- [x] <!-- vrt:approve@abc1234:home.png --> 🔄 `home.png` — 1.00% changed',
      `- [ ] <!-- vrt:approve@abc1234:${encodeItemMarker('nav/old menu.png')} --> 🗑️ removed`,
    ].join('\n');
    const a = parseApprovalCommands([
      { body, author_association: 'NONE', user: bot },
      { body: '- [x] <!-- vrt:approve@deadbee:old.png -->', author_association: 'OWNER', user: { login: 'someone' } },
    ]);
    expect(a.entries.get('home.png')).toEqual(['abc1234']);
    expect(a.entries.has('nav/old menu.png')).toBe(false); // unticked
    expect(a.entries.has('old.png')).toBe(false); // not the bot's comment
    expect(a.allShas).toEqual([]);
  });

  it('ignores unchecked checkboxes', () => {
    const a = parseApprovalCommands([
      { body: '- [ ] <!-- vrt:approve-all@abc1234 --> **Approve all**', author_association: 'NONE', user: { login: 'github-actions[bot]' } },
    ]);
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

describe('checkboxItems', () => {
  it('lists every per-screenshot box with its tick state, decoding names', () => {
    const body = [
      '- [X] <!-- vrt:approve@abc1234:home.png -->',
      `- [ ] <!-- vrt:approve@abc1234:${encodeItemMarker('a-b c.png')} -->`,
      '- [x] <!-- vrt:approve-all@abc1234 -->',
      '- [x] <!-- vrt:approve@abc1234:%E0%A4%A -->', // malformed encoding is skipped
    ].join('\n');
    expect(checkboxItems(body)).toEqual([
      { name: 'home.png', pin: 'abc1234', checked: true },
      { name: 'a-b c.png', pin: 'abc1234', checked: false },
    ]);
  });
});

describe('boxTick', () => {
  const items = (a: string, b: string) =>
    [`- [${a}] <!-- vrt:approve@abc1234:home.png -->`, `- [${b}] <!-- vrt:approve@abc1234:old.png -->`];
  const all = (x: string) => `- [${x}] <!-- vrt:approve-all@abc1234 --> **Approve all**`;

  it('is "none" when nothing is ticked', () => {
    expect(boxTick([all(' '), ...items(' ', ' ')].join('\n'))).toEqual({ kind: 'none' });
    expect(boxTick('just a comment')).toEqual({ kind: 'none' });
  });

  it('is "partial" while some screenshots are still unticked — no rerun yet', () => {
    expect(boxTick([all(' '), ...items('x', ' ')].join('\n'))).toEqual({ kind: 'partial', ticked: 1, total: 2 });
  });

  it('is "complete" once every screenshot is ticked', () => {
    expect(boxTick([all(' '), ...items('x', 'x')].join('\n'))).toEqual({
      kind: 'complete',
      command: '/vrt approve home.png@abc1234 old.png@abc1234',
    });
  });

  it('is "complete" when Approve all is ticked, however many screenshots are', () => {
    expect(boxTick([all('x'), ...items(' ', ' ')].join('\n'))).toEqual({ kind: 'complete', command: '/vrt approve all@abc1234' });
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

  it('a ticked per-screenshot box approves that screenshot at the current head only', () => {
    const body = '- [x] <!-- vrt:approve@deadbee:home.png -->';
    const a = parseApprovalCommands([{ body, user: { login: 'github-actions[bot]' } }]);
    const s = summary();
    expect(applyApprovals(s, a, 'deadbeefcafe00')).toBe(1);
    expect(s.results[0].approved).toBe(true);
    expect(applyApprovals(summary(), a, '0123456abcdef0')).toBe(0);
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

describe('approvalsUnreadableMessage', () => {
  it('says approvals were not evaluated, not that none were posted', () => {
    const msg = approvalsUnreadableMessage('other side closed', 17);
    expect(msg).toMatch(/^Approvals could not be evaluated/);
    expect(msg).toContain('other side closed');
    expect(msg).toContain('17 changed/removed');
    expect(msg).toContain('boxes are ticked');
    expect(msg).toMatch(/Re-run this job/);
    expect(msg).not.toMatch(/Visual changes detected/);
  });
});
