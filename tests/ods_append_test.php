<?php
/**
 * Saving a second formula INTO an existing .ods ("append"): its Result cell must refer to its
 * own variable rows, which sit below what the sheet already holds — not to rows 4, 5, ... at
 * the top, which belong to the first formula. LibreOffice opens the file and recalculates.
 * A sheet whose empty rows run down to its last row must still take the new rows.
 */
require __DIR__ . '/boot.php';

$f1 = formula(1, 'Area', 'a*b', [['key' => 'a', 'default' => '2'], ['key' => 'b', 'default' => '3']]);
$f2 = formula(2, 'Total', 'x+y', [['key' => 'x', 'label' => 'x', 'default' => '10'], ['key' => 'y', 'label' => 'y', 'default' => '20']]);
$all = [$f1, $f2];

foreach (['without picture' => '', 'with picture' => tinyPng()] as $case => $img) {
	$files = [];
	[$st] = exportInto($all, $files, 1, ['format' => 'ods', 'filename' => 'calc', 'values' => ['a' => 2, 'b' => 3], 'image' => $img, 'imageWidth' => 40, 'imageHeight' => 20]);
	check("$case: first formula saved", $st === 200 && isset($files['calc.ods']), (string)$st);
	[$st, $data] = exportInto($all, $files, 2, ['format' => 'ods', 'values' => ['x' => 10, 'y' => 20], 'image' => $img, 'imageWidth' => 40, 'imageHeight' => 20,
		'target' => ['path' => 'calc.ods', 'mode' => 'append']]);
	check("$case: second formula appended", $st === 200, $st . ' ' . json_encode($data));

	$xml = odfContent($files['calc.ods'] ?? '');
	check("$case: content.xml is well-formed", wellFormed($xml));
	// the last Result cell's formula names the rows its x and y were written to
	$d = new DOMDocument();
	@$d->loadXML((string)$xml);
	$xp = new DOMXPath($d);
	$xp->registerNamespace('table', 'urn:oasis:names:tc:opendocument:xmlns:table:1.0');
	$rows = $xp->query('//table:table-row');
	$rowOf = [];
	foreach ($rows as $i => $r) {
		$label = trim($r->firstChild?->textContent ?? '');
		$rowOf[$label][] = $i + 1;
	}
	$formulas = $xp->query('//table:table-cell[@table:formula]');
	$last = $formulas->length ? $formulas->item($formulas->length - 1)->getAttribute('table:formula') : '';
	$want = '[.B' . ($rowOf['x'][0] ?? 0) . ']+[.B' . ($rowOf['y'][0] ?? 0) . ']';
	check("$case: the appended Result refers to its own rows", str_contains($last, $want), "formula $last, x/y on rows " . json_encode([$rowOf['x'] ?? null, $rowOf['y'] ?? null]));

	if ($img !== '') {
		$ys = [];
		foreach ($xp->query('//*[local-name()="frame"]') as $fr) {
			$ys[] = (float)$fr->getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', 'y');
		}
		check("$case: the second picture sits below the first", count($ys) === 2 && $ys[1] > $ys[0] + 1, json_encode($ys));
	}

	$lo = libreoffice($files['calc.ods'] ?? '', 'ods');
	if ($lo === null) {
		echo "SKIP  $case: LibreOffice recalculation (soffice or python3-uno not found)\n";
	} else {
		$res = besideLabel($lo['rows'] ?? [], 'Result');
		check("$case: LibreOffice recalculates both results as 6 and 30", $res === ['6', '30'], json_encode($lo['error'] ?? $res));
	}
}

// A sheet whose (empty, formatted) rows reach the last row the format allows.
$files = [];
exportInto($all, $files, 1, ['format' => 'ods', 'filename' => 'full', 'values' => ['a' => 2, 'b' => 3]]);
$tmp = tempnam(sys_get_temp_dir(), 'fbf');
file_put_contents($tmp, $files['full.ods']);
$z = new ZipArchive();
$z->open($tmp);
$c = $z->getFromName('content.xml');
$pad = '<table:table-row table:number-rows-repeated="' . (1048576 - 6) . '"><table:table-cell/></table:table-row>';
$z->addFromString('content.xml', substr_replace($c, $pad, strrpos($c, '</table:table>'), 0));
$z->close();
$files['full.ods'] = file_get_contents($tmp);
unlink($tmp);
[$st, $data] = exportInto($all, $files, 2, ['format' => 'ods', 'values' => ['x' => 10, 'y' => 20], 'target' => ['path' => 'full.ods', 'mode' => 'append']]);
check('padded sheet: appended', $st === 200, $st . ' ' . json_encode($data));
$d = new DOMDocument();
@$d->loadXML((string)odfContent($files['full.ods']));
$total = 0;
foreach ($d->getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'table-row') as $r) {
	$total += max(1, (int)$r->getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'number-rows-repeated'));
}
check('padded sheet: still no more rows than a sheet can hold', $total <= 1048576, (string)$total);
$lo = libreoffice($files['full.ods'], 'ods');
if ($lo === null) {
	echo "SKIP  padded sheet: LibreOffice recalculation\n";
} else {
	check('padded sheet: LibreOffice recalculates both results as 6 and 30', besideLabel($lo['rows'] ?? [], 'Result') === ['6', '30'], json_encode($lo['error'] ?? besideLabel($lo['rows'] ?? [], 'Result')));
}

finish();
