import { EyeIcon } from './WallEdit';

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

/** While the wall is arranged, each chip hides or shows its cabinet instead (design.md). */
export interface IdleStripEditing {
  isHidden: (cabinetId: string) => boolean;
  onToggleHidden: (cabinetId: string) => void;
}

/**
 * The cabinets with nothing on air, as one thin strip at the end of the wall (design.md,
 * "Cabinets with no broadcast"). A tile the size of a playing one used to stand in for
 * each, a whole row of dashed boxes saying "준비중…". Neutral colours only: an empty
 * cabinet is neither on air, nor chosen, nor the venue's identity.
 *
 * With `onOpenReplay`, each chip opens its cabinet's last broadcast in 다시보기.
 *
 * The same line says how many cabinets the viewer has hidden from this view (`hidden`), with
 * 편집 to bring them back, so a hidden cabinet is never one that simply went missing; and
 * while the wall is arranged (`editing`) every chip, hidden ones dimmed among them, hides or
 * shows its cabinet.
 */
export function IdleStrip({
  cabinets,
  title = IDLE_STRIP_TITLE,
  onOpenReplay,
  hidden,
  editing,
  order,
}: {
  cabinets: IdleCabinet[];
  title?: string;
  onOpenReplay?: (cabinetId: string) => void;
  hidden?: { count: number; onEdit: () => void };
  editing?: IdleStripEditing;
  /** Its place in the wall's grid, after every tile, when the tiles are placed by `order`. */
  order?: number;
}) {
  const hiddenCount = hidden?.count ?? 0;
  if (cabinets.length === 0 && hiddenCount === 0) {
    return null;
  }

  return (
    <section
      className="idle-strip"
      aria-label={cabinets.length > 0 ? `${title} ${cabinets.length}대` : `숨긴 기체 ${hiddenCount}대`}
      style={order === undefined ? undefined : { order }}
    >
      {cabinets.length > 0 && (
        <>
          <span className="idle-strip__title">{title}</span>
          <ul className="idle-strip__chips">
            {cabinets.map((cabinet, index) =>
              // Labels are not promised unique, so the position is part of the key.
              editing ? (
                <EditChip
                  key={`${index}:${cabinet.id}`}
                  cabinet={cabinet.label}
                  hidden={editing.isHidden(cabinet.id)}
                  onToggle={() => editing.onToggleHidden(cabinet.id)}
                />
              ) : (
                <IdleChip
                  key={`${index}:${cabinet.id}`}
                  cabinet={cabinet.label}
                  onOpen={onOpenReplay ? () => onOpenReplay(cabinet.id) : undefined}
                />
              ),
            )}
          </ul>
        </>
      )}
      {hidden && hiddenCount > 0 && (
        <span className="idle-strip__hidden" data-testid="wall-hidden-note">
          <span className="idle-strip__title">
            숨긴 기체 <span className="idle-strip__count">{hiddenCount}</span>
          </span>
          <span className="idle-chip-slot">
            <button
              type="button"
              className="idle-strip__edit"
              onClick={hidden.onEdit}
              aria-label={`숨긴 기체 ${hiddenCount}대 편집`}
            >
              편집
            </button>
          </span>
        </span>
      )}
    </section>
  );
}

/** A cabinet with nothing on air while the wall is arranged: pressing it hides or shows it. */
function EditChip({ cabinet, hidden, onToggle }: { cabinet: string; hidden: boolean; onToggle: () => void }) {
  return (
    <li className="idle-chip-slot">
      <button
        type="button"
        className={hidden ? 'idle-chip idle-chip--replay idle-chip--hidden' : 'idle-chip idle-chip--replay'}
        title={hidden ? `${cabinet} 다시 보이기` : `${cabinet} 숨기기`}
        aria-label={hidden ? `${cabinet} 다시 보이기` : `${cabinet} 숨기기`}
        onClick={onToggle}
      >
        <EyeIcon open={!hidden} />
        <span className="idle-chip__name">{cabinet}</span>
      </button>
    </li>
  );
}
