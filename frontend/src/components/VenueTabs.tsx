import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Venue, VenueLive } from '../lib/types';
import { accentStyle } from '../lib/venue';
import { liveCountOf, liveElsewhere, PHONE_LAYOUT_QUERY, venueRowMode, type VenueRowMode } from '../lib/venueRow';
import { VenueMark } from './VenueMark';

interface VenueTabsProps {
  venues: Venue[];
  liveByVenue: Map<string, VenueLive>;
  activeVenueId: string;
  onSelect: (venueId: string) => void;
}

/**
 * Venues are separate businesses, not branches of one chain, so each gets its own
 * accent colour. Tabs rather than a dropdown because the live count has to stay
 * visible — the whole point is seeing which venue is streaming without switching.
 *
 * A phone has one line for them. When every tab does not fit, the line keeps the open
 * venue's tab and a "전체 매장" button carrying the other venues' live count, and the
 * rest open as a list laid over the page, so the sticky marquee stays one venue row and
 * one view row tall however many venues there are (see `venueRowMode`).
 */
export function VenueTabs({ venues, liveByVenue, activeVenueId, onSelect }: VenueTabsProps) {
  const phone = useMediaQuery(PHONE_LAYOUT_QUERY);
  const groupRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<VenueRowMode>('tabs');

  // The full row is laid out off screen on a phone, so the decision follows its real
  // width: logos loading, fonts arriving, the phone turning, a venue added.
  useLayoutEffect(() => {
    const group = groupRef.current;
    const probe = probeRef.current;
    if (!phone || !group || !probe) {
      setMode('tabs');
      return;
    }

    const measure = () =>
      setMode(venueRowMode({ phone: true, needed: probe.getBoundingClientRect().width, available: group.clientWidth }));

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [phone, venues, liveByVenue]);

  if (venues.length < 2) {
    return null;
  }

  const folded = mode === 'folded';
  const activeVenue = venues.find((venue) => venue.id === activeVenueId);
  const shown = folded && activeVenue ? [activeVenue] : venues;

  return (
    <div className="control-group control-group--venues" ref={groupRef}>
      <span className="control-group__label" id="venue-tabs-label">
        매장
      </span>
      <div
        className={folded ? 'venue-tabs venue-tabs--folded' : 'venue-tabs'}
        role="tablist"
        aria-labelledby="venue-tabs-label"
      >
        {shown.map((venue) => {
          const count = liveCountOf(liveByVenue.get(venue.id));
          const isActive = venue.id === activeVenueId;

          return (
            <button
              key={venue.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className="venue-tab"
              style={accentStyle(venue.accent)}
              title={venue.name}
              onClick={() => onSelect(venue.id)}
            >
              <TabFace venue={venue} count={count} />
            </button>
          );
        })}
      </div>

      {folded && (
        <VenueList
          venues={venues}
          liveByVenue={liveByVenue}
          activeVenueId={activeVenueId}
          onSelect={onSelect}
        />
      )}

      {/* The whole row on one line, never seen or read, only measured. It sits in a
          clipping box so its width cannot widen the page. */}
      {phone && (
        <div className="venue-probe" aria-hidden="true">
          <div className="venue-tabs venue-tabs--probe" ref={probeRef}>
            {venues.map((venue) => (
              <span key={venue.id} className="venue-tab" style={accentStyle(venue.accent)}>
                <TabFace venue={venue} count={liveCountOf(liveByVenue.get(venue.id))} />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TabFace({ venue, count }: { venue: Venue; count: number }) {
  return (
    <>
      <VenueMark venue={venue} size="tab" />
      {/* The open venue's name is already large in the marquee, so a tab is its
          logo and its live count; the name stays for screen readers, and shows
          when there is no logo to go by. */}
      <span className={venue.logo ? 'venue-tab__name visually-hidden' : 'venue-tab__name'}>{venue.name}</span>
      <span className={count > 0 ? 'venue-tab__count venue-tab__count--live' : 'venue-tab__count'}>
        {count}
        <span className="visually-hidden">개 송출 중</span>
      </span>
    </>
  );
}

/**
 * The "전체 매장" button and the list it opens. The list is laid over the page, not
 * into the marquee, so opening it leaves the bar's height - and with it the phone's
 * playing slots, which are judged below the bar - exactly as it was.
 */
function VenueList({ venues, liveByVenue, activeVenueId, onSelect }: VenueTabsProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const elsewhere = liveElsewhere(venues, liveByVenue, activeVenueId);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }, []);

  // Opening puts the focus on the open venue, as a native select would.
  useEffect(() => {
    if (open) {
      listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }
  }, [open]);

  // A tap anywhere else closes it; the button's own tap toggles it instead.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        close(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const choose = (venueId: string) => {
    onSelect(venueId);
    close(true);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = options.indexOf(document.activeElement as HTMLElement);
    const focusAt = (index: number) => options[(index + options.length) % options.length]?.focus();

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusAt(at + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(at - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const venueId = options[at]?.dataset.venueId;
        if (venueId) {
          choose(venueId);
        }
        break;
      }
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="venue-more"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        전체 매장
        <span className="venue-more__caret" aria-hidden="true">
          ▾
        </span>
        {/* 돈: on air elsewhere, so a venue worth switching to is not hidden behind the fold. */}
        {elsewhere > 0 && (
          <span className="venue-tab__count venue-tab__count--live">
            {elsewhere}
            <span className="visually-hidden">개 다른 매장에서 송출 중</span>
          </span>
        )}
      </button>

      <ul
        ref={listRef}
        id={listId}
        className="venue-list"
        role="listbox"
        aria-label="매장 목록"
        hidden={!open}
        onKeyDown={onListKeyDown}
      >
        {venues.map((venue) => {
          const count = liveCountOf(liveByVenue.get(venue.id));
          const isActive = venue.id === activeVenueId;
          return (
            <li
              key={venue.id}
              role="option"
              aria-selected={isActive}
              tabIndex={-1}
              className="venue-list__option"
              style={accentStyle(venue.accent)}
              data-venue-id={venue.id}
              onClick={() => choose(venue.id)}
            >
              <VenueMark venue={venue} size="tab" />
              <span className="venue-list__name">{venue.name}</span>
              <span className={count > 0 ? 'venue-tab__count venue-tab__count--live' : 'venue-tab__count'}>
                {count}
                <span className="visually-hidden">개 송출 중</span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
