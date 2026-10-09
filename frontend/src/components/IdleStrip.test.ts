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

describe('TagChip and LiveBadge', () => {
  it('reads 미등록 unless told otherwise', () => {
    expect(renderToStaticMarkup(createElement(TagChip))).toContain('>미등록</span>');
    expect(renderToStaticMarkup(createElement(TagChip, { label: '점검' }))).toContain('>점검</span>');
  });

  it('says LIVE', () => {
    expect(renderToStaticMarkup(createElement(LiveBadge))).toBe('<span class="tile__badge">LIVE</span>');
  });
});
