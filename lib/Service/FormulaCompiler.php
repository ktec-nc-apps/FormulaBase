<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Service;

/**
 * A PHP port of the expression engine in js/formulabase.js (tokenizer + recursive-descent
 * parser + evaluator), plus an AST -> OpenDocument-formula compiler. Grammar, precedence,
 * function set and constants MUST stay in sync with the JS engine so a spreadsheet exported
 * from a formula recomputes to the same number the app shows.
 *
 * OpenFormula (ODF) notes: arguments are ';'-separated, cell refs are '[.B2]', and '^' is
 * always compiled to POWER(a;b) — never emitted as an infix operator — because '^' associativity
 * differs between spreadsheet apps (left-assoc) and this engine (right-assoc); POWER() sidesteps
 * the ambiguity entirely. '%' likewise has no infix spreadsheet equivalent, so it becomes MOD(a;b).
 */
class FormulaCompiler {
	private const CONST_NAMES = ['pi', 'e', 'tau'];

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

		$pPrimary = null; $pPow = null; $pUnary = null; $pMul = null; $pAdd = null; $pExpr = null;

		$pPrimary = function () use ($peek, $next, $expect, &$pExpr): array {
			$t = $next();
			if (!$t) {
				throw new \RuntimeException('unexpected end');
			}
			if ($t['t'] === 'num') {
				return ['type' => 'num', 'v' => $t['v']];
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
					$lower = mb_strtolower($t['v']);
					if (!isset(self::FUNCTIONS[$lower])) {
						throw new \RuntimeException('unknown function "' . $t['v'] . '"');
					}
					return ['type' => 'call', 'name' => $t['v'], 'args' => $args];
				}
				if (in_array(mb_strtolower($t['v']), self::CONST_NAMES, true)) {
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
		$pMul = function () use ($pUnary, $peek, $next): array {
			$l = $pUnary();
			while ($peek() && $peek()['t'] === 'op' && in_array($peek()['v'], ['*', '/', '%'], true)) {
				$op = $next()['v'];
				$l = ['type' => 'bin', 'op' => $op, 'l' => $l, 'r' => $pUnary()];
			}
			return $l;
		};
		$pAdd = function () use ($pMul, $peek, $next): array {
			$l = $pMul();
			while ($peek() && $peek()['t'] === 'op' && ($peek()['v'] === '+' || $peek()['v'] === '-')) {
				$op = $next()['v'];
				$l = ['type' => 'bin', 'op' => $op, 'l' => $l, 'r' => $pMul()];
			}
			return $l;
		};
		$pExpr = function () use ($pAdd): array { return $pAdd(); };

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
		$i = 0;
		while ($i < $n) {
			$c = mb_substr($s, $i, 1);
			if (preg_match('/\s/u', $c)) {
				$i++;
				continue;
			}
			if (($c >= '0' && $c <= '9') || $c === '.') {
				$j = $i + 1;
				while ($j < $n && preg_match('/[0-9.]/', mb_substr($s, $j, 1))) {
					$j++;
				}
				if ($j < $n && in_array(mb_substr($s, $j, 1), ['e', 'E'], true)) {
					$j++;
					if ($j < $n && in_array(mb_substr($s, $j, 1), ['+', '-'], true)) {
						$j++;
					}
					while ($j < $n && preg_match('/[0-9]/', mb_substr($s, $j, 1))) {
						$j++;
					}
				}
				$numStr = mb_substr($s, $i, $j - $i);
				if (!is_numeric($numStr)) {
					throw new \RuntimeException('bad number');
				}
				$toks[] = ['t' => 'num', 'v' => (float)$numStr];
				$i = $j;
				continue;
			}
			if (preg_match('/[\p{L}_]/u', $c)) {
				$j = $i + 1;
				while ($j < $n && preg_match('/[\p{L}\p{N}_]/u', mb_substr($s, $j, 1))) {
					$j++;
				}
				$toks[] = ['t' => 'id', 'v' => mb_substr($s, $i, $j - $i)];
				$i = $j;
				continue;
			}
			if (strpos('+-*/%^(),', $c) !== false) {
				$toks[] = ['t' => 'op', 'v' => $c];
				$i++;
				continue;
			}
			throw new \RuntimeException('unexpected "' . $c . '"');
		}
		return $toks;
	}

	private const FUNCTIONS = [
		'sqrt' => 1, 'cbrt' => 1, 'abs' => 1, 'round' => 1, 'floor' => 1, 'ceil' => 1,
		'trunc' => 1, 'sign' => 1, 'exp' => 1, 'ln' => 1, 'log' => 1, 'log2' => 1,
		'sin' => 1, 'cos' => 1, 'tan' => 1, 'asin' => 1, 'acos' => 1, 'atan' => 1,
		'min' => 1, 'max' => 1, 'pow' => 1, 'mod' => 1, 'hypot' => 1, 'root' => 1,
	];

	/** Evaluate a parsed AST against a variable scope (mirrors evalAST in formulabase.js). */
	public function evaluate(array $n, array $scope): float {
		switch ($n['type']) {
			case 'num':
				return (float)$n['v'];
			case 'const':
				return match (mb_strtolower($n['name'])) {
					'pi' => M_PI, 'e' => M_E, 'tau' => M_PI * 2,
				};
			case 'var':
				if (!array_key_exists($n['name'], $scope)) {
					throw new \RuntimeException('unknown variable "' . $n['name'] . '"');
				}
				return (float)$scope[$n['name']];
			case 'unary':
				$a = $this->evaluate($n['arg'], $scope);
				return $n['op'] === '-' ? -$a : $a;
			case 'bin':
				$a = $this->evaluate($n['l'], $scope);
				$b = $this->evaluate($n['r'], $scope);
				return match ($n['op']) {
					'+' => $a + $b, '-' => $a - $b, '*' => $a * $b, '/' => $a / $b,
					'%' => fmod($a, $b), '^' => $a ** $b,
				};
			case 'call':
				$args = array_map(fn ($a) => $this->evaluate($a, $scope), $n['args']);
				return $this->callFn(mb_strtolower($n['name']), $args);
		}
		throw new \RuntimeException('bad node');
	}

	private function callFn(string $name, array $a): float {
		return match ($name) {
			'sqrt' => sqrt($a[0]), 'cbrt' => ($a[0] >= 0 ? 1 : -1) * (abs($a[0]) ** (1 / 3)),
			'abs' => abs($a[0]), 'round' => round($a[0]), 'floor' => floor($a[0]), 'ceil' => ceil($a[0]),
			'trunc' => $a[0] >= 0 ? floor($a[0]) : ceil($a[0]), 'sign' => (float)($a[0] <=> 0),
			'exp' => exp($a[0]), 'ln' => log($a[0]), 'log' => log10($a[0]), 'log2' => log($a[0], 2),
			'sin' => sin($a[0]), 'cos' => cos($a[0]), 'tan' => tan($a[0]),
			'asin' => asin($a[0]), 'acos' => acos($a[0]), 'atan' => atan($a[0]),
			'min' => min($a), 'max' => max($a), 'pow' => $a[0] ** $a[1], 'mod' => fmod($a[0], $a[1]),
			'hypot' => sqrt(array_sum(array_map(fn ($x) => $x * $x, $a))),
			'root' => ($a[0] <=> 0) * (abs($a[0]) ** (1 / $a[1])),
			default => throw new \RuntimeException('unknown function "' . $name . '"'),
		};
	}

	/**
	 * Compile a parsed AST into an OpenFormula body (no leading "of:="), resolving each
	 * variable name through $cellMap (name -> cell address, e.g. "B4").
	 * @param array<string,string> $cellMap
	 * @throws \RuntimeException if a variable has no assigned cell
	 */
	public function toOdf(array $n, array $cellMap): string {
		switch ($n['type']) {
			case 'num':
				return $this->numLiteral((float)$n['v']);
			case 'const':
				return match (mb_strtolower($n['name'])) {
					'pi' => 'PI()', 'e' => 'EXP(1)', 'tau' => '(2*PI())',
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
					return 'POWER(' . $this->toOdf($n['l'], $cellMap) . ';' . $this->toOdf($n['r'], $cellMap) . ')';
				}
				if ($n['op'] === '%') {
					return 'MOD(' . $this->toOdf($n['l'], $cellMap) . ';' . $this->toOdf($n['r'], $cellMap) . ')';
				}
				return $this->wrap($n['l'], $cellMap) . $n['op'] . $this->wrap($n['r'], $cellMap);
			case 'call':
				return $this->callToOdf(mb_strtolower($n['name']), $n['args'], $cellMap);
		}
		throw new \RuntimeException('bad node');
	}

	/** Wrap a binary-operation operand in parentheses (leaves and calls never need it). */
	private function wrap(array $n, array $cellMap): string {
		$s = $this->toOdf($n, $cellMap);
		return ($n['type'] === 'bin' && $n['op'] !== '^' && $n['op'] !== '%') ? '(' . $s . ')' : $s;
	}

	private function numLiteral(float $v): string {
		$s = rtrim(rtrim(sprintf('%.10F', $v), '0'), '.');
		return $s === '' || $s === '-' ? '0' : $s;
	}

	/** @param list<array> $args */
	private function callToOdf(string $name, array $args, array $cellMap): string {
		$a = array_map(fn ($x) => $this->toOdf($x, $cellMap), $args);
		return match ($name) {
			'sqrt' => 'SQRT(' . $a[0] . ')',
			'cbrt' => 'SIGN(' . $a[0] . ')*POWER(ABS(' . $a[0] . ');1/3)',
			'abs' => 'ABS(' . $a[0] . ')',
			'round' => 'ROUND(' . $a[0] . ';0)',
			'floor' => 'FLOOR(' . $a[0] . ';1)',
			'ceil' => 'CEILING(' . $a[0] . ';1)',
			'trunc' => 'TRUNC(' . $a[0] . ';0)',
			'sign' => 'SIGN(' . $a[0] . ')',
			'exp' => 'EXP(' . $a[0] . ')',
			'ln' => 'LN(' . $a[0] . ')',
			'log' => 'LOG10(' . $a[0] . ')',
			'log2' => 'LOG(' . $a[0] . ';2)',
			'sin' => 'SIN(' . $a[0] . ')',
			'cos' => 'COS(' . $a[0] . ')',
			'tan' => 'TAN(' . $a[0] . ')',
			'asin' => 'ASIN(' . $a[0] . ')',
			'acos' => 'ACOS(' . $a[0] . ')',
			'atan' => 'ATAN(' . $a[0] . ')',
			'min' => 'MIN(' . implode(';', $a) . ')',
			'max' => 'MAX(' . implode(';', $a) . ')',
			'pow' => 'POWER(' . $a[0] . ';' . $a[1] . ')',
			'mod' => 'MOD(' . $a[0] . ';' . $a[1] . ')',
			'hypot' => 'SQRT(' . implode('+', array_map(fn ($x) => $x . '^2', $a)) . ')',
			'root' => 'SIGN(' . $a[0] . ')*POWER(ABS(' . $a[0] . ');1/' . $a[1] . ')',
			default => throw new \RuntimeException('unknown function "' . $name . '"'),
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
				foreach ($n['args'] as $arg) {
					$this->collectVars($arg, $out, $seen);
				}
				break;
		}
		return $out;
	}
}
