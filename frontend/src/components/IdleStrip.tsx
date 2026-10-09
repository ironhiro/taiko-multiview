export const IDLE_STRIP_TITLE = '방송 없음';

/**
 * One cabinet with nothing on air. Given `onOpen`, pressing it opens the cabinet's newest
 * finished broadcast in 다시보기 - still in neutral colours, since it is neither on air, nor
 * chosen, nor the venue's identity, but with a base to press like every other control.
 */
export function IdleChip({ cabinet, onOpen }: { cabinet: string; onOpen?: () => void }) {
  if (!onOpen) {
    return (
      <li className="idle-chip" title={cabinet}>
        {cabinet}
      </li>
    );
  }

  return (
    <li className="idle-chip-slot">
      <button
        type="button"
        className="idle-chip idle-chip--replay"
        title={`${cabinet} 지난 방송 보기`}
        aria-label={`${cabinet} 지난 방송 보기`}
        onClick={onOpen}
      >
        <ReplayIcon />
        <span className="idle-chip__name">{cabinet}</span>
      </button>
    </li>
  );
}

/** A circling arrow: "again". */
function ReplayIcon() {
  return (
    <svg className="idle-chip__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3.2 6.2A5 5 0 1 1 3 9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M2 2.5v4.2h4.2z" fill="currentColor" />
    </svg>
  );
}

export interface IdleCabinet {
  id: string;
  label: string;
}

/**
 * The cabinets with nothing on air, as one thin strip at the end of the wall (design.md,
 * "Cabinets with no broadcast"). A tile the size of a playing one used to stand in for
 * each, a whole row of dashed boxes saying "준비중…". Neutral colours only: an empty
 * cabinet is neither on air, nor chosen, nor the venue's identity.
 *
 * With `onOpenReplay`, each chip opens its cabinet's last broadcast in 다시보기.
 */
export function IdleStrip({
  cabinets,
  title = IDLE_STRIP_TITLE,
  onOpenReplay,
}: {
  cabinets: IdleCabinet[];
  title?: string;
  onOpenReplay?: (cabinetId: string) => void;
}) {
  if (cabinets.length === 0) {
    return null;
  }

  return (
    <section className="idle-strip" aria-label={`${title} ${cabinets.length}대`}>
      <span className="idle-strip__title">{title}</span>
      <ul className="idle-strip__chips">
        {cabinets.map((cabinet, index) => (
          // Labels are not promised unique, so the position is part of the key.
          <IdleChip
            key={`${index}:${cabinet.id}`}
            cabinet={cabinet.label}
            onOpen={onOpenReplay ? () => onOpenReplay(cabinet.id) : undefined}
          />
        ))}
      </ul>
    </section>
  );
}
