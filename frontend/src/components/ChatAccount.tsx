import { signInUrl, type AuthStatus } from '../lib/googleSignIn';
import { ArcadeLink } from './ArcadeButton';

interface ChatSignInProps {
  /** The page is back from a sign-in that did not go through (`?signin=failed`). */
  signInFailed: boolean;
  /** Just before the page leaves for Google's sign-in. */
  onSignIn: () => void;
}

/**
 * The sidebar of a viewer signed out where the server offers Google sign-in
 * (lib/googleSignIn.ts): what signing in gives them, and the button that does it, in the
 * middle of the column. No frame: our own chat is the chat here, and it is the signed-in one.
 */
export function ChatSignIn({ signInFailed, onSignIn }: ChatSignInProps) {
  return (
    <section className="chat-account" aria-label="Google 로그인" data-testid="chat-account">
      <p className="chat-account__lead" data-testid="chat-account-lead">
        로그인하면 이 방송의 채팅을 보고 쓸 수 있습니다.
      </p>
      {/* A whole-page visit: Google's consent page cannot be framed, and comes back here.
          A link, so it opens in a new tab the way links do; the explicit tabIndex keeps it in
          Safari's Tab order, which leaves links out unless "Press Tab to highlight each item"
          is on - and this is the one thing to do in the column. */}
      <ArcadeLink
        className="chat-account__signin"
        label="Google로 로그인"
        href={signInUrl()}
        tabIndex={0}
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

/** Who is signed in: the name, with the address on hover. */
export function ChatAccountName({ status }: { status: AuthStatus }) {
  return (
    <span className="chat-account__name" title={status.email} data-testid="chat-account-name">
      {status.name}
    </span>
  );
}
