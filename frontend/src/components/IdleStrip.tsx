export const IDLE_STRIP_TITLE = '방송 없음';

/** One cabinet with nothing on air: its label, as data, and nothing to press. */
export function IdleChip({ cabinet }: { cabinet: string }) {
  return (
    <li className="idle-chip" title={cabinet}>
      {cabinet}
    </li>
  );
}

/**
 * The cabinets with nothing on air, as one thin strip at the end of the wall (design.md,
 * "Cabinets with no broadcast"). A tile the size of a playing one used to stand in for
 * each, a whole row of dashed boxes saying "준비중…". Neutral colours only: an empty
 * cabinet is neither on air, nor chosen, nor the venue's identity.
 */
export function IdleStrip({ cabinets, title = IDLE_STRIP_TITLE }: { cabinets: string[]; title?: string }) {
  if (cabinets.length === 0) {
    return null;
  }

  return (
    <section className="idle-strip" aria-label={`${title} ${cabinets.length}대`}>
      <span className="idle-strip__title">{title}</span>
      <ul className="idle-strip__chips">
        {cabinets.map((cabinet, index) => (
          // Labels are not promised unique, so the position is part of the key.
          <IdleChip key={`${index}:${cabinet}`} cabinet={cabinet} />
        ))}
      </ul>
    </section>
  );
}
