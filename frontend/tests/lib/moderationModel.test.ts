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

describe('ModerationModel.dateOnly', () => {
  it('cuts a raw MySQL datetime down to its date part', () => {
    expect(ModerationModel.dateOnly('2026-07-08 20:14:02')).toBe('2026-07-08');
  });

  it('passes null through for a timestamp that was never set', () => {
    expect(ModerationModel.dateOnly(null)).toBeNull();
  });
});

describe('ModerationModel.shortTitle', () => {
  it('passes a short title through unchanged', () => {
    expect(ModerationModel.shortTitle('A funny meme')).toBe('A funny meme');
  });

  it('passes a title of exactly 20 characters through unchanged', () => {
    expect(ModerationModel.shortTitle('12345678901234567890')).toBe('12345678901234567890');
  });

  it('cuts a longer title to 20 characters plus an ellipsis', () => {
    expect(ModerationModel.shortTitle('Chewbacca Screams in terror')).toBe('Chewbacca Screams in…');
  });

  it('trims a trailing space left behind by the cut', () => {
    expect(ModerationModel.shortTitle('Damn you High5 damn you again')).toBe('Damn you High5 damn…');
  });

  it('passes null through for a meme without a title', () => {
    expect(ModerationModel.shortTitle(null)).toBeNull();
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

describe('ModerationModel.deleteConfirmMessage', () => {
  it('explains both outcomes, naming the post by its title', () => {
    expect(ModerationModel.deleteConfirmMessage('A funny meme')).toBe(
      'Soft delete hides the post "A funny meme" from the site — you can restore it later. '
        + 'Permanent delete removes the post and its files forever.',
    );
  });

  it('falls back to "this post" when the title is missing', () => {
    expect(ModerationModel.deleteConfirmMessage(null)).toBe(
      'Soft delete hides this post from the site — you can restore it later. '
        + 'Permanent delete removes the post and its files forever.',
    );
  });
});

describe('ModerationModel.purgeConfirmMessage', () => {
  it('states the post is already hidden and the removal is forever, naming it by title', () => {
    expect(ModerationModel.purgeConfirmMessage('A funny meme')).toBe(
      'The post "A funny meme" is already hidden from the site. '
        + 'Permanent delete removes it and its files forever.',
    );
  });

  it('falls back to "This post" when the title is missing', () => {
    expect(ModerationModel.purgeConfirmMessage(null)).toBe(
      'This post is already hidden from the site. Permanent delete removes it and its files forever.',
    );
  });
});
