import { useCallback, useEffect, useRef, useState } from 'react';
import { embeddedChatUrl, openChatWindow } from '../lib/chat';
import { report } from '../lib/diagnostics';
import { isDesktopShell, showNativeChat } from '../lib/shell';
import type { LiveStream } from '../lib/types';

interface ChatPanelProps {
  label: string;
  /** Undefined once the broadcast has ended; the panel stays open and says so. */
  stream: LiveStream | undefined;
  onClose: () => void;
}

/**
 * The chat of one chosen tile, docked beside the wall (a sheet on phones).
 *
 * In a browser the chat is a youtube.com frame: readable, but the browser keeps the
 * viewer's YouTube sign-in from it, so writing opens YouTube's own chat window. In the
 * desktop shell the panel leaves a hole instead and the shell lays a webview of its own
 * over it - youtube.com proper, where signing in works and the chat can be written to.
 */
export function ChatPanel({ label, stream, onClose }: ChatPanelProps) {
  const [nativeFailed, setNativeFailed] = useState(false);
  const useNative = isDesktopShell && !nativeFailed;
  const fallBackToFrame = useCallback(() => setNativeFailed(true), []);

  return (
    <aside className="chat" aria-label={`${label} 채팅`}>
      <header className="chat__header">
        <h2 className="chat__title">
          <span className="chat__station">{label}</span> 채팅
        </h2>
        <div className="chat__actions">
          {stream && !useNative && (
            <button type="button" className="btn chat__write" onClick={() => openChatWindow(stream.videoId)}>
              입력하기 ↗
            </button>
          )}
          <button type="button" className="chat__close" onClick={onClose} aria-label="채팅 닫기">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {!stream ? (
        <p className="chat__empty">방송이 끝나 채팅을 불러올 수 없습니다.</p>
      ) : useNative ? (
        <NativeChatSlot videoId={stream.videoId} onUnavailable={fallBackToFrame} />
      ) : (
        // Keyed by video so a new broadcast on the same cabinet gets a fresh chat.
        <iframe key={stream.videoId} className="chat__frame" src={embeddedChatUrl(stream.videoId)} title={`${label} 라이브 채팅`} />
      )}

      <p className="chat__hint">
        {useNative
          ? 'YouTube에 로그인하면 여기서 바로 입력할 수 있습니다.'
          : '입력은 YouTube 로그인이 필요해 새 창에서 합니다.'}
      </p>
    </aside>
  );
}

/**
 * The hole the shell's chat webview fills. Its bounds are sent whenever they change -
 * the panel moves with window resizes and, on phones, is a sheet - and the webview is
 * closed when the slot goes away.
 */
function NativeChatSlot({ videoId, onUnavailable }: { videoId: string; onUnavailable: () => void }) {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) {
      return;
    }

    let frame = 0;
    const send = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = slot.getBoundingClientRect();
        showNativeChat(videoId, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }).catch(
          (cause) => {
            report('native-chat-failed', { videoId, message: String(cause) });
            onUnavailable();
          },
        );
      });
    };

    send();
    const observer = new ResizeObserver(send);
    observer.observe(slot);
    window.addEventListener('resize', send);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', send);
    };
  }, [videoId, onUnavailable]);

  // Closing is its own effect so switching videos moves the webview rather than
  // tearing it down and building it again.
  useEffect(() => () => void showNativeChat(null, null).catch(() => {}), []);

  return <div ref={slotRef} className="chat__frame chat__frame--native" />;
}
