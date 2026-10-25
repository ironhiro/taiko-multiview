import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveBadge } from './LiveBadge';

describe('LiveBadge', () => {
  it('says LIVE', () => {
    expect(renderToStaticMarkup(createElement(LiveBadge))).toBe('<span class="tile__badge">LIVE</span>');
  });
});
