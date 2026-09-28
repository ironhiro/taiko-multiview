import { describe, expect, it } from 'vitest';
import { brokenEmbedLabels, isDrilled } from './embedFailureDrill';

describe('brokenEmbedLabels', () => {
  it('is empty without the parameter, so an ordinary address drills nothing', () => {
    expect(brokenEmbedLabels('?venue=mock-1&view=all-grid').size).toBe(0);
    expect(brokenEmbedLabels('').size).toBe(0);
  });

  it('reads a list of labels, however they are written', () => {
    expect([...brokenEmbedLabels('?breakEmbed=a1,%20THE%20BASE')]).toEqual(['A1', 'THEBASE']);
  });
});

describe('isDrilled', () => {
  it('leaves a tile nobody named alone', () => {
    expect(isDrilled('A2', brokenEmbedLabels('?breakEmbed=A1'))).toBe(false);
    expect(isDrilled('A1', brokenEmbedLabels('?venue=mock-1'))).toBe(false);
  });

  it('names a tile the way the wall labels it', () => {
    expect(isDrilled('A1', brokenEmbedLabels('?breakEmbed=A1,A2'))).toBe(true);
    expect(isDrilled('THE BASE', brokenEmbedLabels('?breakEmbed=the-base'))).toBe(true);
  });

  it('takes in every tile on the wall for "all"', () => {
    const broken = brokenEmbedLabels('?breakEmbed=all');
    expect(isDrilled('A1', broken)).toBe(true);
    expect(isDrilled('C3', broken)).toBe(true);
  });
});
