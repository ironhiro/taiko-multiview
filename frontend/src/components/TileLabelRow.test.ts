import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatViewers, TileLabelRow } from './TileLabelRow';

const row = (props: Partial<Parameters<typeof TileLabelRow>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TileLabelRow, {
      cabinet: 'THE BASE 2',
      live: true,
      sound: 'off',
      onToggleSound: () => {},
      ...props,
    }),
  );

// The row measures itself in a layout effect (lib/rowFit.ts), which a server render skips
// and React warns about; what is checked here is the markup.
const realError = console.error;
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) {
      realError(...args);
    }
  });
});
afterAll(() => vi.restoreAllMocks());

describe('formatViewers', () => {
  it('writes the count the Korean way, with its unit', () => {
    expect(formatViewers(12345)).toBe('12,345명');
    expect(formatViewers(0)).toBe('0명');
  });
});

describe('TileLabelRow', () => {
  it('reads cabinet, tag, LIVE, viewers, then the controls', () => {
    const html = row({ tag: true, viewers: 12345, chat: createElement('a', { className: 'chat' }, '채팅') });
    const order = ['tile__label', 'tile__tag', 'tile__badge', 'tile__viewers', 'tile__controls', 'class="chat"'].map(
      (part) => html.indexOf(part),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('title="THE BASE 2"');
    expect(html).toContain('12,345명');
    expect(html).toContain('미등록');
  });

  it('leaves out what is not there: no tag, no LIVE, no count', () => {
    const html = row({ live: false });
    expect(html).not.toContain('tile__tag');
    expect(html).not.toContain('tile__badge');
    expect(html).not.toContain('tile__viewers');
  });

  it('turns the sound button 카 when the tile has the sound, and names it by the cabinet', () => {
    const off = row();
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('aria-label="THE BASE 2 소리 듣기"');
    expect(off).toContain('>음소거</span>');

    const on = row({ sound: 'on' });
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('aria-label="THE BASE 2 소리 끄기"');
    expect(on).toContain('>소리 켜짐</span>');
  });

  it('disables the sound button while there is no player', () => {
    expect(row({ soundDisabled: true })).toMatch(/<button[^>]*disabled=""/);
  });
});
