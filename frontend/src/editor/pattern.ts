import type { StationDraft } from './model';
import { splitList } from './model';

/**
 * Title patterns: building one by pointing at the cabinet name in a real title, and
 * checking one against real titles.
 *
 * The backend runs these as .NET regular expressions and the editor checks them as
 * JavaScript ones. For what the builder produces and what people write by hand -
 * literals, \s \d, (?<name>...) - the two agree.
 */

const escape = (value: string) => value.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');

/**
 * Escapes literal text, then relaxes the two things that change between broadcasts:
 * runs of whitespace become \s+ and runs of digits become \d+.
 */
function generalize(value: string): string {
  if (!value) {
    return '';
  }

  const joined = value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => escape(token).replace(/\d+/g, '\\d+'))
    .join('\\s+');

  const leading = /^\s/.test(value) ? '\\s+' : '';
  const trailing = /\s$/.test(value) ? '\\s+' : '';
  return leading + joined + trailing;
}

/** A pattern whose name group captures title[start, end), dates and parts generalised. */
export function patternFromSelection(title: string, start: number, end: number): string {
  if (end <= start || start < 0 || end > title.length) {
    throw new Error('제목에서 기체명 부분을 드래그로 선택해 주세요.');
  }

  return `^\\s*${generalize(title.slice(0, start))}(?<name>.+?)${generalize(title.slice(end))}\\s*$`;
}

export type Compiled = { regex: RegExp; error?: undefined } | { regex?: undefined; error: string };

export function compilePattern(pattern: string): Compiled {
  if (!pattern.trim()) {
    return { error: '패턴이 비어 있습니다.' };
  }

  try {
    const regex = new RegExp(pattern, 'i');
    // Every named group shows up in .groups, matched or not.
    const groups = new RegExp(`(?:${pattern})|`, 'i').exec('')?.groups ?? {};
    if (!('name' in groups)) {
      return { error: '(?<name>...) 그룹이 없습니다. 기체명을 잡는 그룹이 반드시 필요합니다.' };
    }
    return { regex };
  } catch (cause) {
    return { error: `정규식 오류: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

export function nameIn(regex: RegExp, title: string): string | null {
  const name = regex.exec(title)?.groups?.name;
  return name === undefined ? null : name.trim();
}

/** The backend's normalisation: case, spaces and separators do not matter. */
const normalize = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();

/** Which cabinet a name from a title resolves to, the way the backend decides it. */
export function stationFor(name: string, stations: StationDraft[]): StationDraft | null {
  const key = normalize(name);
  if (!key) {
    return null;
  }

  return (
    stations.find((station) =>
      [...splitList(station.aliases), station.label, station.id].some((candidate) => normalize(candidate) === key),
    ) ?? null
  );
}
