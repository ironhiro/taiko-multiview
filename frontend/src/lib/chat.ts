/**
 * YouTube live chat, in the two forms the app uses.
 *
 * The embedded chat reads fine, but typing into it needs the viewer's YouTube sign-in,
 * and browsers (WebKit above all) withhold that from a youtube.com frame inside another
 * site. The pop-out is youtube.com itself, so signing in works there - that is where
 * messages get written. In the desktop shell, window.open on a chat URL becomes an app
 * window instead of a browser tab.
 */

export function embeddedChatUrl(videoId: string): string {
  const params = new URLSearchParams({ v: videoId, embed_domain: window.location.hostname, dark_theme: '1' });
  return `https://www.youtube.com/live_chat?${params}`;
}

export function popoutChatUrl(videoId: string): string {
  const params = new URLSearchParams({ is_popout: '1', v: videoId });
  return `https://www.youtube.com/live_chat?${params}`;
}

/** One named window, so opening another tile's chat reuses it rather than stacking. */
export function openChatWindow(videoId: string): void {
  window.open(popoutChatUrl(videoId), 'taiko-chat', 'popup=yes,width=420,height=720');
}
