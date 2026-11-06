<?php
/**
 * The 150 templates added in November 2026: each one, calculated with its default
 * values by the app's own engine, must equal the value worked out independently
 * (in Python, from a different form of the same textbook definition) and stored in
 * templates_2026_11_expected.json. A change to the engine or to a template that
 * moves any of these results makes this test fail.
 */
declare(strict_types=1);
require __DIR__ . '/boot.php';

use OCA\FormulaBase\Service\FormulaCompiler;

$dir = __DIR__ . '/../data/templates/';
$manifest = json_decode((string)file_get_contents($dir . 'manifest.json'), true);
$expected = json_decode((string)file_get_contents(__DIR__ . '/templates_2026_11_expected.json'), true);
$fc = new FormulaCompiler();
$byCat = [];
foreach ($expected as $name => $e) {
	$cat = $e['cat'];
	if (!isset($byCat[$cat])) {
		$byCat[$cat] = [];
		foreach (json_decode((string)file_get_contents($dir . $manifest[$cat]), true) as $t) {
			$byCat[$cat][$t['name']] = $t;
		}
	}
	$t = $byCat[$cat][$name] ?? null;
	if ($t === null) {
		check($name, false, 'template missing');
		continue;
	}
	$got = attempt($name, function () use ($fc, $t) {
		$scope = [];
		foreach ($t['variables'] as $v) {
			$scope[$v['key']] = $fc->parseValue($v['default']);
		}
		return (float)$fc->evaluate($fc->parse($t['expression']), $scope);
	});
	if ($got === null) {
		continue;
	}
	$want = (float)$e['expected'];
	check($name, abs($got - $want) <= 1e-9 * max(1.0, abs($want)), "got $got, want $want");
}
finish();
