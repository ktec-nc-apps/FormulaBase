<?php
/**
 * Appending a formula with its picture into an ODF file that never declared the draw:, svg:
 * and xlink: prefixes (the collection export is one) must leave a file that still opens,
 * with the picture's shapes placed before the sheet's rows as ODF requires. A file that
 * cannot be read as XML is refused and left exactly as it was.
 */
require __DIR__ . '/boot.php';

$f1 = formula(1, 'Area', 'a*b', [['key' => 'a', 'default' => '2'], ['key' => 'b', 'default' => '3']]);
$f2 = formula(2, 'Total', 'x+y', [['key' => 'x', 'label' => 'x', 'default' => '10'], ['key' => 'y', 'label' => 'y', 'default' => '20']]);
$all = [$f1, $f2];
const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';

// 1. the collection export, saved into Files, then a formula with its picture appended
$files = [];
$res = exportController($all, $files, [])->exportCollection(1);
$files['coll.ods'] = $res->render();
check('collection export lacks the draw prefix (the case under test)', !str_contains((string)odfContent($files['coll.ods']), 'xmlns:draw'));
[$st, $data] = exportInto($all, $files, 2, ['format' => 'ods', 'values' => ['x' => 10, 'y' => 20], 'image' => tinyPng(), 'imageWidth' => 40, 'imageHeight' => 20,
	'target' => ['path' => 'coll.ods', 'mode' => 'append']]);
check('ods: appended', $st === 200, $st . ' ' . json_encode($data));
$xml = odfContent($files['coll.ods']);
check('ods: content.xml is well-formed', wellFormed($xml));
$d = new DOMDocument();
if (@$d->loadXML((string)$xml)) {
	$sheet = $d->getElementsByTagNameNS(T, 'table')->item(0);
	$order = [];
	foreach ($sheet->childNodes as $c) {
		if ($c instanceof DOMElement) {
			$order[] = $c->localName;
		}
	}
	$s = array_search('shapes', $order, true);
	$r = array_search('table-row', $order, true);
	check('ods: the shapes come before the rows', $s !== false && $r !== false && $s < $r, implode(',', array_unique($order)));
}
$lo = libreoffice($files['coll.ods'], 'ods');
if ($lo === null) {
	echo "SKIP  ods: LibreOffice (soffice or python3-uno not found)\n";
} else {
	check('ods: LibreOffice opens it and the Result is 30', besideLabel($lo['rows'] ?? [], 'Result') === ['30'], json_encode($lo['error'] ?? besideLabel($lo['rows'] ?? [], 'Result')));
}

// 2. a plain text document declaring only office: and text:
$odt = tempnam(sys_get_temp_dir(), 'fbo');
$z = new ZipArchive();
$z->open($odt, ZipArchive::CREATE | ZipArchive::OVERWRITE);
$z->addFromString('mimetype', 'application/vnd.oasis.opendocument.text');
$z->setCompressionName('mimetype', ZipArchive::CM_STORE);
$z->addFromString('content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text><text:p>Notes</text:p></office:text></office:body></office:document-content>');
$z->addFromString('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
$z->close();
$files['notes.odt'] = file_get_contents($odt);
unlink($odt);
[$st, $data] = exportInto($all, $files, 1, ['format' => 'odt', 'values' => ['a' => 2, 'b' => 3], 'image' => tinyPng(), 'imageWidth' => 40, 'imageHeight' => 20,
	'target' => ['path' => 'notes.odt', 'mode' => 'append']]);
check('odt: appended', $st === 200, $st . ' ' . json_encode($data));
check('odt: content.xml is well-formed', wellFormed(odfContent($files['notes.odt'])));
$lo = libreoffice($files['notes.odt'], 'odt');
if ($lo === null) {
	echo "SKIP  odt: LibreOffice\n";
} else {
	check('odt: LibreOffice opens it with the old and the new text', str_contains((string)($lo['text'] ?? ''), 'Notes') && str_contains((string)($lo['text'] ?? ''), 'Area'), json_encode($lo));
}

// 3. a file whose content.xml is not XML: refused, untouched
$bad = tempnam(sys_get_temp_dir(), 'fbb');
$z = new ZipArchive();
$z->open($bad, ZipArchive::CREATE | ZipArchive::OVERWRITE);
$z->addFromString('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
$z->addFromString('content.xml', '<office:document-content><table:table></table:table>');
$z->addFromString('META-INF/manifest.xml', '<manifest:manifest></manifest:manifest>');
$z->close();
$files['bad.ods'] = $before = file_get_contents($bad);
unlink($bad);
[$st] = exportInto($all, $files, 2, ['format' => 'ods', 'values' => ['x' => 1, 'y' => 2], 'target' => ['path' => 'bad.ods', 'mode' => 'append']]);
check('broken file: refused', $st === 400, (string)$st);
check('broken file: left as it was', $files['bad.ods'] === $before);

finish();
