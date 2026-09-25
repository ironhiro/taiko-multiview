/**
 * The desktop shell's side of the page, when there is one.
 *
 * Tauri exposes its IPC on window.__TAURI_INTERNALS__; reaching it directly keeps the
 * web build free of a Tauri dependency, and in a browser the object simply is not there.
 */

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const internals = (window as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;

export const isDesktopShell = typeof internals?.invoke === 'function';

export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shows the chat as a native webview over the given bounds, or closes it when called
 * with no video. Rejects when the shell lacks the command (an older build).
 */
export function showNativeChat(videoId: string | null, bounds: PanelBounds | null): Promise<unknown> {
  if (!internals?.invoke) {
    return Promise.reject(new Error('not running in the desktop shell'));
  }

  return internals.invoke('chat_panel', { videoId, bounds });
}
