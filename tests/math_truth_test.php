<?php
/**
 * Every result is the mathematically correct one, in all three places it is calculated:
 *   php   the engine behind the export and the AI assistant (FormulaCompiler)
 *   js    the engine behind the live result on screen (js/formulabase.js, run in node)
 *   ods   the spreadsheet formula written into an exported .ods, recalculated by LibreOffice
 * and the three agree. The cases are the ones that were wrong: root of a negative number, the sign of
 * a remainder, comparisons of sums that are equal on paper, powers of negative numbers, whole-number
 * functions given a fraction, the rounding of a value just under a half, and the values that came out
 * NaN although they are defined.
 */
require __DIR__ . '/boot.php';

const NAN_ = 'NaN';
$cases = [
	// n-th root on the real numbers: none for n = 0, nor for a negative x unless n is an odd whole number
	['root(x, y)', ['x' => -2.5, 'y' => 2], NAN_], ['root(x, y)', ['x' => -2.5, 'y' => 3.5], NAN_], ['root(x, y)', ['x' => -1, 'y' => -2], NAN_],
	['root(x, y)', ['x' => -8, 'y' => 3], -2.0], ['root(x, y)', ['x' => -27, 'y' => -3], -1 / 3], ['root(x, y)', ['x' => 8, 'y' => 3], 2.0],
	['root(x, y)', ['x' => 1, 'y' => 0], NAN_], ['root(x, y)', ['x' => -1, 'y' => 0], NAN_], ['root(x, y)', ['x' => 5, 'y' => 0], NAN_],
	['root(x, y)', ['x' => 0, 'y' => -2], 'INF'],
	// the remainder: the sign of the divisor, so never negative for a positive divisor
	['-7 % 3', [], 2.0], ['7 % -3', [], -2.0], ['10 % 3', [], 1.0], ['-6 % 3', [], 0.0],
	['mod(x, y)', ['x' => -2.5, 'y' => 2], 1.5], ['mod(x, y)', ['x' => -1, 'y' => 3], 2.0], ['mod(x, y)', ['x' => 0.5, 'y' => -3], -2.5],
	['mod(x, y)', ['x' => 3.5, 'y' => 0.7], 0.0], ['mod(x, y)', ['x' => 5.2, 'y' => 5], 0.2], ['mod(x, y)', ['x' => 5, 'y' => 0], NAN_],
	// comparisons: sums that are equal on paper are equal
	['0.1 + 0.2 == 0.3', [], 1.0], ['0.1 + 0.2 != 0.3', [], 0.0], ['0.1 + 0.2 < 0.3', [], 0.0], ['0.1 + 0.2 <= 0.3', [], 1.0], ['0.1 + 0.2 >= 0.3', [], 1.0], ['0.3 > 0.1 + 0.2', [], 0.0],
	['0.1 * 3 == 0.3', [], 1.0], ['sqrt(2)^2 == 2', [], 1.0], ['1 == 1 + 1e-9', [], 0.0], ['1 == 1 + 1e-13', [], 1.0], ['1e-30 == 0', [], 0.0], ['2 < 3', [], 1.0], ['3 <= 2', [], 0.0],
	['x == y', ['x' => 0.1 + 0.2, 'y' => 0.3], 1.0], ['if(x == y, 10, 20)', ['x' => 0.1 + 0.2, 'y' => 0.3], 10.0],
	// powers of negative numbers: real where mathematics has a real answer
	['(-8)^(1/3)', [], -2.0], ['(-27)^(1/3)', [], -3.0], ['(-32)^0.2', [], -2.0], ['(-8)^(2/3)', [], NAN_], ['(-8)^0.5', [], NAN_],
	['pow(x, y)', ['x' => -8, 'y' => 1 / 3], -2.0], ['x^y', ['x' => -27, 'y' => 1 / 3], -3.0], ['x^y', ['x' => -27, 'y' => 0.5], NAN_], ['x^y', ['x' => -2, 'y' => 3], -8.0], ['x^y', ['x' => 1, 'y' => 1e308], 1.0],
	// whole-number functions: a fraction is outside their domain; gcd/lcm take any sign; binom/perm are 0 outside 0..n
	['fact(x)', ['x' => 2.5], NAN_], ['fact(x)', ['x' => 5], 120.0], ['gcd(x, y)', ['x' => 2.5, 'y' => 5], NAN_], ['binom(x, y)', ['x' => 2.5, 'y' => 1], NAN_],
	['gcd(x, y)', ['x' => -12, 'y' => 18], 6.0], ['gcd(x, y)', ['x' => 0, 'y' => -6], 6.0], ['lcm(x, y)', ['x' => -4, 'y' => 6], 12.0], ['lcm(x, y)', ['x' => -12, 'y' => 0], 0.0],
	['binom(x, y)', ['x' => 5, 'y' => 7], 0.0], ['binom(x, y)', ['x' => 5, 'y' => -1], 0.0], ['binom(x, y)', ['x' => 10, 'y' => 3], 120.0], ['perm(x, y)', ['x' => 3, 'y' => 5], 0.0], ['perm(x, y)', ['x' => 5, 'y' => 2], 20.0],
	// rounding: halves go up; a value just under a half goes down
	['round(x)', ['x' => 0.49999999999999994], 0.0], ['round(x)', ['x' => 2.5], 3.0], ['round(x)', ['x' => -2.5], -3.0],
	// ROUND as in spreadsheets: half away from zero, the digits as written (1.005 → 1.01)
	['round(x, 2)', ['x' => 2.675], 2.68], ['round(x, 2)', ['x' => 1.005], 1.01], ['round(x, 2)', ['x' => 0.285], 0.29], ['round(x, 2)', ['x' => -1.005], -1.01],
	['round(x, -1)', ['x' => 1234.5], 1230.0], ['round(x, -1)', ['x' => 1255], 1260.0], ['round(x, 1)', ['x' => -5.55], -5.6], ['round(x, 2)', ['x' => 9.995], 10.0],
	['roundto(x, 2)', ['x' => 1.005], 1.01], ['roundto(x, 0)', ['x' => -2.5], -3.0], ['round(x)', ['x' => 1.4999], 1.0], ['round(x)', ['x' => -0.4], 0.0],
	// defined, and used to be NaN
	['besselj(x, y)', ['x' => 0.5, 'y' => 1], 0.6713967071418031], ['besselj(x, y)', ['x' => -0.5, 'y' => 2], -0.23478571040624846], ['besselj(x, y)', ['x' => 2.3, 'y' => 12], 0.009835916897741019],
	['besselj(x, y)', ['x' => 10.5, 'y' => 0.1], 1.8346985880035505e-21], ['besselj(x, y)', ['x' => 0, 'y' => 0], 1.0],
	['bessely(x, y)', ['x' => 1.5, 'y' => 3], 0.08700809072083528], ['bessely(x, y)', ['x' => 0.5, 'y' => 0.1], -2.5105273689585093],
	['besseli(x, y)', ['x' => 0.5, 'y' => 2], 2.046236863089055], ['besseli(x, y)', ['x' => -1.5, 'y' => 40], 1.4476512910296416e+16],
	['besselk(x, y)', ['x' => 0.5, 'y' => 1], 0.46106850444789454], ['besselk(x, y)', ['x' => 2.3, 'y' => 0.5], 13.50965388130364],
	['lgamma(x)', ['x' => -0.5], 1.2655121234846454], ['lgamma(x)', ['x' => -2.5], -0.056243716497674054], ['lgamma(x)', ['x' => 1], 0.0], ['lgamma(x)', ['x' => 2], 0.0], ['lgamma(x)', ['x' => -2], NAN_],
	['polylog(x, y)', ['x' => 1, 'y' => -1], -0.6931471805599453], ['lambertw(x)', ['x' => -1 / M_E], -1.0],
	['ellipf(x, y)', ['x' => 0, 'y' => 1], 0.0], ['ellipf(x, y)', ['x' => 0.5, 'y' => 1], 0.5222381032784403], ['ellipf(x, y)', ['x' => 1, 'y' => 1], 1.2261911708835171],
	['betapdf(x, y, z)', ['x' => 0, 'y' => 1, 'z' => 2], 2.0], ['betapdf(x, y, z)', ['x' => 1, 'y' => 2, 'z' => 1], 2.0], ['betapdf(x, y, z)', ['x' => 0, 'y' => 2, 'z' => 2], 0.0], ['betapdf(x, y, z)', ['x' => 0, 'y' => 0.5, 'z' => 2], 'INF'],
	['nbinpdf(x, y, z)', ['x' => 0, 'y' => 3, 'z' => 1], 1.0], ['nbinpdf(x, y, z)', ['x' => 2, 'y' => 3, 'z' => 1], 0.0], ['logninv(x, y, z)', ['x' => 0, 'y' => 0, 'z' => 1], 0.0],
	['logb(x, y)', ['x' => 8, 'y' => 1], NAN_], ['logb(x, y)', ['x' => 8, 'y' => 2], 3.0],
	// a chain of comparisons reads as in mathematics
	['3 > 2 > 1', [], 1.0], ['1 < 2 < 3', [], 1.0], ['1 < 3 < 2', [], 0.0], ['x <= y <= z', ['x' => 1, 'y' => 1, 'z' => 2], 1.0], ['3 > 2 == 1', [], 0.0],
	// npv as NPV() in a spreadsheet: the first value is one period away; irr keeps the first value at time 0
	['npv(x, list(-100, 60, 60))', ['x' => 0.1], 3.7565740045078755], ['npv(x, list(-100, 60, 60)) * (1 + x)', ['x' => 0.1], 4.132231404958663], ['irr(list(-100, 60, 60))', [], 0.13066238629180738],
	// Stirling numbers of the first kind, signed: s(n, k) = (-1)^(n-k) c(n, k)
	['stirling1(x, y)', ['x' => 4, 'y' => 2], 11.0], ['stirling1(x, y)', ['x' => 5, 'y' => 2], -50.0], ['stirling1(x, y)', ['x' => 10, 'y' => 3], -1172700.0], ['stirling1(x, y)', ['x' => 3, 'y' => 5], 0.0], ['stirling1(x, y)', ['x' => 0, 'y' => 0], 1.0], ['abs(stirling1(x, y))', ['x' => 10, 'y' => 3], 1172700.0],
	// exported as spreadsheet formulas (they used to be fixed values), with the app's 0 and NaN at the edges
	['clamp(x, y, z)', ['x' => 5, 'y' => 0, 'z' => 3], 3.0], ['clamp(x, y, z)', ['x' => -1, 'y' => 0, 'z' => 3], 0.0], ['clamp(x, y, z)', ['x' => 2.5, 'y' => 0, 'z' => 3], 2.5],
	['logb(x, y)', ['x' => 100, 'y' => 10], 2.0], ['logb(x, y)', ['x' => 0.5, 'y' => 0.5], 1.0], ['logb(x, y)', ['x' => 8, 'y' => 0], 0.0], ['logb(x, y)', ['x' => 0, 'y' => 0], NAN_],
	['logb(x, y)', ['x' => -8, 'y' => 2], NAN_], ['logb(x, y)', ['x' => 8, 'y' => -2], NAN_], ['logb(x, y)', ['x' => 1, 'y' => 1], NAN_],
	['sec(x)', ['x' => 1], 1.8508157176809255], ['sec(x)', ['x' => 0], 1.0], ['csc(x)', ['x' => 1], 1.1883951057781212], ['csc(x)', ['x' => 0], 'INF'], ['cot(x)', ['x' => 1], 0.6420926159343306], ['cot(x)', ['x' => 0], 'INF'],
	['normpdf(x)', ['x' => 1], 0.24197072451914337], ['normpdf(x, y, z)', ['x' => 1, 'y' => 0, 'z' => 2], 0.17603266338214976], ['normpdf(x, y, z)', ['x' => 1, 'y' => 0, 'z' => 0], NAN_], ['normpdf(x, y, z)', ['x' => 1, 'y' => 0, 'z' => -1], NAN_],
	['normcdf(x, y, z)', ['x' => 1, 'y' => 0, 'z' => 2], 0.6914624612740131], ['normcdf(x, y)', ['x' => 1, 'y' => 1], 0.5], ['normcdf(x, y, z)', ['x' => 1, 'y' => 0, 'z' => 0], NAN_],
	['lognpdf(x, y, z)', ['x' => 2, 'y' => 0, 'z' => 1], 0.1568740192789811], ['lognpdf(x, y, z)', ['x' => 0, 'y' => 0, 'z' => 1], 0.0], ['lognpdf(x, y, z)', ['x' => -1, 'y' => 0, 'z' => 1], 0.0], ['lognpdf(x, y, z)', ['x' => 2, 'y' => 0, 'z' => 0], NAN_],
	['logncdf(x, y, z)', ['x' => 2, 'y' => 0, 'z' => 1], 0.7558914042144173], ['logncdf(x, y, z)', ['x' => 0, 'y' => 0, 'z' => 1], 0.0], ['logncdf(x, y, z)', ['x' => 2, 'y' => 0, 'z' => -1], NAN_],
	['exppdf(x, y)', ['x' => 1, 'y' => 2], 0.2706705664732254], ['exppdf(x, y)', ['x' => -1, 'y' => 2], 0.0], ['exppdf(x, y)', ['x' => 1, 'y' => 0], NAN_],
	['expcdf(x, y)', ['x' => 1, 'y' => 2], 0.8646647167633873], ['expcdf(x, y)', ['x' => -1, 'y' => 2], 0.0], ['expcdf(x, y)', ['x' => 1, 'y' => -1], NAN_],
	['expinv(x, y)', ['x' => 0.5, 'y' => 2], 0.34657359027997264], ['expinv(x, y)', ['x' => 0, 'y' => 2], 0.0], ['expinv(x, y)', ['x' => 1, 'y' => 2], NAN_], ['expinv(x, y)', ['x' => -0.1, 'y' => 2], NAN_], ['expinv(x, y)', ['x' => 0.5, 'y' => 0], NAN_],
	['weibpdf(x, y, z)', ['x' => 1, 'y' => 2, 'z' => 3], 0.1988531815143044], ['weibpdf(x, y, z)', ['x' => 0, 'y' => 1, 'z' => 3], 1 / 3], ['weibpdf(x, y, z)', ['x' => 0, 'y' => 2, 'z' => 3], 0.0],
	['weibpdf(x, y, z)', ['x' => 0, 'y' => 0.5, 'z' => 3], 'INF'], ['weibpdf(x, y, z)', ['x' => -1, 'y' => 2, 'z' => 3], 0.0], ['weibpdf(x, y, z)', ['x' => 1, 'y' => 0, 'z' => 3], NAN_],
	['weibcdf(x, y, z)', ['x' => 1, 'y' => 2, 'z' => 3], 0.10516068318563021], ['weibcdf(x, y, z)', ['x' => -1, 'y' => 2, 'z' => 3], 0.0], ['weibcdf(x, y, z)', ['x' => 1, 'y' => 2, 'z' => 0], NAN_],
	['weibinv(x, y, z)', ['x' => 0.5, 'y' => 2, 'z' => 3], 2.497663833473093], ['weibinv(x, y, z)', ['x' => 0, 'y' => 2, 'z' => 3], 0.0], ['weibinv(x, y, z)', ['x' => 1, 'y' => 2, 'z' => 3], NAN_],
	['geompdf(x, y)', ['x' => 3, 'y' => 0.2], 0.128], ['geompdf(x, y)', ['x' => 2.5, 'y' => 0.2], NAN_], ['geompdf(x, y)', ['x' => 0, 'y' => 0.2], 0.0], ['geompdf(x, y)', ['x' => 1, 'y' => 1], 1.0],
	['geompdf(x, y)', ['x' => 2, 'y' => 1], 0.0], ['geompdf(x, y)', ['x' => 2, 'y' => 0], NAN_], ['geompdf(x, y)', ['x' => 4000, 'y' => 0.2], 0.0],
	['geomcdf(x, y)', ['x' => 3, 'y' => 0.2], 0.488], ['geomcdf(x, y)', ['x' => 2.5, 'y' => 0.2], 0.36], ['geomcdf(x, y)', ['x' => 0, 'y' => 0.2], 0.0], ['geomcdf(x, y)', ['x' => 4000, 'y' => 0.2], 1.0],
	['geomcdf(x, y)', ['x' => 3, 'y' => 1], 1.0], ['geomcdf(x, y)', ['x' => 3, 'y' => 1.2], NAN_],
	// unchanged, and still right
	['-2^2', [], -4.0], ['2^3^2', [], 512.0], ['0^0', [], 1.0], ['sqrt(x)', ['x' => -1], NAN_], ['1/0', [], 'INF'], ['-7 % 3 + 0', [], 2.0],
	// distributions with large parameters and far tails (2026-11-06): the values of a 40-digit calculation;
	// these used to be wrong from the 6th digit on (poisscdf, gammacdf), or from the 9th to 13th
	['poisscdf(x, y)', ['x' => 1000000.0, 'y' => 1000000.0], 0.5002659614862837], ['gammacdf(x, y, z)', ['x' => 520000, 'y' => 520000, 'z' => 1], 0.5001844111363212], ['chi2cdf(x, y)', ['x' => 100000.0, 'y' => 100000.0], 0.5005947081047933],
	['norminv(x, y, z)', ['x' => 0.999999999999, 'y' => 0, 'z' => 1], 7.0344869100478356], ['norminv(x, y, z)', ['x' => 1e-300, 'y' => 5, 'z' => 2], -69.0941925987224], ['norminv(x, y, z)', ['x' => 0.5000001, 'y' => 0, 'z' => 1000], 0.0002506628273311648],
	['binompdf(x, y, z)', ['x' => 500300, 'y' => 1000000.0, 'z' => 0.5], 0.0006664491519344462], ['tpdf(x, y)', ['x' => 2.5, 'y' => 1000000.0], 0.017528412510179753], ['chi2pdf(x, y)', ['x' => 100500, 'y' => 100000.0], 0.00047609720509648844],
	['betapdf(x, y, z)', ['x' => 0.5002, 'y' => 500000.0, 'z' => 500000.0], 736.5402096041889], ['gammapdf(x, y, z)', ['x' => 1002000, 'y' => 1000000.0, 'z' => 1], 5.402686013678803e-05], ['poisspdf(x, y)', ['x' => 1002000, 'y' => 1000000.0], 5.400894402150457e-05],
	['hygepdf(x, y, z, w)', ['x' => 300500, 'y' => 2000000.0, 'z' => 1000000.0, 'w' => 600000.0], 0.00037436781522299183], ['nbinpdf(x, y, z)', ['x' => 1000500, 'y' => 1000000.0, 'z' => 0.5], 0.0002649083001878111], ['gammainc(x, y)', ['x' => 10000000.0, 'y' => 10000000.0], 0.5000420522087237],
	['gammaincc(x, y)', ['x' => 1e-05, 'y' => 0.9], 2.6018639772092986e-06], ['betainc(x, y, z)', ['x' => 0.9999995985894541, 'y' => 6575334.8895259965, 'z' => 0.3], 0.010000000003026404], ['lgamma(x)', ['x' => 1.999999999999], -4.2282192087173953e-13],
	['lgamma(x)', ['x' => 0.9999999999], 5.7721571274281786e-11], ['logninv(x, y, z)', ['x' => 1e-300, 'y' => 0, 'z' => 1], 8.140489241100185e-17], ['chi2inv(x, y)', ['x' => 1e-300, 'y' => 10], 5.210342169394704e-60],
	['chi2inv(x, y)', ['x' => 1e-08, 'y' => 10000000.0], 9974922.693744855], ['tinv(x, y)', ['x' => 0.500000000001, 'y' => 5], 2.6342472487707527e-12], ['tinv(x, y)', ['x' => 1e-300, 'y' => 3], -1.033110836044653e+100],
	['tinv(x, y)', ['x' => 0.999999999999999, 'y' => 1000000.0], 7.9415716843636455], ['betainv(x, y, z)', ['x' => 1e-200, 'y' => 2, 'z' => 3], 4.08248290463863e-101], ['betainv(x, y, z)', ['x' => 1e-300, 'y' => 3.7, 'z' => 23294], 7.461744894748733e-86],
	['gammainv(x, y, z)', ['x' => 0.999999999999999, 'y' => 2, 'z' => 1], 38.20846875548482], ['finv(x, y, z)', ['x' => 0.99, 'y' => 1000000.0, 'z' => 1000000.0], 1.004663539619797], ['finv(x, y, z)', ['x' => 1e-200, 'y' => 1000000.0, 'z' => 96433], 0.8682647072952611],
	['tcdf(x, y)', ['x' => 2.5e-07, 'y' => 1060], 0.5000000997120503], ['fcdf(x, y, z)', ['x' => 1.001, 'y' => 1000000.0, 'z' => 1000000.0], 0.6913744504289026], ['binomcdf(x, y, z)', ['x' => 499000, 'y' => 1000000.0, 'z' => 0.5], 0.02280414993269104],
];
// those the spreadsheet cannot show exactly: LibreOffice's own arithmetic treats 0.49999999999999994 as a half
$expected = array_map(static fn ($c) => $c[2], $cases);

$js = jsValues(array_map(static fn ($c) => ['expr' => $c[0], 'vars' => $c[1]], $cases));
if ($js === null) {
	echo "SKIP  js: node not found (or the engine could not be loaded)\n";
}
$lo = odsBatch(array_map(static fn ($c) => ['expr' => $c[0], 'vars' => $c[1]], $cases));
if ($lo === null) {
	echo "SKIP  ods: LibreOffice recalculation (soffice or python3-uno not found)\n";
} elseif (isset($lo['error'])) {
	check('ods: LibreOffice gave a result', false, $lo['error']);
	$lo = null;
}

foreach ($cases as $i => $c) {
	[$expr, $vars, $want] = $c;
	$label = $expr . ($vars ? '  ' . json_encode($vars) : '');
	$php = phpValue($expr, $vars);
	check("php: $label = " . json_encode($want), sameValue($php, $want), json_encode($php));
	if ($js !== null) {
		$v = $js[$i] ?? 'missing';
		check("js:  $label = " . json_encode($want), is_string($v) && !in_array($v, ['NaN', 'INF', '-INF'], true) ? false : sameValue($v, $want), json_encode($v));
		check("php and js agree: $label", is_string($php) || is_string($v) ? $php === $v : sameValue($php, $v, 1e-12), json_encode([$php, $v]));
	}
	if ($lo !== null && ($c[3] ?? '') !== 'noods') {
		$v = $lo[$i] ?? 'missing';
		// an error in the spreadsheet stands for a value that has none (NaN) or is infinite
		$ok = is_string($v) ? (str_starts_with($v, 'ERR') && is_string($php)) : (!is_string($php) && sameValue($v, $php));
		check("ods: $label (as the app)", $ok, json_encode([$v, $php]));
	}
}

// those exported as formulas hold no fixed value: the ods column above is the spreadsheet's own calculation
$fc = new OCA\FormulaBase\Service\FormulaCompiler();
$fixedOf = static function (string $expr, array $vars) use ($fc): bool {
	$map = [];
	foreach (array_keys($vars) as $i => $k) {
		$map[$k] = 'B' . ($i + 1);
	}
	$fc->toOdf($fc->parse($expr), $map, array_map('floatval', $vars));
	return $fc->odfHasFixedValue();
};
foreach ($cases as $c) {
	if (preg_match('/^(clamp|logb|sec|csc|cot|normpdf|normcdf|lognpdf|logncdf|exppdf|expcdf|expinv|weibpdf|weibcdf|weibinv|geompdf|geomcdf)\(/', $c[0])) {
		check("ods: $c[0] is a formula, not a value", !$fixedOf($c[0], $c[1]));
	}
}
// a part with no spreadsheet function is still a value, and only a part that depends on an input counts as fixed
check('ods: isprime(x) is a fixed value', $fixedOf('isprime(x)', ['x' => 7]));
check('ods: isprime(7) + x is not', !$fixedOf('isprime(7) + x', ['x' => 1]));
check('ods: chi2inv(x, y) is a fixed value', $fixedOf('chi2inv(x, y)', ['x' => 0.95, 'y' => 3]));

// 1.5.2 is not a number: both engines refuse it
check('php: 1.5.2 is refused', phpValue('1.5.2', []) === 'ERR');
$bad = jsValues([['expr' => '1.5.2', 'vars' => []], ['expr' => '1.5 + 2', 'vars' => []]]);
if ($bad !== null) {
	check('js:  1.5.2 is refused', is_string($bad[0] ?? null) && str_starts_with($bad[0], 'ERR'), json_encode($bad[0] ?? null));
	check('js:  1.5 + 2 still works', (float)($bad[1] ?? 0) === 3.5, json_encode($bad[1] ?? null));
}

finish();
