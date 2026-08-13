# Changelog

All notable changes to FormulaBase.

## 0.4.19 — 2026-08-13

### Export to a real, calculable spreadsheet

- The Markdown export from 0.4.18 no longer downloads through the browser — it now writes
  straight into a folder you pick in your own Nextcloud Files, via a small built-in folder
  picker.
- New: **Save as ODS**. Exports a formula as a genuine OpenDocument Spreadsheet — variable
  values land in editable cells, the result cell holds a real spreadsheet formula (compiled
  from the expression, not just its text) that recalculates when you change a value, and the
  formula's rendered math is embedded above it as an image.

## 0.4.18 — 2026-08-13

### Copy and export the calculation trace

- The "Calculation steps" panel now has **Copy** and **Download as Markdown (.md)** buttons —
  export the formula, its input values, and the full substitution/reduction trace as plain
  Markdown text, ready to paste into a report or hand to a student/colleague.

## 0.4.17 — 2026-08-06

### Compatibility

- Declared support for **Nextcloud 34** (verified on Nextcloud 34.0.2 with PHP 8.5 — install,
  migrations and the collection/formula views all pass). No code changes.

## 0.4.15 — 2026-07-23

### Emoji are drawn by the app, not by the viewer's device

0.4.14 bundled the full emoji set but kept it as a *fallback* behind the device's own font.
That does not fix flags, and the reason is worth writing down: **Segoe UI Emoji has glyphs
for the regional indicator letters**. It reports 🇯 and 🇵 as covered and simply draws them as
two boxed letters instead of forming 🇯🇵 — so nothing is "missing", the browser never falls
through, and the bundled font was never even downloaded. Taking only the flag code points
away from the device font does not work either: U+200D has to travel with them or
🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️ split into a bare flag, and once U+200D belongs to a different font than the
base character, **every** ZWJ emoji comes apart — families, couples, professions, hair
colours.

- All 1,849 emoji are now rendered from the bundled Noto Color Emoji subset (SIL OFL 1.1),
  on every platform. A device's own emoji font is kept behind it only as a safety net for a
  failed download.
- Verified on three simulated devices — a complete emoji font, a Windows-like one (has the
  regional indicator glyphs but cannot form flags), and none at all: all 1,849 render
  identically in each, flags and ZWJ sequences included.
- The font applies only to the elements that display an icon, so the app's own UI keeps the
  platform look and body text is untouched — characters such as © ® ™ ↔ stay plain text.
- Cost: one cached 1.7 MB download. Collections are shared, so consistent rendering is the
  point — everyone now sees the icon the person who picked it saw.

## 0.4.14 — 2026-07-22

### Emoji no longer depend on the viewer's device

0.4.13 shipped a flag-only font, which treated the symptom. The cause is that the app was
letting whatever emoji font a device happens to ship decide whether an icon is readable —
and flags are simply where that shows up first, because **Windows has no flag glyphs on any
version** (Segoe UI Emoji draws 🇯🇵 as a boxed "JP" and 🏴󠁧󠁢󠁷󠁬󠁳󠁿 as an empty box, a deliberate
omission that updates will not fix). The same gap hits anything newer than the device's
font: Segoe UI Emoji only gained the Unicode 13/14 additions (🫠 🫰 🫡 …) in Windows 11 22H2.
Collections get shared, so an icon has to survive being viewed on someone else's screen.

- FormulaBase now carries **all 1,849 emoji** it offers, as a subset of Noto Color Emoji
  (SIL OFL 1.1) — the vector COLRv1 build, 1.7 MB where the bitmap build of the same
  coverage would be 4.4 MB.
- It is a **fallback, not a replacement**: the first `@font-face` is `local()` only and
  names the platform emoji fonts, so a device with a complete font uses its own and
  downloads nothing. Font fallback reaches the bundled file only for the glyphs the
  platform font turned out to be missing, and the browser caches it from then on.
- Measured on three simulated devices — complete emoji font: **never fetched**; Windows-like
  (emoji font present, no flags): fetched the first time a flag is drawn, **not** on app
  start; no emoji font at all: fetched on load, and every one of the 1,849 renders.
- The font pair applies only to the elements that display an icon, never to body text, so
  characters such as © ® ™ ↔ stay plain text everywhere else.

## 0.4.13 — 2026-07-22

### Flags now render on Windows

- Windows ships no flag glyphs: Segoe UI Emoji draws 🇯🇵 as a boxed "JP" letter pair and
  🏴󠁧󠁢󠁷󠁬󠁳󠁿 as an empty box, so the 269 flags in the icon picker were unusable there. FormulaBase
  now carries a **flag-only subset of Noto Color Emoji** (SIL OFL 1.1) and declares it
  with a `unicode-range` limited to the flag code points: the browser fetches the file
  the first time a flag is actually drawn — not on app start — and then caches it. Every
  other emoji still comes from the system font, so nothing else changes.

## 0.4.12 — 2026-07-22

### The icon picker now holds every Unicode emoji

- The collection icon picker used to offer a hand-picked 404 emoji. It now contains the
  **complete Unicode 14.0 set — 1,849 emoji**, in the nine official Unicode groups
  (Smileys & Emotion, People & Body, Animals & Nature, Food & Drink, Travel & Places,
  Activities, Objects, Symbols, Flags), in the official emoji-ordering sequence. The
  curated **Calculation** set stays as the first tab.
- **Search box**: type to filter across all 1,849 by name or keyword, in your own
  language (CLDR names for all 12 UI languages). Japanese search is kana-insensitive,
  so "ねこ" finds ネコの顔.
- **Group tabs** replace one long scroll, and hovering an emoji shows its name.
- The emoji set is fetched only when the picker is first opened, so the app starts
  just as fast as before.
- The icon input accepts longer sequences (16 units instead of 8), so multi-codepoint
  emoji such as 🏴󠁧󠁢󠁷󠁬󠁳󠁿 or 👩‍❤️‍💋‍👩 can be typed or pasted without being cut off.
- The emoji category names are now translated into all 12 languages.

### Fixed: the Nextcloud user-status menu was broken on FormulaBase pages

- FormulaBase loads the "global" build of the Vue 3 runtime, which publishes `window.Vue`.
  A third-party library bundled into Nextcloud core (vue-resize) auto-installs into that
  global with the Vue 2 API — `window.Vue.use(...)` — which throws on a Vue 3 namespace
  and aborted the script that renders the user-status menu. FormulaBase now keeps its Vue
  copy private and leaves `window.Vue` untouched.

## 0.4.6 — 2026-07-20

- **App Store screenshots added** (8, in Japanese): formula list, live calculation with
  step-by-step working, several results in one collection, reverse solve (target result),
  the template picker (2,932 templates / 64 categories), the formula editor, settings,
  and collection settings.

## 0.4.5 — 2026-07-18

- Initial App Store release. 2,932 built-in formula templates across 64 categories,
  collections, named variables with labels / units / defaults, live evaluation with a
  safe (eval-free) expression engine, reverse solve, collection sharing (view / edit /
  delete), ODS export, backup / restore, and a 4-language UI (en / ja / es / zh).
