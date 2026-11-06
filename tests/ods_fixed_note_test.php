<?php
/**
 * An exported .ods whose Result holds a part written as its value (isprime, a list input, …) says so
 * beside the Result: that part does not follow a changed input in the spreadsheet. A Result that is
 * all spreadsheet formula, or whose value-only part has no input in it, carries no such note.
 */
require __DIR__ . '/boot.php';

const NOTE = 'This value is calculated by FormulaBase and does not recalculate in the spreadsheet.';

/** The Result row's cells (text), from the exported content.xml; the note goes through the translator. */
function resultRow(string $expr, array $vars, array $values): array {
	$files = [];
	$api = exportController([formula(1, 'F', $expr, $vars)], $files, ['format' => 'ods', 'filename' => 'calc', 'values' => $values]);
	poke($api, 'l', stub(OCP\IL10N::class, ['t' => static fn ($s, $p = []) => $s === NOTE ? 'T:' . $s : (string)$s]));
	$st = $api->exportFormula(1)->getStatus();
	check("$expr: saved", $st === 200, (string)$st);
	$d = new DOMDocument();
	@$d->loadXML((string)odfContent($files['calc.ods'] ?? ''));
	$xp = new DOMXPath($d);
	$xp->registerNamespace('table', 'urn:oasis:names:tc:opendocument:xmlns:table:1.0');
	foreach ($xp->query('//table:table-row') as $r) {
		$cells = [];
		foreach ($xp->query('table:table-cell', $r) as $c) {
			$cells[] = trim($c->textContent);
		}
		if (($cells[0] ?? '') === 'Result') {
			return [$cells, $files['calc.ods'] ?? ''];
		}
	}
	return [[], ''];
}

$n = ['key' => 'n', 'label' => 'n', 'default' => '7'];
$x = ['key' => 'x', 'label' => 'x', 'default' => '2'];
[$row, $bytes] = resultRow('isprime(n) + x', [$n, $x], ['n' => 7, 'x' => 2]);
check('isprime(n) + x: the note is beside the Result, translated', ($row[3] ?? '') === 'T:' . NOTE, json_encode($row));
[$row] = resultRow('clamp(x, 0, 1) + normpdf(x, 0, 2)', [$x], ['x' => 2]);
check('clamp + normpdf: all formula, no note', count($row) === 3, json_encode($row));
[$row] = resultRow('isprime(7) + x', [$x], ['x' => 2]);
check('isprime(7) + x: the value-only part has no input, no note', count($row) === 3, json_encode($row));
[$row] = resultRow('mean(v)', [['key' => 'v', 'label' => 'v', 'default' => '1, 2, 3']], ['v' => '1, 2, 3']);
check('mean(v) of a list input: the note is there', ($row[3] ?? '') === 'T:' . NOTE, json_encode($row));

$lo = libreoffice($bytes, 'ods');
if ($lo === null) {
	echo "SKIP  LibreOffice (soffice or python3-uno not found)\n";
} else {
	$r = array_values(array_filter($lo['rows'] ?? [], static fn ($r) => ($r[0] ?? null) === 'Result'))[0] ?? [];
	check('LibreOffice shows the Result 3 and the note beside it', ($r[1] ?? null) === '3' && ($r[3] ?? null) === 'T:' . NOTE, json_encode($lo['error'] ?? $r));
}

finish();
