import type { Layout, LayoutUnit, Rect } from './types';

/**
 * Floor plan geometry helpers.
 *
 * The coordinates themselves now come from the server, so adding a venue is a
 * configuration change. A venue that publishes no map has `layout: null` and is
 * rendered as a plain grid instead.
 *
 * A venue draws cabinets as squares; here each square is widened into a 16:9 video
 * tile centred on the same spot, which is what makes the map watchable.
 */

export function tileRect(layout: Layout, unit: LayoutUnit): Rect {
  const width = layout.tileWidth;
  const height = (width * 9) / 16;

  const centreX = unit.x + layout.unitSize / 2;
  const centreY = unit.y + layout.unitSize / 2;

  return {
    x: centreX - width / 2,
    y: centreY - height / 2,
    width,
    height,
  };
}

/** Converts canvas coordinates into percentages so the map scales with its container. */
export function toPercentStyle(layout: Layout, rect: Rect): React.CSSProperties {
  return {
    left: `${(rect.x / layout.canvas.width) * 100}%`,
    top: `${(rect.y / layout.canvas.height) * 100}%`,
    width: `${(rect.width / layout.canvas.width) * 100}%`,
    height: `${(rect.height / layout.canvas.height) * 100}%`,
  };
}
