# FormulaBase 🧮

**Save your own formulas, type in numbers, and calculate instantly — a personal calculator app for Nextcloud.**
**自分の計算式を登録して、数値を入れるだけで即計算できる Nextcloud 向けアプリ。**

Made in Japan 🇯🇵 — a companion to [RegiBase](https://github.com/ktec-nc-apps/RegiBase).

---

## English

FormulaBase is a lightweight personal calculator for the formulas you use again and again — markups, unit conversions, loan payments, mixing ratios, engineering constants, anything.

Organise your formulas into **collections**, define each formula's **variables** once, then open it any time, type in numbers, and read the result **live**. A right-hand panel shows the **step-by-step calculation** (values substituted in, then reduced one operation at a time), and every calculation you press **Record** on is kept in a per-formula **history** stored on the server.

### Features
- Collections of reusable formulas
- Named variables with labels, units and default values
- **Safe expression engine** — a small parser/AST evaluator, **no `eval` / no `new Function`** (no `unsafe-eval`): `+ - * / % ^`, parentheses, and functions `sqrt cbrt abs round floor ceil trunc sign exp ln log log2 sin cos tan asin acos atan min max pow mod hypot root`, constants `pi e tau`. Unicode (incl. Japanese) variable names supported.
- **Live result** as you type, with unit and decimal-place control
- **Step-by-step trace** of the calculation
- **Server-side history** per formula (record / restore / delete / clear), scoped per user
- 10 built-in starter **templates** (circle area, BMI, tax, speed, Ohm's law, simple/compound interest, Pythagoras, °C↔°F)
- English / Japanese UI, light / dark theme — the same clean design as RegiBase

### Tech
Buildless Vue 3 (Options API). The template is precompiled to an eval-free render function (`formulabase-build.mjs` using `@vue/compiler-dom`); the runtime loads `vue.runtime.global.prod.js` + `formulabase.dist.js`. Backend: Nextcloud AppFramework (PHP), three tables (`formulabase_colls`, `formulabase_formulas`, `formulabase_history`).

Requires Nextcloud 30–32.

---

## 日本語

FormulaBase は、何度も使う計算式（利益率、単位換算、ローン返済、配合比、各種定数など）を登録しておける、軽量な個人向け計算アプリです。

計算式を**コレクション**にまとめ、各式の**変数**を一度だけ定義しておけば、あとはいつでも開いて数値を入力するだけで結果が**リアルタイム**に出ます。画面右側には**計算の経過**（数値を代入し、1 演算ずつ簡約していく様子）が表示され、「**記録**」を押した計算は式ごとの**履歴**としてサーバーに保存されます。

### 特長
- 再利用できる計算式のコレクション
- ラベル・単位・初期値つきの名前付き変数
- **安全な数式エンジン** — 小さなパーサ／AST 評価器で **`eval`・`new Function` 不使用**（`unsafe-eval` なし）。`+ - * / % ^`・括弧・各種関数・定数に対応。日本語などの変数名も可
- 入力に応じて**即時に結果**を表示（単位・小数桁数の指定つき）
- **計算過程の可視化**
- 式ごとの**サーバー保存の履歴**（記録／復元／削除／全消去、ユーザー単位）
- **テンプレート**を 10 種内蔵（円の面積・BMI・税込価格・速さ・オームの法則・単利／複利・ピタゴラス・摂氏↔華氏）
- 日本語／英語 UI、ライト／ダークテーマ（RegiBase と同じデザイン）

Nextcloud 30〜32 対応。

---

## License
[AGPL-3.0](LICENSE)
