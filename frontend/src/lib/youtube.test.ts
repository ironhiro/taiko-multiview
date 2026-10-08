import { describe, expect, it, vi } from 'vitest';
import { CHAT_WINDOW_FEATURES, chatWindowName, openChatWindow, popoutChatUrl } from './youtube';

describe('popoutChatUrl', () => {
  it("opens the broadcast's pop-out chat on youtube.com itself, not through its sign-in", () => {
    const url = new URL(popoutChatUrl('abc123'));
    expect(`${url.origin}${url.pathname}`).toBe('https://www.youtube.com/live_chat');
    expect(url.searchParams.get('is_popout')).toBe('1');
    expect(url.searchParams.get('v')).toBe('abc123');
    expect(url.searchParams.has('next')).toBe(false);
  });

  it('is the address YouTube serves the chat at', () => {
    expect(popoutChatUrl('abc123')).toBe('https://www.youtube.com/live_chat?is_popout=1&v=abc123');
  });

  it('keeps an id with URL-special characters intact', () => {
    expect(new URL(popoutChatUrl('a-b_c&d')).searchParams.get('v')).toBe('a-b_c&d');
  });
});

describe('chatWindowName', () => {
  it('names one window per broadcast', () => {
    expect(chatWindowName('abc123')).toBe('taiko-chat-abc123');
    expect(chatWindowName('abc123')).not.toBe(chatWindowName('xyz789'));
  });
});

describe('openChatWindow', () => {
  /** Stands in for a window a real open would give: still this page's, with its opener. */
  function fakeWindow() {
    return { closed: false, opener: {} as Window | null, focus: vi.fn() };
  }

  function fakeOpen() {
    const opened: ReturnType<typeof fakeWindow>[] = [];
    const open = vi.fn(() => {
      const popup = fakeWindow();
      opened.push(popup);
      return popup as unknown as Window;
    });
    return { open, opened };
  }

  it('opens the sign-in in a named popup, cut off from the wall and in front', () => {
    const { open, opened } = fakeOpen();

    expect(openChatWindow('abc123', open, new Map())).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(popoutChatUrl('abc123'), 'taiko-chat-abc123', CHAT_WINDOW_FEATURES);
    expect(opened[0].opener).toBeNull();
    expect(opened[0].focus).toHaveBeenCalledTimes(1);
  });

  it("brings an open broadcast's window back rather than loading its chat again", () => {
    const { open, opened } = fakeOpen();
    const windows = new Map<string, Window>();

    openChatWindow('abc123', open, windows);
    expect(openChatWindow('abc123', open, windows)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(opened[0].focus).toHaveBeenCalledTimes(2);
  });

  it('opens another window for another broadcast', () => {
    const { open, opened } = fakeOpen();
    const windows = new Map<string, Window>();

    openChatWindow('abc123', open, windows);
    openChatWindow('xyz789', open, windows);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(popoutChatUrl('xyz789'), 'taiko-chat-xyz789', CHAT_WINDOW_FEATURES);
    expect(opened).toHaveLength(2);
  });

  it('opens a new window once the last one was closed', () => {
    const { open, opened } = fakeOpen();
    const windows = new Map<string, Window>();

    openChatWindow('abc123', open, windows);
    opened[0].closed = true;
    expect(openChatWindow('abc123', open, windows)).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
    expect(opened[1].opener).toBeNull();
  });

  it('says so when the popup was blocked, and tries again on the next click', () => {
    const windows = new Map<string, Window>();
    expect(openChatWindow('abc123', () => null, windows)).toBe(false);

    const { open } = fakeOpen();
    expect(openChatWindow('abc123', open, windows)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('counts a window that will not take focus or lose its opener as opened', () => {
    const popup = {
      closed: false,
      focus: () => {
        throw new Error('denied');
      },
      set opener(_value: unknown) {
        throw new DOMException('Blocked a frame', 'SecurityError');
      },
    } as unknown as Window;
    expect(openChatWindow('abc123', () => popup, new Map())).toBe(true);
  });
});
