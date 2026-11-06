<?php
/**
 * An exported file keeps every digit of the numbers in it: the variable's value cell holds the number
 * itself (it used to be cut to 10 decimals, so 1.2345678901e-5 became 0.0000123457), the spreadsheet
 * recalculates from it, and the report (.odt) shows the result with enough digits to be the result.
 */
require __DIR__ . '/boot.php';

$values = [1 / 3, 1.2345678901e-5, 0.000123456789012, 9.87654321012345, 123456.123456789, 1.0e-7, 2.5e-6, 0.1 + 0.2, 1234567890123.456, 4.2e-9, 5.0, 1.5e20];
$f = formula(1, 'F', 'x*1', [['key' => 'x', 'default' => '1']]);
foreach ($values as $v) {
	$files = [];
	exportInto([$f], $files, 1, ['format' => 'ods', 'filename' => 'n', 'values' => ['x' => $v]]);
	preg_match('/office:value="([^"]*)"/', (string)odfContent($files['n.ods']), $m);
	$stored = (float)($m[1] ?? 'x');
	check('ods: the stored value is ' . json_encode($v), $stored === $v, (string)($m[1] ?? 'missing'));
	$lo = libreoffice($files['n.ods'], 'ods');
	if ($lo === null) {
		echo "SKIP  ods: LibreOffice recalculation (soffice or python3-uno not found)\n";
	} else {
		$res = besideLabel($lo['rows'] ?? [], 'Result')[0] ?? 'missing';
		check('ods: LibreOffice recalculates ' . json_encode($v) . ' x 1 to the same number', is_numeric($res) && abs((float)$res - $v) <= 1e-14 * abs($v), (string)$res);
	}

	$files = [];
	exportInto([$f], $files, 1, ['format' => 'odt', 'filename' => 'n', 'values' => ['x' => $v]]);
	preg_match('/Result:<\/text:span> ([^<]*)</', (string)odfContent($files['n.odt']), $m);
	$shown = (float)($m[1] ?? 'x');
	check('odt: the result of ' . json_encode($v) . ' is shown with its digits', abs($shown - $v) <= 5e-15 * abs($v), (string)($m[1] ?? 'missing'));
}

finish();
