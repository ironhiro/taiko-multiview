import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHONE_LAYOUT_QUERY } from './media';

// Read from disk: Vitest hands a test an empty string for a stylesheet it imports.
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('PHONE_LAYOUT_QUERY', () => {
  it('is the query the stylesheet lays out a phone by, word for word', () => {
    // The venue row folds where the phone rules apply: an 840px phone block with an 820px
    // query here would leave a row too wide for the page between the two.
    expect(styles).toContain(`@media ${PHONE_LAYOUT_QUERY} {`);
  });
});
