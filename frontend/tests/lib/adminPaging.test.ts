import { describe, expect, it } from 'vitest';

import type { PageMeta } from '../../src/lib/adminPaging';
import { AdminPaging } from '../../src/lib/adminPaging';

// Build a paginator meta block; only last_page/current_page drive the link math.
function meta(currentPage: number, lastPage: number): PageMeta {
  return { current_page: currentPage, last_page: lastPage, per_page: 100, total: lastPage * 100 };
}

describe('AdminPaging.parsePage', () => {
  it('falls back to page 1 when the query value is absent', () => {
    expect(AdminPaging.parsePage(null)).toBe(1);
  });

  it('falls back to page 1 for a non-numeric value', () => {
    expect(AdminPaging.parsePage('abc')).toBe(1);
  });

  it('falls back to page 1 for zero', () => {
    expect(AdminPaging.parsePage('0')).toBe(1);
  });

  it('falls back to page 1 for a negative value', () => {
    expect(AdminPaging.parsePage('-3')).toBe(1);
  });

  it('falls back to page 1 for a fractional value', () => {
    expect(AdminPaging.parsePage('2.5')).toBe(1);
  });

  it('returns a valid page number unchanged', () => {
    expect(AdminPaging.parsePage('7')).toBe(7);
  });
});

describe('AdminPaging.window', () => {
  it('lists the single page when there is only one', () => {
    expect(AdminPaging.window(meta(1, 1))).toEqual([1]);
  });

  it('lists every page in full when the count is small (no gaps)', () => {
    expect(AdminPaging.window(meta(1, 4))).toEqual([1, 2, 3, 4]);
    expect(AdminPaging.window(meta(3, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it('shows a single hidden page as that page, never an ellipsis', () => {
    // current=4 shows {3,4,5}; with first=1 that leaves only page 2 between 1 and 3 — a
    // one-page gap renders as "2", not "…".
    expect(AdminPaging.window(meta(4, 6))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('collapses a leading run of hidden pages to one ellipsis', () => {
    expect(AdminPaging.window(meta(1, 10))).toEqual([1, 2, 'ellipsis', 10]);
  });

  it('collapses a trailing run of hidden pages to one ellipsis', () => {
    expect(AdminPaging.window(meta(3, 10))).toEqual([1, 2, 3, 4, 'ellipsis', 10]);
  });

  it('windows around a middle page with a gap on each side', () => {
    expect(AdminPaging.window(meta(6, 10))).toEqual([1, 'ellipsis', 5, 6, 7, 'ellipsis', 10]);
  });

  it('clamps an out-of-range current page into the window', () => {
    // A hand-edited ?page beyond the last: the last page is the effective current one.
    expect(AdminPaging.window(meta(99, 10))).toEqual([1, 'ellipsis', 9, 10]);
  });
});
