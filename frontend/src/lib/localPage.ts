/**
 * Whether this page is served from this machine: the Vite dev server, or the desktop
 * shell's bundled build (tauri://localhost on macOS, http://tauri.localhost on Windows).
 * The venue editor is offered only here - it edits a file the deployed server never reads.
 */
export function isLocalPage({ protocol, hostname }: Pick<Location, 'protocol' | 'hostname'>): boolean {
  return (
    protocol === 'tauri:' ||
    hostname === 'localhost' ||
    hostname === 'tauri.localhost' ||
    hostname === '[::1]' ||
    /^127\./.test(hostname)
  );
}
