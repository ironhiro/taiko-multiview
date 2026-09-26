import { useCallback, useEffect, useRef, useState } from 'react';
import { embeddedChatUrl, openYouTubeChat } from '../lib/chat';
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
 * In a browser the chat is a youtube.com frame, read-only: the browser keeps the
 * viewer's YouTube sign-in from it, so writing opens YouTube's own chat window. In the
 * desktop shell the panel leaves a hole instead and the shell lays a webview of its own
 * over it - youtube.com proper, where signing in works and the chat can be written to.
 */
export function ChatPanel({ label, stream, onClose }: ChatPanelProps) {
  const [nativeFailed, setNativeFailed] = useState(false);
  const useNative = isDesktopShell && !nativeFailed;
  const fallBackToFrame = useCallback(() => setNativeFailed(true), []);
  const { height, isResizing, gripProps } = useSheetResize();

  return (
    <aside
      className={isResizing ? 'chat chat--resizing' : 'chat'}
      aria-label={`${label} 채팅`}
      style={height ? ({ '--chat-height': `${height}px` } as React.CSSProperties) : undefined}
    >
      {/* Phones only: drag to make the sheet taller or shorter. */}
      <div className="chat__grip" aria-hidden="true" {...gripProps}>
        <span className="chat__grip-bar" />
      </div>
      <header className="chat__header">
        <h2 className="chat__title">
          <span className="chat__station">{label}</span> 채팅
        </h2>
        <div className="chat__actions">
          {stream && !useNative && (
            <button type="button" className="btn chat__youtube" onClick={() => openYouTubeChat(stream.videoId)}>
              유튜브에서 채팅 ↗
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
        // Read-only. Sandboxed without top navigation, since the chat's own "sign in to
        // chat" link took the whole multiview away to Google's sign-in; and that link's
        // panel along the bottom - dead once sandboxed - is cropped off. Writing happens in
        // YouTube's own chat window, from the button above.
        <div className="chat__frame chat__frame--crop">
          <iframe
            key={stream.videoId}
            src={embeddedChatUrl(stream.videoId)}
            title={`${label} 라이브 채팅`}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}

      <p className="chat__hint">
        {useNative
          ? 'YouTube에 로그인하면 여기서 바로 입력할 수 있습니다.'
          : '채팅 입력은 ‘유튜브에서 채팅’ 창에서 할 수 있습니다.'}
      </p>
    </aside>
  );
}

const SHEET_HEIGHT_KEY = 'taiko-multiview:chat-height';
const SHEET_MIN_HEIGHT = 160;

/**
 * The phone sheet's height, set by dragging its grip and remembered for next time.
 * Undefined means as tall as it goes - up to the video pinned above it; the stylesheet
 * caps any height at that, so only the lower bound is kept here.
 */
function useSheetResize() {
  const [height, setHeight] = useState<number | undefined>(readSheetHeight);
  const [isResizing, setIsResizing] = useState(false);
  // Read by the move handler, which can run before a render has caught up with the press.
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    setIsResizing(true);
    try {
      // Keeps the drag when the finger strays off the grip.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not a live pointer (a synthetic event): the drag works while on the grip.
    }
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }
    // The sheet is anchored to the bottom edge, so its top follows the finger.
    const next = Math.round(window.innerHeight - event.clientY);
    setHeight(Math.min(window.innerHeight, Math.max(SHEET_MIN_HEIGHT, next)));
  }, []);

  const onPointerEnd = useCallback(() => {
    draggingRef.current = false;
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing || height === undefined) {
      return;
    }
    try {
      window.localStorage.setItem(SHEET_HEIGHT_KEY, String(height));
    } catch {
      // Private mode and the like: the size just is not remembered.
    }
  }, [isResizing, height]);

  return {
    height,
    isResizing,
    gripProps: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  };
}

function readSheetHeight(): number | undefined {
  try {
    const stored = Number(window.localStorage.getItem(SHEET_HEIGHT_KEY));
    return stored >= SHEET_MIN_HEIGHT ? stored : undefined;
  } catch {
    return undefined;
  }
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
