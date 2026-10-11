import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  JUMP_GAP_PX,
  jumpDirection,
  placeJump,
  viewBand,
  type JumpDirection,
  type ScreenBox,
} from '../lib/selectedTile';
import { useCoveredTop } from '../lib/stickyCover';

/**
 * What the button must never cover: the marquee, the credit strip, and each tile's label
 * and buttons. The pictures it may cover - on a phone the shield keeps YouTube's controls
 * out of reach there anyway.
 */
const KEEP_CLEAR_SELECTOR = '.marquee, .credit, .stage__error, .tile__header, .tile__controls';

/** Before the button has been drawn once: about the size of a long label's. */
const SIZE_GUESS = { width: 200, height: 40 };

interface Placed {
  direction: JumpDirection;
  top: number;
  left: number;
}

/**
 * The way back to the selected tile, while it is scrolled out of view: a button laid over
 * the wall - never in the marquee, so the marquee keeps the height the playing slots are
 * judged by (lib/stickyCover.ts). It sits at the bottom of the wall, where a thumb is,
 * and steps up off any tile bar or strip it would cover (lib/selectedTile.ts placeJump).
 * It shows only while less than half the tile is in view.
 */
export function SelectedTileJump({ gridRef, label }: { gridRef: RefObject<HTMLElement | null>; label: string }) {
  const coveredTop = useCoveredTop(true);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const safeAreaRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<() => void>(() => {});

  // Measured on every scroll frame: the selected tile's box, and - only while the button
  // shows - the boxes it has to keep clear of. Scrolling does not dirty layout, so these
  // reads cost no layout. An IntersectionObserver would miss a tile carried from above
  // the screen to below it in one step, and could not say which way it went.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const tile = selectedTileIn(grid);
      if (!tile) {
        setPlaced(null);
        return;
      }
      // The wall's scrolling box: the whole wall on a phone, the scrolling area on a tablet.
      const scroller = grid.parentElement?.getBoundingClientRect() ?? null;
      const band = viewBand(
        coveredTop,
        {
          width: document.documentElement.clientWidth,
          height: window.innerHeight,
          safeBottom: safeAreaRef.current?.offsetHeight ?? 0,
        },
        scroller,
      );
      const direction = jumpDirection(tile.getBoundingClientRect(), band);
      if (!direction) {
        setPlaced(null);
        return;
      }

      const button = buttonRef.current;
      const size = button ? { width: button.offsetWidth, height: button.offsetHeight } : SIZE_GUESS;
      const obstacles = [...document.querySelectorAll<HTMLElement>(KEEP_CLEAR_SELECTOR)]
        .map((element): ScreenBox => element.getBoundingClientRect())
        .filter((box) => box.bottom > band.top && box.top < band.bottom && box.right > box.left);
      const place = placeJump(band, size, obstacles);
      setPlaced((current) =>
        place === null
          ? null
          : current?.direction === direction && current.top === place.top && current.left === place.left
            ? current
            : { direction, ...place },
      );
    };
    const soon = () => {
      frame ||= window.requestAnimationFrame(measure);
    };
    measureRef.current = measure;

    measure();
    // Capturing, so the scroll of the wall's own box (a tablet's) is heard as well as the page's.
    window.addEventListener('scroll', soon, { capture: true, passive: true });
    window.addEventListener('resize', soon);
    // Tiles come and go, and the tile carrying the selection changes, without a scroll.
    const resizes = new ResizeObserver(soon);
    resizes.observe(grid);
    const mutations = new MutationObserver(soon);
    mutations.observe(grid, { subtree: true, attributeFilter: ['aria-current'], childList: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', soon, { capture: true });
      window.removeEventListener('resize', soon);
      resizes.disconnect();
      mutations.disconnect();
    };
  }, [gridRef, coveredTop]);

  // Placed first on a guess at its size; placed again at its real size before it is seen.
  const isShown = placed !== null;
  useLayoutEffect(() => {
    if (isShown) {
      measureRef.current();
    }
  }, [isShown, label]);

  const jump = () => {
    const tile = gridRef.current && selectedTileIn(gridRef.current);
    if (!tile) {
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Lands the tile just under the marquee, whichever box scrolls.
    tile.style.scrollMarginTop = `${coveredTop + JUMP_GAP_PX}px`;
    tile.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <>
      <span ref={safeAreaRef} className="selected-jump-safe-area" aria-hidden="true" />
      {placed && (
        <button
          ref={buttonRef}
          type="button"
          className="selected-jump"
          style={{ top: placed.top, left: placed.left }}
          onClick={jump}
          aria-label={`선택한 영상(${label})으로 이동`}
        >
          <span className="selected-jump__label">{label}</span>
          <span className="selected-jump__text">선택한 영상</span>
          <span className="selected-jump__arrow" aria-hidden="true">
            {placed.direction === 'up' ? '↑' : '↓'}
          </span>
        </button>
      )}
    </>
  );
}

function selectedTileIn(grid: HTMLElement): HTMLElement | null {
  return grid.querySelector<HTMLElement>('.tile[aria-current="true"]');
}
