<?php
/**
 * A variable with no key gets no row in the exported .ods; the Result cell must still refer to
 * the rows the other variables were written to. (The editor drops keyless variables, but the
 * API and a restored backup can carry one.) LibreOffice opens the file and recalculates.
 */
require __DIR__ . '/boot.php';

$f = formula(1, 'Area', 'a*b', [['key' => '', 'default' => '9'], ['key' => 'a', 'label' => 'a', 'default' => '2'], ['key' => 'b', 'label' => 'b', 'default' => '3']]);
$files = [];
[$st, $data] = exportInto([$f], $files, 1, ['format' => 'ods', 'filename' => 'calc', 'values' => ['a' => 2, 'b' => 3]]);
check('saved', $st === 200, $st . ' ' . json_encode($data));

$d = new DOMDocument();
@$d->loadXML((string)odfContent($files['calc.ods'] ?? ''));
$xp = new DOMXPath($d);
$xp->registerNamespace('table', 'urn:oasis:names:tc:opendocument:xmlns:table:1.0');
$rowOf = [];
foreach ($xp->query('//table:table-row') as $i => $r) {
	$rowOf[trim($r->firstChild?->textContent ?? '')] = $i + 1;
}
$cell = $xp->query('//table:table-cell[@table:formula]')->item(0);
$formula = $cell ? $cell->getAttribute('table:formula') : '';
$want = '[.B' . ($rowOf['a'] ?? 0) . ']*[.B' . ($rowOf['b'] ?? 0) . ']';
check('the Result refers to the rows a and b are on', str_contains($formula, $want), "$formula, want $want");

$lo = libreoffice($files['calc.ods'] ?? '', 'ods');
if ($lo === null) {
	echo "SKIP  LibreOffice recalculation (soffice or python3-uno not found)\n";
} else {
	check('LibreOffice recalculates the Result as 6', besideLabel($lo['rows'] ?? [], 'Result') === ['6'], json_encode($lo['error'] ?? besideLabel($lo['rows'] ?? [], 'Result')));
}

finish();
