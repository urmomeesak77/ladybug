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

describe('AdminPaging.pageLinks', () => {
  it('lists the single page when there is only one', () => {
    expect(AdminPaging.pageLinks(meta(1, 1))).toEqual([1]);
  });

  it('lists every page from the first page', () => {
    expect(AdminPaging.pageLinks(meta(1, 4))).toEqual([1, 2, 3, 4]);
  });

  it('lists every page from a middle page', () => {
    expect(AdminPaging.pageLinks(meta(3, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it('lists every page from the last page', () => {
    expect(AdminPaging.pageLinks(meta(5, 5))).toEqual([1, 2, 3, 4, 5]);
  });
});
