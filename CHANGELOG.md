# Changelog

All notable changes to FormulaBase.

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
