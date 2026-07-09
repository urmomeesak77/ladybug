import { describe, expect, it } from 'vitest';

import { ModerationModel } from '../../src/lib/moderationModel';
import type { ModerationMeta, RawModerationRow } from '../../src/lib/moderationModel';

const rawRow: RawModerationRow = {
  hash: 'Ab3-_9xQ12',
  thumbnail: 'http://localhost/storage/x.jpg',
  type: 'image',
  username: 'alice',
  created_at: '2026-07-08T20:14:02.000000Z',
  activated: true,
  deleted: false,
  url: '/posts/Ab3-_9xQ12',
};

const meta: ModerationMeta = { current_page: 2, last_page: 4, per_page: 100, total: 331 };

describe('ModerationModel.mapRow', () => {
  it('maps the raw row into a render-ready row, renaming created_at', () => {
    const row = ModerationModel.mapRow(rawRow);

    expect(row).toEqual({
      hash: 'Ab3-_9xQ12',
      thumbnail: 'http://localhost/storage/x.jpg',
      type: 'image',
      username: 'alice',
      createdAt: '2026-07-08T20:14:02.000000Z',
      activated: true,
      deleted: false,
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

describe('ModerationModel state labels', () => {
  it('labels activation by state', () => {
    expect(ModerationModel.activationLabel(true)).toBe('Activated');
    expect(ModerationModel.activationLabel(false)).toBe('Not activated');
  });

  it('labels deletion by state', () => {
    expect(ModerationModel.deletionLabel(true)).toBe('Deleted');
    expect(ModerationModel.deletionLabel(false)).toBe('Not deleted');
  });
});
