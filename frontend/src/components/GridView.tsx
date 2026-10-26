import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IdleMessage } from '../lib/venue';
import { splitWall } from '../lib/idleCabinets';
import { arrangeTiles, tilesOnWall } from '../lib/wallArrangement';
import type { WallTile } from '../lib/wallTiles';
import { IdleStrip } from './IdleStrip';
import { gridColumns } from './LayoutPicker';
import { PlayerTile } from './PlayerTile';
import { HiddenTile, type TileEditControls } from './WallEdit';

/** Arranging the wall (design.md, "Arranging the wall"): what the tiles' edit rows and a drag do. */
export interface WallEditing {
  /** Puts `tileId` just before or after `targetId` in the venue's order. */
  onMove: (tileId: string, targetId: string, side: 'before' | 'after') => void;
  onSetHidden: (tileId: string, hidden: boolean) => void;
}

interface GridViewProps {
  /** The cabinets in the venue's own order, and what each has on air (lib/wallTiles.ts). */
  tiles: WallTile[];
  /** The viewer's order for the venue (lib/wallArrangement.ts); empty for the venue's own. */
  order?: readonly string[];
  /** The cabinets the viewer has hidden: no tile and no player, unless the wall is being arranged. */
  hidden?: ReadonlySet<string>;
  /** Given while the wall is being arranged: every cabinet shows, hidden ones dimmed. */
  editing?: WallEditing;
  /** Starts arranging the wall, from the line that counts the hidden cabinets. */
  onEdit?: () => void;
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
  /** Opens a cabinet with nothing on air in 다시보기, at its newest finished broadcast. */
  onOpenReplay?: (cabinetId: string) => void;
}

const NO_ORDER: readonly string[] = [];
const NONE_HIDDEN: ReadonlySet<string> = new Set();

/**
 * The multiview: the cabinets on air as equal tiles, N to a row and N rows to a screen,
 * each as large as the screen allows at 16:9 with its label row beneath. More than N×N
 * scroll. The cabinets with nothing on air follow as one "방송 없음" strip, the grid's
 * last row, spanning every column (lib/idleCabinets.ts).
 *
 * The viewer's order puts each tile in its place with the grid's `order`, while the page
 * keeps the tiles in the venue's own order: React moving a tile in the page would move its
 * player's frame, and a frame moved in the page loads afresh - every step of a drag would
 * build the players it passed again. A hidden cabinet has no tile at all, until the wall is
 * being arranged.
 */
export function GridView({
  tiles,
  order = NO_ORDER,
  hidden = NONE_HIDDEN,
  editing,
  onEdit,
  audioTileId,
  onRequestAudio,
  gridSize,
  lazy,
  onOpenChat,
  chatTileId,
  idle,
  onOpenReplay,
}: GridViewProps) {
  const arranged = useMemo(() => arrangeTiles(tiles, order), [tiles, order]);
  const { shown, hiddenCount: hiddenHere } = tilesOnWall(arranged, hidden, Boolean(editing));
  const wall = splitWall(shown, Boolean(idle.loading));
  const placeOf = new Map(wall.tiles.map((tile, index) => [tile.id, index]));
  const hasStrip = wall.idle.length > 0 || hiddenHere > 0;
  // The tiles decide the columns. When the strip is the whole wall it takes the chosen
  // layout's width rather than one tile's; with nothing at all (no venues yet) it stays one.
  const columns = wall.tiles.length === 0 && hasStrip ? gridSize : gridColumns(gridSize, wall.tiles.length);

  const { gridRef, dragId, dragHandlers } = useDragToArrange(editing, wall.tiles);
  // Outside the arranging only the columns relay the wall, as before; within it, a new order too.
  const layout = editing ? `${columns}|${wall.tiles.map((tile) => tile.id).join(' ')}` : String(columns);
  useGlideOnRelayout(gridRef, layout, dragId !== null);

  const controlsOf = (tile: WallTile, index: number): TileEditControls | undefined => {
    if (!editing) {
      return undefined;
    }
    const before = wall.tiles[index - 1];
    const after = wall.tiles[index + 1];
    const isHidden = hidden.has(tile.id);
    return {
      hidden: isHidden,
      onEarlier: before ? () => editing.onMove(tile.id, before.id, 'before') : undefined,
      onLater: after ? () => editing.onMove(tile.id, after.id, 'after') : undefined,
      onToggleHidden: () => editing.onSetHidden(tile.id, !isHidden),
    };
  };

  const classes = ['grid-view'];
  if (hasStrip) {
    classes.push('grid-view--idle-strip');
  }
  if (editing) {
    classes.push('grid-view--editing');
  }
  if (dragId !== null) {
    classes.push('grid-view--dragging');
  }

  return (
    <div
      ref={gridRef}
      className={classes.join(' ')}
      style={{ '--grid-columns': columns } as React.CSSProperties}
      {...dragHandlers}
    >
      {/* In the venue's order, each placed by the viewer's (see above). */}
      {tiles.map((tile) => {
        const place = placeOf.get(tile.id);
        if (place === undefined) {
          return null;
        }
        const controls = controlsOf(tile, place);
        if (controls?.hidden) {
          return (
            <HiddenTile
              key={tile.id}
              tileId={tile.id}
              order={place}
              label={tile.label}
              unregistered={tile.unregistered}
              stream={tile.stream}
              controls={controls}
              dragging={dragId === tile.id}
            />
          );
        }
        return (
          <PlayerTile
            key={tile.id}
            tileId={tile.id}
            order={place}
            edit={controls}
            dragging={dragId === tile.id}
            label={tile.label}
            unregistered={tile.unregistered}
            stream={tile.stream}
            isAudioActive={audioTileId === tile.id}
            onRequestAudio={() => onRequestAudio(tile.id)}
            lazy={lazy}
            pausesWhenAway={lazy}
            opensChatInTab={lazy}
            chatSidebar={
              onOpenChat && tile.stream
                ? { isOpen: tile.id === chatTileId, onOpen: openChatOf(tile.id, tile.stream.videoId, onOpenChat) }
                : undefined
            }
            idle={idle}
          />
        );
      })}
      <IdleStrip
        cabinets={wall.idle.map((tile) => ({ id: tile.id, label: tile.label }))}
        onOpenReplay={onOpenReplay}
        hidden={!editing && onEdit ? { count: hiddenHere, onEdit } : undefined}
        editing={
          editing && {
            isHidden: (cabinetId) => hidden.has(cabinetId),
            onToggleHidden: (cabinetId) => editing.onSetHidden(cabinetId, !hidden.has(cabinetId)),
          }
        }
        order={wall.tiles.length}
      />
    </div>
  );
}

function openChatOf(tileId: string, videoId: string, onOpenChat: (tileId: string, videoId: string) => void) {
  return () => onOpenChat(tileId, videoId);
}

/**
 * A mouse or a pen drags a tile to its new place while the wall is arranged; the tiles make
 * room as it passes over them. A finger does not: on a phone a thumb on a tile scrolls the
 * page as anywhere, and the tile's row has 앞으로 and 뒤로 instead.
 *
 * The grid holds the pointer for the whole drag, so a player's frame under it - covered by
 * the tile's shield anyway - never gets to swallow a move or the release.
 */
function useDragToArrange(editing: WallEditing | undefined, placed: readonly WallTile[]) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const drag = useRef<{ id: string; pointerId: number; lastOver: string | null } | null>(null);
  // Read by the handlers between renders: a move can land before the tiles are drawn again.
  const placedIds = useRef<string[]>([]);
  placedIds.current = placed.map((tile) => tile.id);

  const end = () => {
    drag.current = null;
    setDragId(null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    const target = event.target as Element;
    if (!editing || !grid || event.pointerType === 'touch' || event.button !== 0 || target.closest('button, a')) {
      return;
    }
    const tile = target.closest<HTMLElement>('.tile[data-tile-id]');
    const id = tile?.dataset.tileId;
    if (!tile || !id || tile.parentElement !== grid) {
      return;
    }
    event.preventDefault();
    grid.setPointerCapture(event.pointerId);
    drag.current = { id, pointerId: event.pointerId, lastOver: id };
    setDragId(id);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const grid = gridRef.current;
    if (!current || !grid || !editing || event.pointerId !== current.pointerId) {
      return;
    }
    const over = tileAt(grid, event.clientX, event.clientY);
    // Once per tile entered: the tile it traded places with is no longer under the pointer,
    // and waiting for the pointer to leave keeps two tiles from swapping back and forth.
    if (!over || over === current.lastOver) {
      return;
    }
    current.lastOver = over;
    const from = placedIds.current.indexOf(current.id);
    const to = placedIds.current.indexOf(over);
    if (over === current.id || from < 0 || to < 0) {
      return;
    }
    const side = to < from ? 'before' : 'after';
    editing.onMove(current.id, over, side);
    // Where things stand until the next render, so the next move counts from here.
    const next = placedIds.current.filter((each) => each !== current.id);
    next.splice(next.indexOf(over) + (side === 'after' ? 1 : 0), 0, current.id);
    placedIds.current = next;
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current && event.pointerId === drag.current.pointerId) {
      end();
    }
  };

  // Leaving the arranging mid-drag drops the tile where it is.
  useLayoutEffect(() => {
    if (!editing && drag.current) {
      end();
    }
  }, [editing]);

  return {
    gridRef,
    dragId,
    dragHandlers: editing
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp: onPointerEnd,
          onPointerCancel: onPointerEnd,
          onLostPointerCapture: onPointerEnd,
        }
      : {},
  };
}

/** The tile under a point, by the boxes the grid gives them (no glide runs during a drag). */
function tileAt(grid: HTMLElement, x: number, y: number): string | null {
  for (const tile of tilesOf(grid)) {
    const box = tile.getBoundingClientRect();
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      return tile.dataset.tileId ?? null;
    }
  }
  return null;
}

const GLIDE_MS = 320;
const GLIDE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Tiles glide from where they were to where a new layout or a new order puts them, instead
 * of jumping (FLIP: the old boxes are remembered, and each tile is animated from its old box
 * into its new one with a transform - cheap for the compositor, even over a playing video).
 * Each tile is followed by its key, since the order on screen is not the order in the page.
 * Reduced-motion users get the jump, and so does a drag, whose tiles the pointer is read
 * against.
 */
function useGlideOnRelayout(gridRef: React.RefObject<HTMLDivElement>, layout: string, dragging: boolean) {
  const lastBoxes = useRef(new Map<string, DOMRect>());
  const lastLayout = useRef(layout);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    const tiles = tilesOf(grid);
    const boxes = boxesOf(tiles);
    const relaid = lastLayout.current !== layout;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (relaid && !reduced && !dragging) {
      for (const tile of tiles) {
        const key = tile.dataset.tileId ?? '';
        const from = lastBoxes.current.get(key);
        const to = boxes.get(key);
        if (!from || !to || to.width === 0 || to.height === 0) {
          continue;
        }

        const dx = from.left - to.left;
        const dy = from.top - to.top;
        const sx = from.width / to.width;
        const sy = from.height / to.height;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) {
          continue;
        }

        tile.animate(
          [
            { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transformOrigin: 'top left', transform: 'none' },
          ],
          { duration: GLIDE_MS, easing: GLIDE_EASING },
        );
      }
    }

    lastBoxes.current = boxes;
    lastLayout.current = layout;
  });

  // The remembered boxes go stale when the window is resized or the wall scrolled
  // without a render; refresh them so the next layout change starts from the truth.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    const remember = () => {
      lastBoxes.current = boxesOf(tilesOf(grid));
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
  }, [gridRef]);
}

function boxesOf(tiles: HTMLElement[]): Map<string, DOMRect> {
  return new Map(tiles.map((tile) => [tile.dataset.tileId ?? '', tile.getBoundingClientRect()]));
}

/** The grid's tiles, without the "방송 없음" strip in its last row: only tiles glide. */
function tilesOf(grid: HTMLElement): HTMLElement[] {
  return [...grid.children].filter((child): child is HTMLElement => child.classList.contains('tile'));
}
