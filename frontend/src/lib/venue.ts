import type { CSSProperties } from 'react';
import type { VenueStatus } from './types';

export interface IdleMessage {
  title: string;
  detail?: string;
  /** Nothing has been heard from the API yet. */
  loading?: boolean;
}

export const LOADING_MESSAGE: IdleMessage = { title: '불러오는 중', loading: true };

/**
 * What an empty cabinet should say. A closed venue is a different thing from a
 * cabinet that simply has no stream yet, and saying "준비중" at 3am reads as if
 * something is about to start.
 */
export function idleMessageFor(venue: VenueStatus | undefined): IdleMessage {
  if (!venue) {
    return { title: '준비중…' };
  }

  const opens = formatOpening(venue);

  switch (venue.state) {
    case 'ClosedForHoliday':
      return { title: '오늘 휴무', detail: opens };
    case 'OutsideHours':
      return { title: '영업 종료', detail: opens };
    default:
      return { title: '준비중…' };
  }
}

/** A one-line summary for the header, or null while the venue is open. */
export function venueSummary(venue: VenueStatus | undefined): string | null {
  if (!venue || venue.state === 'Open') {
    return null;
  }

  const opens = formatOpening(venue);
  const label = venue.state === 'ClosedForHoliday' ? '오늘 휴무' : '영업 종료';

  return opens ? `${label} · ${opens}` : label;
}

function formatOpening(venue: VenueStatus): string | undefined {
  if (!venue.opensAt) {
    return undefined;
  }

  const opensAt = new Date(venue.opensAt);
  if (Number.isNaN(opensAt.getTime())) {
    return undefined;
  }

  // Compare against the venue's clock, not the viewer's - someone watching from
  // another time zone should still read "내일 10:00" the way a local would.
  const now = new Date(venue.localTime);
  const time = opensAt.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const days = calendarDaysBetween(now, opensAt);

  if (days <= 0) {
    return `${time} 오픈`;
  }

  if (days === 1) {
    return `내일 ${time} 오픈`;
  }

  const date = opensAt.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  return `${date} ${time} 오픈`;
}

/** Whole calendar days apart, ignoring the time of day. */
function calendarDaysBetween(from: Date, to: Date): number {
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

/** Hands a venue's brand colour to CSS as --venue-accent; the stylesheet falls back to the app accent. */
export function accentStyle(accent: string | undefined): CSSProperties | undefined {
  return accent ? ({ '--venue-accent': accent } as CSSProperties) : undefined;
}
