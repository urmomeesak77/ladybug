// A feed item's hash and its document-absolute top (px from the top of the page).
// Callers must provide items sorted ascending by top.
export type ItemRect = { hash: string; top: number };

export type Anchor = { anchorHash: string; anchorOffset: number };

// Choose the post at the top of the viewport as the scroll anchor: the last item
// whose top is at or above the current scroll position, plus how far that item is
// scrolled past the viewport top. Falls back to the first item when scrolled above
// all of them. Restoring later means: scrollTo(item.currentTop + anchorOffset).
// PRECONDITION: items must be sorted ascending by top; the scan short-circuits on
// the first item above the viewport, so unsorted input yields a silently wrong anchor.
export function pickAnchor(items: ItemRect[], scrollY: number): Anchor | null {
  if (items.length === 0) {
    return null;
  }
  let anchor = items[0];
  for (const item of items) {
    if (item.top <= scrollY) {
      anchor = item;
    } else {
      break;
    }
  }
  return { anchorHash: anchor.hash, anchorOffset: scrollY - anchor.top };
}
