import { signInUrl, type AuthStatus } from '../lib/googleSignIn';
import { ArcadeButton, ArcadeLink } from './ArcadeButton';

interface ChatAccountProps {
  /** Null until the server has said; nothing is shown till then. */
  status: AuthStatus | null;
  /** The page is back from a sign-in that did not go through (`?signin=failed`). */
  signInFailed: boolean;
  /** Just before the page leaves for Google's sign-in. */
  onSignIn: () => void;
  onSignOut: () => void;
  /** Back to our own chat, from YouTube's framed one. */
  onShowOurs: () => void;
}

/**
 * Google sign-in, over YouTube's framed chat in the sidebar (lib/googleSignIn.ts). Nothing at
 * all where the server offers no sign-in: the sidebar is then as it was. Signed out, the
 * button that signs in; signed in - with the framed chat chosen over our own - who is signed
 * in, the way back to our chat, and 로그아웃. Signed in with our chat, ChatRoom has the row.
 */
export function ChatAccount({ status, signInFailed, onSignIn, onSignOut, onShowOurs }: ChatAccountProps) {
  if (!status?.enabled) {
    return null;
  }

  if (!status.signedIn) {
    return (
      <section className="chat-account" aria-label="Google 로그인" data-testid="chat-account">
        {/* A whole-page visit: Google's consent page cannot be framed, and comes back here. */}
        <ArcadeLink
          className="chat-account__signin"
          label="Google로 로그인"
          href={signInUrl()}
          onClick={onSignIn}
          data-testid="chat-account-signin"
        />
        {signInFailed && (
          <p className="chat-account__note" role="status" data-testid="chat-account-failed">
            Google 로그인을 마치지 못했습니다. 다시 눌러 보세요.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="chat-account" aria-label="Google 계정" data-testid="chat-account">
      <div className="chat-account__row">
        <ChatAccountName status={status} />
        <ArcadeButton className="chat-account__ours" label="채팅 목록으로 보기" onClick={onShowOurs} data-testid="chat-account-ours" />
        <ArcadeButton className="chat-account__signout" label="로그아웃" onClick={onSignOut} data-testid="chat-account-signout" />
      </div>
    </section>
  );
}

/** Who is signed in: the name, with the address on hover. */
export function ChatAccountName({ status }: { status: AuthStatus }) {
  return (
    <span className="chat-account__name" title={status.email} data-testid="chat-account-name">
      {status.name}
    </span>
  );
}
