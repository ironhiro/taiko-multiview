import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * What a button face shows, named as the Figma component's `content` variant is:
 * words alone, an icon and words, or the icon alone. An icon-only face keeps its words
 * as the accessible name.
 */
export type ArcadeButtonContent = 'text' | 'icon+text' | 'icon-only';

interface ArcadeFace {
  /** The words on the face, and the accessible name when the face has none. */
  label: string;
  icon?: ReactNode;
  /** Inferred when left out: an icon and words when there is an icon, words otherwise. */
  content?: ArcadeButtonContent;
}

/**
 * The content a face ends up with. An icon-only face without an icon would be blank, so
 * it falls back to its words.
 */
export function resolveArcadeContent(icon: ReactNode | undefined, content?: ArcadeButtonContent): ArcadeButtonContent {
  const hasIcon = icon !== undefined && icon !== null && icon !== false;
  if (!hasIcon) {
    return 'text';
  }
  return content ?? 'icon+text';
}

/**
 * The class list for an arcade button (design.md, "Controls"). The states the Figma
 * component draws - hover, pressed, focus, disabled - are the stylesheet's; `chosen` is
 * `aria-pressed`, which the stylesheet turns 카.
 */
export function arcadeClassName(content: ArcadeButtonContent, className?: string): string {
  return ['arcade-button', content === 'icon-only' ? 'arcade-button--icon-only' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
}

function Face({ label, icon, content }: { label: string; icon: ReactNode; content: ArcadeButtonContent }) {
  return (
    <>
      {content !== 'text' && icon}
      {content !== 'icon-only' && <span className="arcade-button__text">{label}</span>}
    </>
  );
}

type ArcadeButtonProps = ArcadeFace &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-pressed'> & {
    /** A choice the wall remembers (카). Left out, the button is not a toggle at all. */
    chosen?: boolean;
  };

/** The system's one button: it sits on a base and sinks into it when pressed. */
export function ArcadeButton({ label, icon, content, chosen, className, type, ...rest }: ArcadeButtonProps) {
  const resolved = resolveArcadeContent(icon, content);
  return (
    <button
      type={type ?? 'button'}
      className={arcadeClassName(resolved, className)}
      aria-pressed={chosen}
      aria-label={rest['aria-label'] ?? (resolved === 'icon-only' ? label : undefined)}
      {...rest}
    >
      <Face label={label} icon={icon} content={resolved} />
    </button>
  );
}

type ArcadeLinkProps = ArcadeFace & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>;

/**
 * A control that leaves the page, dressed as the arcade button. Never a toggle and never
 * 카: opening somewhere else is not a choice the wall remembers.
 */
export function ArcadeLink({ label, icon, content, className, ...rest }: ArcadeLinkProps) {
  const resolved = resolveArcadeContent(icon, content);
  return (
    <a
      className={arcadeClassName(resolved, className)}
      aria-label={rest['aria-label'] ?? (resolved === 'icon-only' ? label : undefined)}
      {...rest}
    >
      <Face label={label} icon={icon} content={resolved} />
    </a>
  );
}
