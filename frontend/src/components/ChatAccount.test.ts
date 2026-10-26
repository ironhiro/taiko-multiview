import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// api.ts, under the sign-in's address, reads the desktop shell's base from `window` as it
// loads; the unit tests run in Node.
vi.stubGlobal('window', {});
let ChatSignIn: typeof import('./ChatAccount').ChatSignIn;
beforeAll(async () => {
  ({ ChatSignIn } = await import('./ChatAccount'));
});

const signIn = (signInFailed = false) =>
  renderToStaticMarkup(createElement(ChatSignIn, { signInFailed, onSignIn: () => {} }));

describe('ChatSignIn', () => {
  it('is a link to the sign-in that Safari still reaches with Tab', () => {
    const anchor = /<a [^>]*data-testid="chat-account-signin"[^>]*>/.exec(signIn())?.[0] ?? '';
    // Still a link, so a middle click or "open in new tab" works as on any link ...
    expect(anchor).toContain('href="/api/auth/login"');
    // ... and named in the Tab order, which Safari keeps links out of by default.
    expect(anchor).toContain('tabindex="0"');
  });

  it('says why it failed only when it did', () => {
    expect(signIn()).not.toContain('chat-account-failed');
    expect(signIn(true)).toContain('chat-account-failed');
  });
});

describe('the sign-in lead', () => {
  it('wraps into balanced lines, so the last is not one word left over', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const rule = /\.chat-account__lead \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/text-wrap: balance;/);
    expect(rule).toMatch(/word-break: keep-all;/);
    expect(rule).toMatch(/max-width: 16rem;/);
  });
});
