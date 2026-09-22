# FormulaBase 🧮

**Save your own formulas, type in numbers, and calculate instantly — a personal calculator app for Nextcloud, with 5,522 built-in formula templates to get you started.**
**自分の計算式を登録して、数値を入れるだけで即計算できる Nextcloud 向けアプリ。5,522件の組み込みテンプレート付き。**

> Personal project · self-hosted · runs entirely inside your own Nextcloud.
> 個人プロジェクト · セルフホスト · あなた自身の Nextcloud の中だけで動作します。

[English ↓](#english) · [日本語 ↓](#japanese)

---

<a id="english"></a>

## English

FormulaBase is a lightweight personal calculator for the formulas you use again and again — markups, unit conversions, loan payments, mixing ratios, engineering constants, anything.

Organise your formulas into **collections**, define each formula's **variables** once, then open it any time, type in numbers, and read the result **live**. A right-hand panel shows the **step-by-step calculation** (values substituted in, then reduced one operation at a time), and every calculation you press **Record** on is kept in a per-formula **history** stored on the server.

### Why FormulaBase

- **You don't start from a blank page.** FormulaBase ships with **5,522 ready-made formula templates in 13 fields** — mathematics, statistics and probability, AI and computing, physics, space and Earth, chemistry and materials, engineering, personal money, investing and markets, business and accounting, economics, health and life sciences, and everyday life. The list is grouped by field, related fields sit side by side, and **Template settings** lets you hide whole fields, subcategories or single templates you never use. Search the library, drop a template straight into your own collection, and start calculating — no need to type out the formula yourself.
- **Nothing leaves your browser.** The expression engine is a small hand-written parser/AST evaluator — **no `eval`, no `new Function`, no `unsafe-eval`**. Every calculation runs client-side, instantly, with no round-trip to the server and no code-injection surface.
- **You can see the math, not just the answer.** The step-by-step trace panel substitutes your values into the formula and reduces it one operation at a time, so you (or a student, or a colleague) can follow exactly how the result was reached.
- **Your work is never lost.** Every formula keeps its own calculation history on the server — record a calculation, restore it later, delete what you don't need, scoped per user. Edits to a formula itself are protected too: the version before each edit is kept beside it, numbered and restorable, so a bad edit is never the end of the story.
- **Built for teams, not just individuals.** Share a collection with other Nextcloud users at three permission levels (view / edit / delete), so a department can maintain one shared set of formulas instead of everyone reinventing them.
- **Speaks your language.** The UI and the original 3,122 templates are localized — English, Japanese, Spanish, Chinese, French, German, Portuguese and more, with full technical/scientific terminology, not just menu labels. The 2,400 templates added in 0.7.0 and the newest screens (Template settings, the function list) are in English and Japanese so far; other languages show them in English.

### Features
- **5,522 built-in formula templates in 13 fields**, grouped by field — searchable and ready to drop into your own collections
- **Template settings** — hide whole fields, subcategories or single templates; hidden ones never appear in the list, in search or in the counts
- Collections of reusable formulas
- Named variables with labels, units and default values — numbers, lists, matrices or complex numbers
- **Safe expression engine** — a small parser/AST evaluator, **no `eval` / no `new Function`** (no `unsafe-eval`), with **more than 200 functions**: arithmetic, comparisons and conditions (`if`, `piecewise`), sums and products (Σ, Π), definite integrals, derivatives and equation solving (`solve`), statistics, cash flows (`npv`, `irr`), vectors and matrices, exact whole-number arithmetic for number theory (`gcd`, `isprime`, `powmod`, …), special functions, probability distributions and physical constants. A function list with short descriptions opens from the formula editor. Unicode (incl. Japanese) variable names supported.
- **Live result** as you type, with unit and decimal-place control
- **Step-by-step trace** of the calculation — one Output button copies it as text or as an image, or saves it into your Nextcloud Files in your choice of format: Markdown, a real calculable ODS spreadsheet, or an ODT report
- **Server-side history** per formula (record / restore / delete / clear), scoped per user
- **Version history** per formula — the version before each edit is kept beside it (numbered, restorable), independent of the calculation history above; how many to keep, and whether one is taken on every edit or only on request, is configurable in Settings
- **Internal sharing** — share a collection with other Nextcloud users at three permission levels (view / edit / delete)
- Multi-language UI and template library — English, Japanese, Spanish, Chinese, French, German, Portuguese and more (the 0.7.0 additions are in English and Japanese so far)

### Tech
Buildless Vue 3 (Options API). The template is precompiled to an eval-free render function (`formulabase-build.mjs` using `@vue/compiler-dom`); the runtime loads `vue.runtime.global.prod.js` + `formulabase.dist.js`. Backend: Nextcloud AppFramework (PHP), three tables (`formulabase_colls`, `formulabase_formulas`, `formulabase_history`).

Requires Nextcloud 30–35.

### Help us test the template library

Thank you for the downloads, and for the comments on apps.nextcloud.com saying FormulaBase is useful. No problems have been reported against the template library up to 0.6.2, so 0.7.0 adds much more to it — 2,400 more formulas (5,522 in 13 fields in all) and many new functions — while the way you use the app stays the same. Each of the new formulas was checked against an independent calculation — but with 5,522 formulas there are now far too many for us to debug on our own, so we would really welcome your help. If you spot a wrong formula, a bad default, a mistranslation, or a missing unit, please tell us in the [community thread on help.nextcloud.com](https://help.nextcloud.com/t/three-apps-i-built-for-my-own-nextcloud-instance-regibase-formulabase-talk-bot-feedback-welcome/247817) — even a one-line report helps. (A [GitHub issue](https://github.com/ktec-nc-apps/FormulaBase/issues/new?template=formula-report.yml) is fine too.)

---

<a id="japanese"></a>

## 日本語

FormulaBase は、何度も使う計算式（利益率、単位換算、ローン返済、配合比、各種定数など）を登録しておける、軽量な個人向け計算アプリです。

計算式を**コレクション**にまとめ、各式の**変数**を一度だけ定義しておけば、あとはいつでも開いて数値を入力するだけで結果が**リアルタイム**に出ます。画面右側には**計算の経過**（数値を代入し、1 演算ずつ簡約していく様子）が表示され、「**記録**」を押した計算は式ごとの**履歴**としてサーバーに保存されます。

### 機能

- **ゼロから式を作る必要がありません。** 数学・統計と確率・AI とコンピュータ・物理・宇宙と地球・化学と材料・工学・暮らしのお金・投資と市場・会社の会計と経営・経済学・医療と生命科学・暮らしの**13分野・5,522件の組み込み公式テンプレート**をあらかじめ搭載。一覧は分野ごとに区切って近い分野を隣に並べ、**テンプレート設定**で使わない分野・小分類・テンプレートを非表示にできます。ライブラリから検索して、そのまま自分のコレクションに追加するだけで使い始められます。
- **計算はすべてブラウザ内で完結。** 数式エンジンは自前実装の小さなパーサ／AST評価器で、**`eval`・`new Function` は一切不使用**（`unsafe-eval` なし）。サーバーへの通信も発生せず、コード実行のリスクもありません。
- **答えだけでなく、計算の過程が見えます。** 変数に値を代入し、1演算ずつ簡約していく様子をそのまま表示するので、自分自身の確認にも、学生や同僚への説明にも使えます。
- **入力した計算は失われません。** 式ごとにサーバー保存の計算履歴を持ち、記録・復元・削除ができます（ユーザーごとに独立）。式そのものの編集も保護されており、編集の直前の内容が番号付きで保存され、いつでも復元できます。
- **チームでも使えます。** コレクションを他のNextcloudユーザーと3段階の権限（閲覧／編集／削除）で共有でき、部署内で1つの式集を管理・共用できます。
- **多言語対応。** UIと元からの3,122件のテンプレートは、日本語・英語・スペイン語・中国語・フランス語・ドイツ語・ポルトガル語など多言語に対応し、専門用語もきちんと翻訳されています。0.7.0 で追加した2,400件と新しい画面（テンプレート設定・関数の一覧）は、今のところ日本語と英語のみで、ほかの言語では英語で表示されます。

### 特長
- **13分野・5,522件の組み込み公式テンプレート**（分野ごとに区切って表示）— 検索してそのままコレクションに追加可能
- **テンプレート設定** — 分野・小分類・テンプレート単位で非表示にでき、非表示にしたものは一覧・検索・件数のどこにも出ません
- 再利用できる計算式のコレクション
- ラベル・単位・初期値つきの名前付き変数 — 数値・リスト・行列・複素数
- **安全な数式エンジン** — 小さなパーサ／AST 評価器で **`eval`・`new Function` 不使用**（`unsafe-eval` なし）。**200を超える関数**：四則演算、比較と条件（`if`・`piecewise`）、総和・総乗（Σ・Π）、定積分・微分・方程式の解（`solve`）、統計、キャッシュフロー（`npv`・`irr`）、ベクトルと行列、数論のための正確な整数計算（`gcd`・`isprime`・`powmod` など）、特殊関数、確率分布、物理定数。関数の一覧と説明は数式エディタから開けます。日本語などの変数名も可
- 入力に応じて**即時に結果**を表示（単位・小数桁数の指定つき）
- **計算過程の可視化** — 「出力」ボタン1つでテキストまたは画像としてコピー、またはNextcloud内のフォルダへMarkdown・計算可能なODS表計算・ODTレポートから選んで保存可能
- 式ごとの**サーバー保存の履歴**（記録／復元／削除／全消去、ユーザー単位）
- **バージョン履歴** — 編集の直前の内容を式のそばに保存（番号付き・復元可能）。上記の計算履歴とは別の仕組みです。保存数と、毎回自動で残すか指示したときだけ残すかは設定で変更可能
- **内部共有** — コレクションを他のNextcloudユーザーと3段階の権限（閲覧／編集／削除）で共有
- UI・テンプレートとも多言語対応 — 日本語・英語・スペイン語・中国語・フランス語・ドイツ語・ポルトガル語など（0.7.0 の追加分は今のところ日本語と英語のみ）

Nextcloud 30〜35 対応。

### テンプレートの動作確認にご協力ください

多くのダウンロードと、apps.nextcloud.com での「役に立っている」というコメントをありがとうございます。0.6.2 までのテンプレートについて問題の報告は寄せられていないため、0.7.0 ではこれまでの使い方は変えずに、公式を2,400件（合計13分野・5,522件）と多くの関数を追加しました。追加した公式は、すべて別の方法で計算した値と照合していますが、5,522件ともなると私たちだけではとてもデバッグしきれません。ぜひご協力ください。誤った公式・不適切な初期値・誤訳・単位の誤りなどを見つけた方は、[help.nextcloud.com のコミュニティのスレッド](https://help.nextcloud.com/t/three-apps-i-built-for-my-own-nextcloud-instance-regibase-formulabase-talk-bot-feedback-welcome/247817)で教えていただけると助かります（一行程度の簡単な報告で構いません。[GitHub の Issue](https://github.com/ktec-nc-apps/FormulaBase/issues/new?template=formula-report.yml) でも受け付けます）。

---

## Screenshots

| | |
|---|---|
| ![Formula list](screenshots/01-formula-list.png) | ![Calculation](screenshots/02-calculation.png) |
| Formula list / 計算式一覧 | Calculation / 計算 |
| ![Money results](screenshots/03-money-results.png) | ![Reverse solve](screenshots/04-reverse-solve.png) |
| Money results / 金額結果 | Reverse solve / 逆算 |
| ![Templates](screenshots/05-templates.png) | ![Formula editor](screenshots/06-formula-editor.png) |
| Templates / テンプレート | Formula editor / 計算式エディタ |
| ![Settings](screenshots/07-settings.png) | ![Collection settings](screenshots/08-collection-settings.png) |
| Settings / 設定 | Collection settings / コレクション設定 |

## License
[AGPL-3.0](LICENSE) · © KTEC
