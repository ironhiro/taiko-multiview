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
  /** Multiplies the minimum tile width, so bigger means fewer per row. */
  scale: number;
  lazy?: boolean;
  idle: IdleMessage;
}

const BASE_TILE_WIDTH = 460;

/**
 * An ordinary multiview: the given cabinets as equal tiles that reflow to fit, with no
 * regard for where they physically sit. This is the only view a venue without a
 * published floor plan offers.
 */
export function GridView({
  stations,
  streamsByStation,
  audioStationId,
  onRequestAudio,
  chatStationId,
  onRequestChat,
  scale,
  lazy,
  idle,
}: GridViewProps) {
  const minWidth = Math.round(BASE_TILE_WIDTH * scale);

  return (
    <div
      className="grid-view"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${minWidth}px, 100%), 1fr))` }}
    >
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
