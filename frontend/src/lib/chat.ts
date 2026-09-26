/**
 * YouTube's embedded live chat. It reads fine, but typing into it needs the viewer's
 * YouTube sign-in, which browsers (WebKit above all) withhold from a youtube.com frame
 * inside another site (WebKit - every iPhone browser - and Chrome's incognito never
 * pass it on). So in a browser the embedded chat is read-only and writing happens in
 * YouTube's own chat window. The desktop shell's chat is a webview of its own, where
 * signing in works.
 */
export function embeddedChatUrl(videoId: string): string {
  const params = new URLSearchParams({ v: videoId, embed_domain: window.location.hostname, dark_theme: '1' });
  return `https://www.youtube.com/live_chat?${params}`;
}

/**
 * Google's sign-in for YouTube, landing on this broadcast's own chat window once done -
 * the same route YouTube's "sign in to chat" link takes, but ending at the chat rather
 * than the watch page. Already signed in, it passes straight through to the chat.
 */
export function chatSignInUrl(videoId: string): string {
  const chat = `/live_chat?${new URLSearchParams({ is_popout: '1', v: videoId })}`;
  const signedIn = `https://www.youtube.com/signin?${new URLSearchParams({ action_handle_signin: 'true', next: chat })}`;
  const params = new URLSearchParams({ service: 'youtube', passive: 'true', continue: signedIn });
  return `https://accounts.google.com/ServiceLogin?${params}`;
}

/** YouTube's chat for this broadcast in a window of its own (a tab, on a phone). */
export function openYouTubeChat(videoId: string): void {
  window.open(chatSignInUrl(videoId), 'taiko-chat', 'popup=yes,width=420,height=720');
}
