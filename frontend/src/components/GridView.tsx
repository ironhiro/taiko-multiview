import { useLayoutEffect, useRef } from 'react';
import type { IdleMessage } from '../lib/venue';
import { splitWall } from '../lib/idleCabinets';
import type { WallTile } from '../lib/wallTiles';
import { IdleStrip } from './IdleStrip';
import { gridColumns } from './LayoutPicker';
import { PlayerTile } from './PlayerTile';

interface GridViewProps {
  /** The cabinets in order, and what each has on air (lib/wallTiles.ts). */
  tiles: WallTile[];
  /** The id of the tile holding the sound. */
  audioTileId: string | null;
  onRequestAudio: (tileId: string) => void;
  /** The chosen N×N layout; fewer columns are used when fewer cabinets are on air. */
  gridSize: number;
  lazy?: boolean;
  /**
   * Opens a broadcast's chat in the sidebar beside the wall; left out where the chat opens
   * elsewhere (lib/chatSidebar.ts, chatPlacement).
   */
  onOpenChat?: (tileId: string, videoId: string) => void;
  /** The tile whose chat the sidebar shows, if any. */
  chatTileId?: string | null;
  idle: IdleMessage;
}


/**
 * The multiview: the cabinets on air as equal tiles, N to a row and N rows to a screen,
 * each as large as the screen allows at 16:9 with its label row beneath. More than N×N
 * scroll. The cabinets with nothing on air follow as one "방송 없음" strip, the grid's
 * last row, spanning every column (lib/idleCabinets.ts).
 */
export function GridView({
  tiles,
  audioTileId,
  onRequestAudio,
  gridSize,
  lazy,
  onOpenChat,
  chatTileId,
  idle,
}: GridViewProps) {
  const wall = splitWall(tiles, Boolean(idle.loading));
  const hasStrip = wall.idle.length > 0;
  // The tiles decide the columns. When the strip is the whole wall it takes the chosen
  // layout's width rather than one tile's; with nothing at all (no venues yet) it stays one.
  const columns = wall.tiles.length === 0 && hasStrip ? gridSize : gridColumns(gridSize, wall.tiles.length);
  const gridRef = useGlideOnRelayout(columns);

  return (
    <div
      ref={gridRef}
      className={hasStrip ? 'grid-view grid-view--idle-strip' : 'grid-view'}
      style={{ '--grid-columns': columns } as React.CSSProperties}
    >
      {wall.tiles.map((tile) => (
        <PlayerTile
          key={tile.id}
          label={tile.label}
          unregistered={tile.unregistered}
          stream={tile.stream}
          isAudioActive={audioTileId === tile.id}
          onRequestAudio={() => onRequestAudio(tile.id)}
          lazy={lazy}
          shielded={lazy}
          pausesWhenAway={lazy}
          opensChatInTab={lazy}
          chatSidebar={
            onOpenChat && tile.stream
              ? { isOpen: tile.id === chatTileId, onOpen: openChatOf(tile.id, tile.stream.videoId, onOpenChat) }
              : undefined
          }
          idle={idle}
        />
      ))}
      <IdleStrip cabinets={wall.idle.map((tile) => tile.label)} />
    </div>
  );
}

function openChatOf(tileId: string, videoId: string, onOpenChat: (tileId: string, videoId: string) => void) {
  return () => onOpenChat(tileId, videoId);
}

const GLIDE_MS = 320;
const GLIDE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Tiles glide from where they were to where a new layout puts them, instead of jumping
 * (FLIP: the old boxes are remembered, and each tile is animated from its old box into
 * its new one with a transform - cheap for the compositor, even over a playing video).
 * Reduced-motion users get the jump.
 */
function useGlideOnRelayout(columns: number) {
  const gridRef = useRef<HTMLDivElement>(null);
  const lastBoxes = useRef<DOMRect[]>([]);
  const lastColumns = useRef(columns);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    const tiles = tilesOf(grid);
    const boxes = tiles.map((tile) => tile.getBoundingClientRect());
    const relaid = lastColumns.current !== columns;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (relaid && !reduced) {
      tiles.forEach((tile, index) => {
        const from = lastBoxes.current[index];
        const to = boxes[index];
        if (!from || !to || to.width === 0 || to.height === 0) {
          return;
        }

        const dx = from.left - to.left;
        const dy = from.top - to.top;
        const sx = from.width / to.width;
        const sy = from.height / to.height;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) {
          return;
        }

        tile.animate(
          [
            { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transformOrigin: 'top left', transform: 'none' },
          ],
          { duration: GLIDE_MS, easing: GLIDE_EASING },
        );
      });
    }

    lastBoxes.current = boxes;
    lastColumns.current = columns;
  });

  // The remembered boxes go stale when the window is resized or the wall scrolled
  // without a render; refresh them so the next layout change starts from the truth.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    const remember = () => {
      lastBoxes.current = tilesOf(grid).map((tile) => tile.getBoundingClientRect());
    };
    // The wall scrolls on a desktop; on a phone the whole page does.
    const scroller = grid.parentElement;

    window.addEventListener('resize', remember);
    window.addEventListener('scroll', remember, { passive: true });
    scroller?.addEventListener('scroll', remember, { passive: true });
    return () => {
      window.removeEventListener('resize', remember);
      window.removeEventListener('scroll', remember);
      scroller?.removeEventListener('scroll', remember);
    };
  }, []);

  return gridRef;
}

/** The grid's tiles, without the "방송 없음" strip in its last row: only tiles glide. */
function tilesOf(grid: HTMLElement): HTMLElement[] {
  return [...grid.children].filter((child): child is HTMLElement => child.classList.contains('tile'));
}
