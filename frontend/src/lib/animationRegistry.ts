import { AnimatedImage } from './animatedImage';
import type { ProbeResult } from './animatedImage';

// What a post remembers about where it was: a few numbers, kept for every animated post on
// the page and never capped, because this is what makes a released post resume rather than
// restart (FR-018/FR-019).
export type FramePosition = {
  frameIndex: number;
  loopsDone: number;
  isFinished: boolean;
};

// The expensive half — a live decoder — capped at MAX_SESSIONS. Same shape as the probe
// result it is built from; aliased rather than restated so the two cannot drift apart.
export type PlaybackSession = ProbeResult;

// FR-017: at most twelve live decoders at any scroll depth.
const MAX_SESSIONS = 12;

// Module-level so playback survives a component unmounting and remounting (a Back
// navigation into a cached feed), which is the whole point of a registry (research R9).
const positions = new Map<string, FramePosition>();
const sessions = new Map<string, PlaybackSession | Promise<PlaybackSession | null>>();
const pinned = new Set<string>();

export class AnimationRegistry {
  // Live-or-create the session for this URL. Concurrent callers share the one in-flight
  // promise, so a burst of scroll events cannot start two decoders for one post.
  static acquire(url: string): Promise<PlaybackSession | null> {
    const existing = sessions.get(url);
    if (existing) {
      AnimationRegistry.touch(url, existing);
      return Promise.resolve(existing);
    }
    const pending = AnimationRegistry.open(url);
    sessions.set(url, pending);
    AnimationRegistry.evict(url);
    return pending;
  }

  // Acquisition fires across a band three viewports tall, which can hold more than twelve
  // candidates — so recency alone would evict a post that is still on screen and playing.
  // A running player pins its URL, and eviction skips pinned sessions (research R9).
  static pin(url: string): void {
    pinned.add(url);
  }

  static unpin(url: string): void {
    pinned.delete(url);
  }

  // The currently-held session, or null when it was never acquired or has been evicted.
  // Never creates one — an evicted post keeps showing its frozen frame regardless.
  static peek(url: string): PlaybackSession | null {
    const entry = sessions.get(url);
    if (!entry || !('decoder' in entry)) {
      return null;
    }
    return entry;
  }

  // Hands a drawn frame back. Whether it may be closed is the decoder's trait, not the
  // caller's (see AnimatedImage.framesAreShared), and the registry is the only place that
  // knows which session a URL is on. An evicted session's decoder is closed already, so a
  // frame outliving it is ours to release.
  static release(url: string, frame: VideoFrame): void {
    if (AnimationRegistry.peek(url)?.framesAreShared) {
      return;
    }
    frame.close();
  }

  static position(url: string): FramePosition {
    return positions.get(url) ?? { frameIndex: 0, loopsDone: 0, isFinished: false };
  }

  static savePosition(url: string, position: FramePosition): void {
    positions.set(url, position);
  }

  // Test-only: nothing in the app clears the registry, since none of it outlives the page.
  static reset(): void {
    for (const entry of sessions.values()) {
      if ('decoder' in entry) {
        entry.decoder.close();
      }
    }
    sessions.clear();
    positions.clear();
    pinned.clear();
  }

  private static async open(url: string): Promise<PlaybackSession | null> {
    const probed = await AnimatedImage.probe(url);
    if (!probed) {
      sessions.delete(url);
      return null;
    }
    if (!sessions.has(url)) {
      // Evicted while the decode was in flight: nothing holds it now, so release it here
      // rather than leaking a decoder no map points at.
      probed.decoder.close();
      return probed;
    }
    // Replaces the pending promise in place, which keeps the LRU order acquire() gave it.
    sessions.set(url, probed);
    return probed;
  }

  // Map iterates in insertion order, so "touch" is delete + re-set and the least recently
  // used key is simply the first one.
  private static touch(url: string, entry: PlaybackSession | Promise<PlaybackSession | null>): void {
    sessions.delete(url);
    sessions.set(url, entry);
  }

  // `exemptUrl` is the acquisition that triggered this pass: it is the newest entry and not
  // yet pinned, so an unguarded search would pick it the moment every other session is
  // pinned — throwing away the decode we just paid for instead of the oldest one.
  private static evict(exemptUrl: string): void {
    while (sessions.size > MAX_SESSIONS) {
      const victim = AnimationRegistry.evictionTarget(exemptUrl);
      if (!victim) {
        return;
      }
      const entry = sessions.get(victim);
      sessions.delete(victim);
      if (entry && 'decoder' in entry) {
        entry.decoder.close();
      }
    }
  }

  private static evictionTarget(exemptUrl: string): string {
    let leastRecent = '';
    for (const key of sessions.keys()) {
      if (key === exemptUrl) {
        continue;
      }
      if (!pinned.has(key)) {
        return key;
      }
      if (!leastRecent) {
        leastRecent = key;
      }
    }
    // Every other session is pinned (it takes twelve posts passing the visibility test at
    // once): the cap wins anyway, and that player's next decode re-acquires under
    // AnimationPlayer guarantee 5.
    return leastRecent;
  }
}
