import { useCallback, useEffect, useRef, useState } from 'react';
import { embeddedChatUrl, watchReturn } from '../lib/chatSidebar';
import type { LiveStream } from '../lib/types';
import { ArcadeButton } from './ArcadeButton';
import { ChatLink } from './ChatLink';

interface ChatSidebarProps {
  /** The cabinet whose broadcast this is. */
  label: string;
  stream: LiveStream;
  onClose: () => void;
}

/**
 * One broadcast's YouTube chat down the right of the window, beside the wall (design.md,
 * "Chat sidebar"). Wide browser windows on a computer only (lib/chatSidebar.ts); App closes
 * it once the broadcast's tile leaves the wall.
 *
 * Whether the framed chat can be written to is the browser's call, which the page cannot
 * see: a Chrome signed in to YouTube gets the chat's input; a browser that keeps
 * youtube.com's cookies from other sites' frames (Safari and Firefox by default, private
 * windows) only the chat to read. Nor can the framed chat sign anyone in: its own "채팅하려면
 * 로그인" would take the whole window away, which the sandbox stops. So "로그인하고 채팅" is
 * always there, with a line over the chat pointing to it: Google's sign-in in a window of its
 * own, arriving at YouTube's pop-out chat, where writing always works. Back from that window,
 * the framed chat is loaded once more, so a sign-in the browser does pass to the frame shows
 * its input without a reload of the page.
 */
export function ChatSidebar({ label, stream, onClose }: ChatSidebarProps) {
  // Counts the reloads after a sign-in; part of the frame's key.
  const [signInReloads, setSignInReloads] = useState(0);
  const stopWatching = useRef<(() => void) | null>(null);

  const reloadOnReturn = useCallback(() => {
    stopWatching.current?.();
    stopWatching.current = watchReturn(window, document, () => {
      stopWatching.current = null;
      setSignInReloads((count) => count + 1);
    });
  }, []);
  useEffect(() => () => stopWatching.current?.(), []);

  return (
    <aside className="chat-sidebar" aria-label={`${label} 채팅`} data-testid="chat-sidebar">
      <header className="chat-sidebar__header">
        <h2 className="chat-sidebar__title">
          <span className="chat-sidebar__cabinet" title={label}>
            {label}
          </span>{' '}
          채팅
        </h2>
        <ChatLink
          className="chat-sidebar__signin"
          label="로그인하고 채팅"
          icon={<NewWindowIcon />}
          name={`유튜브에 로그인하고 ${label} 채팅을 새 창에서 열기`}
          stream={stream}
          inTab={false}
          signIn
          onOpen={reloadOnReturn}
          data-testid="chat-sidebar-signin"
        />
        <ArcadeButton
          className="chat-sidebar__close"
          label="채팅 닫기"
          content="icon-only"
          icon={<CloseIcon />}
          onClick={onClose}
          data-testid="chat-sidebar-close"
        />
      </header>

      <p className="chat-sidebar__hint" data-testid="chat-sidebar-hint">
        입력란이 없거나 채팅 안의 로그인 버튼이 반응하지 않으면{' '}
        <span className="chat-sidebar__hint-name">‘로그인하고 채팅’을</span> 누르세요.
      </p>

      <div className="chat-sidebar__frame">
        {/* Keyed by broadcast: another tile's chat is a new frame, not this one sent
            elsewhere, which would leave a step in the browser's history for Back to undo; and
            by the reloads after a sign-in, which is how the frame is loaded once more.
            Sandboxed without top navigation: the chat's own "채팅하려면 로그인" is a link that
            takes the top window to Google's sign-in (measured 2026-10-09), and it would take the
            whole multiview with it. Sandboxed, it does nothing; "로그인하고 채팅" stands in. */}
        <iframe
          key={`${stream.videoId}:${signInReloads}`}
          src={embeddedChatUrl(stream.videoId)}
          title={`${label} 라이브 채팅`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          data-testid="chat-sidebar-frame"
        />
      </div>
    </aside>
  );
}

function NewWindowIcon() {
  return (
    <svg className="chat-sidebar__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="chat-sidebar__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
