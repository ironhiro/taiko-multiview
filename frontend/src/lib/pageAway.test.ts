import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageAway, RELEASE_AFTER_MS } from './pageAway';

function fakeDocument() {
  const handlers = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: 'visibilitychange', handler: () => void) => handlers.add(handler),
    removeEventListener: (_: 'visibilitychange', handler: () => void) => handlers.delete(handler),
    show(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      handlers.forEach((handler) => handler());
    },
    handlers,
  };
  return doc;
}

describe('createPageAway', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is away at once when hidden, and gone after three minutes', () => {
    const doc = fakeDocument();
    const away = createPageAway(doc);
    away.subscribe(() => {});

    doc.show('hidden');
    expect(away.current()).toBe('away');
    vi.advanceTimersByTime(RELEASE_AFTER_MS - 1);
    expect(away.current()).toBe('away');
    vi.advanceTimersByTime(1);
    expect(away.current()).toBe('gone');

    doc.show('visible');
    expect(away.current()).toBe('here');
  });

  it('starts the count again after a return', () => {
    const doc = fakeDocument();
    const away = createPageAway(doc);
    away.subscribe(() => {});

    doc.show('hidden');
    vi.advanceTimersByTime(RELEASE_AFTER_MS - 1000);
    doc.show('visible');
    doc.show('hidden');
    vi.advanceTimersByTime(RELEASE_AFTER_MS - 1000);
    expect(away.current()).toBe('away');
  });

  it('does not restart the count on a repeated hidden', () => {
    const doc = fakeDocument();
    const away = createPageAway(doc);
    away.subscribe(() => {});

    doc.show('hidden');
    vi.advanceTimersByTime(RELEASE_AFTER_MS - 1000);
    doc.show('hidden');
    vi.advanceTimersByTime(1000);
    expect(away.current()).toBe('gone');
  });

  it('listens to the page only while subscribed', () => {
    const doc = fakeDocument();
    const away = createPageAway(doc);
    const stop = away.subscribe(() => {});
    expect(doc.handlers.size).toBe(1);
    stop();
    expect(doc.handlers.size).toBe(0);
  });
});
