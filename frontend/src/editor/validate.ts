import { DAY_LABEL, splitList, type VenueDraft } from './model';
import { compilePattern } from './pattern';

/**
 * The checks the backend runs at startup, so a venue it would skip is caught before
 * saving. Errors block the save; warnings are worth a look but do not.
 */

export interface Issue {
  error: boolean;
  message: string;
}

const minutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [hours, mins] = [Number(match[1]), Number(match[2])];
  return hours <= 47 && mins <= 59 ? hours * 60 + mins : null;
};

export function validateVenue(venue: VenueDraft, all: VenueDraft[]): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ error: true, message });
  const warn = (message: string) => issues.push({ error: false, message });

  const id = venue.id.trim();
  if (!id) {
    error('id가 비어 있습니다.');
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    warn('id는 영소문자·숫자·하이픈만 쓰는 편이 URL에서 안전합니다.');
  }

  if (id && all.some((other) => other.key !== venue.key && other.id.trim().toLowerCase() === id.toLowerCase())) {
    error(`id '${id}'가 다른 매장과 중복됩니다.`);
  }

  if (!venue.name.trim()) {
    warn('name이 비어 있습니다. 탭에 표시할 이름입니다.');
  }

  const channelId = venue.channelId.trim();
  if (!channelId) {
    error('channelId가 없습니다. 이 매장은 로드되지 않습니다.');
  } else if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) {
    warn('channelId 형식이 일반적이지 않습니다 (UC + 22자).');
  }

  const compiled = compilePattern(venue.titlePattern);
  if (compiled.error) {
    error(`titlePattern: ${compiled.error}`);
  }

  const stations = venue.stations.filter((station) => station.id.trim());
  if (stations.length === 0) {
    error('기체가 하나도 없습니다. 이 매장은 로드되지 않습니다.');
  }

  const seen = new Set<string>();
  for (const station of stations) {
    const stationId = station.id.trim();
    if (seen.has(stationId)) {
      error(`기체 id '${stationId}'가 중복됩니다.`);
    }
    seen.add(stationId);
    if (!station.label.trim()) {
      warn(`기체 '${stationId}'에 label이 없습니다.`);
    }
  }

  const zoneIds = new Set(venue.zones.map((zone) => zone.id.trim()).filter(Boolean));
  for (const station of stations) {
    const zoneId = station.zoneId.trim();
    if (zoneId && !zoneIds.has(zoneId)) {
      warn(`기체 '${station.id}'의 zoneId '${zoneId}'에 해당하는 구역이 없습니다.`);
    }
  }

  for (const hour of venue.hours.filter((hour) => !hour.closed)) {
    const [start, end] = [minutes(hour.open), minutes(hour.close)];
    if (start === null || end === null) {
      error(`${DAY_LABEL[hour.day]}요일 영업시간 형식이 잘못됐습니다 (HH:mm).`);
    } else if (end <= start) {
      error(`${DAY_LABEL[hour.day]}요일 마감이 오픈보다 빠릅니다. 자정을 넘기면 29:00처럼 적으세요.`);
    }
  }

  for (const date of splitList(venue.closedDates)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      warn(`휴무일 '${date}'을 날짜로 읽을 수 없습니다 (yyyy-MM-dd).`);
    }
  }

  if (venue.logo.trim() && !/^(https?:\/\/|logos\/)/.test(venue.logo.trim())) {
    warn('logo는 logos/파일명 또는 http(s):// 주소여야 합니다.');
  }

  return issues;
}
