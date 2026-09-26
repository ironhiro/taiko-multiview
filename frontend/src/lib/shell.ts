/**
 * The desktop shell's side of the page, when there is one.
 *
 * Tauri exposes its IPC on window.__TAURI_INTERNALS__; reaching it directly keeps the
 * web build free of a Tauri dependency, and in a browser the object simply is not there.
 */

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const internals = (window as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;

export const isDesktopShell = typeof internals?.invoke === 'function';

export interface OpenedSettings {
  path: string;
  text: string;
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!internals?.invoke) {
    return Promise.reject(new Error('데스크톱 앱에서만 쓸 수 있습니다.'));
  }
  return internals.invoke(command, args) as Promise<T>;
}

/** The backend's settings file: found near the app, or picked when `pick` is set. Null when cancelled. */
export const openSettings = (pick: boolean) => invoke<OpenedSettings | null>('editor_open', { pick });

/** Saves over the file last opened - the shell refuses any other. */
export const saveSettings = (text: string) => invoke<void>('editor_save', { text });

/** A www.youtube.com page or feed as text; the shell fetches nothing else. */
export const shellFetch = (url: string) => invoke<string>('editor_fetch', { url });
