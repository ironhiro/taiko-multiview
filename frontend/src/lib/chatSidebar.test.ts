import { describe, expect, it, vi } from 'vitest';
import type { LiveStream } from './types';
import type { WallTile } from './wallTiles';
import {
  CHAT_AFTER_SIGN_IN_KEY,
  CHAT_AFTER_SIGN_IN_MS,
  chatAfterSignIn,
  chatPlacement,
  chatTileOf,
  embeddedChatUrl,
  forgetChatAfterSignIn,
  readChatView,
  rememberChatForSignIn,
  signInFailedIn,
  storeChatView,
  watchReturn,
  withoutSignInFailed,
} from './chatSidebar';

const onAir = (id: string, videoId = `v-${id}`): WallTile => ({
  id,
  label: id.toUpperCase(),
  stream: { stationId: id, videoId, title: '', name: id, isLive: true, embeddable: true, watchUrl: '' } as LiveStream,
  unregistered: false,
});
const empty = (id: string): WallTile => ({ id, label: id.toUpperCase(), stream: undefined, unregistered: false });

describe('embeddedChatUrl', () => {
  it("is YouTube's chat for a frame on this site, in the dark theme", () => {
    expect(embeddedChatUrl('abc123', 'taiko.example')).toBe(
      'https://www.youtube.com/live_chat?v=abc123&embed_domain=taiko.example&dark_theme=1',
    );
  });

  it('is not the pop-out chat', () => {
    expect(new URL(embeddedChatUrl('abc123', 'localhost')).searchParams.has('is_popout')).toBe(false);
  });

  it('keeps an id with URL-special characters intact', () => {
    expect(new URL(embeddedChatUrl('a-b_c&d', 'localhost')).searchParams.get('v')).toBe('a-b_c&d');
  });
});

describe('chatPlacement', () => {
  it('docks the chat beside the wall in a wide browser window', () => {
    expect(chatPlacement({ compact: false, desktopShell: false, wide: true })).toBe('sidebar');
  });

  it('keeps the popup in a narrower browser window', () => {
    expect(chatPlacement({ compact: false, desktopShell: false, wide: false })).toBe('popup');
  });

  it('keeps the popup in the desktop shell, however wide', () => {
    expect(chatPlacement({ compact: false, desktopShell: true, wide: true })).toBe('popup');
    expect(chatPlacement({ compact: false, desktopShell: true, wide: false })).toBe('popup');
  });

  it("keeps a phone's or tablet's link to the broadcast's page, however wide", () => {
    for (const desktopShell of [false, true]) {
      for (const wide of [false, true]) {
        expect(chatPlacement({ compact: true, desktopShell, wide })).toBe('tab');
      }
    }
  });
});

describe('chatTileOf', () => {
  const wall = [onAir('a1'), empty('a2'), onAir('a3')];

  it('finds the tile on the wall with the broadcast', () => {
    expect(chatTileOf(wall, { tileId: 'a3', videoId: 'v-a3' })?.id).toBe('a3');
  });

  it('finds none with no chat open', () => {
    expect(chatTileOf(wall, null)).toBeUndefined();
  });

  it('finds none once the broadcast is off the wall: ended, or another venue or view', () => {
    expect(chatTileOf(wall, { tileId: 'b1', videoId: 'v-b1' })).toBeUndefined();
    expect(chatTileOf([], { tileId: 'a1', videoId: 'v-a1' })).toBeUndefined();
    expect(chatTileOf([empty('a1')], { tileId: 'a1', videoId: 'v-a1' })).toBeUndefined();
  });

  it('follows the broadcast: a new broadcast on the same cabinet is another chat', () => {
    expect(chatTileOf([onAir('a1', 'v-a1-part2')], { tileId: 'a1', videoId: 'v-a1' })).toBeUndefined();
  });

  it('tells apart two tiles with one broadcast, as the mock server has them', () => {
    const shared = [onAir('a1', 'same'), onAir('a2', 'same')];
    expect(chatTileOf(shared, { tileId: 'a2', videoId: 'same' })?.id).toBe('a2');
  });

  it('finds a cabinet the settings do not list yet, like any other', () => {
    const unlisted = { ...onAir('unmatched:new'), unregistered: true };
    expect(chatTileOf([...wall, unlisted], { tileId: 'unmatched:new', videoId: 'v-unmatched:new' })?.unregistered).toBe(
      true,
    );
  });
});

describe('watchReturn', () => {
  function fakePage() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const hide = (hidden: boolean) => {
      doc.visibilityState = hidden ? 'hidden' : 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    return { win, doc, hide, blur: () => win.dispatchEvent(new Event('blur')), focus: () => win.dispatchEvent(new Event('focus')) };
  }

  it('answers once the window has lost focus to the sign-in popup and taken it back', () => {
    const page = fakePage();
    const onReturn = vi.fn();
    watchReturn(page.win, page.doc, onReturn);

    page.focus();
    expect(onReturn).not.toHaveBeenCalled();
    page.blur();
    page.focus();
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('answers once, however often the viewer comes back after', () => {
    const page = fakePage();
    const onReturn = vi.fn();
    watchReturn(page.win, page.doc, onReturn);

    for (let i = 0; i < 3; i++) {
      page.blur();
      page.focus();
      page.hide(true);
      page.hide(false);
    }
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('counts a page hidden behind a new tab and shown again', () => {
    const page = fakePage();
    const onReturn = vi.fn();
    watchReturn(page.win, page.doc, onReturn);

    page.hide(true);
    expect(onReturn).not.toHaveBeenCalled();
    page.hide(false);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('says nothing once stopped', () => {
    const page = fakePage();
    const onReturn = vi.fn();
    const stop = watchReturn(page.win, page.doc, onReturn);

    stop();
    page.blur();
    page.focus();
    expect(onReturn).not.toHaveBeenCalled();
  });
});

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

// A browser that will not keep anything: storage off, or a private window's.
const refusing: Storage = {
  length: 0,
  clear: () => {},
  getItem: () => {
    throw new Error('SecurityError');
  },
  key: () => null,
  removeItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('the chat view', () => {
  it('is ours until YouTube is chosen, and kept for the session', () => {
    const storage = memoryStorage();
    expect(readChatView(storage)).toBe('ours');
    storeChatView(storage, 'youtube');
    expect(readChatView(storage)).toBe('youtube');
    storeChatView(storage, 'ours');
    expect(readChatView(storage)).toBe('ours');
  });

  it('is ours where there is no storage to keep it in', () => {
    expect(readChatView(undefined)).toBe('ours');
    expect(() => storeChatView(refusing, 'youtube')).not.toThrow();
    expect(readChatView(refusing)).toBe('ours');
  });
});

describe('the chat after a sign-in', () => {
  const chat = { tileId: 'a1', videoId: 'v-a1' };

  it('is the chat noted before the sign-in left, until forgotten', () => {
    const storage = memoryStorage();
    expect(chatAfterSignIn(storage, 1_000)).toBeNull();
    rememberChatForSignIn(storage, chat, 1_000);
    expect(chatAfterSignIn(storage, 61_000)).toEqual(chat);
    forgetChatAfterSignIn(storage);
    expect(chatAfterSignIn(storage, 61_000)).toBeNull();
  });

  it("is none once the sign-in's ten minutes are up, or from a clock gone back", () => {
    const storage = memoryStorage();
    rememberChatForSignIn(storage, chat, 1_000);
    expect(chatAfterSignIn(storage, 1_000 + CHAT_AFTER_SIGN_IN_MS)).toEqual(chat);
    expect(chatAfterSignIn(storage, 1_001 + CHAT_AFTER_SIGN_IN_MS)).toBeNull();
    expect(chatAfterSignIn(storage, 999)).toBeNull();
  });

  it('is none for a note it cannot read, or no storage', () => {
    const storage = memoryStorage();
    storage.setItem(CHAT_AFTER_SIGN_IN_KEY, '{not json');
    expect(chatAfterSignIn(storage, 0)).toBeNull();
    storage.setItem(CHAT_AFTER_SIGN_IN_KEY, JSON.stringify({ tileId: 1, videoId: 'v', at: 0 }));
    expect(chatAfterSignIn(storage, 0)).toBeNull();
    expect(chatAfterSignIn(refusing, 0)).toBeNull();
    expect(() => rememberChatForSignIn(refusing, chat, 0)).not.toThrow();
    expect(() => forgetChatAfterSignIn(refusing)).not.toThrow();
  });
});

describe('a sign-in that came back failed', () => {
  it('is the server saying so in the address', () => {
    expect(signInFailedIn('?venue=taikolabs&signin=failed')).toBe(true);
    expect(signInFailedIn('?venue=taikolabs')).toBe(false);
    expect(signInFailedIn('?signin=ok')).toBe(false);
  });

  it('comes off the address, the rest left as it was', () => {
    expect(withoutSignInFailed('http://localhost:5173/?venue=taikolabs&signin=failed&view=all-grid')).toBe(
      'http://localhost:5173/?venue=taikolabs&view=all-grid',
    );
  });
});
