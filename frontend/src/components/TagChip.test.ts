import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TagChip } from './TagChip';

describe('TagChip', () => {
  it('reads 미등록 unless told otherwise', () => {
    expect(renderToStaticMarkup(createElement(TagChip))).toContain('>미등록</span>');
    expect(renderToStaticMarkup(createElement(TagChip, { label: '점검' }))).toContain('>점검</span>');
  });
});
