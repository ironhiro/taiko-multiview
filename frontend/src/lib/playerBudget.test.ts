import { describe, expect, it, vi } from 'vitest';
import { createPlayerBudget } from './playerBudget';

describe('createPlayerBudget', () => {
  it('keeps a hidden player while there is room', () => {
    const budget = createPlayerBudget(2);
    const evict = vi.fn();
    budget.claim('a', evict);
    budget.hide('a');
    budget.claim('b', vi.fn());

    expect(budget.holders()).toEqual(['a', 'b']);
    expect(evict).not.toHaveBeenCalled();
  });

  it('gives up the player hidden longest when over budget', () => {
    let clock = 0;
    const budget = createPlayerBudget(2, () => clock);
    const evicted: string[] = [];
    const claim = (key: string) => budget.claim(key, () => evicted.push(key));

    claim('a');
    claim('b');
    clock = 1;
    budget.hide('a');
    clock = 2;
    budget.hide('b');
    claim('c');

    expect(evicted).toEqual(['a']);
    expect(budget.holders()).toEqual(['b', 'c']);
  });

  it('never takes a player that is on screen', () => {
    const budget = createPlayerBudget(1);
    const evict = vi.fn();
    budget.claim('a', evict);
    budget.claim('b', vi.fn());

    expect(evict).not.toHaveBeenCalled();
    expect(budget.holders()).toEqual(['a', 'b']);

    // Once one leaves, the budget catches up.
    budget.hide('a');
    expect(evict).toHaveBeenCalledOnce();
    expect(budget.holders()).toEqual(['b']);
  });

  it('a returning tile claims its player again rather than a second one', () => {
    const budget = createPlayerBudget(2);
    budget.claim('a', vi.fn());
    budget.hide('a');
    budget.claim('a', vi.fn());

    expect(budget.holders()).toEqual(['a']);
  });
});
