import type { BrowserContext, Locator, Page } from '@playwright/test';

/**
 * A tile's chat: its links, and stand-ins for what they open - window.open on the wall, and
 * YouTube in a tab the page opens - so nothing reaches the network.
 */

/** Every chat link in `scope`; a tile's own reads "<label> 유튜브 채팅 열기". */
export function chatLinks(scope: Page | Locator): Locator {
  return scope.getByRole('link', { name: /유튜브 채팅 열기/ });
}

/** Written out rather than taken from lib/youtube.ts, so a change there has to agree with this. */
export function chatSignInUrl(videoId: string): string {
  return `https://www.youtube.com/signin?action_handle_signin=true&next=%2Flive_chat%3Fis_popout%3D1%26v%3D${videoId}`;
}

export type WindowOpenCall = [url: string, target: string, features: string];

/** What recordWindowOpen hands back for a window: enough of one for the page to use. */
export interface FakeWindow {
  opener: unknown;
  closed: boolean;
  focusCount: number;
}

declare global {
  /** The fake windows recordWindowOpen has handed out, read from inside the page. */
  function fakeWindows(): FakeWindow[];
}

/**
 * Stands in for window.open from the page's first script: each call is noted, and
 * answered with a fake window or, as a popup blocker would, with null. Returns the calls so far.
 */
export async function recordWindowOpen(page: Page, answer: 'window' | 'blocked'): Promise<() => Promise<WindowOpenCall[]>> {
  await page.addInitScript((answer) => {
    const calls: unknown[][] = [];
    const opened: FakeWindow[] = [];
    Object.assign(window, { openCalls: calls, fakeWindows: () => opened });
    window.open = ((...args: unknown[]) => {
      calls.push(args);
      if (answer === 'blocked') {
        return null;
      }
      // A real new window starts out with this page as its opener.
      const popup = {
        opener: window as unknown,
        closed: false,
        focusCount: 0,
        focus() {
          popup.focusCount += 1;
        },
      };
      opened.push(popup);
      return popup as unknown as Window;
    }) as typeof window.open;
  }, answer);
  return () => page.evaluate(() => ((window as { openCalls?: WindowOpenCall[] }).openCalls ?? []) as WindowOpenCall[]);
}

/** A tab the page opens is outside offline(): answer youtube.com there without the network. */
export async function answerYouTube(context: BrowserContext) {
  await context.route(/youtube\.com|google\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>YouTube</title>' }),
  );
}
