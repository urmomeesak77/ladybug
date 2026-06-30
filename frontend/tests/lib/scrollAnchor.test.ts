import { describe, expect, it } from 'vitest';

import { ScrollAnchor } from '../../src/lib/scrollAnchor';

// Item tops are document-absolute (px from the top of the page).
const items = [
  { hash: 'a', top: 0 },
  { hash: 'b', top: 500 },
  { hash: 'c', top: 1200 },
];

describe('pickAnchor', () => {
  it('returns null for an empty list', () => {
    expect(ScrollAnchor.pickAnchor([], 0)).toBeNull();
  });

  it('anchors to the first item at the top of the page', () => {
    expect(ScrollAnchor.pickAnchor(items, 0)).toEqual({ anchorHash: 'a', anchorOffset: 0 });
  });

  it('anchors to the item straddling the viewport top, with how far it is scrolled past', () => {
    expect(ScrollAnchor.pickAnchor(items, 650)).toEqual({ anchorHash: 'b', anchorOffset: 150 });
  });

  it('treats an exact item top as that item with zero offset', () => {
    expect(ScrollAnchor.pickAnchor(items, 1200)).toEqual({ anchorHash: 'c', anchorOffset: 0 });
  });

  it('anchors to the last item when scrolled beyond it', () => {
    expect(ScrollAnchor.pickAnchor(items, 5000)).toEqual({ anchorHash: 'c', anchorOffset: 3800 });
  });

  it('handles a single-item list at rest and scrolled past it', () => {
    expect(ScrollAnchor.pickAnchor([{ hash: 'solo', top: 0 }], 0)).toEqual({ anchorHash: 'solo', anchorOffset: 0 });
    expect(ScrollAnchor.pickAnchor([{ hash: 'solo', top: 0 }], 800)).toEqual({ anchorHash: 'solo', anchorOffset: 800 });
  });
});

describe('pickRestoreTarget', () => {
  it('targets the saved anchor when the snapshot has one', () => {
    expect(ScrollAnchor.pickRestoreTarget({ anchorHash: 'abc1234567', anchorOffset: 42 })).toEqual({
      kind: 'anchor',
      hash: 'abc1234567',
      offset: 42,
    });
  });

  it('targets the top when there is no snapshot at all', () => {
    expect(ScrollAnchor.pickRestoreTarget(null)).toEqual({ kind: 'top' });
  });

  it('targets the top when the snapshot has no anchor', () => {
    expect(ScrollAnchor.pickRestoreTarget({ anchorHash: null, anchorOffset: 0 })).toEqual({ kind: 'top' });
  });
});
