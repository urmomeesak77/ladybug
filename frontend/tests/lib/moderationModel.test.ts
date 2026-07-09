import { describe, expect, it } from 'vitest';

import { ModerationModel } from '../../src/lib/moderationModel';
import type { ModerationMeta, RawModerationRow } from '../../src/lib/moderationModel';

const rawRow: RawModerationRow = {
  hash: 'Ab3-_9xQ12',
  thumbnail: 'http://localhost/storage/x.jpg',
  title: 'A funny meme',
  type: 'image',
  username: 'alice',
  created_at: '2026-07-08 20:14:02',
  activated_at: '2026-07-09 08:01:10',
  deleted_at: null,
  url: '/posts/Ab3-_9xQ12',
};

const meta: ModerationMeta = { current_page: 2, last_page: 4, per_page: 100, total: 331 };

describe('ModerationModel.mapRow', () => {
  it('maps the raw row into a render-ready row, camelCasing the timestamp keys', () => {
    const row = ModerationModel.mapRow(rawRow);

    expect(row).toEqual({
      hash: 'Ab3-_9xQ12',
      thumbnail: 'http://localhost/storage/x.jpg',
      title: 'A funny meme',
      type: 'image',
      username: 'alice',
      createdAt: '2026-07-08 20:14:02',
      activatedAt: '2026-07-09 08:01:10',
      deletedAt: null,
      url: '/posts/Ab3-_9xQ12',
    });
  });

  it('carries a null thumbnail and a null username through unchanged', () => {
    const row = ModerationModel.mapRow({ ...rawRow, thumbnail: null, username: null });

    expect(row.thumbnail).toBeNull();
    expect(row.username).toBeNull();
  });
});

describe('ModerationModel.pageLinks', () => {
  it('lists every page number from 1 to last_page', () => {
    expect(ModerationModel.pageLinks(meta)).toEqual([1, 2, 3, 4]);
  });

  it('is a single page when last_page is 1', () => {
    expect(ModerationModel.pageLinks({ ...meta, last_page: 1 })).toEqual([1]);
  });
});

describe('ModerationModel.parsePage', () => {
  it('defaults an absent, non-numeric, or below-1 value to page 1', () => {
    expect(ModerationModel.parsePage(null)).toBe(1);
    expect(ModerationModel.parsePage('abc')).toBe(1);
    expect(ModerationModel.parsePage('0')).toBe(1);
    expect(ModerationModel.parsePage('-3')).toBe(1);
  });

  it('parses a valid page number', () => {
    expect(ModerationModel.parsePage('5')).toBe(5);
  });
});
