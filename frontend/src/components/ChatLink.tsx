import type { ReactNode } from 'react';
import type { LiveStream } from '../lib/types';
import { isDesktopShell } from '../lib/shell';
import { chatSignInUrl, openChatWindow, popoutChatUrl } from '../lib/youtube';
import { ArcadeLink } from './ArcadeButton';

interface ChatLinkProps {
  stream: LiveStream;
  /** The broadcast's own YouTube page in a new tab, rather than the pop-out chat in a popup. */
  inTab: boolean;
  /**
   * Start the window at Google's sign-in for YouTube, which arrives at the pop-out chat once
   * done (or at once, signed in). The chat sidebar's: the chat framed beside the wall cannot
   * take a sign-in itself.
   */
  signIn?: boolean;
  /** Called on every click that opens the chat elsewhere: a popup or a tab. */
  onOpen?: () => void;
  className: string;
  /** The words on the face. */
  label: string;
  icon: ReactNode;
  /** The accessible name: which cabinet's chat, and where it opens. */
  name: string;
  'data-testid'?: string;
}

/**
 * The broadcast's YouTube chat, in a youtube.com window of its own: the tile's 채팅 where
 * there is no sidebar, and the sidebar's 로그인하고 채팅 (through Google's sign-in first). In
 * a window of its own the chat always has the viewer's YouTube sign-in, whatever the browser
 * does with youtube.com's cookies in a frame (lib/chatSidebar.ts).
 *
 * A link rather than a button, so that whatever stops the popup still leaves a way there:
 * its own new tab. On a computer the click opens a popup instead and keeps the link from
 * following; a blocked popup lets the link go ahead. The desktop shell hands both kinds of
 * new window to the default browser and reports each as blocked, so there the link goes on
 * its own - opening a popup first would open the chat twice.
 */
export function ChatLink({
  stream,
  inTab,
  signIn,
  onOpen,
  className,
  label,
  icon,
  name,
  'data-testid': testId,
}: ChatLinkProps) {
  const popupUrl = signIn ? chatSignInUrl(stream.videoId) : popoutChatUrl(stream.videoId);
  const openPopup = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onOpen?.();
    // A modified or middle click asked for a tab or a window of the browser's own kind.
    if (isDesktopShell || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (openChatWindow(stream.videoId, undefined, undefined, popupUrl)) {
      event.preventDefault();
    }
  };

  return (
    <ArcadeLink
      className={className}
      label={label}
      icon={icon}
      href={inTab ? stream.watchUrl : popupUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={inTab ? undefined : openPopup}
      aria-label={name}
      data-testid={testId}
    />
  );
}
