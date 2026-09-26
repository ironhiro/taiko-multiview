/**
 * Runs a task until it succeeds, waiting longer after each failure.
 *
 * Built for the venue list: without it, one failed or stalled `/api/venues` at start left
 * the wall empty for good, because nothing asked again. The waits double from
 * RETRY_FIRST_DELAY_MS up to RETRY_MAX_DELAY_MS. A wait that ends while the page is hidden
 * holds the next try until the page is visible again, so a tab left in the background
 * does not keep calling a server that is down.
 *
 * Plain setTimeout and an injected visibility source, so a test can fake both.
 */
export const RETRY_FIRST_DELAY_MS = 2_000;
export const RETRY_MAX_DELAY_MS = 30_000;

/** The wait before the next try, after `failures` failed tries in a row (1 or more). */
export function retryDelayMs(failures: number): number {
  const doubled = RETRY_FIRST_DELAY_MS * 2 ** Math.max(0, failures - 1);
  return Math.min(RETRY_MAX_DELAY_MS, doubled);
}

interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
}

export interface RetryHandle {
  /** Try at once, skipping the rest of the wait. Does nothing while a try is running or after success. */
  now: () => void;
  /** Give up: abort the running try, clear the wait and stop listening. */
  stop: () => void;
}

export interface RetryOptions {
  visibility: VisibilitySource;
  /** A try failed; the next one comes after `delayMs` (or later, if the page is hidden then). */
  onFailure?: (cause: unknown, failures: number, delayMs: number) => void;
}

export function retryUntilDone(task: (signal: AbortSignal) => Promise<void>, options: RetryOptions): RetryHandle {
  const { visibility, onFailure } = options;
  let failures = 0;
  let finished = false;
  let running: AbortController | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  let waitingForVisible = false;

  const onVisibilityChange = () => {
    if (waitingForVisible && visibility.visibilityState !== 'hidden') {
      stopWaitingForVisible();
      void attempt();
    }
  };

  const stopWaitingForVisible = () => {
    if (waitingForVisible) {
      waitingForVisible = false;
      visibility.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };

  const attemptWhenVisible = () => {
    waitTimer = undefined;
    if (visibility.visibilityState === 'hidden') {
      waitingForVisible = true;
      visibility.addEventListener('visibilitychange', onVisibilityChange);
    } else {
      void attempt();
    }
  };

  const attempt = async () => {
    if (finished || running) {
      return;
    }
    const controller = new AbortController();
    running = controller;
    try {
      await task(controller.signal);
      if (!controller.signal.aborted) {
        finished = true;
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        failures += 1;
        const delayMs = retryDelayMs(failures);
        onFailure?.(cause, failures, delayMs);
        waitTimer = setTimeout(attemptWhenVisible, delayMs);
      }
    } finally {
      if (running === controller) {
        running = null;
      }
    }
  };

  // The first try goes out at once, hidden or not: a page opened in a background tab
  // should still have its venues when it is brought forward.
  void attempt();

  return {
    now() {
      if (finished || running) {
        return;
      }
      clearTimeout(waitTimer);
      waitTimer = undefined;
      stopWaitingForVisible();
      void attempt();
    },
    stop() {
      finished = true;
      clearTimeout(waitTimer);
      stopWaitingForVisible();
      running?.abort();
      running = null;
    },
  };
}
