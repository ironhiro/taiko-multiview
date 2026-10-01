import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArcadeButton, ArcadeLink, arcadeClassName, resolveArcadeContent } from './ArcadeButton';

const icon = createElement('svg', { className: 'icon' });

describe('resolveArcadeContent', () => {
  it('is icon and words with an icon, words alone without one', () => {
    expect(resolveArcadeContent(icon)).toBe('icon+text');
    expect(resolveArcadeContent(undefined)).toBe('text');
  });

  it('keeps the words when icon-only is asked for with no icon to show', () => {
    expect(resolveArcadeContent(undefined, 'icon-only')).toBe('text');
    expect(resolveArcadeContent(icon, 'icon-only')).toBe('icon-only');
    expect(resolveArcadeContent(icon, 'text')).toBe('text');
  });
});

describe('arcadeClassName', () => {
  it("marks the icon-only face and keeps the caller's own class", () => {
    expect(arcadeClassName('icon+text', 'tile__control')).toBe('arcade-button tile__control');
    expect(arcadeClassName('icon-only')).toBe('arcade-button arcade-button--icon-only');
  });
});

describe('ArcadeButton', () => {
  it('is a toggle only when told what was chosen', () => {
    expect(renderToStaticMarkup(createElement(ArcadeButton, { label: '새로고침' }))).not.toContain('aria-pressed');
    const chosen = renderToStaticMarkup(createElement(ArcadeButton, { label: '소리 켜짐', icon, chosen: true }));
    expect(chosen).toContain('aria-pressed="true"');
    expect(chosen).toContain('<span class="arcade-button__text">소리 켜짐</span>');
    expect(chosen).toContain('type="button"');
  });

  it("keeps an icon-only face's words as its name", () => {
    const html = renderToStaticMarkup(createElement(ArcadeButton, { label: '음소거', icon, content: 'icon-only' }));
    expect(html).toContain('aria-label="음소거"');
    expect(html).not.toContain('arcade-button__text');
  });

  it('lets a given name stand over the words', () => {
    const html = renderToStaticMarkup(
      createElement(ArcadeButton, { label: '음소거', icon, 'aria-label': 'A1 소리 듣기' }),
    );
    expect(html).toContain('aria-label="A1 소리 듣기"');
  });
});

describe('ArcadeLink', () => {
  it('is a plain link dressed as the button, never pressed', () => {
    const html = renderToStaticMarkup(createElement(ArcadeLink, { label: '채팅', icon, href: 'https://example.test/' }));
    expect(html).toMatch(/^<a class="arcade-button"/);
    expect(html).not.toContain('aria-pressed');
    expect(html).toContain('href="https://example.test/"');
  });
});
