import { useLayoutEffect, type RefObject } from 'react';

/**
 * How a tile's row gives way when it runs out of room (design.md, "Tile labels"), in
 * order: the buttons with their words; icons only, square; the viewer count goes as well;
 * the icons lose their square; the row's spacing closes up. The label shrinks with an
 * ellipsis all along, never below three letters and the ellipsis ("THE…"). The tag never
 * goes.
 *
 * Decided per tile, by what that row holds: "A1 · 10명 · 음소거 · 채팅" keeps its words on a
 * tile where a tagged "THE BASE 2 · 12,345명" has to drop them. A width rule in the
 * stylesheet could only answer for the longest row on the wall.
 */
export const ROW_FITS = ['words', 'icons', 'no-count', 'tight', 'snug'] as const;
export type RowFit = (typeof ROW_FITS)[number];

/**
 * How much wider a row must have grown since it last had to tighten before it loosens
 * again. A row exactly at a step's edge would otherwise flip with every subpixel of a
 * resize.
 */
export const LOOSEN_SLACK_PX = 4;

export interface RowFitState {
  fit: RowFit | null;
  /** The row's width when it last had to tighten; null when it has not since its content changed. */
  tightenedAt: number | null;
}

/** What chooseRowFit leaves a row in: always a fit, since the tightest is kept when nothing holds. */
export type ChosenRowFit = RowFitState & { fit: RowFit };

/**
 * The loosest fit the row takes, trying each from the loosest: `fits` lays the row out as
 * that fit and says whether it holds. A fit looser than the current one is skipped until
 * the row is LOOSEN_SLACK_PX wider than where it last tightened. When nothing holds the
 * tightest is kept, which is as little as the row can show.
 */
export function chooseRowFit(fits: (fit: RowFit) => boolean, state: RowFitState, width: number): ChosenRowFit {
  const currentIndex = state.fit === null ? -1 : ROW_FITS.indexOf(state.fit);
  let chosen: RowFit = ROW_FITS[ROW_FITS.length - 1];

  for (const [index, fit] of ROW_FITS.entries()) {
    const looser = index < currentIndex;
    if (looser && state.tightenedAt !== null && width < state.tightenedAt + LOOSEN_SLACK_PX) {
      continue;
    }
    if (fits(fit)) {
      chosen = fit;
      break;
    }
  }

  const chosenIndex = ROW_FITS.indexOf(chosen);
  if (currentIndex !== -1 && chosenIndex > currentIndex) {
    return { fit: chosen, tightenedAt: width };
  }
  return { fit: chosen, tightenedAt: chosenIndex < currentIndex ? null : state.tightenedAt };
}

/**
 * Whether the row, laid out as `fit`, holds: nothing spills out of it or out of its label
 * part, and a cut label keeps its least width. Reads layout sizes only - a tile gliding to
 * a new layout is transformed, which they ignore.
 */
export function rowHoldsAs(row: HTMLElement, fit: RowFit): boolean {
  row.dataset.fit = fit;
  const header = row.querySelector<HTMLElement>('.tile__header');
  const label = row.querySelector<HTMLElement>('.tile__label');
  if (!header || !label) {
    return true;
  }
  if (row.scrollWidth > row.clientWidth || header.scrollWidth > header.clientWidth) {
    return false;
  }
  const isCut = label.scrollWidth > label.clientWidth;
  return !isCut || label.offsetWidth >= leastLabelWidth(label);
}

const LEAST_LABEL = 'THE…';
const leastWidths = new Map<string, number>();

/**
 * Three letters and an ellipsis in the label's own type - or the whole label, if shorter.
 * Measured once per font and cached; the cache is dropped when web fonts finish loading.
 */
function leastLabelWidth(label: HTMLElement): number {
  const style = getComputedStyle(label);
  const key = [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing].join('|');
  let least = leastWidths.get(key);
  if (least === undefined) {
    const probe = document.createElement('span');
    probe.textContent = LEAST_LABEL;
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      whiteSpace: 'nowrap',
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
    });
    document.body.appendChild(probe);
    least = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    leastWidths.set(key, least);
  }
  return Math.min(least, label.scrollWidth);
}

// One observer for every row on the wall. It fires when a row's own size changes - a new
// layout, a resized window - and not on a scroll or a glide, which move rows without
// resizing them.
interface RowMeasures {
  /** The row was resized to `width`. */
  resized: (width: number) => void;
  /** Something other than the row's size changed what fits in it. */
  refresh: () => void;
}

const rows = new Map<Element, RowMeasures>();
let observer: ResizeObserver | null = null;

function rowObserver(): ResizeObserver {
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        rows.get(entry.target)?.resized(entry.contentRect.width);
      }
    });
    // Web fonts change every width in a row without changing the row's: measure again as
    // each face arrives, at most once a frame.
    const refreshAll = () => {
      leastWidths.clear();
      for (const measures of rows.values()) {
        measures.refresh();
      }
    };
    if (document.fonts) {
      const refreshSoon = oncePerFrame(refreshAll, (callback) => window.requestAnimationFrame(callback));
      const rescan = watchFontLoads(document.fonts, refreshSoon);
      // Once more a while after the page has loaded, in case a face was added after the
      // last look and nothing reported it. Once, not on a timer.
      const lastLook = () =>
        window.setTimeout(() => {
          rescan();
          refreshSoon();
        }, LAST_FONT_LOOK_MS);
      if (document.readyState === 'complete') {
        lastLook();
      } else {
        window.addEventListener('load', lastLook, { once: true });
      }
    }
  }
  return observer;
}

/** How long after the page's load event the rows measure once more for late fonts. */
export const LAST_FONT_LOOK_MS = 3_000;

/** The parts of a FontFace and a FontFaceSet that watchFontLoads reads. */
export interface FontFaceLike {
  status: string;
  loaded: Promise<unknown>;
}

export interface FontFaceSetLike extends Iterable<FontFaceLike> {
  ready?: Promise<unknown>;
  addEventListener?: (type: string, listener: () => void) => void;
}

/**
 * Calls `onLoaded` whenever a font face finishes loading, by its own `loaded` promise.
 * The set's events are not enough: headless WebKit never fired `loadingdone`, and
 * `ready` resolved before the late Pretendard subsets arrived, so a row measured with the
 * fallback font stayed that way unless something resized it. Each face is hooked once;
 * faces added later are picked up whenever the set reports loading, and by the returned
 * rescan.
 */
export function watchFontLoads(fonts: FontFaceSetLike, onLoaded: () => void): () => void {
  const hooked = new WeakSet<FontFaceLike>();
  const rescan = () => {
    for (const face of fonts) {
      if (face.status === 'loaded' || face.status === 'error' || hooked.has(face)) {
        continue;
      }
      hooked.add(face);
      face.loaded.then(onLoaded, () => {});
    }
  };
  rescan();
  fonts.ready?.then(onLoaded, () => {});
  fonts.addEventListener?.('loading', rescan);
  fonts.addEventListener?.('loadingdone', () => {
    rescan();
    onLoaded();
  });
  return rescan;
}

/**
 * `callback` at most once per frame, however often the result is called: several faces
 * arriving together make one measuring pass.
 */
export function oncePerFrame(callback: () => void, schedule: (run: () => void) => unknown): () => void {
  let pending = false;
  return () => {
    if (pending) {
      return;
    }
    pending = true;
    schedule(() => {
      pending = false;
      callback();
    });
  };
}

/**
 * Keeps the row's `data-fit` (ROW_FITS) right for its width and content. Measured when the
 * content changes (`contentKey`), when the row is resized, and when fonts load - never per
 * frame. Setting `data-fit` does not resize the row, so the observer is not set off again.
 */
export function useRowFit(rowRef: RefObject<HTMLElement>, contentKey: string) {
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }

    let state: RowFitState = { fit: null, tightenedAt: null };
    let measuredWidth = -1;
    const measure = (width: number) => {
      measuredWidth = width;
      const chosen = chooseRowFit((fit) => rowHoldsAs(row, fit), state, width);
      state = chosen;
      row.dataset.fit = chosen.fit;
    };

    measure(row.clientWidth);
    rows.set(row, {
      // The observer reports every row once when it starts watching it, at the width just
      // measured: that report, and any other that does not change the width, is skipped.
      resized: (width) => {
        if (Math.abs(width - measuredWidth) >= 0.5) {
          measure(width);
        }
      },
      refresh: () => measure(row.clientWidth),
    });
    const resizes = rowObserver();
    resizes.observe(row);
    return () => {
      resizes.unobserve(row);
      rows.delete(row);
    };
  }, [rowRef, contentKey]);
}
