import { describe, expect, it } from 'vitest';
import { chatSignInUrl } from './chat';

describe('chatSignInUrl', () => {
  it('signs in to YouTube and lands on the broadcast chat', () => {
    const url = new URL(chatSignInUrl('abc123'));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('service')).toBe('youtube');

    const signedIn = new URL(url.searchParams.get('continue')!);
    expect(signedIn.href.startsWith('https://www.youtube.com/signin?')).toBe(true);
    expect(signedIn.searchParams.get('next')).toBe('/live_chat?is_popout=1&v=abc123');
  });
});
