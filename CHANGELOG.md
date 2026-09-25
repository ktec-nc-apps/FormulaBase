# Changelog

All notable changes to FormulaBase.

## 0.8.0 — 2026-09-25

The 2,400 templates added in 0.7.0 now speak every language, and a set of fixes found by a review
of the whole app is included.
（0.7.0 で追加した 2,400 件のテンプレートが、すべての言語で使えるようになった。あわせて、アプリ
全体の点検で見つかったものを直した。）

### Languages

- **Every template and every screen is now translated into all 13 languages** — the 2,400
  templates added in 0.7.0 and the newer screens (Template settings, the function list) were in
  English and Japanese only.
  （**すべてのテンプレートと画面が 13 言語に対応した**。0.7.0 で追加した 2,400 件と新しい画面
  （テンプレート設定・関数の一覧）は、これまで英語と日本語だけだった。）
- **Brazilian Portuguese** is new. The Portuguese shipped so far is European Portuguese and is
  now named **Português (Portugal)**; if you had chosen it, it stays selected.
  （**ブラジルのポルトガル語**を加えた。これまでのポルトガル語は本国版で、名前を
  **Português (Portugal)** とした。選んでいた人はそのまま。）
- **The earlier translations were reviewed in every language**, and many terms that had been
  translated in their everyday sense were corrected (for example "stroke" of an engine,
  "charge" in physics, "discharge" of a river). The English and Japanese texts were reviewed as
  well, and variable labels that were in Japanese in the English templates are now in English.
  （**これまでの訳を全言語で見直した**。専門語を日常の意味で訳していたもの（エンジンの
  「行程」、物理の「電荷」、川の「流量」など）を多数直した。英語と日本語の文も見直し、英語の
  テンプレートで日本語になっていた変数名を英語にした。）

### Fixed

- **`sum` and `prod` with four plain values** (for example `sum(1, 2, 3, 4)`) are the total or
  product of those values; they were taken as Σ / Π and gave a wrong result, on the screen and
  in the spreadsheet export alike.
  （**値を 4 つ並べた `sum`・`prod`**（例 `sum(1, 2, 3, 4)`）を、その値の合計・積として計算する。
  これまでは Σ・Π として扱われ、画面でも表計算の書き出しでも誤った結果になった。）
- **A formula that is too long, too deeply nested or too heavy to calculate** now shows a
  message instead of freezing the page or keeping the server busy.
  （**長すぎる・入れ子が深すぎる・重すぎる式**は、画面を止めたりサーバーを使い続けたりせず、
  知らせを出す。）
- In a shared collection, how many versions a formula keeps follows the owner's setting, so an
  editor can no longer remove the owner's versions; a formula saved without changing its name
  or labels keeps the wording it was written in.
  （共有されたコレクションでは、式の版をいくつ残すかはオーナーの設定に従う。編集者がオーナーの
  版を消せない。名前やラベルを変えずに保存した式は、元の言葉のまま残る。）
- Saving one formula no longer resets the numbers typed into the others; switching collections
  quickly no longer shows another collection's formulas; Restore waits until the chosen backup
  has been read.
  （一つの式を保存しても、ほかの式に入力した数値が消えない。コレクションをすばやく切り替えても、
  別のコレクションの式が出ない。復元は、選んだバックアップを読み終えるまで押せない。）

## 0.7.0 — 2026-09-22

Thank you for the downloads, and for the comments on apps.nextcloud.com saying FormulaBase is
useful. No problems were reported against the template library up to 0.6.2, so this release adds
much more content — new formulas and new functions — while the way you use the app stays the same.
（多くのダウンロードと、apps.nextcloud.com での「役に立っている」というコメントをありがとうございます。
0.6.2 までテンプレートについて問題の報告が無かったため、この版ではこれまでの使い方は変えずに、
公式と関数を大きく追加した。）

With 5,522 formulas there are now far too many for us to debug on our own — if you find a wrong
formula, a bad default, a mistranslation or a missing unit, please tell us in the FormulaBase 0.7.0 thread
on help.nextcloud.com: https://help.nextcloud.com/t/formulabase-0-7-0-2-400-new-formula-templates-help-testing-them-is-very-welcome/249798 (a GitHub issue is fine too).
（公式が 5,522 件になり、私たちだけではデバッグしきれない。誤った公式・不適切な初期値・誤訳・
単位の誤りなどを見つけたら、help.nextcloud.com の FormulaBase 0.7.0 のスレッドで知らせてもらえると助かる
（GitHub の Issue でもよい）。）

### New: 2,400 more templates (5,522 in all)

- **2,400 new formula templates** in five areas:
  number theory (500); finance, accounting, insurance and pensions (500); AI and machine
  learning (400); physics, chemistry and engineering (600); medicine, statistics and biology
  (400). Each one was checked against an independent calculation, and against a published value
  where one exists. The whole library was checked for duplicates, and any found were removed.
  （**2,400 件のテンプレートを追加した**。数論 500・金融／会計／保険／年金 500・
  AI と機械学習 400・物理／化学／工学 600・医療／統計／生物 400。すべて別の方法で計算した
  値と照合し、公表値があるものはそれとも照合した。ライブラリ全体で重複を調べ、見つかったものは取り除いた。）
- The new templates are in English and Japanese. Other languages show them in English.
  （新しいテンプレートは英語と日本語。ほかの言語では英語で表示される。）

### New: templates grouped into 13 fields

- The template list is now arranged in two levels: 13 fields (Mathematics, Statistics
  and probability, AI and computing, Physics, …) and subcategories under each. Each field
  has its own heading, and related fields sit next to each other. This replaces the
  63 flat categories, whose names overlapped (for example "Money", "Finance" and
  "Accounting").
  （テンプレート一覧を 2 段にした。13 の大分類（数学・統計・確率・AI・コンピュータ・
  物理 など）の下に小分類がある。大分類ごとに見出しで区切り、近い分野を隣に並べた。
  名前が紛らわしかった従来の 63 分類（「お金」「金融」「会計」など）に代わる。）

### New: Template settings — hide templates you do not need

- **Settings → Template settings** shows every field, subcategory and template with a
  checkbox. Untick a whole field, a subcategory or a single template to hide it; "Show
  all" brings everything back. The choice is saved per user on the server.
  （**設定 → テンプレート設定**で、大分類・小分類・テンプレートをチェックの木で表示する。
  チェックを外すと大分類ごと・小分類ごと・1 件ずつ非表示にできる。「すべて表示」で元に戻る。
  利用者ごとにサーバーへ保存される。）
- Hidden templates never appear in the list, in search results (by name, description,
  formula, variable or category) or in the counts.
  （非表示のテンプレートは、一覧・検索結果（名前・説明・式・変数・分類のどれで探しても）・
  件数のどこにも出ない。）

### New: a much more capable formula engine

- **Lists, matrices and complex numbers** as variable types.
- **Conditions**: comparisons (`<`, `>=`, `==` …), `if()` and `piecewise()`.
- **Calculus**: Σ `sum()`, Π `prod()`, definite integrals, derivatives and `solve()`.
- **More than 200 functions** in all, including statistics, cash flows (npv, irr),
  vectors and matrices, number theory, special functions, probability distributions,
  and physical constants. A function list with short descriptions is available in the
  formula editor.
  （**数式エンジンを大幅に強化した**。リスト・行列・複素数の変数、比較と `if()`・`piecewise()`、
  Σ・Π・定積分・微分・`solve()`、統計・キャッシュフロー・ベクトルと行列・数論・特殊関数・
  確率分布・物理定数など **200 を超える関数**。数式編集画面から関数の一覧と説明を開ける。）
- All 3,122 existing templates give the same results as before.
  （既存の 3,122 件のテンプレートの計算結果は以前と変わらない。）

### Fixed: spreadsheet export

- 8 templates were exported with a wrong spreadsheet formula (a missing pair of
  parentheses around hypot, cbrt and root); this is fixed.
- Rounding (round, floor, ceil) of negative numbers now gives the same result in the
  exported spreadsheet as in the app.
- The normal distribution is written as `LEGACY.NORMSDIST` / `LEGACY.NORMSINV`, which
  LibreOffice accepts (it rejected `NORMSDIST` with Err:525).
- Parts a spreadsheet cannot compute (for example Σ or complex numbers) are written as
  their value. Every template was re-computed in LibreOffice after export and matched
  the app.
  （**表計算への書き出しを修正した**。8 件で式の括弧が欠けていた（hypot・cbrt・root）のを
  直した。負の数の丸め（round・floor・ceil）がアプリと一致するようにした。正規分布は
  LibreOffice が受け付ける `LEGACY.NORMSDIST`／`LEGACY.NORMSINV` で書く（`NORMSDIST` は
  Err:525 になっていた）。表計算で計算できない部分（Σ や複素数など）は値で書く。全テンプレートを
  書き出して LibreOffice で計算し直し、アプリと一致することを確かめた。）

### Changed

- "Modular Exponentiation (Small Values)" now computes exactly for large inputs. Its
  inputs and its default answer are unchanged.
  （「モジュラー指数演算（小規模値）」が大きな入力でも正確に計算するようにした。入力と初期値での答えは
  変わらない。）

## 0.6.2 — 2026-09-17

### Changed

- **Nextcloud 35 is now supported. There are no other changes.** The supported range
  is widened from 30–34 to 30–35. The app itself is unchanged from 0.6.1: it was tested
  on Nextcloud 35 against the changes that release makes for apps, and ran without
  modification.
  （**Nextcloud 35 に対応した。それ以外の変更はない。** 対応範囲を 30〜34 から 30〜35 に
  広げた。アプリ本体は 0.6.1 から変わっていない。Nextcloud 35 でアプリ向けに変わった点に
  照らして試験し、修正なしで動くことを確かめた。）

## 0.6.1 — 2026-09-08

### Fixed

- **Fixed a bug where clicking outside a dialog while entering data made the dialog
  disappear and discarded what you had typed.** It affected the data-entry dialogs —
  the collection editor, the formula editor, Settings, and the "Download all data"
  (backup) and "Restore from backup" dialogs: clicking the surrounding area no longer
  closes them, so nothing you were entering is lost; close them with ✕, Cancel or Save.
  The view-only and picker dialogs (the template browser, a formula's version history,
  the export options and the file picker) keep closing on an outside click, since they
  hold nothing you can lose.
  （データ入力中にダイアログの外側をクリックすると、ダイアログが消えて入力が失われてしまうバグを
  修正した。対象＝コレクション編集・数式編集・設定・「全データのダウンロード」（バックアップ）・
  「バックアップから復元」の各ダイアログ。外側クリックでは閉じなくなり、✕・キャンセル・保存で閉じる。
  閲覧/選択系のダイアログ（テンプレート一覧・数式の版履歴・書き出し設定・ファイル選択）は失う入力が
  ないため従来どおり外側クリックで閉じる。）

## 0.6.0 — 2026-09-01

### New: per-formula version history

- Every edit to a formula now keeps the version before it beside the formula
  itself — numbered #01 (newest) upward, with the oldest falling off past a
  configurable limit (default 10, up to 99, or 0 to turn it off).
- Configurable in Settings: how many versions to keep per formula, and
  whether one is taken automatically on every edit or only when you ask for
  one (the "Versions" button in the formula editor).
- Open "Versions" on any formula to see the list and put an earlier one back;
  restoring a version keeps the current content as a version of its own
  first, so a restore can itself be undone the same way.
- This is separate from the existing per-formula calculation history
  (record / restore / delete a calculation) — that log is untouched.

### Fixed: a formula added from a template could re-translate itself when you changed the display language

- Adding a formula from a template bakes its name, description, variable
  labels and notes into the language you were viewing at that moment — by
  design, so the formula becomes fully your own and can be edited like
  anything you typed yourself.
- The card display was re-running that text through the translator on every
  render. For a formula added while viewing in English, its text happened to
  still match the original English lookup key, so it kept getting
  re-translated on every later language switch — while the same formula
  added under any other language stayed correctly frozen. Now the stored
  text is shown as-is, so a formula's language stays whatever it was at the
  moment it was added or last saved, regardless of later language switches.
  Opening "Edit" still lets you re-save a formula in the current language on
  purpose, same as before.

## 0.5.2 — 2026-08-17

### New: brand-new logo

- Replaced the old placeholder icon everywhere it appeared — the Nextcloud app
  icon (top navigation bar and Settings > Apps), the in-app header, the welcome
  screen, and the loading screen — with FormulaBase's new two-color mark.
- Fixed the logo's on-screen size and proportions: cropped the icon artwork to
  its actual visible bounds (removing built-in empty margin) and corrected the
  CSS so the logo scales by its own aspect ratio instead of being forced into a
  square, which had been shrinking it inside its own space.

## 0.5.1 — 2026-08-14

### Fixed: ODS/ODT export — broken formula results and missing images

- **ODS "Result" cell showed a formula error ("Err:510") instead of the computed value.** The
  generated `table:formula` attribute used an `of:=` dialect prefix without declaring its XML
  namespace, which real LibreOffice rejects. Formulas are now written as plain `=...`, and the
  Result cell recalculates correctly when opened.
- **The embedded formula image didn't appear at all in ODS or ODT exports**, despite the file
  looking structurally correct (valid manifest, correct image bytes, well-formed XML). Verified
  against real LibreOffice (headless rendering, not just XML inspection): an image anchored
  inside a spreadsheet cell's paragraph is silently dropped by Calc. Images are now embedded as
  a table-level floating shape (`<table:shapes>`) — the same structure Calc itself writes when
  you paste a picture into a sheet — which renders correctly.
- Fixed a follow-on bug the image fix introduced: the blank rows reserved above the image
  shifted the variable/result rows down, so the Result formula's cell references (`B4`, `B5`,
  …) pointed at the wrong rows and evaluated to 0. Row numbering is now computed from the
  image's actual height instead of a fixed offset.

### Changed: Copy is now two explicit choices, not one ambiguous button

- The Output dialog's single "Copy" button (which wrote text and image together, letting the
  paste target guess which one to use) is now two buttons: **Copy as text** (Markdown trace
  only) and **Copy as image** (the rendered formula picture only) — so pasting into a chat, a
  document, or an image field reliably gets the type you meant, not whichever a mixed
  clipboard write happened to prefer.
- The small "Copy result" button next to a live calculation result now shows visible **Copy**
  text (and **Copied** when clicked) instead of a bare, unlabeled clipboard icon.

### New: resizable calculation-steps panel

- The boundary between the formula list and the "🧭 Calculation steps" / history panel can now
  be dragged to resize it.
- A new Settings field, **Calculation steps panel width**, sets it precisely with a slider
  (20%–50%, default 30%) instead of dragging. Both the drag and the slider save to the same
  per-user setting, so the width you left it at — however you set it — is restored the next
  time you open FormulaBase.

## 0.4.20 — 2026-08-13

### One "Output" button — copy or save, in your choice of format

- Replaced the small icon buttons in the side "Calculation steps" panel with a single
  **Output** button on every formula card, next to Edit/Delete — easier to find, and no
  longer limited to whichever formula happens to be active.
- The button opens a dialog: an "include the calculation steps" checkbox, then **Copy** or
  **Save**.
  - **Copy** writes the formula to the clipboard as text AND as its rendered-math image at
    once — a `text/html` entry carries both together for paste targets that support rich
    text, alongside plain `text/plain` and `image/png` fallbacks.
  - **Save** picks ONE format — **Markdown**, a real calculable **ODS** spreadsheet (variable
    values in editable cells, the result cell a genuine recalculating formula, not just its
    text), or an **ODT** report — then writes it into your own Nextcloud Files (no browser
    download) via a small built-in folder picker. Every format embeds the formula both ways,
    as text and as its rendered-math image (inline for Markdown, a real embedded picture for
    ODS/ODT).
  - The picker also lets you target an existing file instead of a plain destination folder —
    overwrite it, or append to the end.
- New Settings field, **Formula save destination**, sets the default folder Save opens to
  (root folder if left empty).

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
