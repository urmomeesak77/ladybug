import { afterEach, describe, expect, it, vi } from 'vitest';

import { Theme } from '../../src/lib/theme';

// Minimal controllable stand-in for a MediaQueryList so the theme helpers can be exercised
// in the node test environment (no jsdom). `fire` simulates the OS scheme changing.
class MockMediaQueryList {
  matches: boolean;
  private listeners = new Set<(event: MediaQueryListEvent) => void>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.delete(listener);
  }

  fire(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
  }
}

function stubMatchMedia(mql: MockMediaQueryList): void {
  vi.stubGlobal('window', { matchMedia: () => mql });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prefersDark', () => {
  it('is true when the dark scheme query matches', () => {
    stubMatchMedia(new MockMediaQueryList(true));

    expect(Theme.prefersDark()).toBe(true);
  });

  it('is false when the dark scheme query does not match', () => {
    stubMatchMedia(new MockMediaQueryList(false));

    expect(Theme.prefersDark()).toBe(false);
  });
});

describe('watchScheme', () => {
  it('invokes the callback with the new scheme on each change', () => {
    const mql = new MockMediaQueryList(false);
    stubMatchMedia(mql);
    const seen: boolean[] = [];

    Theme.watchScheme((isDark) => seen.push(isDark));
    mql.fire(true);
    mql.fire(false);

    expect(seen).toEqual([true, false]);
  });

  it('stops notifying after the returned unsubscribe is called', () => {
    const mql = new MockMediaQueryList(false);
    stubMatchMedia(mql);
    const seen: boolean[] = [];

    const stop = Theme.watchScheme((isDark) => seen.push(isDark));
    mql.fire(true);
    stop();
    mql.fire(false);

    expect(seen).toEqual([true]);
  });
});
