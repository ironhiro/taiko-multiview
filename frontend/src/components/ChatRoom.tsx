import { useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  appendChatMessages,
  CHAT_SEND_REFUSALS,
  chatMessageLength,
  chatMessageProblem,
  isScrolledToBottom,
  isSendKey,
  MAX_CHAT_MESSAGE_LENGTH,
  readChat,
  sendChat,
  startChatPolling,
  unseenWhileReading,
  CHAT_FOLLOW_START,
  followChat,
  type AuthStatus,
  type ChatMessage,
} from '../lib/googleSignIn';
import { ArcadeButton } from './ArcadeButton';
import { ChatAccountName } from './ChatAccount';

interface ChatRoomProps {
  videoId: string;
  /** Signed in: who. */
  status: AuthStatus;
  onSignOut: () => void;
  /** The server says the session is gone: a read or a send came back 401. */
  onSignedOut: () => void;
}

const ROLE_NAMES: Record<NonNullable<ChatMessage['role']>, string> = {
  owner: '소유자',
  moderator: '운영자',
};

/**
 * Our own chat, the whole sidebar under its header, for a viewer signed in to this page
 * (design.md, "Chat sidebar"): who is signed in, the broadcast's chat read with that sign-in,
 * and a box to write in. Keyed by broadcast where it is used: another tile's chat starts its
 * own list.
 *
 * The list follows new messages while the viewer is at its bottom. Scrolled up to read, it
 * stays where it is, and "새 메시지 N" counts what came since, a press away from the bottom.
 */
export function ChatRoom({ videoId, status, onSignOut, onSignedOut }: ChatRoomProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notLive, setNotLive] = useState(false);
  // The latest, without restarting the polling: it belongs to the broadcast alone.
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;

  useEffect(
    () =>
      startChatPolling({
        read: (pageToken, signal) => readChat(videoId, pageToken, signal),
        onPage: (page) => setMessages((list) => appendChatMessages(list, page.messages)),
        onEnd: (reason) => (reason === 'signedOut' ? signedOut.current() : setNotLive(true)),
        doc: document,
      }),
    [videoId],
  );

  // --- following the newest -------------------------------------------------

  // The rules are lib/googleSignIn.ts's (followChat); this keeps the list where they say.
  const listRef = useRef<HTMLOListElement>(null);
  const [follow, dispatchFollow] = useReducer(followChat, CHAT_FOLLOW_START);
  const newestId = messages.at(-1)?.id;

  useLayoutEffect(() => {
    dispatchFollow({ kind: 'messages', newestId });
  }, [messages, newestId]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && follow.atBottom) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, follow.atBottom]);

  const handleScroll = () => {
    const list = listRef.current;
    if (list) {
      dispatchFollow({ kind: 'scrolled', atBottom: isScrolledToBottom(list), newestId });
    }
  };

  const toBottom = () => dispatchFollow({ kind: 'toBottom', newestId });

  const unseen = unseenWhileReading(follow, messages);

  // --- writing --------------------------------------------------------------

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const sendAbort = useRef<AbortController | null>(null);
  useEffect(() => () => sendAbort.current?.abort(), []);

  const length = chatMessageLength(draft);
  const problem = chatMessageProblem(draft);

  const send = async () => {
    if (sending || notLive) {
      return;
    }
    if (problem) {
      setRefusal(CHAT_SEND_REFUSALS[problem]);
      return;
    }

    const controller = new AbortController();
    sendAbort.current = controller;
    setSending(true);
    setRefusal(null);
    try {
      const result = await sendChat(videoId, draft, controller.signal);
      switch (result.kind) {
        case 'sent':
          setDraft('');
          setMessages((list) => appendChatMessages(list, [result.message]));
          // Their own message: to the bottom to see it, wherever they were reading.
          dispatchFollow({ kind: 'toBottom', newestId: result.message.id });
          break;
        case 'signedOut':
          signedOut.current();
          break;
        default:
          // The words stay in the box, to send again or change. Nothing is locked, not even
          // by notLive: a send turned down once may go the next time, and the reads, which
          // stop for good when the chat has really ended, are what close the box.
          setRefusal(CHAT_SEND_REFUSALS[result.reason]);
      }
    } catch {
      // The sidebar closed while sending.
      return;
    } finally {
      if (sendAbort.current === controller) {
        sendAbort.current = null;
        setSending(false);
      }
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSendKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode })) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <section className="chat-room" aria-label="Google 계정과 채팅" data-testid="chat-room">
      <div className="chat-account__row chat-room__account">
        <ChatAccountName status={status} />
        <ArcadeButton className="chat-account__signout" label="로그아웃" onClick={onSignOut} data-testid="chat-account-signout" />
      </div>

      <div className="chat-room__list">
        {notLive && messages.length === 0 ? (
          <p className="chat-room__note" data-testid="chat-room-note">
            이 방송의 라이브 채팅을 읽을 수 없습니다.
          </p>
        ) : (
          <ol
            ref={listRef}
            className="chat-room__messages"
            aria-label="채팅 메시지"
            // In the Tab order in every browser (Chromium takes a scrolling box by itself, WebKit
            // does not), so the arrow keys scroll it.
            tabIndex={0}
            onScroll={handleScroll}
            data-testid="chat-room-messages"
          >
            {messages.map((message) => (
              <li key={message.id} className="chat-room__message">
                <span className="chat-room__author">{message.author}</span>
                {message.role && <span className="chat-room__role">{ROLE_NAMES[message.role]}</span>}{' '}
                <span className="chat-room__text">{message.text}</span>
              </li>
            ))}
          </ol>
        )}
        {unseen > 0 && (
          <ArcadeButton
            className="chat-room__latest"
            label={`새 메시지 ${unseen}`}
            icon={<DownIcon />}
            onClick={toBottom}
            data-testid="chat-room-latest"
          />
        )}
      </div>

      <form className="chat-room__composer" onSubmit={handleSubmit}>
        <div className="chat-room__entry">
          <textarea
            className="chat-room__input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              // What was said about the words before no longer holds for these.
              setRefusal(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="메시지 입력…"
            aria-label="메시지 입력"
            aria-invalid={problem === 'tooLong' || undefined}
            aria-describedby="chat-room-count"
            rows={2}
            readOnly={sending}
            disabled={notLive}
            data-testid="chat-room-input"
          />
          <ArcadeButton
            className="chat-room__send"
            type="submit"
            label="보내기"
            disabled={sending || notLive || problem !== null}
            aria-busy={sending || undefined}
            data-testid="chat-room-send"
          />
        </div>
        <div className="chat-room__status">
          <span className="chat-room__refusal" role="status" data-testid="chat-room-refusal">
            {refusal}
          </span>
          <span
            id="chat-room-count"
            className={problem === 'tooLong' ? 'chat-room__count chat-room__count--over' : 'chat-room__count'}
            data-testid="chat-room-count"
          >
            {length}/{MAX_CHAT_MESSAGE_LENGTH}
          </span>
        </div>
      </form>
    </section>
  );
}

function DownIcon() {
  return (
    <svg className="chat-sidebar__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 3v9M4 8.5 8 12.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
