import { tileRect, toPercentStyle } from '../lib/layout';
import type { Layout, LiveStream, Station, Zone } from '../lib/types';
import type { IdleMessage } from '../lib/venue';
import { PlayerTile } from './PlayerTile';

interface FloorPlanViewProps {
  layout: Layout;
  zones: Zone[];
  stations: Station[];
  streamsByStation: Map<string, LiveStream>;
  audioStationId: string | null;
  onRequestAudio: (stationId: string) => void;
  /** 1 fits the whole venue on screen; above that the view scrolls. */
  scale: number;
  lazy?: boolean;
  idle: IdleMessage;
}

/**
 * The 통합 (배치도) view: every cabinet drawn where it physically sits, on the canvas
 * the venue's own map uses. Only rendered for venues that publish coordinates.
 */
export function FloorPlanView({
  layout,
  zones,
  stations,
  streamsByStation,
  audioStationId,
  onRequestAudio,
  scale,
  lazy,
  idle,
}: FloorPlanViewProps) {
  const labelFor = (stationId: string) =>
    stations.find((station) => station.id === stationId)?.label ?? stationId;

  const codeFor = (zoneId: string) => zones.find((zone) => zone.id === zoneId)?.code ?? zoneId;

  return (
    <div className="floorplan-scroll">
      <div
        className="floorplan"
        style={{
          aspectRatio: `${layout.canvas.width} / ${layout.canvas.height}`,
          height: `${scale * 100}%`,
        }}
      >
        {layout.zones.map((zone) => (
          <div key={zone.id} className="floorplan__zone" style={toPercentStyle(layout, zone.outline)}>
            <span className="floorplan__zone-code">{codeFor(zone.id)}</span>
          </div>
        ))}

        {layout.decorations.map((decoration) => (
          <div
            key={decoration.label}
            className="floorplan__zone floorplan__zone--muted"
            style={toPercentStyle(layout, decoration.outline)}
          >
            <span className="floorplan__zone-code">{decoration.label}</span>
            {decoration.note && <span className="floorplan__zone-note">{decoration.note}</span>}
          </div>
        ))}

        {layout.units.map((unit) => (
          <div
            key={unit.stationId}
            className="floorplan__slot"
            style={toPercentStyle(layout, tileRect(layout, unit))}
          >
            <PlayerTile
              compact
              label={labelFor(unit.stationId)}
              stream={streamsByStation.get(unit.stationId)}
              isAudioActive={audioStationId === unit.stationId}
              onRequestAudio={() => onRequestAudio(unit.stationId)}
              lazy={lazy}
              idle={idle}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
