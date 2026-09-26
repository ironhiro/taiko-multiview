import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryDelayMs, retryUntilDone, RETRY_MAX_DELAY_MS } from './retry';

function fakeDocument() {
  const handlers = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: 'visibilitychange', handler: () => void) => handlers.add(handler),
    removeEventListener: (_: 'visibilitychange', handler: () => void) => handlers.delete(handler),
    show(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      handlers.forEach((handler) => handler());
    },
    handlers,
  };
  return doc;
}

/** A task that fails its first `failures` tries and then succeeds, counting every try. */
function flakyTask(failures: number) {
  const task = vi.fn(async () => {
    if (task.mock.calls.length <= failures) {
      throw new Error('백엔드 응답 오류 (500)');
    }
  });
  return task;
}

describe('retryDelayMs', () => {
  it('doubles from two seconds and stops at thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(retryDelayMs(1000)).toBe(RETRY_MAX_DELAY_MS);
  });
});

describe('retryUntilDone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tries again after each failure, waiting longer each time, and stops on success', async () => {
    const task = flakyTask(3);
    const onFailure = vi.fn();
    retryUntilDone(task, { visibility: fakeDocument(), onFailure });

    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8000);
    expect(task).toHaveBeenCalledTimes(4);

    expect(onFailure.mock.calls.map(([, failures, delayMs]) => [failures, delayMs])).toEqual([
      [1, 2000],
      [2, 4000],
      [3, 8000],
    ]);

    // Succeeded on the fourth: nothing more, however long we wait.
    await vi.advanceTimersByTimeAsync(10 * RETRY_MAX_DELAY_MS);
    expect(task).toHaveBeenCalledTimes(4);
  });

  it('holds a try that falls due while the page is hidden until it is visible again', async () => {
    const doc = fakeDocument();
    const task = flakyTask(1);
    retryUntilDone(task, { visibility: doc });
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    doc.show('hidden');
    await vi.advanceTimersByTimeAsync(10 * RETRY_MAX_DELAY_MS);
    expect(task).toHaveBeenCalledTimes(1);

    doc.show('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
    expect(doc.handlers.size).toBe(0);
  });

  it('tries at once when asked, instead of waiting out the delay', async () => {
    const task = flakyTask(1);
    const retry = retryUntilDone(task, { visibility: fakeDocument() });
    await vi.advanceTimersByTimeAsync(0);

    retry.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);

    // Done: neither the old wait nor another request tries again.
    retry.now();
    await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('asking for a try while one is running does not start a second', async () => {
    let finish: () => void = () => {};
    const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const retry = retryUntilDone(task, { visibility: fakeDocument() });

    retry.now();
    retry.now();
    expect(task).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('stop aborts the running try and cancels the next', async () => {
    const signals: AbortSignal[] = [];
    const task = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_, reject) => {
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const onFailure = vi.fn();
    const retry = retryUntilDone(task, { visibility: fakeDocument(), onFailure });

    retry.stop();
    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * RETRY_MAX_DELAY_MS);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('stop during a hidden wait lets go of the page', async () => {
    const doc = fakeDocument();
    const retry = retryUntilDone(flakyTask(5), { visibility: doc });
    await vi.advanceTimersByTimeAsync(0);
    doc.show('hidden');
    await vi.advanceTimersByTimeAsync(2000);
    expect(doc.handlers.size).toBe(1);

    retry.stop();
    expect(doc.handlers.size).toBe(0);
  });
});
