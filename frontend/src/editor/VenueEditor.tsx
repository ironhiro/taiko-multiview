import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { announceVenuesSaved } from '../lib/settingsChannel';
import { isDesktopShell, openSettings, saveSettings } from '../lib/shell';
import {
  DAY_LABEL,
  duplicateVenue,
  newKey,
  newVenue,
  venuesOf,
  withVenues,
  type HourDraft,
  type StationDraft,
  type VenueDraft,
  type ZoneDraft,
} from './model';
import { compilePattern, nameIn, patternFromSelection, stationFor } from './pattern';
import { validateVenue, type Issue } from './validate';
import { channelUrlFrom, fetchChannelFeed, resolveChannelId } from './youtube';
import './editor.css';

type Tab = 'basic' | 'pattern' | 'stations' | 'hours' | 'layout' | 'check';

const TABS: { id: Tab; label: string }[] = [
  { id: 'basic', label: '기본' },
  { id: 'pattern', label: '제목 규칙' },
  { id: 'stations', label: '기체 · 구역' },
  { id: 'hours', label: '영업시간' },
  { id: 'layout', label: '배치도' },
  { id: 'check', label: '검증' },
];

interface Confirmation {
  message: string;
  action: string;
  run: () => void;
}

/**
 * The venue editor, as a screen of the desktop shell: edits Venues:Items in the
 * backend's venues.json. File access and YouTube lookups go through the shell;
 * everything else happens here.
 */
export default function VenueEditor() {
  const [path, setPath] = useState<string | null>(null);
  const [root, setRoot] = useState<Record<string, unknown> | null>(null);
  const [venues, setVenues] = useState<VenueDraft[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('basic');
  const [status, setStatus] = useState('설정 파일을 찾는 중…');
  const [dirty, setDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);

  const venue = venues.find((item) => item.key === selectedKey) ?? null;
  const issues = useMemo(() => (venue ? validateVenue(venue, venues) : []), [venue, venues]);

  const load = useCallback(async (pick: boolean) => {
    try {
      const opened = await openSettings(pick);
      if (!opened) {
        setStatus(pick ? '파일 선택을 취소했습니다.' : 'venues.json을 찾지 못했습니다. [파일 선택]으로 지정해 주세요.');
        return;
      }

      const parsed = JSON.parse(opened.text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('최상위가 JSON 객체가 아닙니다.');
      }

      const loaded = venuesOf(parsed as Record<string, unknown>);
      setRoot(parsed as Record<string, unknown>);
      setVenues(loaded);
      setSelectedKey(loaded[0]?.key ?? null);
      setPath(opened.path);
      setDirty(false);
      setStatus(`${loaded.length}개 매장을 불러왔습니다.`);
    } catch (cause) {
      setStatus(`불러오기 실패: ${messageOf(cause)}`);
    }
  }, []);

  useEffect(() => {
    document.title = '매장 등록기 · 태고 멀티뷰';
    if (isDesktopShell) {
      void load(false);
    }
  }, [load]);

  const update = useCallback((key: string, change: (venue: VenueDraft) => VenueDraft) => {
    setVenues((current) => current.map((item) => (item.key === key ? change(item) : item)));
    setDirty(true);
  }, []);

  const save = async () => {
    if (!root) {
      return;
    }

    const blocking = venues.flatMap((item) =>
      validateVenue(item, venues)
        .filter((issue) => issue.error)
        .map((issue) => `[${item.name || item.id}] ${issue.message}`),
    );

    if (blocking.length > 0) {
      const first = venues.find((item) => validateVenue(item, venues).some((issue) => issue.error));
      if (first) {
        setSelectedKey(first.key);
      }
      setTab('check');
      setStatus(`저장하지 못했습니다: 고쳐야 할 문제 ${blocking.length}건`);
      return;
    }

    setBusy(true);
    try {
      await saveSettings(`${JSON.stringify(withVenues(root, venues), null, 2)}\n`);
      setDirty(false);
      announceVenuesSaved();
      setStatus(`${new Date().toLocaleTimeString('ko-KR')} 저장 완료 — 멀티뷰에 곧바로 반영됩니다.`);
    } catch (cause) {
      setStatus(`저장 실패: ${messageOf(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const addVenue = () => {
    const created = newVenue();
    setVenues((current) => [...current, created]);
    setSelectedKey(created.key);
    setTab('basic');
    setDirty(true);
  };

  const duplicate = () => {
    if (!venue) {
      return;
    }
    const copy = duplicateVenue(venue);
    setVenues((current) => [...current, copy]);
    setSelectedKey(copy.key);
    setDirty(true);
  };

  const remove = () => {
    if (!venue) {
      return;
    }
    setConfirmation({
      message: `'${venue.name || venue.id}' 매장을 목록에서 뺄까요? 저장하기 전까지 파일은 바뀌지 않습니다.`,
      action: '빼기',
      run: () => {
        const index = venues.findIndex((item) => item.key === venue.key);
        const rest = venues.filter((item) => item.key !== venue.key);
        setVenues(rest);
        setSelectedKey(rest[Math.min(index, rest.length - 1)]?.key ?? null);
        setDirty(true);
      },
    });
  };

  if (!isDesktopShell) {
    return (
      <div className="editor editor--unavailable">
        <p>매장 등록기는 데스크톱 앱에서만 쓸 수 있습니다. 설정 파일을 직접 열고 저장해야 하기 때문입니다.</p>
      </div>
    );
  }

  return (
    <div className="editor">
      {/* The same marquee as the wall: whose screen this is, and the file it edits. */}
      <header className="marquee editor__marquee">
        <div className="marquee__brand">
          <p className="wordmark">태고 멀티뷰</p>
          <h1 className="marquee__venue">
            <span className="marquee__venue-name">매장 등록기</span>
          </h1>
        </div>

        <p className="editor__path" title={path ?? undefined}>
          {path ?? '설정 파일 없음'}
        </p>

        <div className="editor__file-actions">
          <button type="button" className="btn" onClick={() => void load(true)}>
            파일 선택…
          </button>
          <button type="button" className="btn editor__save" onClick={() => void save()} disabled={!root || busy}>
            {busy ? '저장 중…' : dirty ? '저장 ●' : '저장'}
          </button>
        </div>
      </header>

      <aside className="editor__list" aria-label="매장 목록">
        <div className="editor__venues">
          <span className="editor__list-label" id="editor-venues-label">
            매장
          </span>
          <div className="editor__venue-list" role="listbox" aria-labelledby="editor-venues-label">
            {venues.map((item) => (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={item.key === selectedKey}
                className="choice editor__venue"
                style={item.accent ? ({ '--venue-accent': item.accent } as React.CSSProperties) : undefined}
                onClick={() => setSelectedKey(item.key)}
              >
                <span className="editor__venue-name">{item.name || item.id || '(이름 없음)'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="editor__venue-actions">
          <button type="button" className="btn" onClick={addVenue} disabled={!root}>
            추가
          </button>
          <button type="button" className="btn" onClick={duplicate} disabled={!venue}>
            복제
          </button>
          <button type="button" className="btn" onClick={remove} disabled={!venue}>
            빼기
          </button>
        </div>
      </aside>

      <div className="editor__stage">
        {confirmation && (
          <div className="editor__confirm" role="alertdialog" aria-label={confirmation.action}>
            <p>{confirmation.message}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                confirmation.run();
                setConfirmation(null);
              }}
            >
              {confirmation.action}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmation(null)}>
              취소
            </button>
          </div>
        )}

        {venue ? (
          <>
            <nav className="editor__tabs" role="tablist" aria-label="편집 항목">
              {TABS.map((item) => {
                const errors = item.id === 'check' ? issues.filter((issue) => issue.error).length : 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    className="editor__tab"
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                    {errors > 0 && <span className="editor__tab-count">{errors}</span>}
                  </button>
                );
              })}
            </nav>

            {/* Keyed by venue: the fetched titles, the sample and the lookup box belong to
                the venue they were entered for, and must not carry over to the next one. */}
            <main className="editor__body" key={venue.key}>
              {tab === 'basic' && <BasicTab venue={venue} update={update} setStatus={setStatus} />}
              {tab === 'pattern' && <PatternTab venue={venue} update={update} setStatus={setStatus} />}
              {tab === 'stations' && <StationsTab venue={venue} update={update} />}
              {tab === 'hours' && <HoursTab venue={venue} update={update} />}
              {tab === 'layout' && (
                <LayoutTab
                  venue={venue}
                  onClear={() =>
                    setConfirmation({
                      message: '배치도 좌표를 지우면 되돌리려면 좌표를 다시 작성해야 합니다. 지울까요?',
                      action: '지우기',
                      run: () => update(venue.key, (item) => ({ ...item, layout: null })),
                    })
                  }
                />
              )}
              {tab === 'check' && <CheckTab issues={issues} />}
            </main>
          </>
        ) : (
          <main className="editor__body editor__empty">
            <p>{root ? '왼쪽에서 매장을 고르거나 [추가]를 누르세요.' : '설정 파일을 열어 주세요.'}</p>
          </main>
        )}

      </div>

      <footer className="credit editor__credit">
        <p className="editor__status" aria-live="polite">
          {status}
        </p>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------------ tabs

interface TabProps {
  venue: VenueDraft;
  update: (key: string, change: (venue: VenueDraft) => VenueDraft) => void;
}

/**
 * A labelled control. The label names the control and the hint describes it, so a
 * screen reader says "이름" rather than the label and the whole hint run together. When
 * the control sits in a row with a button, the first element of the row is the one
 * labelled.
 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const labelled = (element: ReactElement) =>
    cloneElement(element as ReactElement<{ id?: string; 'aria-describedby'?: string }>, {
      id,
      'aria-describedby': hintId,
    });

  const row = children.props as { className?: string; children?: ReactNode };
  const control =
    row.className === 'field__row'
      ? cloneElement(children, {}, ...Children.toArray(row.children).map((child, index) =>
          index === 0 && isValidElement(child) ? labelled(child) : child,
        ))
      : labelled(children);

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {control}
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

function BasicTab({ venue, update, setStatus }: TabProps & { setStatus: (message: string) => void }) {
  const [channelInput, setChannelInput] = useState('');
  const [looking, setLooking] = useState(false);
  const set = (key: keyof VenueDraft) => (event: { target: { value: string } }) =>
    update(venue.key, (item) => ({ ...item, [key]: event.target.value }));

  const lookUp = async () => {
    if (!channelInput.trim()) {
      setStatus('@핸들이나 채널 주소를 입력해 주세요.');
      return;
    }

    setLooking(true);
    setStatus('채널을 조회하는 중…');
    try {
      const channelId = await resolveChannelId(channelInput);
      if (!channelId) {
        setStatus('채널을 찾지 못했습니다. 주소를 다시 확인해 주세요.');
        return;
      }

      const { name } = await fetchChannelFeed(channelId).catch(() => ({ name: null }));
      update(venue.key, (item) => ({
        ...item,
        channelId,
        channelUrl: item.channelUrl || channelUrlFrom(channelInput, channelId),
        name: item.name && item.name !== '새 매장' ? item.name : name ?? item.name,
      }));
      setStatus(`채널 확인: ${name ?? channelId}`);
    } catch (cause) {
      setStatus(`조회 실패: ${messageOf(cause)}`);
    } finally {
      setLooking(false);
    }
  };

  const accentValid = /^#[0-9a-f]{6}$/i.test(venue.accent.trim());

  return (
    <div className="form">
      <Field label="id" hint="URL과 설정에서 이 매장을 가리키는 값. 영소문자·숫자·하이픈">
        <input value={venue.id} onChange={set('id')} spellCheck={false} />
      </Field>
      <Field label="이름" hint="매장 목록에 표시할 이름">
        <input value={venue.name} onChange={set('name')} />
      </Field>
      <Field label="강조색" hint="#RRGGBB. 선택한 보기, 소리 켜진 타일 등에 쓰입니다">
        <span className="field__row">
          <input value={venue.accent} onChange={set('accent')} spellCheck={false} />
          <input
            type="color"
            className="field__swatch"
            value={accentValid ? venue.accent.trim() : '#888888'}
            onChange={set('accent')}
            aria-label="강조색 고르기"
          />
        </span>
      </Field>
      <Field label="로고" hint="비우면 YouTube 채널 프로필 이미지. 파일은 frontend/public/logos/ 에 두고 logos/이름.svg">
        <input value={venue.logo} onChange={set('logo')} spellCheck={false} />
      </Field>

      <hr className="form__rule" />

      <Field label="채널 조회" hint="@핸들, 채널 주소, UC로 시작하는 id 중 아무거나">
        <span className="field__row">
          <input
            value={channelInput}
            onChange={(event) => setChannelInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void lookUp()}
            placeholder="@TAIKO_LABS"
            spellCheck={false}
          />
          <button type="button" className="btn" onClick={() => void lookUp()} disabled={looking}>
            {looking ? '조회 중…' : '조회'}
          </button>
        </span>
      </Field>
      <Field label="channelId">
        <input value={venue.channelId} onChange={set('channelId')} spellCheck={false} />
      </Field>
      <Field label="채널 주소" hint="선택">
        <input value={venue.channelUrl} onChange={set('channelUrl')} spellCheck={false} />
      </Field>
      <Field label="네이버 플레이스 id" hint="선택. 임시휴무 자동 감지에 씁니다. 네이버 지도 주소의 place/ 뒤 숫자">
        <input value={venue.naverPlaceId} onChange={set('naverPlaceId')} spellCheck={false} />
      </Field>
    </div>
  );
}

interface TitleRow {
  title: string;
}

function PatternTab({ venue, update, setStatus }: TabProps & { setStatus: (message: string) => void }) {
  const [rows, setRows] = useState<TitleRow[]>([]);
  const [sample, setSample] = useState('');
  const [fetching, setFetching] = useState(false);
  const sampleRef = useRef<HTMLInputElement>(null);
  const compiled = compilePattern(venue.titlePattern);

  const fetchTitles = async () => {
    if (!venue.channelId.trim()) {
      setStatus('먼저 기본 탭에서 채널을 조회해 channelId를 채워 주세요.');
      return;
    }

    setFetching(true);
    setStatus('최근 방송 제목을 가져오는 중…');
    try {
      const { titles } = await fetchChannelFeed(venue.channelId.trim());
      setRows(titles.map((title) => ({ title })));
      setStatus(`제목 ${titles.length}건을 가져왔습니다. 매칭 결과를 확인하세요.`);
    } catch (cause) {
      setStatus(`제목을 가져오지 못했습니다: ${messageOf(cause)}`);
    } finally {
      setFetching(false);
    }
  };

  const build = () => {
    const input = sampleRef.current;
    if (!input) {
      return;
    }
    try {
      const pattern = patternFromSelection(sample, input.selectionStart ?? 0, input.selectionEnd ?? 0);
      update(venue.key, (item) => ({ ...item, titlePattern: pattern }));
      setStatus('패턴을 만들었습니다. 아래 목록에서 매칭 결과를 확인하세요.');
    } catch (cause) {
      setStatus(messageOf(cause));
    }
  };

  return (
    <div className="form">
      <Field label="titlePattern" hint="방송 제목에서 기체명을 뽑는 정규식. (?<name>...) 그룹이 반드시 필요합니다.">
        <input
          className="field__mono"
          value={venue.titlePattern}
          onChange={(event) => update(venue.key, (item) => ({ ...item, titlePattern: event.target.value }))}
          spellCheck={false}
        />
      </Field>
      {compiled.error && <p className="form__error">{compiled.error}</p>}

      <section className="builder">
        <h2 className="builder__title">패턴 만들기</h2>
        <p className="field__hint">
          아래 목록에서 제목을 고른 뒤, 이 칸에서 기체명 부분만 드래그로 선택하고 [선택 부분이 기체명]을 누르세요.
          날짜·회차 숫자는 자동으로 일반화됩니다.
        </p>
        <span className="field__row">
          <input
            ref={sampleRef}
            className="field__mono"
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            placeholder="방송 제목"
            spellCheck={false}
          />
          {/* mousedown is stopped so the sample keeps its selection when this is pressed. */}
          <button type="button" className="btn" onMouseDown={(event) => event.preventDefault()} onClick={build}>
            선택 부분이 기체명
          </button>
        </span>
      </section>

      <div className="table-head">
        <p className="field__hint">최근 방송 제목으로 패턴과 기체 매칭을 함께 확인합니다.</p>
        <button type="button" className="btn" onClick={() => void fetchTitles()} disabled={fetching}>
          {fetching ? '가져오는 중…' : '채널에서 제목 가져오기'}
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>제목</th>
              <th>기체명</th>
              <th>매칭된 기체</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="table__empty">
                  아직 가져온 제목이 없습니다.
                </td>
              </tr>
            )}
            {rows.map((row, index) => {
              const name = compiled.regex ? nameIn(compiled.regex, row.title) : null;
              const station = name ? stationFor(name, venue.stations) : null;
              return (
                <tr key={index} className="table__pick" onClick={() => setSample(row.title)}>
                  <td>{row.title}</td>
                  <td className="field__mono">{compiled.error ? '패턴 오류' : name ?? '매칭 안 됨'}</td>
                  <td className={name && !station ? 'table__warn' : undefined}>
                    {!name ? '—' : station ? `${station.id} (${station.label})` : '⚠ 매칭되는 기체 없음'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowTable<T extends { key: string }>({
  columns,
  rows,
  onChange,
  onRemove,
  empty,
}: {
  columns: { key: keyof T & string; label: string; mono?: boolean; width?: string }[];
  rows: T[];
  onChange: (key: string, field: keyof T & string, value: string) => void;
  onRemove: (key: string) => void;
  empty: string;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={column.width ? { width: column.width } : undefined}>
                {column.label}
              </th>
            ))}
            <th className="table__action" aria-label="삭제" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="table__empty">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((column) => (
                <td key={column.key}>
                  <input
                    className={column.mono ? 'table__input field__mono' : 'table__input'}
                    value={String(row[column.key] ?? '')}
                    onChange={(event) => onChange(row.key, column.key, event.target.value)}
                    aria-label={column.label}
                    spellCheck={false}
                  />
                </td>
              ))}
              <td className="table__action">
                <button type="button" className="table__remove" onClick={() => onRemove(row.key)} aria-label="행 삭제">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StationsTab({ venue, update }: TabProps) {
  const editStations = (change: (rows: StationDraft[]) => StationDraft[]) =>
    update(venue.key, (item) => ({ ...item, stations: change(item.stations) }));
  const editZones = (change: (rows: ZoneDraft[]) => ZoneDraft[]) =>
    update(venue.key, (item) => ({ ...item, zones: change(item.zones) }));

  return (
    <div className="form">
      <div className="table-head">
        <p className="field__hint">
          기체 — id는 내부 식별자, label은 화면에 보이는 이름. aliases는 제목에 쓰이는 다른 표기를 쉼표로 구분해 적습니다.
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => editStations((rows) => [...rows, { key: newKey(), id: '', label: '', zoneId: '', aliases: '' }])}
        >
          기체 추가
        </button>
      </div>
      <RowTable<StationDraft>
        columns={[
          { key: 'id', label: 'id', mono: true, width: '16%' },
          { key: 'label', label: 'label', width: '20%' },
          { key: 'zoneId', label: 'zoneId', mono: true, width: '18%' },
          { key: 'aliases', label: 'aliases (쉼표 구분)' },
        ]}
        rows={venue.stations}
        onChange={(key, field, value) =>
          editStations((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
        }
        onRemove={(key) => editStations((rows) => rows.filter((row) => row.key !== key))}
        empty="기체가 없습니다."
      />

      <div className="table-head">
        <p className="field__hint">구역 — 2개 이상일 때만 보기 목록에 구역별 항목이 생깁니다. 나눌 필요가 없으면 비워 두세요.</p>
        <button
          type="button"
          className="btn"
          onClick={() => editZones((rows) => [...rows, { key: newKey(), id: '', code: '', label: '' }])}
        >
          구역 추가
        </button>
      </div>
      <RowTable<ZoneDraft>
        columns={[
          { key: 'id', label: 'id', mono: true, width: '22%' },
          { key: 'code', label: 'code (배치도 표기)', width: '28%' },
          { key: 'label', label: 'label (보기 이름)' },
        ]}
        rows={venue.zones}
        onChange={(key, field, value) =>
          editZones((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
        }
        onRemove={(key) => editZones((rows) => rows.filter((row) => row.key !== key))}
        empty="구역이 없습니다."
      />
    </div>
  );
}

function HoursTab({ venue, update }: TabProps) {
  const edit = (day: HourDraft['day'], change: Partial<HourDraft>) =>
    update(venue.key, (item) => ({
      ...item,
      hours: item.hours.map((hour) => (hour.day === day ? { ...hour, ...change } : hour)),
    }));

  return (
    <div className="form">
      <p className="field__hint">자정을 넘기는 마감은 시를 24 이상으로 적습니다. 예: 07:00 ~ 익일 05:00 → 마감 29:00</p>
      <div className="table-wrap">
        <table className="table table--hours">
          <thead>
            <tr>
              <th>요일</th>
              <th>오픈</th>
              <th>마감</th>
              <th>휴무</th>
            </tr>
          </thead>
          <tbody>
            {venue.hours.map((hour) => (
              <tr key={hour.day} className={hour.closed ? 'table__muted' : undefined}>
                <td>{DAY_LABEL[hour.day]}</td>
                <td>
                  <input
                    className="table__input field__mono"
                    value={hour.open}
                    disabled={hour.closed}
                    onChange={(event) => edit(hour.day, { open: event.target.value })}
                    aria-label={`${DAY_LABEL[hour.day]}요일 오픈`}
                  />
                </td>
                <td>
                  <input
                    className="table__input field__mono"
                    value={hour.close}
                    disabled={hour.closed}
                    onChange={(event) => edit(hour.day, { close: event.target.value })}
                    aria-label={`${DAY_LABEL[hour.day]}요일 마감`}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={hour.closed}
                    onChange={(event) => edit(hour.day, { closed: event.target.checked })}
                    aria-label={`${DAY_LABEL[hour.day]}요일 휴무`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Field label="확정된 휴무일" hint="한 줄에 하나씩 yyyy-MM-dd. 네이버 플레이스 id를 넣어 두면 임시휴무는 하루 한 번 자동 반영되고, 여기 적은 날짜가 항상 우선합니다.">
        <textarea
          className="field__mono"
          rows={5}
          value={venue.closedDates}
          onChange={(event) => update(venue.key, (item) => ({ ...item, closedDates: event.target.value }))}
        />
      </Field>
    </div>
  );
}

function LayoutTab({ venue, onClear }: { venue: VenueDraft; onClear: () => void }) {
  const units = (venue.layout as { units?: unknown[] } | null)?.units;

  return (
    <div className="form">
      <p>
        {Array.isArray(units)
          ? `좌표 ${units.length}개 — 저장할 때 그대로 보존됩니다.`
          : '없음 — 이 매장은 그리드 보기만 제공합니다.'}
      </p>
      <p className="field__hint">
        이 등록기는 배치도 좌표를 편집하지 않습니다. 배치도를 넣으려면 venues.json 의 layout 항목을 직접
        작성하세요. 지금 멀티뷰는 배치도 보기를 쓰지 않습니다.
      </p>
      {Array.isArray(units) && (
        <button type="button" className="btn" onClick={onClear}>
          이 매장의 배치도 지우기
        </button>
      )}
    </div>
  );
}

function CheckTab({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return <p className="check check--ok">문제 없습니다.</p>;
  }

  return (
    <ul className="check">
      {issues.map((issue, index) => (
        <li key={index} className={issue.error ? 'check__error' : 'check__warn'}>
          <span className="check__mark">{issue.error ? '고쳐야 함' : '확인'}</span>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
