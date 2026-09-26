import { describe, expect, it, vi } from 'vitest';
import { createPlayerBudget } from './playerBudget';

describe('createPlayerBudget', () => {
  it('keeps a parked player while there is room', () => {
    const budget = createPlayerBudget(2);
    const evict = vi.fn();
    budget.claim('a', evict);
    budget.park('a', evict);
    budget.claim('b', vi.fn());

    expect(budget.holders()).toEqual(['a', 'b']);
    expect(evict).not.toHaveBeenCalled();
  });

  it('gives up the player parked longest when over budget', () => {
    let clock = 0;
    const budget = createPlayerBudget(2, () => clock);
    const evicted: string[] = [];
    const evictOf = (key: string) => () => evicted.push(key);

    budget.claim('a', evictOf('a'));
    budget.claim('b', evictOf('b'));
    clock = 1;
    budget.park('a', evictOf('a'));
    clock = 2;
    budget.park('b', evictOf('b'));
    budget.claim('c', evictOf('c'));

    expect(evicted).toEqual(['a']);
    expect(budget.holders()).toEqual(['b', 'c']);
  });

  it('never takes the player of a tile that holds a slot', () => {
    const budget = createPlayerBudget(1);
    const evict = vi.fn();
    budget.claim('a', evict);
    budget.claim('b', vi.fn());

    expect(evict).not.toHaveBeenCalled();
    expect(budget.holders()).toEqual(['a', 'b']);

    // Once one loses its slot, the budget catches up.
    budget.park('a', evict);
    expect(evict).toHaveBeenCalledOnce();
    expect(budget.holders()).toEqual(['b']);
  });

  it('a tile getting its slot back claims its player again rather than a second one', () => {
    const budget = createPlayerBudget(2);
    budget.claim('a', vi.fn());
    budget.park('a', vi.fn());
    budget.claim('a', vi.fn());

    expect(budget.holders()).toEqual(['a']);
  });

  it('enrolls a parked player it did not hold, and takes it when room is needed', () => {
    // A tile built its player on a desktop, outside the budget, before the window narrowed.
    let clock = 0;
    const budget = createPlayerBudget(1, () => clock);
    const desktop = vi.fn();
    budget.park('desktop', desktop);
    expect(budget.holders()).toEqual(['desktop']);

    clock = 1;
    budget.claim('b', vi.fn());
    expect(desktop).toHaveBeenCalledOnce();
    expect(budget.holders()).toEqual(['b']);
  });

  it('parking twice keeps the first time, so a tile does not jump the queue', () => {
    let clock = 0;
    const budget = createPlayerBudget(2, () => clock);
    const evicted: string[] = [];
    budget.park('a', () => evicted.push('a'));
    clock = 1;
    budget.park('b', () => evicted.push('b'));
    clock = 2;
    budget.park('a', () => evicted.push('a'));
    budget.claim('c', vi.fn());

    expect(evicted).toEqual(['a']);
  });
});
