import { useLayoutEffect, useRef } from 'react';
import type { LiveStream, Station } from '../lib/types';
import type { IdleMessage } from '../lib/venue';
import { PlayerTile } from './PlayerTile';

interface GridViewProps {
  stations: Station[];
  streamsByStation: Map<string, LiveStream>;
  audioStationId: string | null;
  onRequestAudio: (stationId: string) => void;
  chatStationId: string | null;
  onRequestChat: (stationId: string) => void;
  /** The chosen N×N layout; fewer columns are used when there are fewer cabinets. */
  gridSize: number;
  lazy?: boolean;
  idle: IdleMessage;
}


/**
 * The multiview: the cabinets as equal tiles, N to a row and N rows to a screen, each
 * as large as the screen allows at 16:9. More cabinets than N×N scroll.
 */
export function GridView({
  stations,
  streamsByStation,
  audioStationId,
  onRequestAudio,
  chatStationId,
  onRequestChat,
  gridSize,
  lazy,
  idle,
}: GridViewProps) {
  // A 3×3 wall with a single cabinet would be one small tile in a corner, so there are
  // never more columns than cabinets. Otherwise the choice stands: 4×4 on nine cabinets
  // means four to a row, even though a row is left short.
  const columns = Math.max(1, Math.min(gridSize, stations.length));
  const gridRef = useGlideOnRelayout(columns);

  return (
    <div ref={gridRef} className="grid-view" style={{ '--grid-columns': columns } as React.CSSProperties}>
      {stations.map((station) => (
        <PlayerTile
          key={station.id}
          label={station.label}
          stream={streamsByStation.get(station.id)}
          isAudioActive={audioStationId === station.id}
          onRequestAudio={() => onRequestAudio(station.id)}
          isChatOpen={chatStationId === station.id}
          onRequestChat={() => onRequestChat(station.id)}
          lazy={lazy}
          idle={idle}
        />
      ))}
    </div>
  );
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

    const tiles = [...grid.children] as HTMLElement[];
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
      lastBoxes.current = [...grid.children].map((tile) => tile.getBoundingClientRect());
    };
    const scroller = grid.parentElement;

    window.addEventListener('resize', remember);
    scroller?.addEventListener('scroll', remember, { passive: true });
    return () => {
      window.removeEventListener('resize', remember);
      scroller?.removeEventListener('scroll', remember);
    };
  }, []);

  return gridRef;
}
