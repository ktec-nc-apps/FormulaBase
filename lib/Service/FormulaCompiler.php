<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Service;

/**
 * A PHP port of the expression engine in js/formulabase.js (tokenizer + recursive-descent
 * parser + evaluator), plus an AST -> OpenDocument-formula compiler. Grammar, precedence,
 * function set and constants MUST stay in sync with the JS engine so a spreadsheet exported
 * from a formula recomputes to the same number the app shows.
 *
 * Values are floats, lists/matrices (PHP arrays) or complex numbers (Cx). Comparisons give 1/0;
 * if()/piecewise() evaluate only the branch taken; sum/prod/integral/deriv/solve bind a variable.
 *
 * OpenFormula (ODF) notes: arguments are ';'-separated, cell refs are '[.B2]', and '^' is
 * always compiled to POWER(a;b) — never emitted as an infix operator — because '^' associativity
 * differs between spreadsheet apps (left-assoc) and this engine (right-assoc); POWER() sidesteps
 * the ambiguity entirely. '%' likewise has no infix spreadsheet equivalent, so it becomes MOD(a;b).
 * A part with no spreadsheet function (Σ, isprime, …) is written as the number it comes to.
 */
class FormulaCompiler {
	/** Named constants — the same table as CONST/PCONST in the JS engine. */
	private const CONSTS = [
		'pi' => M_PI, 'e' => M_E, 'tau' => M_PI * 2, 'infinity' => INF,
		'c_light' => 299792458.0, 'h_planck' => 6.62607015e-34, 'h_bar' => 1.054571817e-34, 'g_newton' => 6.67430e-11,
		'k_boltz' => 1.380649e-23, 'n_avo' => 6.02214076e23, 'r_gas' => 8.314462618, 'q_e' => 1.602176634e-19,
		'm_e' => 9.1093837015e-31, 'm_p' => 1.67262192369e-27, 'm_n' => 1.67492749804e-27, 'u_amu' => 1.66053906660e-27,
		'eps_0' => 8.8541878128e-12, 'mu_0' => 1.25663706212e-6, 'k_coulomb' => 8.9875517923e9, 'sigma_sb' => 5.670374419e-8,
		'alpha_fs' => 7.2973525693e-3, 'a_bohr' => 5.29177210903e-11, 'r_inf' => 10973731.568160, 'f_faraday' => 96485.33212,
		'g_std' => 9.80665, 'atm_pa' => 101325.0, 'au_m' => 149597870700.0, 'ly_m' => 9460730472580800.0, 'pc_m' => 3.0856775814913673e16,
		'm_sun' => 1.98847e30, 'm_earth' => 5.9722e24, 'r_earth' => 6371000.0, 'ev_j' => 1.602176634e-19, 'cal_j' => 4.184,
		'euler_gamma' => 0.5772156649015329, 'golden_ratio' => 1.618033988749895, 'catalan_c' => 0.915965594177219, 'apery_c' => 1.2020569031595942,
	];

	/** Scalar functions (lifted over lists). */
	private const BASE = [
		'sqrt', 'cbrt', 'abs', 'round', 'floor', 'ceil', 'trunc', 'sign', 'exp', 'ln', 'log', 'log2',
		'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'pow', 'mod', 'hypot', 'root', 'logb', 'roundto', 'frac', 'clamp',
		'deg', 'rad', 'sec', 'csc', 'cot', 'and', 'or', 'xor', 'not',
	];
	private const COMPLEX_OK = ['sqrt', 'abs', 'exp', 'ln', 'log', 'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'pow'];
	/** Forms evaluated specially (binders and branches). */
	private const SPECIAL = ['integral', 'deriv', 'solve', 'if', 'piecewise'];
	private const BINDER_ARITY = ['sum' => [4], 'prod' => [4], 'integral' => [4], 'deriv' => [3, 4], 'solve' => [3, 4]];
	private const CMP = ['<', '<=', '>', '>=', '==', '!='];

	private function isFunction(string $name): bool {
		return in_array($name, self::BASE, true) || in_array($name, self::SPECIAL, true)
			|| in_array($name, MathLib::NAMES, true) || in_array($name, Values::AGGREGATES, true);
	}

	/** @throws \RuntimeException on a malformed expression */
	public function parse(string $src): array {
		$toks = $this->tokenize($src);
		$p = 0;
		$peek = function () use (&$toks, &$p) { return $toks[$p] ?? null; };
		$next = function () use (&$toks, &$p) { return $toks[$p++] ?? null; };
		$expect = function (string $v) use ($next) {
			$t = $next();
			if (!$t || $t['v'] !== $v) {
				throw new \RuntimeException('expected "' . $v . '"');
			}
		};
		$isOp = fn ($t, array $ops) => $t && $t['t'] === 'op' && in_array($t['v'], $ops, true);

		$pPrimary = null; $pPow = null; $pUnary = null; $pMul = null; $pAdd = null; $pCmp = null; $pExpr = null;

		$pPrimary = function () use ($peek, $next, $expect, &$pExpr): array {
			$t = $next();
			if (!$t) {
				throw new \RuntimeException('unexpected end');
			}
			if ($t['t'] === 'num') {
				return !empty($t['imag']) ? ['type' => 'num', 'v' => $t['v'], 'imag' => true] : ['type' => 'num', 'v' => $t['v']];
			}
			if ($t['t'] === 'op' && $t['v'] === '(') {
				$e = $pExpr();
				$expect(')');
				return $e;
			}
			if ($t['t'] === 'id') {
				if ($peek() && $peek()['t'] === 'op' && $peek()['v'] === '(') {
					$next();
					$args = [];
					if (!($peek() && $peek()['v'] === ')')) {
						$args[] = $pExpr();
						while ($peek() && $peek()['v'] === ',') {
							$next();
							$args[] = $pExpr();
						}
					}
					$expect(')');
					if (!$this->isFunction(mb_strtolower($t['v']))) {
						throw new \RuntimeException('unknown function "' . $t['v'] . '"');
					}
					return ['type' => 'call', 'name' => $t['v'], 'args' => $args];
				}
				if (array_key_exists(mb_strtolower($t['v']), self::CONSTS)) {
					return ['type' => 'const', 'name' => $t['v']];
				}
				return ['type' => 'var', 'name' => $t['v']];
			}
			throw new \RuntimeException('unexpected "' . $t['v'] . '"');
		};
		$pPow = function () use ($pPrimary, $peek, $next, &$pUnary): array {
			$l = $pPrimary();
			if ($peek() && $peek()['t'] === 'op' && $peek()['v'] === '^') {
				$next();
				return ['type' => 'bin', 'op' => '^', 'l' => $l, 'r' => $pUnary()];
			}
			return $l;
		};
		$pUnary = function () use ($peek, $next, $pPow, &$pUnary): array {
			$t = $peek();
			if ($t && $t['t'] === 'op' && ($t['v'] === '+' || $t['v'] === '-')) {
				$next();
				return ['type' => 'unary', 'op' => $t['v'], 'arg' => $pUnary()];
			}
			return $pPow();
		};
		$pMul = function () use ($pUnary, $peek, $next, $isOp): array {
			$l = $pUnary();
			while ($isOp($peek(), ['*', '/', '%'])) {
				$op = $next()['v'];
				$l = ['type' => 'bin', 'op' => $op, 'l' => $l, 'r' => $pUnary()];
			}
			return $l;
		};
		$pAdd = function () use ($pMul, $peek, $next, $isOp): array {
			$l = $pMul();
			while ($isOp($peek(), ['+', '-'])) {
				$op = $next()['v'];
				$l = ['type' => 'bin', 'op' => $op, 'l' => $l, 'r' => $pMul()];
			}
			return $l;
		};
		$pCmp = function () use ($pAdd, $peek, $next, $isOp): array {
			$l = $pAdd();
			while ($isOp($peek(), self::CMP)) {
				$op = $next()['v'];
				$l = ['type' => 'bin', 'op' => $op, 'l' => $l, 'r' => $pAdd()];
			}
			return $l;
		};
		$pExpr = function () use ($pCmp): array { return $pCmp(); };

		$ast = $pExpr();
		if ($p < count($toks)) {
			throw new \RuntimeException('unexpected "' . $toks[$p]['v'] . '"');
		}
		return $ast;
	}

	/** @return list<array{t:string,v:mixed}> */
	private function tokenize(string $s): array {
		$toks = [];
		$n = mb_strlen($s);
		$ch = fn (int $k) => $k < $n ? mb_substr($s, $k, 1) : '';
		$i = 0;
		while ($i < $n) {
			$c = $ch($i);
			if (preg_match('/\s/u', $c)) {
				$i++;
				continue;
			}
			if (($c >= '0' && $c <= '9') || $c === '.') {
				$j = $i + 1;
				while ($j < $n && preg_match('/[0-9.]/', $ch($j))) {
					$j++;
				}
				if ($j < $n && in_array($ch($j), ['e', 'E'], true) && preg_match('/[0-9+-]/', $ch($j + 1))) {
					$j++;
					if ($j < $n && in_array($ch($j), ['+', '-'], true)) {
						$j++;
					}
					while ($j < $n && preg_match('/[0-9]/', $ch($j))) {
						$j++;
					}
				}
				$numStr = mb_substr($s, $i, $j - $i);
				if (!is_numeric($numStr)) {
					throw new \RuntimeException('bad number');
				}
				if ($ch($j) === 'i' && !preg_match('/[\p{L}\p{N}_]/u', $ch($j + 1))) {
					$toks[] = ['t' => 'num', 'v' => (float)$numStr, 'imag' => true];
					$i = $j + 1;
					continue;
				}
				$toks[] = ['t' => 'num', 'v' => (float)$numStr];
				$i = $j;
				continue;
			}
			if (preg_match('/[\p{L}_]/u', $c)) {
				$j = $i + 1;
				while ($j < $n && preg_match('/[\p{L}\p{N}_]/u', $ch($j))) {
					$j++;
				}
				$toks[] = ['t' => 'id', 'v' => mb_substr($s, $i, $j - $i)];
				$i = $j;
				continue;
			}
			$two = $c . $ch($i + 1);
			if (in_array($two, ['<=', '>=', '==', '!='], true)) {
				$toks[] = ['t' => 'op', 'v' => $two];
				$i += 2;
				continue;
			}
			if (strpos('+-*/%^(),<>', $c) !== false) {
				$toks[] = ['t' => 'op', 'v' => $c];
				$i++;
				continue;
			}
			throw new \RuntimeException('unexpected "' . $c . '"');
		}
		return $toks;
	}

	private function isBinder(array $n): bool {
		if ($n['type'] !== 'call') {
			return false;
		}
		$ar = self::BINDER_ARITY[mb_strtolower($n['name'])] ?? null;
		return $ar !== null && in_array(count($n['args']), $ar, true) && $n['args'][0]['type'] === 'var';
	}

	private function binderBody(array $n): array {
		return mb_strtolower($n['name']) === 'deriv' ? $n['args'][2] : $n['args'][count($n['args']) - 1];
	}

	private function evalBinder(array $n, array $scope): mixed {
		$k = $n['args'][0]['name'];
		$kind = mb_strtolower($n['name']);
		$body = $this->binderBody($n);
		$f = function ($x) use ($body, $scope, $k) {
			$scope[$k] = (float)$x;
			$v = $this->evaluate($body, $scope);
			return is_float($v) || is_int($v) ? (float)$v : NAN;
		};
		if ($kind === 'sum' || $kind === 'prod') {
			$a = $this->evaluate($n['args'][1], $scope);
			$b = $this->evaluate($n['args'][2], $scope);
			if (!is_float($a) || !is_float($b) || !is_finite($a) || !is_finite($b) || $b - $a > 1000000) {
				return NAN;
			}
			$acc = $kind === 'sum' ? 0.0 : 1.0;
			for ($i = ceil($a); $i <= $b; $i++) {
				$scope[$k] = $i;
				$acc = Values::bin($kind === 'sum' ? '+' : '*', $acc, $this->evaluate($body, $scope));
			}
			return $acc;
		}
		if ($kind === 'integral') {
			$a = $this->evaluate($n['args'][1], $scope);
			$b = $this->evaluate($n['args'][2], $scope);
			if (!is_float($a) || !is_float($b)) {
				return NAN;
			}
			return $a > $b ? -Special::integrate($f, $b, $a) : Special::integrate($f, $a, $b);
		}
		if ($kind === 'deriv') {
			$x0 = $this->evaluate($n['args'][1], $scope);
			$ord = count($n['args']) === 4 ? $this->evaluate($n['args'][3], $scope) : 1.0;
			return is_float($x0) && is_float($ord) ? Special::derivative($f, $x0, $ord) : NAN;
		}
		$g = $this->evaluate($n['args'][1], $scope);
		$h = count($n['args']) === 4 ? $this->evaluate($n['args'][2], $scope) : null;
		if (!is_float($g) || ($h !== null && !is_float($h))) {
			return NAN;
		}
		return Special::findRoot($f, $g, $h);
	}

	private static function truthy(mixed $v): bool {
		if ($v instanceof Cx) {
			return $v->re != 0 || $v->im != 0;
		}
		// like JS: a list counts as true
		return is_array($v) || (!is_nan((float)$v) && (float)$v != 0);
	}

	/** Evaluate a parsed AST against a variable scope (mirrors evalAST in formulabase.js). */
	public function evaluate(array $n, array $scope): mixed {
		switch ($n['type']) {
			case 'num':
				return !empty($n['imag']) ? Values::simp(new Cx(0.0, (float)$n['v'])) : (float)$n['v'];
			case 'const':
				return self::CONSTS[mb_strtolower($n['name'])];
			case 'var':
				if (!array_key_exists($n['name'], $scope)) {
					throw new \RuntimeException('unknown variable "' . $n['name'] . '"');
				}
				$v = $scope[$n['name']];
				return (is_array($v) || $v instanceof Cx) ? $v : (is_numeric($v) ? (float)$v : NAN);
			case 'unary':
				$a = $this->evaluate($n['arg'], $scope);
				return $n['op'] === '-' ? Values::neg($a) : $a;
			case 'bin':
				return Values::bin($n['op'], $this->evaluate($n['l'], $scope), $this->evaluate($n['r'], $scope));
			case 'call':
				$name = mb_strtolower($n['name']);
				if ($this->isBinder($n)) {
					return $this->evalBinder($n, $scope);
				}
				if ($name === 'if') {
					if (count($n['args']) !== 3) {
						return NAN;
					}
					$c = $this->evaluate($n['args'][0], $scope);
					if (is_array($c)) {
						return Values::bin('+', Values::bin('*', $c, $this->evaluate($n['args'][1], $scope)), Values::bin('*', Values::bin('-', 1.0, $c), $this->evaluate($n['args'][2], $scope)));
					}
					return self::truthy($c) ? $this->evaluate($n['args'][1], $scope) : $this->evaluate($n['args'][2], $scope);
				}
				if ($name === 'piecewise') {
					$args = $n['args'];
					for ($i = 0; $i + 1 < count($args); $i += 2) {
						if (self::truthy($this->evaluate($args[$i], $scope))) {
							return $this->evaluate($args[$i + 1], $scope);
						}
					}
					return count($args) % 2 ? $this->evaluate($args[count($args) - 1], $scope) : NAN;
				}
				$args = array_map(fn ($a) => $this->evaluate($a, $scope), $n['args']);
				return $this->callFn($name, $args);
		}
		throw new \RuntimeException('bad node');
	}

	/** Call a function by name: aggregates take lists whole; scalar ones are applied item by item. */
	public function callFn(string $name, array $a): mixed {
		if (in_array($name, Values::AGGREGATES, true)) {
			return Values::call($name, $a);
		}
		foreach ($a as $i => $v) {
			if (is_array($v)) {
				return array_map(function ($x) use ($a, $i, $name) { $b = $a; $b[$i] = $x; return $this->callFn($name, $b); }, $v);
			}
		}
		foreach ($a as $v) {
			if ($v instanceof Cx) {
				return in_array($name, self::COMPLEX_OK, true) ? (Values::complexFn($name, $a) ?? NAN) : NAN;
			}
		}
		$a = array_map('floatval', $a);
		$x = $a[0] ?? NAN;
		return match ($name) {
			'sqrt' => $x < 0 ? NAN : sqrt($x), 'cbrt' => ($x >= 0 ? 1 : -1) * (abs($x) ** (1 / 3)),
			'abs' => abs($x), 'round' => self::jsRound($x), 'floor' => floor($x), 'ceil' => ceil($x),
			'trunc' => $x >= 0 ? floor($x) : ceil($x), 'sign' => is_nan($x) ? NAN : (float)($x <=> 0),
			'exp' => exp($x), 'ln' => $x < 0 ? NAN : ($x == 0 ? -INF : log($x)), 'log' => $x < 0 ? NAN : ($x == 0 ? -INF : log10($x)),
			'log2' => $x < 0 ? NAN : ($x == 0 ? -INF : log($x, 2)),
			'sin' => sin($x), 'cos' => cos($x), 'tan' => tan($x),
			'asin' => asin($x), 'acos' => acos($x), 'atan' => atan($x),
			'pow' => Values::rpow($x, $a[1] ?? NAN), 'mod' => fmod($x, $a[1] ?? NAN),
			'hypot' => sqrt(array_sum(array_map(fn ($v) => $v * $v, $a))),
			'root' => ($x <=> 0) * (abs($x) ** (1 / ($a[1] ?? NAN))),
			'logb' => log($x) / log($a[1] ?? NAN), 'roundto' => self::jsRound($x * (10 ** ($a[1] ?? 0))) / (10 ** ($a[1] ?? 0)),
			'frac' => $x - ($x >= 0 ? floor($x) : ceil($x)), 'clamp' => min(max($x, $a[1] ?? NAN), $a[2] ?? NAN),
			'deg' => $x * 180 / M_PI, 'rad' => $x * M_PI / 180,
			'sec' => 1 / cos($x), 'csc' => 1 / sin($x), 'cot' => 1 / tan($x),
			'and' => (float)(self::truthy($x) && self::truthy($a[1] ?? NAN)), 'or' => (float)(self::truthy($x) || self::truthy($a[1] ?? NAN)),
			'xor' => (float)(self::truthy($x) !== self::truthy($a[1] ?? NAN)), 'not' => (float)!self::truthy($x),
			default => MathLib::call($name, $a),
		};
	}

	/** JavaScript's Math.round: halves go towards +∞ (PHP's round goes away from zero). */
	private static function jsRound(float $x): float {
		return floor($x + 0.5);
	}

	/** A value typed into an input (a bare i is the imaginary unit here only): a number, a list "1, 2, 3", a matrix "1, 2; 3, 4" or a complex number "3+4i". */
	public function parseValue(mixed $raw): mixed {
		if (is_array($raw) || $raw instanceof Cx || is_float($raw) || is_int($raw)) {
			return is_int($raw) ? (float)$raw : $raw;
		}
		$s = trim((string)$raw);
		if ($s === '') {
			return NAN;
		}
		if (preg_match('/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/', $s)) {
			return (float)$s;
		}
		$one = function (string $x) {
			$t = trim($x);
			if ($t === '') {
				return NAN;
			}
			try {
				return $this->evaluate($this->parse($t), ['i' => new Cx(0.0, 1.0)]);
			} catch (\Throwable $e) {
				return NAN;
			}
		};
		$split = fn (string $row) => array_values(array_filter(preg_split('/[,\s]+/', trim($row)), fn ($x) => $x !== ''));
		if (str_contains($s, ';')) {
			return array_map(fn ($row) => array_map($one, $split($row)), explode(';', $s));
		}
		if (str_contains($s, ',') || preg_match('/\d\s+[-+]?\d/', $s)) {
			return array_map($one, $split($s));
		}
		return $one($s);
	}

	/** What a variable holds (mirrors vkind in formulabase.js). */
	public static function variableKind(array $v): string {
		$t = $v['type'] ?? '';
		if (in_array($t, ['list', 'matrix', 'complex'], true)) {
			return $t;
		}
		$d = isset($v['default']) ? (string)$v['default'] : '';
		if (str_contains($d, ';')) {
			return 'matrix';
		}
		if (str_contains($d, ',')) {
			return 'list';
		}
		if (preg_match('/(^|[\d+-])i$/', preg_replace('/\s+/', '', $d))) {
			return 'complex';
		}
		return 'number';
	}

	/** A result of any kind as text (numbers are left to the caller's own formatting). */
	public function formatValue(mixed $v): string {
		if (is_array($v)) {
			$m = Values::isM($v);
			return '[' . implode($m ? '; ' : ', ', array_map(fn ($x) => is_array($x) ? implode(', ', array_map([$this, 'formatValue'], $x)) : $this->formatValue($x), $v)) . ']';
		}
		if ($v instanceof Cx) {
			return $this->formatValue($v->re) . ($v->im < 0 ? ' − ' : ' + ') . $this->formatValue(abs($v->im)) . 'i';
		}
		$f = (float)$v;
		if (!is_finite($f)) {
			return is_nan($f) ? 'NaN' : ($f > 0 ? '∞' : '−∞');
		}
		$s = sprintf('%.12G', $f);
		if (str_contains($s, 'E')) {
			[$m, $e] = explode('E', $s);
			return (str_contains($m, '.') ? rtrim(rtrim($m, '0'), '.') : $m) . 'E' . (int)$e;
		}
		return str_contains($s, '.') ? rtrim(rtrim($s, '0'), '.') : $s;
	}

	/**
	 * Compile a parsed AST into an OpenFormula body (no leading "of:="), resolving each
	 * variable name through $cellMap (name -> cell address, e.g. "B4").
	 * @param array<string,string> $cellMap
	 * @throws \RuntimeException if a variable has no assigned cell
	 */
	public function toOdf(array $n, array $cellMap, ?array $scope = null): string {
		$this->odfScope = $scope;
		foreach ($scope ?? [] as $v) {
			if (is_array($v) || $v instanceof Cx) {
				// a list/matrix/complex input sits in its cell as text, which no spreadsheet formula can
				// read — so the whole result is written as the value it comes to
				return $this->literalOf($n);
			}
		}
		if ($this->needsLiteral($n)) {
			return $this->literalOf($n);
		}
		return $this->odf($n, $cellMap);
	}

	/** Values to put in place of a call that has no spreadsheet function (see callToOdf). */
	private ?array $odfScope = null;

	private function odf(array $n, array $cellMap): string {
		switch ($n['type']) {
			case 'num':
				if (!empty($n['imag'])) {
					return $this->literalOf($n);
				}
				return $this->numLiteral((float)$n['v']);
			case 'const':
				$c = mb_strtolower($n['name']);
				return match ($c) {
					'pi' => 'PI()', 'e' => 'EXP(1)', 'tau' => '(2*PI())',
					default => $this->numLiteral(self::CONSTS[$c]),
				};
			case 'var':
				if (!isset($cellMap[$n['name']])) {
					throw new \RuntimeException('unmapped variable "' . $n['name'] . '"');
				}
				return '[.' . $cellMap[$n['name']] . ']';
			case 'unary':
				return $n['op'] . $this->wrap($n['arg'], $cellMap);
			case 'bin':
				if ($n['op'] === '^') {
					return 'POWER(' . $this->odf($n['l'], $cellMap) . ';' . $this->odf($n['r'], $cellMap) . ')';
				}
				if ($n['op'] === '%') {
					return 'MOD(' . $this->odf($n['l'], $cellMap) . ';' . $this->odf($n['r'], $cellMap) . ')';
				}
				if (in_array($n['op'], self::CMP, true)) {
					// a comparison is TRUE/FALSE in a spreadsheet; turn it into 1/0 like the app
					$op = ['==' => '=', '!=' => '<>'][$n['op']] ?? $n['op'];
					return 'IF(' . $this->wrap($n['l'], $cellMap) . $op . $this->wrap($n['r'], $cellMap) . ';1;0)';
				}
				return $this->wrap($n['l'], $cellMap) . $n['op'] . $this->wrap($n['r'], $cellMap);
			case 'call':
				return $this->callToOdf($n, $cellMap);
		}
		throw new \RuntimeException('bad node');
	}

	/** Wrap a binary-operation operand in parentheses (leaves and calls never need it). */
	private function wrap(array $n, array $cellMap): string {
		$s = $this->odf($n, $cellMap);
		return ($n['type'] === 'bin' && $n['op'] !== '^' && $n['op'] !== '%' && !in_array($n['op'], self::CMP, true)) ? '(' . $s . ')' : $s;
	}

	private function numLiteral(float $v): string {
		if (!is_finite($v)) {
			return is_nan($v) ? 'NA()' : ($v > 0 ? '(1E308*10)' : '(-1E308*10)');
		}
		return self::exactNumber($v);
	}

	/** The shortest text that reads back as the same number (1/3 keeps all 17 of its digits). */
	public static function exactNumber(float $v): string {
		if ($v == 0) {
			return '0';
		}
		for ($p = 15; $p <= 17; $p++) {
			$s = sprintf('%.' . $p . 'G', $v);
			if ((float)$s === $v) {
				break;
			}
		}
		if (str_contains($s, 'E')) {
			[$m, $e] = explode('E', $s);
			$m = str_contains($m, '.') ? rtrim(rtrim($m, '0'), '.') : $m;
			return $m . 'E' . (int)$e;
		}
		return str_contains($s, '.') ? rtrim(rtrim($s, '0'), '.') : $s;
	}

	/** True when the formula holds something no spreadsheet can hold: ∞ or an imaginary number. */
	private function needsLiteral(array $n): bool {
		if (($n['type'] === 'num' && !empty($n['imag'])) || ($n['type'] === 'const' && mb_strtolower($n['name']) === 'infinity')) {
			return true;
		}
		foreach (['arg', 'l', 'r'] as $k) {
			if (isset($n[$k]) && $this->needsLiteral($n[$k])) {
				return true;
			}
		}
		foreach ($n['args'] ?? [] as $a) {
			if ($this->needsLiteral($a)) {
				return true;
			}
		}
		return false;
	}

	/** A sub-expression written as the value it comes to (needs the export's scope). */
	private function literalOf(array $n): string {
		if ($this->odfScope === null) {
			throw new \RuntimeException('no spreadsheet function for this part of the formula');
		}
		$v = $this->evaluate($n, $this->odfScope);
		if (is_float($v) || is_int($v)) {
			return $this->numLiteral((float)$v);
		}
		return '"' . str_replace('"', '""', $this->formatValue($v)) . '"';
	}

	private const ODF_NEW = [
		'gcd' => 'GCD', 'lcm' => 'LCM', 'fact' => 'FACT', 'binom' => 'COMBIN', 'perm' => 'PERMUT',
		'gamma' => 'GAMMA', 'lgamma' => 'GAMMALN', 'erf' => 'ERF', 'erfc' => 'ERFC',
		'sinh' => 'SINH', 'cosh' => 'COSH', 'tanh' => 'TANH', 'asinh' => 'ASINH', 'acosh' => 'ACOSH', 'atanh' => 'ATANH',
		'and' => 'AND', 'or' => 'OR', 'xor' => 'XOR', 'not' => 'NOT',
	];

	private function callToOdf(array $n, array $cellMap): string {
		$name = mb_strtolower($n['name']);
		$args = $n['args'];
		$a = fn () => array_map(fn ($x) => $this->odf($x, $cellMap), $args);
		if ($this->isBinder($n)) {
			return $this->literalOf($n);
		}
		if (isset(self::ODF_NEW[$name])) {
			$inner = self::ODF_NEW[$name] . '(' . implode(';', $a()) . ')';
			return in_array($name, ['and', 'or', 'xor', 'not'], true) ? 'IF(' . $inner . ';1;0)' : $inner;
		}
		if ($name === 'if' && count($args) === 3) {
			$v = $a();
			return 'IF(' . $v[0] . '<>0;' . $v[1] . ';' . $v[2] . ')';
		}
		if ($name === 'piecewise' && count($args) >= 2) {
			$v = $a();
			$out = count($v) % 2 ? $v[count($v) - 1] : 'NA()';
			for ($i = intdiv(count($v), 2) * 2 - 2; $i >= 0; $i -= 2) {
				$out = 'IF(' . $v[$i] . '<>0;' . $v[$i + 1] . ';' . $out . ')';
			}
			return $out;
		}
		if ($name === 'atan2' && count($args) === 2) {
			// OpenFormula ATAN2 takes (x; y), the reverse of atan2(y, x)
			$v = $a();
			return 'ATAN2(' . $v[1] . ';' . $v[0] . ')';
		}
		if ($name === 'normcdf' && count($args) === 1) {
			return 'NORMSDIST(' . $a()[0] . ')';
		}
		if ($name === 'norminv' && count($args) === 1) {
			return 'NORMSINV(' . $a()[0] . ')';
		}
		$simple = [
			'sqrt' => 'SQRT', 'abs' => 'ABS', 'sign' => 'SIGN', 'exp' => 'EXP', 'ln' => 'LN', 'log' => 'LOG10',
			'sin' => 'SIN', 'cos' => 'COS', 'tan' => 'TAN', 'asin' => 'ASIN', 'acos' => 'ACOS', 'atan' => 'ATAN',
			'deg' => 'DEGREES', 'rad' => 'RADIANS',
		];
		if (isset($simple[$name]) && count($args) === 1) {
			return $simple[$name] . '(' . $a()[0] . ')';
		}
		$v = in_array($name, ['sqrt', 'cbrt', 'abs', 'round', 'floor', 'ceil', 'trunc', 'sign', 'exp', 'ln', 'log', 'log2', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'min', 'max', 'pow', 'mod', 'hypot', 'root'], true) ? $a() : null;
		return match ($name) {
			// parenthesised: these stand where a single value would (x / cbrt(y))
			'cbrt' => '(SIGN(' . $v[0] . ')*POWER(ABS(' . $v[0] . ');1/3))',
			// the app rounds halves up (−2.5 → −2), spreadsheets' ROUND away from zero; INT always floors
			'round' => 'INT(' . $v[0] . '+0.5)',
			'floor' => 'INT(' . $v[0] . ')',
			'ceil' => '-INT(-(' . $v[0] . '))',
			'trunc' => 'TRUNC(' . $v[0] . ';0)',
			'log2' => 'LOG(' . $v[0] . ';2)',
			'min' => 'MIN(' . implode(';', $v) . ')',
			'max' => 'MAX(' . implode(';', $v) . ')',
			'pow' => 'POWER(' . $v[0] . ';' . $v[1] . ')',
			'mod' => 'MOD(' . $v[0] . ';' . $v[1] . ')',
			'hypot' => 'SQRT(SUMSQ(' . implode(';', $v) . '))',
			'root' => '(SIGN(' . $v[0] . ')*POWER(ABS(' . $v[0] . ');1/(' . $v[1] . ')))',
			default => $this->literalOf($n),
		};
	}

	/** Variable names referenced by the AST, in first-appearance order (no duplicates). */
	public function collectVars(array $n, array &$out = [], array &$seen = []): array {
		switch ($n['type']) {
			case 'var':
				if (!isset($seen[$n['name']])) {
					$seen[$n['name']] = true;
					$out[] = $n['name'];
				}
				break;
			case 'unary':
				$this->collectVars($n['arg'], $out, $seen);
				break;
			case 'bin':
				$this->collectVars($n['l'], $out, $seen);
				$this->collectVars($n['r'], $out, $seen);
				break;
			case 'call':
				if ($this->isBinder($n)) {
					$bi = mb_strtolower($n['name']) === 'deriv' ? 2 : count($n['args']) - 1;
					$body = $n['args'][$bi];
					$k = $n['args'][0]['name'];
					foreach ($n['args'] as $ai => $arg) {
						if ($ai !== 0 && $ai !== $bi) {
							$this->collectVars($arg, $out, $seen);
						}
					}
					$was = isset($seen[$k]);
					$seen[$k] = true;
					$this->collectVars($body, $out, $seen);
					if (!$was) {
						unset($seen[$k]);
					}
					break;
				}
				foreach ($n['args'] as $arg) {
					$this->collectVars($arg, $out, $seen);
				}
				break;
		}
		return $out;
	}
}
