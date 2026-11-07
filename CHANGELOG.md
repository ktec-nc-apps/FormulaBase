# Changelog

All notable changes to FormulaBase.

## 0.10.3 — 2026-11-08

The AI assistant can now work in FormulaBase itself.
（AI アシスタントが、FormulaBase の中を自分で操作できるようになりました。）

### Added

- **The AI assistant can work in FormulaBase itself** (with AI-Hub). It looks through every collection and formula the person can see — not only the open one — works formulas out on the server to check them, and searches the built-in templates. When the administrator allows it, it adds templates in the person's language, makes, changes and deletes formulas, and makes, renames and deletes collections. It acts with the rights of the person asking, so a shared collection only at its shared level. A formula it changes keeps its earlier form under "Versions"; a formula or collection it deletes can be put back by asking it (without its calculation history). The page shows the change as soon as the answer comes. In the administration settings, "What it may do" now has a third choice, "Make, change and delete formulas and collections", and "The built-in templates" can be chosen. Under each answer, "What was actually done" lists the changes the tools really made — taken from the record of the calls, not from the assistant's words — with what was added, changed or deleted, and any that failed.
  （**AI アシスタントが、AI-Hub を通して FormulaBase の中を自分で操作できるようになりました。** 開いているコレクションだけでなく、利用者が見られるすべてのコレクションと計算式を調べます。計算式をサーバーで計算して確かめ、組み込みのテンプレートも探します。管理者が許可すれば、テンプレートを利用者の言語で追加し、計算式の作成・変更・削除、コレクションの作成・名前の変更・削除も行います。操作は質問した人の権限で行い、共有されたコレクションは共有の権限までです。AI が変更した計算式の元の形は「バージョン」に残ります。AI が削除した計算式やコレクションは、AI に頼めば元に戻せます（計算の履歴は戻りません）。AI が答えると、画面にもすぐ反映されます。管理設定の「AI にできること」に 3 つ目の選択肢「計算式とコレクションの作成、変更、削除」を足し、「組み込みのテンプレート」も選べるようにしました。答えの下には「実際に行った操作」として、ツールが実際に行った変更（追加・変更・削除した物の名前と、失敗した物）を出します。AI の言葉ではなく、実際の呼び出しの記録から作っています。）

### Changed

- The assistant follows the permissions set in AI-Hub (0.1.7 or later): each of its tools says whether it reads, adds, changes or deletes, and what the administrator has not allowed there is not offered to it.
  （AI-Hub（0.1.7 以降）で設定した許可に従います。ツールごとに、読む・追加・変更・削除のどれかを申告し、管理者が許可していない操作はアシスタントに渡しません。）
- Templates that used one name for two different things now say which: "Statistical power" in the sample-size templates (it was shown as electrical power), "Weight (model parameter)" in gradient descent, and "Body weight" in the body, dosing and clinical templates.
  （1 つの名前を別々の意味に使っていたテンプレートを分けました。標本サイズのテンプレートでは「検出力」（これまでは電力と表示）、勾配降下法では「重み（モデルのパラメーター）」、体・薬の量・臨床のテンプレートでは「体重」にしました。）
- The README describes what the assistant can do today.
  （README の AI アシスタントの説明を、今の機能に合わせました。）

### Fixed

- **Translations reviewed.** Japanese was gone through in full — screens, templates, the README and the change notes — and corrected in about 1,800 places, among them wrong meanings such as "hypotenuse" used for any triangle and current assets written for quick assets. In every other language, the screens were checked line by line, and the templates whose Japanese had a wrong meaning were checked in every language.
  （**訳を見直しました。** 日本語は、画面・テンプレート・README・変更履歴の全体を点検し、約 1,800 か所を直しました。その中には、直角三角形でない三角形に「斜辺」を使っていた、当座資産を流動資産と書いていた、などの意味の誤りもあります。ほかの言語は、画面の言葉を 1 行ずつ点検し、日本語で意味の誤りがあったテンプレートを全言語で確かめました。）

## 0.10.0 — 2026-11-07

I am sorry. FormulaBase gave wrong results for some calculations, and some exported files were wrong or damaged. This version fixes them. It also adds 151 templates and eight languages, and changes two functions to work as they do in spreadsheets and in mathematics; a formula you saved with one of them gives a different result (see "Changed").
（申し訳ありません。FormulaBase が一部の計算で誤った結果を出し、書き出したファイルの一部が誤っていたり壊れたりしていました。この版で修正しました。あわせて、テンプレート 151 件と 8 言語を追加し、2 つの関数を表計算と数学の定義に合わせました。この 2 つの関数を使って保存した計算式は、結果が変わります（「変更」を参照）。）

### Added

- **151 templates (5,671 in all):** everyday life 92 (unit conversions 25, 24 of them Japanese traditional units; home, building and DIY 20, travel and driving 17, cooking and food 16, psychology and learning 14), business and accounting 21, personal money 17, investing and markets 11, economics 10.
  （**テンプレート 151 件（合計 5,671 件）：** 暮らし 92 件（単位換算 25（うち日本の伝統的な単位 24）、住まい・建築・DIY 20、旅行と運転 17、料理と食品 16、心理と学習 14）、会社の会計・経営 21 件、暮らしのお金 17 件、投資・市場 11 件、経済学 10 件。）
- **Eight more languages (21 in all):** Indonesian, Vietnamese, Turkish, Thai, Persian, Polish, Ukrainian and Czech. Terms that were still in English in the other languages are now translated. The translations were made with the help of AI and have not all been checked by native speakers; corrections are welcome on GitHub.
  （**8 言語を追加（合計 21 言語）：** インドネシア語、ベトナム語、トルコ語、タイ語、ペルシア語、ポーランド語、ウクライナ語、チェコ語。ほかの言語で英語のまま残っていた用語も訳しました。翻訳は AI を使って作成しており、すべてをその言語を母語とする人が確かめたわけではありません。誤りは GitHub でお知らせください。）

### Changed: results differ

- **`npv(r, cf)` now works as NPV() in a spreadsheet:** the first value is one period away (before, it was at time 0). `npv(0.1, list(-100, 60, 60))` was 4.13 and is now 3.76, the same as NPV(0.1; -100; 60; 60) in LibreOffice Calc and Excel.
  If you saved a formula with `npv` whose first value is at time 0 (an initial investment), change it to `npv(r, cf) * (1 + r)`, or add the first value separately. The template "Net Present Value of a Cash-Flow List" is changed this way. `irr` is not affected.
  （**`npv(r, cf)` を、表計算の NPV() と同じ計算にしました。** 最初の値を 1 期後とします（これまでは時点 0 でした）。`npv(0.1, list(-100, 60, 60))` は 4.13 でしたが、3.76 になります。LibreOffice Calc と Excel の NPV(0.1; -100; 60; 60) と同じです。
  最初の値が時点 0（初期投資など）のつもりで `npv` を使って保存した計算式は、`npv(r, cf) * (1 + r)` に書き換えるか、最初の値を別に足してください。テンプレート「キャッシュフローの並びの正味現在価値」は、この形に変えました。`irr` は変わりません。）
- **`stirling1(n, k)` is now signed,** as in mathematics: s(n, k) = (−1)^(n−k) × c(n, k). `stirling1(5, 2)` was 50 and is now −50. For the number of permutations with k cycles, use `abs(stirling1(n, k))`; the template "Stirling Numbers of the First Kind c(n, k)" is changed this way.
  （**`stirling1(n, k)` を、数学の定義どおり符号付きにしました。** s(n, k) = (−1)^(n−k) × c(n, k) です。`stirling1(5, 2)` は 50 でしたが、−50 になります。k 個の巡回からなる置換の数を求めるときは、`abs(stirling1(n, k))` を使ってください。テンプレート「第1種スターリング数 c(n, k)」は、この形に変えました。）

### Wrong results in the app

- **`root(x, n)` returned a number where no real root exists.** It worked out the sign of x and the root of |x| separately, so `root(-2.5, 2)` gave −1.58, `root(-2.5, 3.5)` gave −1.30 and `root(-1, -2)` gave −1. `root(x, 0)` gave ±∞ or 1 on the server and NaN on the screen.
  Fix: a negative x has a real root only when n is an odd whole number (`root(-8, 3)` = −2). Every other negative x, and n = 0, now gives NaN, on the server, on the screen and in exported spreadsheets.
  （**`root(x, n)` が、実数の根が無い場合にも数を返していました。** x の符号と |x| の根を別々に計算していたため、`root(-2.5, 2)` は −1.58、`root(-2.5, 3.5)` は −1.30、`root(-1, -2)` は −1 を返していました。`root(x, 0)` は、サーバーで ±∞ または 1、画面で NaN でした。
  対応：負の x に実数の根があるのは、n が奇数の整数のときだけです（`root(-8, 3)` = −2）。それ以外の負の x と n = 0 は、サーバー・画面・書き出した表計算のすべてで NaN を返します。）
- **The remainder had the wrong sign.** `%` and `mod()` kept the sign of the number divided (`-7 % 3` = −1, `mod(-2.5, 2)` = −0.5), while an exported spreadsheet gave 2 and 1.5.
  Fix: the remainder now has the sign of the divisor everywhere: `-7 % 3` = 2, `7 % -3` = −2. A divisor of 0 gives NaN. When the quotient is within 1e-12 of a whole number, the remainder is 0 (`mod(3.5, 0.7)` = 0).
  （**剰余の符号が誤っていました。** `%` と `mod()` は割られる数の符号を使っていたため（`-7 % 3` = −1、`mod(-2.5, 2)` = −0.5）、書き出した表計算の 2、1.5 と食い違っていました。
  対応：剰余は、すべての場所で割る数と同じ符号になります。`-7 % 3` = 2、`7 % -3` = −2 です。割る数が 0 なら NaN です。商が整数から 1e-12 以内なら剰余は 0 です（`mod(3.5, 0.7)` = 0）。）
- **Numbers that are equal compared as unequal.** `0.1 + 0.2 == 0.3`, `0.1 * 3 == 0.3` and `sqrt(2)^2 == 2` gave 0 because of binary rounding.
  Fix: two numbers within 1e-12 of each other (relative) are equal for `==` and `!=`; `<` and `>` mean "smaller/larger and not equal"; `<=` and `>=` mean "smaller/larger or equal".
  （**等しい数を「等しくない」と判定していました。** 2 進数の丸めのため、`0.1 + 0.2 == 0.3`、`0.1 * 3 == 0.3`、`sqrt(2)^2 == 2` が 0 でした。
  対応：相対 1e-12 以内の 2 つの数は、`==` と `!=` で等しいとみなします。`<` と `>` は「小さい／大きい、かつ等しくない」、`<=` と `>=` は「小さい／大きい、または等しい」です。）
- **Powers of a negative number.** `(-8)^(1/3)` gave NaN in the app and −2 in an exported spreadsheet.
  Fix: a negative base gives a real result for a whole-number exponent and for 1/n with an odd whole n (`(-8)^(1/3)` = −2, as `cbrt(-8)` already did). Other exponents give NaN (`(-8)^0.5`, `(-8)^(2/3)`).
  （**負の数のべき乗が食い違っていました。** `(-8)^(1/3)` は、アプリで NaN、書き出した表計算で −2 でした。
  対応：負の底は、指数が整数のときと、1/n（n は奇数の整数）のときに実数を返します（`(-8)^(1/3)` = −2。`cbrt(-8)` は前から −2 でした）。それ以外の指数は NaN です（`(-8)^0.5`、`(-8)^(2/3)`）。）
- **Values that exist came out as NaN:** Bessel functions (`besselj`, `bessely`, `besseli`, `besselk`) of a non-integer order (`besselj(0.5, 1)` is 0.671); `lgamma` of a negative non-integer (`lgamma(-0.5)` is 1.2655); `polylog(1, -1)` (−ln 2); `lambertw(-1/e)` (−1); `ellipf(φ, 1)` near φ = 0; `betapdf` at x = 0 and x = 1; `nbinpdf(0, r, 1)` (1); `logninv(0, …)` (0). `lgamma(1)` gave −8.9e-16 instead of 0.
  Fix: each now returns the correct value. Bessel functions of order above 1000, and J, Y, I of a negative x (not real), still give NaN.
  （**値が存在するのに NaN になっていました：** 非整数次数のベッセル関数（`besselj`、`bessely`、`besseli`、`besselk`。`besselj(0.5, 1)` は 0.671）、負の非整数の `lgamma`（`lgamma(-0.5)` は 1.2655）、`polylog(1, -1)`（−ln 2）、`lambertw(-1/e)`（−1）、φ が 0 付近の `ellipf(φ, 1)`、x = 0 と x = 1 の `betapdf`、`nbinpdf(0, r, 1)`（1）、`logninv(0, …)`（0）。また `lgamma(1)` が 0 でなく −8.9e-16 でした。
  対応：いずれも正しい値を返します。次数が 1000 を超えるベッセル関数と、負の x の J・Y・I（実数にならない）は、引き続き NaN です。）
- **Rounding was not the rounding of a spreadsheet.** `round` sent halves up (`round(-2.5)` gave −2, a spreadsheet's ROUND gives −3); `round(2.675, 2)` dropped the 2 and gave 3; `roundto(1.005, 2)` gave 1.00 and `roundto(0.285, 2)` 0.28, because the binary value of 1.005 is a little below it. Results shown with a set number of decimals had the same fault (1.005 shown as 1.00).
  Fix: `round(x)`, `round(x, d)` and `roundto(x, d)` round as ROUND does in LibreOffice Calc and Excel: halves away from zero, on the digits as written (`round(-2.5)` = −3, `round(1.005, 2)` = 1.01, `round(1255, -1)` = 1260). Exported spreadsheets use ROUND. Checked against LibreOffice Calc on 620 values: all the same. Results on the screen are rounded the same way.
  （**丸めが、表計算の四捨五入と違っていました。** `round` は 0.5 をいつも大きい方へ丸めていたため、`round(-2.5)` が −2 でした（表計算の ROUND は −3）。`round(2.675, 2)` は 2 を無視して 3 を返していました。`roundto(1.005, 2)` は 1.00、`roundto(0.285, 2)` は 0.28 でした。1.005 のコンピューターの中の値が、わずかに小さいためです。小数の桁数を決めて表示する結果も、同じ誤りがありました（1.005 を 1.00 と表示）。
  対応：`round(x)`、`round(x, d)`、`roundto(x, d)` は、LibreOffice Calc と Excel の ROUND と同じ四捨五入をします。0.5 は 0 から遠い方へ丸め、書いたとおりの数字で丸めます（`round(-2.5)` = −3、`round(1.005, 2)` = 1.01、`round(1255, -1)` = 1260）。書き出した表計算には ROUND を使います。LibreOffice Calc と 620 通りで突き合わせ、すべて一致しました。画面の結果の表示も、同じ丸め方にしました。）
- **An extra value was dropped without a word.** `sqrt(4, 5)`, `log(8, 2)` and the like used the first value and ignored the rest. They are now refused with "wrong number of values"; `logb(x, b)` is the logarithm to base b.
  （**余分な値を、黙って無視していました。** `sqrt(4, 5)` や `log(8, 2)` などは、最初の値だけを使い、残りを無視していました。現在は「値の数が違う」というエラーにします。底を決めた対数は `logb(x, b)` です。）
- **`logb(x, 1)` gave ±∞.** A logarithm to base 1 is undefined; it now gives NaN.
  （**`logb(x, 1)` が ±∞ を返していました。** 底 1 の対数は定義されないため、NaN を返します。）
- **The server and the screen disagreed.** `round(0.49999999999999994)` gave 1 on the server and 0 on the screen (0 is right); `root(1, 0)` gave 1 and NaN; `1.5.2` was read as 1.5 on the screen and refused on the server; `1^∞` differed. They now agree: 0, NaN, refused, 1. The screen's quick calculation of `%`, `^` and comparisons had its own shortcuts, which are removed.
  （**サーバーと画面の結果が食い違っていました。** `round(0.49999999999999994)` はサーバーで 1、画面で 0（正しいのは 0）、`root(1, 0)` は 1 と NaN、`1.5.2` は画面で 1.5 と読まれサーバーでは拒否、`1^∞` も違っていました。現在はそれぞれ 0、NaN、拒否、1 で一致します。画面の即時計算にあった `%`・`^`・比較の独自の簡略処理はやめました。）
- **Chained comparisons.** `3 > 2 > 1` was read as `(3 > 2) > 1`, that is `1 > 1`, and gave 0.
  Fix: a chain of comparisons means each pair holds: `3 > 2 > 1` is `3 > 2 and 2 > 1` and gives 1; `0 < x <= 10` checks that x is in the range.
  （**比較を続けて書いた式が誤っていました。** `3 > 2 > 1` は `(3 > 2) > 1`、つまり `1 > 1` と読まれ、0 でした。
  対応：比較を続けて書くと、隣り合うすべての組が成り立つかを調べます。`3 > 2 > 1` は `3 > 2 and 2 > 1` で 1 です。`0 < x <= 10` で x が範囲内かを調べられます。）
- **Distributions gave wrong values for large parameters.** `poisscdf(1e6, 1e6)` gave 0.6586 (right: 0.500266), `gammacdf(520000, 520000, 1)` gave 0.4175 (right: 0.500184), and the inverse functions (`tinv`, `chi2inv`, `gammainv`, `betainv`, `finv`) gave wrong values far in the tails. Densities, `lgamma` near 1 and 2, `norminv` near 1, and `expcdf`, `weibcdf`, `geomcdf` for very small values lost digits.
  Fix: the probability, cumulative and inverse functions of every distribution, and `gammainc`, `betainc`, `lgamma`, are computed by methods that keep full accuracy. Checked on about 7,400 values against SciPy and 40-digit references: all within 1e-12 (relative). No template result changes in the digits shown.
  （**分布の関数が、大きなパラメーターで誤った値を返していました。** `poisscdf(1e6, 1e6)` は 0.6586（正しくは 0.500266）、`gammacdf(520000, 520000, 1)` は 0.4175（正しくは 0.500184）でした。逆関数（`tinv`、`chi2inv`、`gammainv`、`betainv`、`finv`）は、裾の遠い所で誤った値でした。確率密度、1 と 2 の近くの `lgamma`、1 に近い所の `norminv`、ごく小さい値の `expcdf`・`weibcdf`・`geomcdf` も、桁落ちで精度が下がっていました。
  対応：すべての分布の確率・累積・逆関数と、`gammainc`、`betainc`、`lgamma` を、精度を落とさない方法で計算します。約 7,400 通りを SciPy と 40 桁の検算値で確かめ、すべて相対 1e-12 以内でした。表示する桁でテンプレートの結果が変わるものはありません。）
- **In right-to-left languages, numbers were reversed.** In Arabic and Persian, "-2.00" was shown as "2.00-", and a list typed as "1, 2; 3, 4" read back as "4 ,3 ;2 ,1". Values, the boxes they are typed into and the worked steps are now shown left to right.
  （**右から左へ書く言語で、数値が逆に表示されていました。** アラビア語とペルシア語で「-2.00」が「2.00-」と表示され、「1, 2; 3, 4」と入力した並びが「4 ,3 ;2 ,1」と表示されていました。値、値を入力する欄、計算の手順は、左から右に表示するようにしました。）
- **Texts and translations.** English texts that had Japanese mixed into them (105 places) are corrected, and one Brazilian Portuguese sentence written the European way now reads as it does in Brazil.
  （**文章と翻訳。** 英語の原文に日本語が混ざっていた 105 か所を直しました。また、ブラジル向けポルトガル語で、ポルトガルの言い方になっていた 1 か所を、ブラジルの言い方に直しました。）

### Wrong or damaged exported files (.ods / .odt)

- **Numbers were cut to 10 decimal places.** A variable of 1.2345678901e-5 was saved as 0.0000123457, the spreadsheet recalculated from the cut value, and the report (.odt) showed the cut result.
  Fix: variables are saved with every digit; the report shows 15 significant digits.
  （**数値が小数 10 桁に切り捨てられていました。** 変数 1.2345678901e-5 は 0.0000123457 として保存され、表計算はその値から再計算し、レポート（.odt）も切り捨てた結果を表示していました。
  対応：変数はすべての桁を保存します。レポートは有効数字 15 桁で表示します。）
- **Whole-number functions in exported spreadsheets.** The spreadsheet worked out `fact(2.5)` as 2 (the app gives NaN), and gave errors for `gcd`/`lcm` of negative numbers and for `binom(5, 7)`, `perm(3, 5)` (the app gives the correct values).
  Fix: the formulas written to the spreadsheet now give the same results as the app.
  （**書き出した表計算の整数の関数が誤っていました。** 表計算では `fact(2.5)` が 2（アプリは NaN）、負の数の `gcd`/`lcm` と `binom(5, 7)`、`perm(3, 5)` がエラー（アプリは正しい値）でした。
  対応：表計算に書く式を、アプリと同じ結果になる形にしました。）
- **Adding to an existing spreadsheet pointed the result at the wrong rows.** The variable rows were counted as in a new file, so the result cell referred to rows at the top of the sheet; a second addition used the first one's variables, and a picture was placed over the first table.
  Fix: new rows and pictures are placed below the last row of the sheet, and the result refers to them. If the sheet has no room left, the addition is refused and the file is not changed.
  （**既存の表計算への追記で、結果が誤った行を参照していました。** 変数の行を新しいファイルと同じ位置として数えていたため、結果のセルがシートの先頭の行を参照していました。2 回目の追記は 1 回目の変数を使い、画像は先頭の表に重なっていました。
  対応：新しい行と画像はシートの最後の行の下に置き、結果はその行を参照します。シートに空きの行が無い場合は追記せず、ファイルは変更しません。）
- **Adding a picture to a spreadsheet exported by FormulaBase damaged it.** Elements were inserted without the declarations they need, and the file was overwritten with the damaged content.
  Fix: elements are inserted as XML with the declarations they need; the result is checked before writing; a file that cannot be read or updated is refused and left as it was.
  （**FormulaBase で書き出した表計算に画像付きで追記すると、ファイルが壊れていました。** 必要な宣言の無いまま要素を差し込み、壊れた内容で元のファイルを上書きしていました。
  対応：要素を、必要な宣言と一緒に XML として入れます。書き込む前に結果を確かめ、読めない・更新できないファイルには書き込まず、元のまま残します。）
- **A variable without a key shifted the rows.** Only possible through the API or an edited backup: every later variable referred to the wrong cell.
  Fix: such rows no longer shift the references.
  （**key の無い変数があると、行がずれていました。** API または手を加えたバックアップの場合だけですが、以降の変数がすべて誤ったセルを参照していました。
  対応：そのような行で参照がずれなくなりました。）
- **Many functions were written to the spreadsheet as fixed values.** 17 more are now written as formulas that recalculate: `clamp`, `logb`, `sec`, `csc`, `cot`, `normpdf`, `normcdf`, `lognpdf`, `logncdf`, `exppdf`, `expcdf`, `expinv`, `weibpdf`, `weibcdf`, `weibinv`, `geompdf`, `geomcdf`. Checked against LibreOffice Calc: within 1e-12.
  Where a result still cannot be written as a formula, a note beside it says: "This value is calculated by FormulaBase and does not recalculate in the spreadsheet."
  （**多くの関数が、表計算に固定の値として書かれていました。** 次の 17 関数を、再計算する式として書くようにしました：`clamp`、`logb`、`sec`、`csc`、`cot`、`normpdf`、`normcdf`、`lognpdf`、`logncdf`、`exppdf`、`expcdf`、`expinv`、`weibpdf`、`weibcdf`、`weibinv`、`geompdf`、`geomcdf`。LibreOffice Calc と突き合わせ、差は 1e-12 以内です。
  式にできない結果には、横に「この値は FormulaBase で計算したもので、表計算ソフトでは再計算されません。」と注記します。）
- A formula too long for a spreadsheet cell (over 4,000 characters) is written as its value instead of a formula.
  （表計算のセルに入らないほど長い式（4,000 文字超）は、式ではなく値として書きます。）

### Files exported before this version

A spreadsheet or report exported earlier may contain a wrong value if it used one of the calculations above, a variable with more than 10 decimal places, or was added to an existing spreadsheet. Please export it again. Nothing stored in FormulaBase needs to change: the results shown on the screen are corrected as they are. The calculation history keeps the results as they were recorded.
（以前に書き出した表計算やレポートは、上の計算を使ったもの、小数 10 桁より細かい変数を使ったもの、既存の表計算に追記したものに、誤った値が含まれることがあります。再度書き出してください。FormulaBase の中のデータを直す必要はなく、画面の結果は自動的に正しくなります。計算履歴は、記録した時点の結果のままです。）

## 0.9.2 — 2026-10-18

One Brazilian Portuguese sentence written the European way ("continua a ser") now reads as it does in Brazil. No feature was added or changed.
（ブラジル向けポルトガル語で、ポルトガルの言い方になっていた 1 か所（「continua a ser」）を、ブラジルの言い方に直しました。機能の追加や変更はありません。）

## 0.9.1 — 2026-10-11

Only the Japanese text was rewritten — the README, the App Store description and the changelog — to read naturally. No feature was added or changed.
（README・App Store の説明・変更履歴の日本語の文章を、自然な日本語に差し替えただけです。機能の追加や変更はありません。）

## 0.9.0 — 2026-10-08

An AI assistant, through the new AI-Hub app, and the fixes from a review of the whole app.
（新しいアプリ AI-Hub を利用した AI アシスタントを追加し、アプリ全体の見直しで見つかった問題を修正しました。）

### Added

- **An AI assistant, through the AI-Hub app.** A chat beside the formulas that knows FormulaBase and how its expressions are written. It answers in words and writes a formula out as text you can type in; it changes nothing, and it reads the open collection only as the administrator allows. Administration settings → FormulaBase → AI assistant: on or off, who may use it, what it may read. Shown only when AI-Hub is installed.
  （**AI-Hub アプリを利用した AI アシスタントを追加しました。** 計算式の横に、FormulaBase と計算式の書き方を理解したチャットが表示されます。質問には文章で答え、計算式はそのまま入力できるテキストとして示します。データを変更することはなく、開いているコレクションは管理者が許可した範囲でのみ読み取ります。管理者設定 → FormulaBase → AI アシスタントで、有効・無効、利用できるユーザー、読み取れる範囲を設定できます。AI-Hub がインストールされている場合にのみ表示されます。）

### Fixed

- **A formula that takes too long now stops.** Expressions such as `primepi(1e11)` or `partitions(100000)` could hold a server process for minutes; the calculation now stops after 15 seconds with "The calculation is too large to finish."
  （**時間がかかりすぎる計算は、途中で止まるようにしました。** `primepi(1e11)` や `partitions(100000)` などの式が、サーバーのプロセスを数分間占有することがありました。現在は 15 秒で計算を打ち切り、「計算が大きすぎて終わりません。」と表示します。）
- **Huge matrices no longer use up the server's memory.** A product that would have a hundred million cells now gives NaN; a backup file or its data that is too large is refused.
  （**巨大な行列でサーバーのメモリーを使い切らないようにしました。** 結果が 1 億セルになる行列の積は NaN を返します。大きすぎるバックアップファイルやそのデータは受け付けません。）
- **Dividing by zero and the like no longer breaks an export.** `csc(0)`, `logb(5,1)`, `root(8,0)` and similar gave an ODS export an error, or dropped the result row of an ODT; they now give ∞ or NaN, as on the screen.
  （**ゼロ除算などで書き出しが失敗しないようにしました。** `csc(0)`、`logb(5,1)`、`root(8,0)` などで、ODS の書き出しがエラーになったり、ODT で結果の行が抜けたりしていました。現在は画面と同じく ∞ または NaN になります。）
- **Restoring a backup over a collection is checked first and done in one step**, so a broken backup no longer leaves the collection empty.
  （**バックアップでコレクションを上書き復元するときは、先に内容を確認してから一括で処理するようにしました。** 壊れたバックアップを使っても、コレクションが空になることはありません。）
- **Choosing whom to share with follows Nextcloud's sharing settings.** Everybody could be listed, outside the groups the administrator allows.
  （**共有相手の選択が、Nextcloud の共有設定に従うようにしました。** これまでは、管理者が許可したグループ以外のユーザーも一覧に表示されていました。）
- **Names, icons and colours that are too long** are cut or refused instead of causing an error.
  （**長すぎる名前、アイコン、色は**、エラーにせず、切り詰めるか受け付けないようにしました。）
- **Deleting a formula, or an account, deletes the history kept for it**; it used to be left behind.
  （**計算式やアカウントを削除すると、その履歴も削除されるようにしました。** これまでは残ったままでした。）

## 0.8.0 — 2026-09-25

The 2,400 templates added in 0.7.0 now speak every language, and a set of fixes found by a review
of the whole app is included.
（0.7.0 で追加した 2,400 件のテンプレートが、すべての言語で使えるようになりました。あわせて、アプリ全体の点検で見つかった問題を直しました。）

### Languages

- **Every template and every screen is now translated into all 13 languages** — the 2,400
  templates added in 0.7.0 and the newer screens (Template settings, the function list) were in
  English and Japanese only.
  （**すべてのテンプレートと画面が 13 言語に対応しました。** 0.7.0 で追加した 2,400 件と新しい画面（テンプレート設定・関数の一覧）は、これまで英語と日本語だけでした。）
- **Brazilian Portuguese** is new. The Portuguese shipped so far is European Portuguese and is
  now named **Português (Portugal)**; if you had chosen it, it stays selected.
  （**ブラジルのポルトガル語**を追加しました。これまでのポルトガル語はヨーロッパのポルトガル語で、名前を **Português (Portugal)** に変えました。選んでいた場合は、そのまま選ばれています。）
- **The earlier translations were reviewed in every language**, and many terms that had been
  translated in their everyday sense were corrected (for example "stroke" of an engine,
  "charge" in physics, "discharge" of a river). The English and Japanese texts were reviewed as
  well, and variable labels that were in Japanese in the English templates are now in English.
  （**これまでの訳を全言語で見直しました。** 日常の意味で訳していた専門用語を多数直しました（例：エンジンの stroke →「行程」、物理の charge →「電荷」、川の discharge →「流量」）。英語と日本語の文も見直し、英語のテンプレートで日本語になっていた変数のラベルを英語にしました。）

### Fixed

- **`sum` and `prod` with four plain values** (for example `sum(1, 2, 3, 4)`) are the total or
  product of those values; they were taken as Σ / Π and gave a wrong result, on the screen and
  in the spreadsheet export alike.
  （**値を 4 つ並べた `sum`・`prod`**（例：`sum(1, 2, 3, 4)`）を、その値の合計・積として計算するようにしました。これまでは Σ・Π として扱われ、画面でも表計算の書き出しでも誤った結果になっていました。）
- **A formula that is too long, too deeply nested or too heavy to calculate** now shows a
  message instead of freezing the page or keeping the server busy.
  （**長すぎる・入れ子が深すぎる・重すぎる計算式**は、画面を止めたりサーバーに負荷をかけ続けたりせず、メッセージを表示するようにしました。）
- In a shared collection, how many versions a formula keeps follows the owner's setting, so an
  editor can no longer remove the owner's versions; a formula saved without changing its name
  or labels keeps the wording it was written in.
  （共有されたコレクションでは、計算式のバージョンをいくつ残すかはオーナーの設定に従うようにしました。編集者がオーナーのバージョンを消すことはできません。名前やラベルを変えずに保存した計算式は、元の文言のまま残ります。）
- Saving one formula no longer resets the numbers typed into the others; switching collections
  quickly no longer shows another collection's formulas; Restore waits until the chosen backup
  has been read.
  （1 つの計算式を保存しても、ほかの計算式に入力した数値が消えないようにしました。コレクションをすばやく切り替えても、別のコレクションの計算式が表示されないようにしました。「復元」ボタンは、選んだバックアップを読み終えるまで押せないようにしました。）

## 0.7.0 — 2026-09-22

Thank you for the downloads, and for the comments on apps.nextcloud.com saying FormulaBase is
useful. No problems were reported against the template library up to 0.6.2, so this release adds
much more content — new formulas and new functions — while the way you use the app stays the same.
（多くのダウンロードと、apps.nextcloud.com での「役に立っている」というコメントをありがとうございます。
0.6.2 までテンプレートについて問題の報告が無かったため、この版では使い方は変えずに、計算式と関数を大幅に追加しました。）

With 5,522 formulas there are now far too many for us to debug on our own — if you find a wrong
formula, a bad default, a mistranslation or a missing unit, please tell us in the FormulaBase 0.7.0 thread
on help.nextcloud.com: https://help.nextcloud.com/t/formulabase-0-7-0-2-400-new-formula-templates-help-testing-them-is-very-welcome/249798 (a GitHub issue is fine too).
（計算式が 5,522 件になり、私たちだけでは確かめきれません。誤った計算式・不適切な初期値・誤訳・単位の抜けなどを見つけたら、help.nextcloud.com の FormulaBase 0.7.0 のスレッドでお知らせください（GitHub の Issue でもかまいません）。）

### New: 2,400 more templates (5,522 in all)

- **2,400 new formula templates** in five areas:
  number theory (500); finance, accounting, insurance and pensions (500); AI and machine
  learning (400); physics, chemistry and engineering (600); medicine, statistics and biology
  (400). Each one was checked against an independent calculation, and against a published value
  where one exists. The whole library was checked for duplicates, and any found were removed.
  （**2,400 件のテンプレートを追加しました。** 数論 500、金融・会計・保険・年金 500、AI と機械学習 400、物理・化学・工学 600、医療・統計・生物 400 です。すべて別の方法で計算した値と照合し、公表値があるものはそれとも照合しました。ライブラリ全体で重複を調べ、見つかったものは取り除きました。）
- The new templates are in English and Japanese. Other languages show them in English.
  （新しいテンプレートは英語と日本語です。ほかの言語では英語で表示されます。）

### New: templates grouped into 13 fields

- The template list is now arranged in two levels: 13 fields (Mathematics, Statistics
  and probability, AI and computing, Physics, …) and subcategories under each. Each field
  has its own heading, and related fields sit next to each other. This replaces the
  63 flat categories, whose names overlapped (for example "Money", "Finance" and
  "Accounting").
  （テンプレートの一覧を 2 段にしました。13 の分野（数学、統計・確率、AI・コンピュータ、物理 など）の下に小分類があります。分野ごとに見出しで区切り、関連する分野を隣に並べました。名前が紛らわしかった従来の 63 分類（「お金」「金融」「会計」など）に代わるものです。）

### New: Template settings — hide templates you do not need

- **Settings → Template settings** shows every field, subcategory and template with a
  checkbox. Untick a whole field, a subcategory or a single template to hide it; "Show
  all" brings everything back. The choice is saved per user on the server.
  （**設定 → テンプレート設定**で、分野・小分類・テンプレートをすべてチェックボックス付きで表示します。チェックを外すと、分野ごと・小分類ごと・1 件ずつ非表示にできます。「すべて表示」で元に戻ります。選択は利用者ごとにサーバーに保存されます。）
- Hidden templates never appear in the list, in search results (by name, description,
  formula, variable or category) or in the counts.
  （非表示のテンプレートは、一覧・検索結果（名前・説明・式・変数・分類のどれで探しても）・件数のどこにも表示されません。）

### New: a much more capable formula engine

- **Lists, matrices and complex numbers** as variable types.
- **Conditions**: comparisons (`<`, `>=`, `==` …), `if()` and `piecewise()`.
- **Calculus**: Σ `sum()`, Π `prod()`, definite integrals, derivatives and `solve()`.
- **More than 200 functions** in all, including statistics, cash flows (npv, irr),
  vectors and matrices, number theory, special functions, probability distributions,
  and physical constants. A function list with short descriptions is available in the
  formula editor.
  （**数式エンジンを大幅に強化しました。** リスト・行列・複素数の変数、比較と `if()`・`piecewise()`、Σ・Π・定積分・微分・`solve()` に対応し、統計・キャッシュフロー・ベクトルと行列・数論・特殊関数・確率分布・物理定数など **200 を超える関数**を使えます。計算式エディターから関数の一覧と説明を開けます。）
- All 3,122 existing templates give the same results as before.
  （既存の 3,122 件のテンプレートの計算結果は、以前と変わりません。）

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
  （**表計算への書き出しを修正しました。** 8 件で式の括弧が欠けていた（hypot・cbrt・root）のを直しました。負の数の丸め（round・floor・ceil）がアプリと一致するようにしました。正規分布は、LibreOffice が受け付ける `LEGACY.NORMSDIST`／`LEGACY.NORMSINV` で書きます（`NORMSDIST` は Err:525 になっていました）。表計算で計算できない部分（Σ や複素数など）は値で書きます。全テンプレートを書き出して LibreOffice で計算し直し、アプリと一致することを確かめました。）

### Changed

- "Modular Exponentiation (Small Values)" now computes exactly for large inputs. Its
  inputs and its default answer are unchanged.
  （「べき剰余（小さな値）」が、大きな入力でも正確に計算できるようにしました。入力と、初期値での答えは変わりません。）

## 0.6.2 — 2026-09-17

### Changed

- **Nextcloud 35 is now supported. There are no other changes.** The supported range
  is widened from 30–34 to 30–35. The app itself is unchanged from 0.6.1: it was tested
  on Nextcloud 35 against the changes that release makes for apps, and ran without
  modification.
  （**Nextcloud 35 に対応しました。それ以外の変更はありません。** 対応範囲を 30〜34 から 30〜35 に広げました。アプリ本体は 0.6.1 から変わっていません。Nextcloud 35 でアプリ向けに変わった点に照らして試験し、修正なしで動くことを確かめました。）

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
  （データの入力中にダイアログの外側をクリックすると、ダイアログが消えて入力した内容が失われるバグを修正しました。対象は、コレクションの編集・計算式の編集・設定・「全データをダウンロード」（バックアップ）・「バックアップから復元」の各ダイアログです。外側をクリックしても閉じなくなり、✕・キャンセル・保存で閉じます。表示や選択だけのダイアログ（テンプレート一覧・計算式のバージョン履歴・書き出しの設定・ファイルの選択）は、失われる入力が無いため、これまでどおり外側のクリックで閉じます。）

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
