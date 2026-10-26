import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdleStrip } from './IdleStrip';
import { LiveBadge } from './LiveBadge';
import { TagChip } from './TagChip';

const named = (...labels: string[]) => labels.map((label) => ({ id: label.toLowerCase(), label }));

const chipsOf = (html: string) =>
  (html.match(/<li class="idle-chip"[^>]*>[^<]*<\/li>/g) ?? []).map((chip) => chip.replace(/<[^>]+>/g, ''));

describe('IdleStrip', () => {
  it('says 방송 없음 and names each cabinet as a chip, in order', () => {
    const html = renderToStaticMarkup(createElement(IdleStrip, { cabinets: named('B3', 'B4', 'C1') }));
    expect(html).toContain('<span class="idle-strip__title">방송 없음</span>');
    expect(chipsOf(html)).toEqual(['B3', 'B4', 'C1']);
    expect(html).toContain('aria-label="방송 없음 3대"');
  });

  it('is not there at all with no cabinet to name', () => {
    expect(renderToStaticMarkup(createElement(IdleStrip, { cabinets: [] }))).toBe('');
  });

  it('keeps chips apart when two cabinets share a label', () => {
    expect(chipsOf(renderToStaticMarkup(createElement(IdleStrip, { cabinets: named('A1', 'A1') })))).toEqual(['A1', 'A1']);
  });

  it('is a list of names to read, not to press, unless 다시보기 is offered', () => {
    expect(renderToStaticMarkup(createElement(IdleStrip, { cabinets: named('B3') }))).not.toContain('<button');
  });

  it("offering 다시보기 makes each chip a button named for its cabinet's last broadcast", () => {
    const html = renderToStaticMarkup(createElement(IdleStrip, { cabinets: named('B3', 'C1'), onOpenReplay: () => {} }));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('aria-label="B3 지난 방송 보기"');
    expect(html).toContain('<span class="idle-chip__name">C1</span>');
  });
});

describe('IdleStrip, with cabinets hidden from the wall', () => {
  it('counts them at the end of the line, with 편집 to bring them back', () => {
    const html = renderToStaticMarkup(
      createElement(IdleStrip, { cabinets: named('B3'), hidden: { count: 2, onEdit: () => {} } }),
    );
    expect(html).toContain('숨긴 기체 <span class="idle-strip__count">2</span>');
    expect(html).toContain('aria-label="숨긴 기체 2대 편집"');
    // The count's 편집 is no cabinet: it is not one of the chips.
    expect(chipsOf(html)).toEqual(['B3']);
  });

  it('stands alone when every cabinet is on air', () => {
    const html = renderToStaticMarkup(createElement(IdleStrip, { cabinets: [], hidden: { count: 1, onEdit: () => {} } }));
    expect(html).toContain('aria-label="숨긴 기체 1대"');
    expect(html).not.toContain('방송 없음');
  });

  it('says nothing of a count of none', () => {
    expect(renderToStaticMarkup(createElement(IdleStrip, { cabinets: [], hidden: { count: 0, onEdit: () => {} } }))).toBe('');
  });

  it('while the wall is arranged, each chip hides or shows its cabinet, hidden ones dimmed', () => {
    const html = renderToStaticMarkup(
      createElement(IdleStrip, {
        cabinets: named('B3', 'C1'),
        onOpenReplay: () => {},
        editing: { isHidden: (id: string) => id === 'c1', onToggleHidden: () => {} },
      }),
    );
    expect(html).toContain('aria-label="B3 숨기기"');
    expect(html).toContain('aria-label="C1 다시 보이기"');
    expect(html.match(/idle-chip--hidden/g)).toHaveLength(1);
    expect(html).not.toContain('지난 방송 보기');
  });
});

describe('TagChip and LiveBadge', () => {
  it('reads 미등록 unless told otherwise', () => {
    expect(renderToStaticMarkup(createElement(TagChip))).toContain('>미등록</span>');
    expect(renderToStaticMarkup(createElement(TagChip, { label: '점검' }))).toContain('>점검</span>');
  });

  it('says LIVE', () => {
    expect(renderToStaticMarkup(createElement(LiveBadge))).toBe('<span class="tile__badge">LIVE</span>');
  });
});
