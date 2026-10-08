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
  Chosen view and layout, the tile with sound, focus.
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
- A control that leaves the page (the tile's 채팅, which opens YouTube) is a link dressed
  as the arcade button: same base, same press, no underline. It is never `aria-pressed`
  and never takes `--color-ka` - opening a chat is not a choice the wall remembers.
- Narrow tiles drop a control's word before the row wraps: the icon stays, the
  accessible name keeps the full words.

## Tile labels
- The row reads: cabinet label, [tag], LIVE, viewers, then the controls (음소거, 채팅).
- **The row sits under the picture, on every device.** Nothing of ours is laid over the
  video, hovered or not: over it, the label and buttons covered YouTube's progress bar,
  its share and channel links, and the thumbnail. A tile is a 16:9 picture plus this
  row; the grid sizes tiles so that N rows of both fit the screen.
- The row is one line. Viewers never wrap ("12,345명" stays whole), and nothing spills
  under the buttons.
- **The label keeps at least three letters and its ellipsis** ("THE…"), or its whole name
  if shorter; its full name is always in `title`.
- **Each row gives way by what it holds, tile by tile** - not by a width for the whole
  wall. "A1 · 10명 · 음소거 · 채팅" keeps its words on a 319px tile where a tagged
  "THE BASE 2 · 12,345명" has to drop them. As its room runs out, a row goes through, in
  order (`data-fit`, lib/rowFit.ts):
  1. `words` - the buttons with their words;
  2. `icons` - icons only, square (the Figma `narrow` form);
  3. `no-count` - the viewer count goes as well;
  4. `tight` - the icons lose their square;
  5. `snug` - the row's spacing closes up to the smallest step.
  The label is cut with its ellipsis all along. **The tag never goes**, nor LIVE.
- Phones held upright (a row 390px wide or less: iPhone SE, 15 Pro, Pixel 7) show the
  icons alone whatever the row holds; a phone held sideways follows the row.
- Measured on the longest row we list (tagged "THE BASE 2", LIVE, "12,345명", "소리 켜짐",
  "채팅"): it keeps "THE…" on every desktop tile from 188px, and on phone tiles from 198px
  (no phone held upright is narrower than 296px); below that it is cut further rather
  than lose its tag. The desktop figure holds on Linux too, whose Chromium rounds each
  glyph of the 11px label to a whole pixel: there a 184px tile, the floor on Windows with
  nothing to spare, keeps only "TH…".
- LIVE, the tag and the count are 10px on phones; the label is 14px there.
- The row's type follows the tile's width, not the window's height (in the grid; the
  `--text-tile-*` tokens stay vh-based for anything else), and a row measures itself
  again when its size, its content or the loaded fonts change - never per frame.
- A tag beside the label (today only 미등록, for a broadcast whose cabinet the settings
  do not list) is a neutral chip: `--color-paper-2` fill, `--color-rule-strong` inset
  edge, `--color-ink-2` text, body face. A tag describes the cabinet, not its state, so
  it never uses 돈, 카 or the venue colour.
- When space runs out the label is cut with an ellipsis first, down to its minimum, and
  the row gives way as above; the tag and LIVE keep their size throughout.

## Cabinets with no broadcast
- A cabinet with nothing on air takes no tile. After the tiles, at the end of the wall,
  one thin strip reads "방송 없음" and lists those cabinets as chips, in the venue's
  order. It wraps when the chips outrun one line; on a desktop one line is at most 48px.
- Neutral only: `--color-paper-2` fill, `--color-rule-strong` dashed edge, `--color-ink-3`
  title, chips edged in `--color-rule-strong` with `--color-ink-2` data-face labels. An
  empty cabinet is neither on air, nor chosen, nor the venue's identity - no 돈, 카 or
  venue colour, and no button look: a chip is not something to press.
- The strip always says "방송 없음": whether the venue is open is the credit strip's to
  say ("영업 종료 · 내일 10:00 오픈"), as it already does when nothing is on air.
- With nothing on air at all the wall is the strip alone, as wide as the chosen layout.
- Until the first live answer arrives nothing is known to be empty: every cabinet keeps
  its tile, blinking "불러오는 중", and the strip does not appear.
- The layout picker (1×1-4×4) and the automatic column shrink count tiles, which are the
  cabinets on air: 3×3 with two on air is two columns.

## Motion
- Easings `--ease-out` / `--ease-in` / `--ease-in-out`; durations `--dur-micro` 120ms,
  `--dur-short` 220ms.
- Allowed: the button press, the tile glide when the layout changes, and the attract
  blink - a hard `steps(1)` on/off of "NOW LOADING" / "불러오는 중" while a tile waits.
  A loading tile shows its stream's thumbnail under a scrim, never a black box.
- Reduced motion: all three collapse to an instant change; the blink stops.

## Microinteractions stance
- Silent success; status goes to the credit strip, never a toast.
- One tile holds the sound.

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
strip moves under it. One tile to a row; only on-screen tiles play.
The tile's row under the picture is taller there (`--tile-bar` 3.25rem, 2.25rem buttons)
so a thumb has room; the "방송 없음" strip wraps its chips.

## Figma 대응
The Figma file (`시안`, `Components` pages) and the code use the same names and units, in
place of Code Connect. Figma set its type in Noto Sans KR because Pretendard would not
load there; this file and `tokens.css` win wherever the two differ.

| Figma component | Code | Props / variants |
|---|---|---|
| ArcadeButton | `frontend/src/components/ArcadeButton.tsx` (`ArcadeButton`, `ArcadeLink`); `.arcade-button` in `styles.css` | state default/hover/pressed/focus/disabled = CSS `:hover`/`:active`/`:focus-visible`/`:disabled`; chosen = `chosen` prop (`aria-pressed`, 카). content text / icon+text / icon-only = `content` prop (inferred from `icon`; icon-only keeps `label` as the accessible name). Label = `label`, Icon = `icon` |
| LiveBadge | `frontend/src/components/LiveBadge.tsx` (`.tile__badge`) | none |
| TagChip | `frontend/src/components/TagChip.tsx` (`.tile__tag`) | Label = `label`, default 미등록 |
| IdleChip | `frontend/src/components/IdleStrip.tsx` (`IdleChip`, `.idle-chip`) | Cabinet = `cabinet` |
| IdleStrip | `frontend/src/components/IdleStrip.tsx` (`IdleStrip`, `.idle-strip`) | title (default 방송 없음), `cabinets` |
| TileLabelRow | `frontend/src/components/TileLabelRow.tsx` (`.tile__row`) | sound off/on = `sound`; width regular/narrow = not a prop: each row measures itself (`data-fit` words/icons/no-count/tight/snug, `lib/rowFit.ts`), and phones upright (row ≤390px) keep the icons alone; Cabinet = `cabinet`, Viewers = `viewers`, Tag = `tag` |
| Tile | `frontend/src/components/PlayerTile.tsx` (`.grid-view .tile`) | device desktop/phone = the phone media block in `styles.css`, not a prop |
| VenueTab, ViewChip, LayoutChip (header) | `VenueTabs.tsx` (`.venue-tab`), `ViewPicker.tsx` (`.choice`), `LayoutPicker.tsx` (`.layout-picker__option`) | names only for now; they already share the arcade button rules in `styles.css` |
