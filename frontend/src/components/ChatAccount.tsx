import { useEffect, useRef, useState } from 'react';
import {
  appendChatMessages,
  fetchAuthStatus,
  readChat,
  signInUrl,
  signOut,
  startChatPolling,
  type AuthStatus,
  type ChatMessage,
} from '../lib/googleSignIn';
import { ArcadeButton, ArcadeLink } from './ArcadeButton';

/**
 * Google sign-in in the chat sidebar, and the broadcast's chat read with it (lib/googleSignIn.ts).
 * Nothing at all where the server offers no sign-in: the sidebar is then as it was.
 *
 * A first step towards reading and writing the chat in our own list: for now the list is
 * plain, and the framed YouTube chat below stays as it is.
 */
export function ChatAccount({ videoId }: { videoId: string }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAuthStatus(controller.signal).then(setStatus, () => {});
    return () => controller.abort();
  }, []);

  if (!status?.enabled) {
    return null;
  }

  if (!status.signedIn) {
    return (
      <section className="chat-account" aria-label="Google 로그인" data-testid="chat-account">
        {/* A whole-page visit: Google's consent page cannot be framed, and comes back here. */}
        <ArcadeLink className="chat-account__signin" label="Google로 로그인" href={signInUrl()} data-testid="chat-account-signin" />
      </section>
    );
  }

  const handleSignOut = () => {
    signOut()
      .catch(() => {})
      .finally(() => setStatus({ enabled: true, signedIn: false }));
  };

  return (
    <section className="chat-account" aria-label="Google 계정과 채팅" data-testid="chat-account">
      <div className="chat-account__row">
        <span className="chat-account__name" title={status.email} data-testid="chat-account-name">
          {status.name}
        </span>
        <ArcadeButton className="chat-account__signout" label="로그아웃" onClick={handleSignOut} data-testid="chat-account-signout" />
      </div>
      {/* Keyed by broadcast: another tile's chat starts its own list from the beginning. */}
      <ChatMessages key={videoId} videoId={videoId} onSignedOut={() => setStatus({ enabled: true, signedIn: false })} />
    </section>
  );
}

function ChatMessages({ videoId, onSignedOut }: { videoId: string; onSignedOut: () => void }) {
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

  if (notLive) {
    return (
      <p className="chat-account__note" data-testid="chat-account-note">
        이 방송의 라이브 채팅을 읽을 수 없습니다.
      </p>
    );
  }

  return (
    <ol className="chat-account__messages" aria-label="채팅 메시지" data-testid="chat-account-messages">
      {messages.map((message) => (
        <li key={message.id} className="chat-account__message">
          <span className="chat-account__author">{message.author}</span> {message.text}
        </li>
      ))}
    </ol>
  );
}
