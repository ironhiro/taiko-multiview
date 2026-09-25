import { describe, expect, it } from 'vitest';
import { isLocalPage } from './localPage';

const at = (href: string) => {
  const url = new URL(href);
  return isLocalPage({ protocol: url.protocol, hostname: url.hostname });
};

describe('isLocalPage', () => {
  it('accepts the dev server and the bundled build', () => {
    expect(at('http://localhost:5173/?screen=editor')).toBe(true);
    expect(at('http://127.0.0.1:5173/')).toBe(true);
    expect(at('http://[::1]:5173/')).toBe(true);
    expect(at('tauri://localhost/index.html')).toBe(true);
    expect(at('http://tauri.localhost/index.html')).toBe(true);
  });

  it('refuses the deployed site and look-alikes', () => {
    expect(at('https://taiko-multiview.azurestaticapps.net/?screen=editor')).toBe(false);
    expect(at('https://localhost.example.com/')).toBe(false);
    expect(at('http://192.168.0.10:5173/')).toBe(false);
  });
});
