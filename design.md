# Design — 태고 멀티뷰

A locked design system for the app's two screens: the multiview wall and the venue
editor. Every redesign of either reads this file first. Extend or amend it when the
system needs to grow; do not restyle one screen on its own.

## Genre
playful — custom theme, dark on purpose.

Vibe: **오락실 감성 — cabinet night, 돈·카, buttons you press.** The arcade is carried by
type, the roles of colour and the feel of controls, not by a light or busy ground: the
wall is watched for hours and video needs a dark surround.

## Macrostructure family
- App screens (multiview): **Catalogue** — a uniform wall of the same thing, the
  cabinets' streams, under a **marquee** header and above a one-line **credit** strip.
- Tool screens (venue editor): the same marquee and credit, with a venue list down the
  left and a tabbed form beside it.
- No marketing or content pages exist yet. When one does, it keeps the marquee voice.

## Theme
Custom, written in `frontend/src/tokens.css`.

- `--color-paper`    oklch(13% 0.03 270)  — cabinet night, the wall's ground
- `--color-paper-2`  oklch(17% 0.035 270) — marquee, credit strip, panels
- `--color-paper-3`  oklch(22% 0.04 270)  — raised: hovered and chosen controls
- `--color-rule`     oklch(30% 0.04 270)
- `--color-ink`      oklch(96% 0.01 270)
- `--color-ink-2`    oklch(79% 0.02 270)
- `--color-ink-3`    oklch(66% 0.025 270) — floor for readable text
- `--color-don`      oklch(64% 0.21 27)   — **on air**. The drum's 돈. Live badge, live counts.
- `--color-ka`       oklch(74% 0.14 230)  — **what the viewer chose**. The drum's 카.
  Chosen view and layout, the tile with sound, the open chat, focus.
- `--venue-accent`   data, per venue      — **identity only**: the venue's lamp and logo.

Never swap these roles. Red is never a selection; blue is never "live"; a venue's own
colour never marks state.

## Typography
- Display: **Black Han Sans** 400 — signage. Wordmark, venue name, the live count.
  Three roles, no more.
- Body: **Pretendard Variable** 400 / 600 / 800.
- Data: **JetBrains Mono** 500 / 700 — cabinet labels, counts, times, layout names.
- Three families is the ceiling.

## Spacing
4-point named scale in `tokens.css` (`--space-3xs` … `--space-lg`). No raw values.

## Controls — the arcade button
Every button sits on a visible base (`--press-depth`, a darker edge below it) and sinks
into it when pressed: `translateY(var(--press-depth))` with the base collapsing,
`--dur-micro`, `--ease-out`. This is the system's one signature move; nothing else
bounces, glows or lifts.

- Radius: `--radius-control` 10px on buttons, `--radius-tile` 12px on tiles, pills 999px.
- Chosen state: `--color-ka` edge and text on `--color-paper-3`.
- Focus: 2px `--color-ka` ring, offset 2px, never animated.

## Motion
- Easings `--ease-out` / `--ease-in` / `--ease-in-out`; durations `--dur-micro` 120ms,
  `--dur-short` 220ms.
- Allowed: the button press, the tile glide when the layout changes, and the attract
  blink - a hard `steps(1)` on/off of "NOW LOADING" / "불러오는 중" while a tile waits.
  A loading tile shows its stream's thumbnail under a scrim, never a black box.
- Reduced motion: all three collapse to an instant change; the blink stops.

## Microinteractions stance
- Silent success; status goes to the credit strip, never a toast.
- One tile holds the sound; one tile's chat is open.

## Per-screen allowances
- The wall MAY scroll when cabinets outnumber the chosen layout.
- The editor MAY use dense tables; every input still meets the control rules above.
- No imagery beyond the streams and venue logos.

## What screens MUST share
- The marquee header and the credit strip.
- Black Han Sans for the wordmark and venue name.
- The 돈 / 카 / venue colour roles.
- The arcade button.

## What screens MAY differ on
- What sits between marquee and credit: the wall, or the editor's list and form.
- Density: the editor is denser than the wall.

## Phones
The marquee compresses to a brand row and scrolling rows of venues and views; the credit
strip moves under it. One tile to a row; only on-screen tiles play. The chat is a sheet.
