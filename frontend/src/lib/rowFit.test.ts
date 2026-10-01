import { describe, expect, it } from 'vitest';
import {
  chooseRowFit,
  LOOSEN_SLACK_PX,
  oncePerFrame,
  ROW_FITS,
  watchFontLoads,
  type FontFaceLike,
  type FontFaceSetLike,
  type RowFit,
  type RowFitState,
} from './rowFit';

/** A row that holds from `loosest` on, tighter fits included. */
const holdsFrom = (loosest: RowFit) => (fit: RowFit) => ROW_FITS.indexOf(fit) >= ROW_FITS.indexOf(loosest);
const fresh: RowFitState = { fit: null, tightenedAt: null };

describe('chooseRowFit', () => {
  it('gives way in order: words, icons, no count, tight, snug', () => {
    expect(ROW_FITS).toEqual(['words', 'icons', 'no-count', 'tight', 'snug']);
  });

  it('takes the loosest fit that holds, trying from the loosest', () => {
    const tried: RowFit[] = [];
    const result = chooseRowFit((fit) => (tried.push(fit), holdsFrom('no-count')(fit)), fresh, 300);
    expect(result.fit).toBe('no-count');
    expect(tried).toEqual(['words', 'icons', 'no-count']);
  });

  it('keeps the tightest when nothing holds: as little as the row can show', () => {
    expect(chooseRowFit(() => false, fresh, 180).fit).toBe('snug');
  });

  it('remembers where it had to tighten, and loosens only once clear of it', () => {
    const atWords: RowFitState = { fit: 'words', tightenedAt: null };
    const tightened = chooseRowFit(holdsFrom('icons'), atWords, 340);
    expect(tightened).toEqual({ fit: 'icons', tightenedAt: 340 });

    // The words would fit again at 341px, but a pixel is a resize's rounding, not room.
    expect(chooseRowFit(holdsFrom('words'), tightened, 340 + LOOSEN_SLACK_PX - 1)).toEqual(tightened);
    expect(chooseRowFit(holdsFrom('words'), tightened, 340 + LOOSEN_SLACK_PX)).toEqual({
      fit: 'words',
      tightenedAt: null,
    });
  });

  it('tightens at once, slack or not, when the current fit stops holding', () => {
    const tightened: RowFitState = { fit: 'icons', tightenedAt: 340 };
    expect(chooseRowFit(holdsFrom('tight'), tightened, 338)).toEqual({ fit: 'tight', tightenedAt: 338 });
  });

  it('measures new content from scratch, with no slack to clear', () => {
    expect(chooseRowFit(holdsFrom('words'), fresh, 200)).toEqual({ fit: 'words', tightenedAt: null });
  });
});

/** A face whose load the test settles by hand. */
function face(status: string) {
  let settle!: (ok: boolean) => void;
  const loaded = new Promise<void>((resolve, reject) => {
    settle = (ok) => (ok ? resolve() : reject(new Error('font failed')));
  });
  loaded.catch(() => {});
  const result: FontFaceLike & { settle: (ok: boolean) => void } = { status, loaded, settle };
  return result;
}

/** A FontFaceSet that never fires its events, as headless WebKit's did not. */
function silentSet(faces: FontFaceLike[]): FontFaceSetLike & { listeners: Map<string, () => void> } {
  const listeners = new Map<string, () => void>();
  return {
    [Symbol.iterator]: () => faces[Symbol.iterator](),
    addEventListener: (type, listener) => listeners.set(type, listener),
    listeners,
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('watchFontLoads', () => {
  it('hears each face that finishes loading, with no event from the set', async () => {
    const early = face('loaded');
    const late = face('loading');
    const later = face('unloaded');
    let heard = 0;
    watchFontLoads(silentSet([early, late, later]), () => (heard += 1));

    await settled();
    expect(heard).toBe(0);
    late.settle(true);
    await settled();
    expect(heard).toBe(1);
    later.settle(true);
    await settled();
    expect(heard).toBe(2);
  });

  it('ignores a face that fails, and hooks each face once however often it looks', async () => {
    const broken = face('loading');
    const late = face('loading');
    const faces: FontFaceLike[] = [broken, late];
    let heard = 0;
    const rescan = watchFontLoads(silentSet(faces), () => (heard += 1));
    rescan();
    rescan();

    broken.settle(false);
    late.settle(true);
    await settled();
    expect(heard).toBe(1);
  });

  it('picks up a face added later on a rescan, or when the set says it is loading', async () => {
    const faces: FontFaceLike[] = [];
    const set = silentSet(faces);
    let heard = 0;
    const rescan = watchFontLoads(set, () => (heard += 1));

    const added = face('loading');
    faces.push(added);
    rescan();
    added.settle(true);
    await settled();
    expect(heard).toBe(1);

    const another = face('loading');
    faces.push(another);
    set.listeners.get('loading')!();
    another.settle(true);
    await settled();
    expect(heard).toBe(2);
  });

  it('also measures when the set says it is ready or done', async () => {
    let ready!: () => void;
    const set = { ...silentSet([]), ready: new Promise<void>((resolve) => (ready = resolve)) };
    let heard = 0;
    watchFontLoads(set, () => (heard += 1));
    ready();
    await settled();
    expect(heard).toBe(1);
    set.listeners.get('loadingdone')!();
    expect(heard).toBe(2);
  });
});

describe('oncePerFrame', () => {
  it('runs once for every burst of calls in a frame, and again in the next', () => {
    const frames: (() => void)[] = [];
    let runs = 0;
    const soon = oncePerFrame(
      () => (runs += 1),
      (run) => frames.push(run),
    );

    soon();
    soon();
    soon();
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(runs).toBe(1);

    soon();
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(runs).toBe(2);
  });
});
