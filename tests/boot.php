<?php
/**
 * What every test here starts from: Nextcloud's own classes, read from disk (no
 * database, no config.php, no network), FormulaBase's classes, and a few helpers.
 *
 *   NC_ROOT          the Nextcloud to borrow classes from (default /var/www/nextcloud)
 *   FORMULABASE_LIB  the lib/ folder under test (default this app's own); pointing it
 *                    at a copy of an older lib/ is how a test is shown to fail there
 *
 * Each test prints PASS/FAIL lines and ends with "ALL PASS" or "N FAILED".
 */
declare(strict_types=1);

$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
define('FB_LIB', rtrim(getenv('FORMULABASE_LIB') ?: __DIR__ . '/../lib', '/'));
spl_autoload_register(static function (string $class): void {
	$prefix = 'OCA\\FormulaBase\\';
	if (str_starts_with($class, $prefix)) {
		$file = FB_LIB . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
		if (is_file($file)) {
			require $file;
		}
	}
});
set_error_handler(static fn (int $no) => $no === E_USER_DEPRECATED || $no === E_DEPRECATED, E_USER_DEPRECATED | E_DEPRECATED);
// Guzzle warns about options it will drop in its next major version; not our concern here.
set_error_handler(static fn (int $no) => $no === E_USER_DEPRECATED || $no === E_DEPRECATED, E_USER_DEPRECATED | E_DEPRECATED);

$GLOBALS['fb_fail'] = 0;

function check(string $name, bool $ok, string $got = ''): void {
	echo ($ok ? 'PASS' : 'FAIL') . '  ' . $name . ($ok || $got === '' ? '' : '  (' . $got . ')') . "\n";
	if (!$ok) {
		$GLOBALS['fb_fail']++;
	}
}

function finish(): never {
	$n = $GLOBALS['fb_fail'];
	echo $n === 0 ? "\nALL PASS\n" : "\n$n FAILED\n";
	exit($n === 0 ? 0 : 1);
}

/** Run $fn; a crash in it is a failure of the test named, not the end of the run. */
function attempt(string $name, callable $fn): mixed {
	try {
		return $fn();
	} catch (\Throwable $e) {
		check($name, false, get_class($e) . ': ' . $e->getMessage());
		return null;
	}
}

/**
 * An object of $class built without its constructor, with whichever of $props
 * the class has. The same test can so build the class before and after a change
 * to what it is made of.
 */
function build(string $class, array $props = []): object {
	$rc = new ReflectionClass($class);
	$obj = $rc->newInstanceWithoutConstructor();
	foreach ($props as $name => $value) {
		for ($c = $rc; $c !== false; $c = $c->getParentClass()) {
			if ($c->hasProperty($name)) {
				$c->getProperty($name)->setValue($obj, $value);
				break;
			}
		}
	}
	return $obj;
}

/** Set a property that may be private to a parent class. */
function poke(object $obj, string $name, mixed $value): void {
	for ($c = new ReflectionClass($obj); $c !== false; $c = $c->getParentClass()) {
		if ($c->hasProperty($name)) {
			$c->getProperty($name)->setValue($obj, $value);
			return;
		}
	}
}

/** An object implementing $iface whose methods return empty defaults, except those in $over. */
function stub(string $iface, array $over = []): object {
	static $n = 0;
	$n++;
	$r = new ReflectionClass($iface);
	$cls = 'FbStub' . $n;
	$code = ($r->isInterface() ? "class $cls implements \\$iface" : "class $cls extends \\$iface") . ' { public array $__o = []; ';
	foreach ($r->getMethods() as $m) {
		if (!$m->isAbstract() && !$r->isInterface()) {
			continue;
		}
		$params = [];
		foreach ($m->getParameters() as $p) {
			$s = '';
			if ($p->hasType()) {
				$s .= stubType($p->getType()) . ' ';
			}
			if ($p->isPassedByReference()) {
				$s .= '&';
			}
			if ($p->isVariadic()) {
				$s .= '...';
			}
			$s .= '$' . $p->getName();
			if ($p->isDefaultValueAvailable()) {
				$s .= ' = ' . var_export($p->getDefaultValue(), true);
			} elseif ($p->isOptional() && !$p->isVariadic()) {
				$s .= ' = null';
			}
			$params[] = $s;
		}
		$name = $m->getName();
		$rt = $m->hasReturnType() ? (string)$m->getReturnType() : '';
		$call = "(\$this->__o['$name'])(...func_get_args())";
		if ($rt === 'void') {
			$body = "if (isset(\$this->__o['$name'])) { $call; } return;";
		} elseif ($rt === 'never') {
			$body = "if (isset(\$this->__o['$name'])) { $call; } throw new \\LogicException('never');";
		} else {
			$body = "if (isset(\$this->__o['$name'])) { return $call; }";
			$body .= match (true) {
				$rt === 'bool' => ' return false;',
				$rt === 'string' => " return '';",
				$rt === 'int' => ' return 0;',
				$rt === 'float' => ' return 0.0;',
				$rt === 'array' => ' return [];',
				$rt === 'static' || $rt === 'self' => ' return $this;',
				$rt !== '' && $rt[0] !== '?' && !str_contains($rt, 'null') && $rt !== 'mixed' => " throw new \\LogicException('stub: $name');",
				default => ' return null;',
			};
		}
		if ($m->isStatic()) {
			$body = "throw new \\LogicException('static stub');";
		}
		$ret = $m->hasReturnType() ? ': ' . stubType($m->getReturnType()) : '';
		$code .= 'public ' . ($m->isStatic() ? 'static ' : '') . "function $name(" . implode(', ', $params) . ")$ret { $body } ";
	}
	$code .= '}';
	eval($code);
	$o = new $cls();
	$o->__o = $over;
	return $o;
}

function stubType(ReflectionType $t): string {
	if ($t instanceof ReflectionNamedType) {
		$name = $t->getName();
		$q = ($t->allowsNull() && $name !== 'mixed' && $name !== 'null') ? '?' : '';
		return $q . ($t->isBuiltin() || $name === 'static' || $name === 'self' ? $name : '\\' . $name);
	}
	if ($t instanceof ReflectionUnionType) {
		return implode('|', array_map(static fn ($x) => $x instanceof ReflectionNamedType
			? ($x->isBuiltin() ? $x->getName() : '\\' . $x->getName())
			: '(' . stubType($x) . ')', $t->getTypes()));
	}
	if ($t instanceof ReflectionIntersectionType) {
		return implode('&', array_map(static fn ($x) => '\\' . $x->getName(), $t->getTypes()));
	}
	return (string)$t;
}

/** A request whose parameters are $params. */
function request(array $params): object {
	return stub(OCP\IRequest::class, ['getParam' => static fn ($k, $d = null) => $params[$k] ?? $d]);
}

/* ---- FormulaBase: exporting a formula into Files, with the Files and the database in memory ---- */

/** A formula as the database would hand it out. */
function formula(int $id, string $name, string $expression, array $variables, int $collectionId = 1): OCA\FormulaBase\Db\FormulaEntity {
	$f = new OCA\FormulaBase\Db\FormulaEntity();
	$f->setId($id);
	$f->setCollectionId($collectionId);
	$f->setName($name);
	$f->setExpression($expression);
	$f->setVariables(json_encode($variables));
	$f->setResultUnit('');
	$f->setDecimals(2);
	$f->setNotes('');
	return $f;
}

/** A collection owned by $uid. */
function collection(int $id, string $uid, string $name): OCA\FormulaBase\Db\CollectionEntity {
	$c = new OCA\FormulaBase\Db\CollectionEntity();
	$c->setId($id);
	$c->setUserId($uid);
	$c->setName($name);
	$c->setIcon('🧮');
	$c->setColor('#2563eb');
	$c->setDescription('');
	return $c;
}

/**
 * An ApiController whose user 'alice' owns collection 1 holding $formulas, and whose Files
 * are the array $files (path => bytes). Each call to exportFormula() reads and writes it.
 */
function exportController(array $formulas, array &$files, array $params): OCA\FormulaBase\Controller\ApiController {
	$byId = [];
	foreach ($formulas as $f) {
		$byId[$f->getId()] = $f;
	}
	$fm = new class($byId) extends OCA\FormulaBase\Db\FormulaMapper {
		public function __construct(private array $byId) {
		}
		public function find(int $id): OCA\FormulaBase\Db\FormulaEntity {
			if (!isset($this->byId[$id])) {
				throw new OCP\AppFramework\Db\DoesNotExistException('no formula');
			}
			return $this->byId[$id];
		}
		public function findForCollection(int $collectionId): array {
			return array_values($this->byId);
		}
	};
	$cm = new class() extends OCA\FormulaBase\Db\CollectionMapper {
		public function __construct() {
		}
		public function findForUser(int $id, string $userId): OCA\FormulaBase\Db\CollectionEntity {
			return collection($id, $userId, 'Coll');
		}
		public function findById(int $id): OCA\FormulaBase\Db\CollectionEntity {
			return collection($id, 'alice', 'Coll');
		}
	};
	$fs = new class($files) extends OCA\FormulaBase\Service\FilesService {
		public function __construct(private array &$files) {
		}
		public function readFile(string $userId, string $path): ?string {
			return $this->files[$path] ?? null;
		}
		public function overwriteFile(string $userId, string $path, string $content): array {
			if (!isset($this->files[$path])) {
				throw new \RuntimeException('File not found');
			}
			$this->files[$path] = $content;
			return ['id' => 1, 'name' => basename($path), 'path' => $path];
		}
		public function saveFile(string $userId, string $folderPath, string $filename, string $content): array {
			$p = ($folderPath === '' ? '' : $folderPath . '/') . $filename;
			$this->files[$p] = $content;
			return ['id' => 1, 'name' => $filename, 'path' => $p];
		}
	};
	$user = stub(OCP\IUser::class, ['getUID' => static fn () => 'alice']);
	$api = build(OCA\FormulaBase\Controller\ApiController::class, [
		'userSession' => stub(OCP\IUserSession::class, ['getUser' => static fn () => $user]),
		'l' => stub(OCP\IL10N::class, ['t' => static fn ($s, $p = []) => (string)$s]),
		'tempManager' => stub(OCP\ITempManager::class, ['getTemporaryFile' => static function ($x = '') {
			$t = tempnam(sys_get_temp_dir(), 'fbt');
			register_shutdown_function(static fn () => @unlink($t));
			return $t;
		}]),
		'collections' => $cm,
		'formulas' => $fm,
		'files' => $fs,
		'compiler' => new OCA\FormulaBase\Service\FormulaCompiler(),
	]);
	(new ReflectionProperty(OCP\AppFramework\Controller::class, 'request'))->setValue($api, request($params));
	return $api;
}

/** Call exportFormula($id) with $params against the Files in $files; the JSON answer and its status. */
function exportInto(array $formulas, array &$files, int $id, array $params): array {
	$res = exportController($formulas, $files, $params)->exportFormula($id);
	return [$res->getStatus(), $res->getData()];
}

/** content.xml of an ODF file's bytes, or null. */
function odfContent(string $bytes): ?string {
	$tmp = tempnam(sys_get_temp_dir(), 'fbz');
	file_put_contents($tmp, $bytes);
	$z = new ZipArchive();
	$out = null;
	if ($z->open($tmp) === true) {
		$c = $z->getFromName('content.xml');
		$out = $c === false ? null : $c;
		$z->close();
	}
	unlink($tmp);
	return $out;
}

/** Whether $xml reads as XML. */
function wellFormed(?string $xml): bool {
	if ($xml === null) {
		return false;
	}
	// strict: an undeclared prefix is only a warning to libxml, so any message at all fails
	$prev = libxml_use_internal_errors(true);
	libxml_clear_errors();
	$d = new DOMDocument();
	$ok = $d->loadXML($xml) === true && libxml_get_errors() === [];
	libxml_clear_errors();
	libxml_use_internal_errors($prev);
	return $ok;
}

/** A 1x1 PNG, as the browser sends the rendered formula. */
function tinyPng(): string {
	return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
}

/**
 * Open $bytes in LibreOffice (headless), recalculate everything, and return the last sheet's
 * used cells as rows of strings (a number as LibreOffice prints it); null when LibreOffice is not
 * there; ['error' => why] when it cannot open the file.
 */
function libreoffice(string $bytes, string $ext): ?array {
	static $have = null;
	$have ??= trim((string)shell_exec('command -v soffice')) !== '' && trim((string)shell_exec('python3 -c "import uno" 2>&1')) === '';
	if (!$have) {
		return null;
	}
	$dir = sys_get_temp_dir() . '/fbtest_' . getmypid();
	@mkdir($dir);
	$file = $dir . '/doc.' . $ext;
	file_put_contents($file, $bytes);
	register_shutdown_function(static fn () => shell_exec('rm -rf ' . escapeshellarg($dir)));
	$out = shell_exec('python3 -I ' . escapeshellarg(__DIR__ . '/lo_recalc.py') . ' ' . escapeshellarg($file) . ' ' . escapeshellarg($dir . '/profile') . ' 2>&1');
	$j = json_decode((string)$out, true);
	return is_array($j) ? $j : ['error' => trim((string)$out)];
}

/** In LibreOffice's rows, the value beside each label $label in column A. */
function besideLabel(array $rows, string $label): array {
	$out = [];
	foreach ($rows as $r) {
		if (($r[0] ?? null) === $label) {
			$out[] = $r[1] ?? null;
		}
	}
	return $out;
}

/* ---- the formula engine: PHP value, JS value, and the spreadsheet formula recalculated by LibreOffice ---- */

/** A result as the tests compare it: a float, or 'NaN' / 'INF' / '-INF' / 'LIST' / 'CX'. */
function encodeValue(mixed $v): mixed {
	if ($v instanceof OCA\FormulaBase\Service\Cx) {
		return 'CX';
	}
	if (is_array($v)) {
		return 'LIST';
	}
	$f = (float)$v;
	return is_nan($f) ? 'NaN' : (is_infinite($f) ? ($f > 0 ? 'INF' : '-INF') : $f);
}

/** Whether $got is the number/special value $want (relative 1e-9, or 1e-15 absolute around 0). */
function sameValue(mixed $got, mixed $want, float $tol = 1e-9): bool {
	if (is_string($want) || is_string($got)) {
		return $got === $want;
	}
	return abs($got - $want) <= $tol * max(abs($got), abs($want)) || abs($got - $want) < 1e-15;
}

/** The PHP engine on one expression: parse, then evaluate with $vars (numbers, or text for lists). */
function phpValue(string $expr, array $vars): mixed {
	$fc = new OCA\FormulaBase\Service\FormulaCompiler();
	try {
		$scope = [];
		foreach ($vars as $k => $v) {
			$scope[$k] = is_string($v) ? $fc->parseValue($v) : (float)$v;
		}
		return encodeValue($fc->evaluate($fc->parse($expr), $scope));
	} catch (\Throwable $e) {
		return 'ERR';
	}
}

/**
 * The JS engine (js/formulabase.js, or FORMULABASE_JS) on the same cases; null when node is not there.
 * @return array<int, mixed>|null id => value
 */
function jsValues(array $cases): ?array {
	if (trim((string)shell_exec('command -v node')) === '') {
		return null;
	}
	$in = tempnam(sys_get_temp_dir(), 'fbj');
	$out = tempnam(sys_get_temp_dir(), 'fbj');
	register_shutdown_function(static fn () => @unlink($in) && @unlink($out));
	file_put_contents($in, json_encode(array_map(static fn ($i, $c) => ['id' => $i, 'expr' => $c['expr'], 'vars' => (object)$c['vars']], array_keys($cases), $cases)));
	shell_exec('node ' . escapeshellarg(__DIR__ . '/js_engine.cjs') . ' ' . escapeshellarg($in) . ' ' . escapeshellarg($out) . ' 2>&1');
	$j = json_decode((string)file_get_contents($out), true);
	return is_array($j) ? $j : null;
}

/**
 * The spreadsheet formula FormulaCompiler writes for each case, recalculated by LibreOffice (headless):
 * id => number | 'ERR:code' | 'NOFORMULA'. Null when LibreOffice (or python3-uno) is not there.
 */
function odsBatch(array $cases): ?array {
	static $have = null;
	$have ??= trim((string)shell_exec('command -v soffice')) !== '' && trim((string)shell_exec('python3 -c "import uno" 2>&1')) === '';
	if (!$have) {
		return null;
	}
	$fc = new OCA\FormulaBase\Service\FormulaCompiler();
	$col = static function (int $i): string {
		$s = '';
		for ($i++; $i > 0; $i = intdiv($i - 1, 26)) {
			$s = chr(65 + ($i - 1) % 26) . $s;
		}
		return $s;
	};
	$rows = '';
	foreach (array_values($cases) as $r => $c) {
		$scope = [];
		$map = [];
		$cells = '';
		$k = 0;
		foreach ($c['vars'] as $name => $val) {
			$scope[$name] = is_string($val) ? $fc->parseValue($val) : (float)$val;
			$map[$name] = $col($k + 1) . ($r + 1);
			$cells .= '<table:table-cell office:value-type="float" office:value="' . (is_string($val) ? 0 : json_encode((float)$val)) . '"/>';
			$k++;
		}
		try {
			$f = $fc->toOdf($fc->parse($c['expr']), $map, $scope);
		} catch (\Throwable $e) {
			$f = null;
		}
		$rows .= '<table:table-row><table:table-cell office:value-type="float" office:value="' . $r . '"/>' . $cells
			. str_repeat('<table:table-cell/>', max(0, 20 - $k))
			. '<table:table-cell' . ($f === null ? '' : ' table:formula="=' . htmlspecialchars($f, ENT_QUOTES | ENT_XML1) . '"') . '/></table:table-row>';
	}
	$dir = sys_get_temp_dir() . '/fbbatch_' . getmypid();
	@mkdir($dir);
	register_shutdown_function(static fn () => shell_exec('rm -rf ' . escapeshellarg($dir)));
	$z = new ZipArchive();
	$z->open($dir . '/b.ods', ZipArchive::CREATE);
	$z->addFromString('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
	$z->setCompressionName('mimetype', ZipArchive::CM_STORE);
	$z->addFromString('content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="T">' . $rows . '</table:table></office:spreadsheet></office:body></office:document-content>');
	$z->addFromString('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
	$z->close();
	shell_exec('python3 -I ' . escapeshellarg(__DIR__ . '/lo_batch.py') . ' ' . escapeshellarg($dir . '/b.ods') . ' ' . escapeshellarg($dir . '/profile') . ' ' . escapeshellarg($dir . '/out.json') . ' 2>&1');
	$j = json_decode((string)@file_get_contents($dir . '/out.json'), true);
	return is_array($j) ? $j : ['error' => 'LibreOffice gave no result'];
}
