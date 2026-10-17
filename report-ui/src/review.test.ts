import { describe, expect, it } from 'vitest';
import type { ReportItem } from '../../src/report-data';
import { coverage, sortItems, verdict } from './review';

const item = (name: string, status: ReportItem['status'], extra: Partial<ReportItem> = {}): ReportItem => ({
  name,
  status,
  diffRatio: 0,
  approved: false,
  ...extra,
});

const items: ReportItem[] = [
  item('home.png', 'changed', { diffRatio: 0.01 }),
  item('cart.png', 'changed', { diffRatio: 0.2 }),
  item('new.png', 'added'),
  item('old.png', 'removed'),
  item('same.png', 'unchanged'),
];

describe('verdict', () => {
  it('only gives changed and removed screenshots a verdict, and PR approvals win', () => {
    expect(verdict(item('a.png', 'added'), { 'a.png': true })).toBeNull();
    expect(verdict(item('a.png', 'changed', { approved: true }), { 'a.png': false })).toBe(true);
    expect(verdict(item('a.png', 'removed'), { 'a.png': false })).toBe(false);
    expect(verdict(item('a.png', 'changed'), {})).toBeNull();
  });
});

describe('coverage', () => {
  it('is idle before any verdict and nothing when no screenshot needs review', () => {
    expect(coverage(items, {}, 'abc1234').state).toBe('idle');
    expect(coverage([item('x.png', 'added')], {}, 'abc1234').state).toBe('nothing');
  });

  it('builds a pinned command from local approvals and reports partial coverage', () => {
    const c = coverage(items, { 'home.png': true }, 'abc1234');
    expect(c.state).toBe('partial');
    expect(c.command).toBe('/vrt approve home.png@abc1234');
    expect(c.unreviewed).toBe(2);
  });

  it('is complete when every changed/removed screenshot is approved', () => {
    const c = coverage(items, { 'home.png': true, 'cart.png': true, 'old.png': true }, 'abc1234');
    expect(c.state).toBe('complete');
    expect(c.command).toBe('/vrt approve home.png@abc1234 cart.png@abc1234 old.png@abc1234');
  });

  it('counts PR approvals as covered but leaves them out of the command', () => {
    const withPr = items.map((i) => (i.name === 'cart.png' ? { ...i, approved: true } : i));
    const c = coverage(withPr, { 'home.png': true, 'old.png': true }, 'abc1234');
    expect(c.state).toBe('complete');
    expect(c.approvedOnPr).toBe(1);
    expect(c.command).toBe('/vrt approve home.png@abc1234 old.png@abc1234');
  });

  it('separates rejections, and keeps whitespace names out of the command', () => {
    expect(coverage(items, { 'home.png': false }, 'abc1234').state).toBe('rejected-only');
    const c = coverage([item('a b.png', 'changed'), item('c.png', 'removed')], { 'a b.png': true, 'c.png': false }, 'abc1234');
    expect(c.state).toBe('with-rejections');
    expect(c.command).toBe('');
    expect(c.unpinnable).toEqual(['a b.png']);
  });
});

describe('sortItems', () => {
  it('orders by status then name, or by largest diff', () => {
    expect(sortItems(items, 'review').map((i) => i.name)).toEqual(['cart.png', 'home.png', 'new.png', 'old.png', 'same.png']);
    expect(sortItems(items, 'ratio')[0].name).toBe('cart.png');
  });
});
