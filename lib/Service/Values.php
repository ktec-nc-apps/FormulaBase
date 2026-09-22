<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Service;

/**
 * Values beyond plain numbers — complex numbers (Cx), lists (PHP lists of values) and matrices
 * (lists of equal-length lists) — with element-wise arithmetic and the list/matrix functions.
 * The PHP port of the VAL block in js/formulabase.js; the two must agree.
 */
class Values {
	public const AGGREGATES = [
		'sum', 'prod', 'count', 'len', 'mean', 'median', 'mode', 'var', 'stdev', 'varp', 'stdevp', 'gmean', 'hmean', 'wmean',
		'percentile', 'quantile', 'skew', 'kurt', 'cov', 'corr', 'slope', 'intercept', 'rsq', 'npv', 'irr', 'mirr', 'list', 'seq', 'at',
		'sort', 'cumsum', 'cummax', 'cummin', 'diff', 'dot', 'cross', 'norm', 'trans', 'mmul', 'det', 'inv', 'trace', 'eye', 'linsolve', 're', 'im', 'conj',
		'arg', 'polar', 'min', 'max', 'csqrt', 'cln', 'cpow',
	];

	public static function isC(mixed $v): bool { return $v instanceof Cx; }
	public static function isA(mixed $v): bool { return is_array($v); }
	public static function isM(mixed $v): bool {
		if (!is_array($v) || !$v) { return false; }
		foreach ($v as $r) { if (!is_array($r)) { return false; } }
		return true;
	}
	public static function C(mixed $v): Cx { return $v instanceof Cx ? $v : new Cx((float)$v, 0.0); }
	public static function simp(Cx $c): float|Cx { return $c->im == 0 ? $c->re : $c; }

	public static function cabs(Cx $a): float { return hypot($a->re, $a->im); }
	public static function carg(Cx $a): float { return atan2($a->im, $a->re); }
	public static function cmul(Cx $a, Cx $b): float|Cx { return self::simp(new Cx($a->re * $b->re - $a->im * $b->im, $a->re * $b->im + $a->im * $b->re)); }
	public static function cdiv(Cx $a, Cx $b): float|Cx {
		$d = $b->re * $b->re + $b->im * $b->im;
		return self::simp(new Cx(($a->re * $b->re + $a->im * $b->im) / $d, ($a->im * $b->re - $a->re * $b->im) / $d));
	}
	public static function cexp(Cx $a): float|Cx { $r = exp($a->re); return self::simp(new Cx($r * cos($a->im), $r * sin($a->im))); }
	public static function cln(Cx $a): float|Cx { return self::simp(new Cx(log(self::cabs($a)), self::carg($a))); }
	public static function cpow(Cx $a, Cx $b): float|Cx {
		if ($a->re == 0 && $a->im == 0) { return ($b->re > 0) ? 0.0 : (($b->re == 0 && $b->im == 0) ? 1.0 : NAN); }
		if ($b->im == 0 && floor($b->re) == $b->re && abs($b->re) <= 64) {
			$r = new Cx(1.0, 0.0);
			$base = $a;
			$n = (int)abs($b->re);
			while ($n) {
				if ($n & 1) { $r = self::C(self::cmul($r, $base)); }
				$base = self::C(self::cmul($base, $base));
				$n >>= 1;
			}
			return $b->re < 0 ? self::cdiv(new Cx(1.0, 0.0), $r) : self::simp($r);
		}
		return self::cexp(self::C(self::cmul($b, self::C(self::cln($a)))));
	}
	public static function csqrt(Cx $a): float|Cx {
		$r = self::cabs($a);
		$re = sqrt(($r + $a->re) / 2);
		$im = ($a->im < 0 ? -1 : 1) * sqrt(($r - $a->re) / 2);
		return self::simp(new Cx($re, ($a->im == 0 && $a->re >= 0) ? 0.0 : $im));
	}

	/** Complex versions of the scalar functions (null when there is none). */
	public static function complexFn(string $name, array $args): mixed {
		$a = self::C($args[0] ?? NAN);
		switch ($name) {
			case 'sqrt': return self::csqrt($a);
			case 'exp': return self::cexp($a);
			case 'ln': return self::cln($a);
			case 'log': return self::cdiv(self::C(self::cln($a)), new Cx(M_LN10, 0.0));
			case 'abs': return self::cabs($a);
			case 'sin': return self::simp(new Cx(sin($a->re) * cosh($a->im), cos($a->re) * sinh($a->im)));
			case 'cos': return self::simp(new Cx(cos($a->re) * cosh($a->im), -sin($a->re) * sinh($a->im)));
			case 'tan': return self::cdiv(self::C(self::complexFn('sin', [$a])), self::C(self::complexFn('cos', [$a])));
			case 'sinh': return self::simp(new Cx(sinh($a->re) * cos($a->im), cosh($a->re) * sin($a->im)));
			case 'cosh': return self::simp(new Cx(cosh($a->re) * cos($a->im), sinh($a->re) * sin($a->im)));
			case 'tanh': return self::cdiv(self::C(self::complexFn('sinh', [$a])), self::C(self::complexFn('cosh', [$a])));
			case 'pow': return self::cpow($a, self::C($args[1] ?? NAN));
		}
		return null;
	}

	public static function scalarBin(string $op, mixed $a, mixed $b): mixed {
		if (!($a instanceof Cx) && !($b instanceof Cx)) {
			$a = (float)$a;
			$b = (float)$b;
			return match ($op) {
				'+' => $a + $b, '-' => $a - $b, '*' => $a * $b,
				'/' => $b == 0 ? ($a == 0 || is_nan($a) ? NAN : ($a > 0 ? INF : -INF)) : $a / $b,
				'%' => fmod($a, $b), '^' => self::rpow($a, $b),
				'<' => (float)($a < $b), '<=' => (float)($a <= $b), '>' => (float)($a > $b), '>=' => (float)($a >= $b),
				'==' => (float)($a === $b), '!=' => (float)($a !== $b), default => NAN,
			};
		}
		$A = self::C($a);
		$B = self::C($b);
		return match ($op) {
			'+' => self::simp(new Cx($A->re + $B->re, $A->im + $B->im)),
			'-' => self::simp(new Cx($A->re - $B->re, $A->im - $B->im)),
			'*' => self::cmul($A, $B), '/' => self::cdiv($A, $B), '^' => self::cpow($A, $B),
			'==' => (float)($A->re == $B->re && $A->im == $B->im), '!=' => (float)($A->re != $B->re || $A->im != $B->im),
			default => NAN,
		};
	}

	/** Math.pow semantics (NaN for a negative base with a fractional exponent, like JS). */
	public static function rpow(float $a, float $b): float {
		if ($a < 0 && floor($b) != $b) { return NAN; }
		if ($a == 0 && $b < 0) { return INF; }
		return $a ** $b;
	}

	public static function bin(string $op, mixed $a, mixed $b): mixed {
		if (is_array($a) || is_array($b)) {
			if (is_array($a) && is_array($b)) {
				if (count($a) !== count($b)) { return NAN; }
				$out = [];
				foreach ($a as $i => $x) { $out[] = self::bin($op, $x, $b[$i]); }
				return $out;
			}
			return is_array($a) ? array_map(fn ($x) => self::bin($op, $x, $b), $a) : array_map(fn ($y) => self::bin($op, $a, $y), $b);
		}
		return self::scalarBin($op, $a, $b);
	}

	public static function neg(mixed $a): mixed {
		if (is_array($a)) { return array_map([self::class, 'neg'], $a); }
		if ($a instanceof Cx) { return self::simp(new Cx(-$a->re, -$a->im)); }
		return -(float)$a;
	}

	/** @return list<mixed> */
	public static function flat(array $args): array {
		$out = [];
		$walk = function ($v) use (&$walk, &$out) { if (is_array($v)) { foreach ($v as $x) { $walk($x); } } else { $out[] = $v; } };
		foreach ($args as $a) { $walk($a); }
		return $out;
	}
	/** @return list<float>|null */
	private static function nums(array $args): ?array {
		$f = self::flat($args);
		foreach ($f as $x) { if (!is_float($x) && !is_int($x)) { return null; } }
		return array_map('floatval', $f);
	}
	private static function mean(array $f): float { return array_sum($f) / count($f); }
	private static function ss(array $f): float { $m = self::mean($f); $s = 0.0; foreach ($f as $x) { $s += ($x - $m) * ($x - $m); } return $s; }
	private static function sorted(array $args): ?array { $f = self::nums($args); if ($f === null) { return null; } sort($f); return $f; }

	public static function call(string $name, array $a): mixed {
		switch ($name) {
			case 'sum': $acc = 0.0; foreach (self::flat($a) as $x) { $acc = self::scalarBin('+', $acc, $x); } return $acc;
			case 'prod': $acc = 1.0; foreach (self::flat($a) as $x) { $acc = self::scalarBin('*', $acc, $x); } return $acc;
			case 'count': case 'len': return (float)count(self::flat($a));
			case 'min': $f = self::nums($a); return ($f === null || !$f) ? NAN : min($f);
			case 'max': $f = self::nums($a); return ($f === null || !$f) ? NAN : max($f);
			case 'mean': $f = self::nums($a); return ($f === null || !$f) ? NAN : self::mean($f);
			case 'median':
				$f = self::sorted($a);
				if (!$f) { return NAN; }
				$n = count($f);
				$m = intdiv($n, 2);
				return $n % 2 ? $f[$m] : ($f[$m - 1] + $f[$m]) / 2;
			case 'mode':
				$f = self::sorted($a);
				if (!$f) { return NAN; }
				[$best, $bc, $cur, $c] = [$f[0], 0, $f[0], 0];
				foreach ($f as $x) { if ($x === $cur) { $c++; } else { $cur = $x; $c = 1; } if ($c > $bc) { $bc = $c; $best = $cur; } }
				return $best;
			case 'var': $f = self::nums($a); return ($f && count($f) > 1) ? self::ss($f) / (count($f) - 1) : NAN;
			case 'varp': $f = self::nums($a); return $f ? self::ss($f) / count($f) : NAN;
			case 'stdev': return sqrt(self::call('var', $a));
			case 'stdevp': return sqrt(self::call('varp', $a));
			case 'gmean':
				$f = self::nums($a);
				if (!$f) { return NAN; }
				$s = 0.0;
				foreach ($f as $x) { if ($x <= 0) { return NAN; } $s += log($x); }
				return exp($s / count($f));
			case 'hmean':
				$f = self::nums($a);
				if (!$f) { return NAN; }
				$s = 0.0;
				foreach ($f as $x) { if ($x <= 0) { return NAN; } $s += 1 / $x; }
				return count($f) / $s;
			case 'wmean':
				[$x, $w] = [$a[0] ?? null, $a[1] ?? null];
				if (!is_array($x) || !is_array($w) || count($x) !== count($w) || !$x) { return NAN; }
				$s = 0.0;
				$sw = 0.0;
				foreach ($x as $i => $v) { $s += $v * $w[$i]; $sw += $w[$i]; }
				return $s / $sw;
			case 'percentile': case 'quantile':
				$f = self::sorted([$a[0] ?? []]);
				$p = (float)($a[1] ?? NAN);
				if (!$f || !($p >= 0 && $p <= 1)) { return NAN; }
				$h = (count($f) - 1) * $p;
				$lo = (int)floor($h);
				return $lo + 1 < count($f) ? $f[$lo] + ($h - $lo) * ($f[$lo + 1] - $f[$lo]) : $f[$lo];
			case 'skew':
				$f = self::nums([$a[0] ?? []]);
				if (!$f || count($f) < 3) { return NAN; }
				$n = count($f);
				$m = self::mean($f);
				$s = sqrt(self::ss($f) / ($n - 1));
				$t = 0.0;
				foreach ($f as $v) { $t += (($v - $m) / $s) ** 3; }
				return $n / (($n - 1) * ($n - 2)) * $t;
			case 'kurt':
				$f = self::nums([$a[0] ?? []]);
				if (!$f || count($f) < 4) { return NAN; }
				$n = count($f);
				$m = self::mean($f);
				$s2 = self::ss($f) / ($n - 1);
				$t = 0.0;
				foreach ($f as $v) { $t += ($v - $m) ** 4; }
				$k4 = $t / ($s2 * $s2);
				return $n * ($n + 1) / (($n - 1) * ($n - 2) * ($n - 3)) * $k4 - 3 * ($n - 1) * ($n - 1) / (($n - 2) * ($n - 3));
			case 'cov':
				[$x, $y] = [$a[0] ?? null, $a[1] ?? null];
				if (!is_array($x) || !is_array($y) || count($x) !== count($y) || count($x) < 2) { return NAN; }
				$mx = self::mean($x);
				$my = self::mean($y);
				$s = 0.0;
				foreach ($x as $i => $v) { $s += ($v - $mx) * ($y[$i] - $my); }
				return $s / (count($x) - 1);
			case 'corr': return self::call('cov', $a) / (self::call('stdev', [$a[0] ?? []]) * self::call('stdev', [$a[1] ?? []]));
			case 'slope': return self::call('cov', $a) / self::call('var', [$a[0] ?? []]);
			case 'intercept': return self::call('mean', [$a[1] ?? []]) - self::call('slope', $a) * self::call('mean', [$a[0] ?? []]);
			case 'rsq': $r = self::call('corr', $a); return $r * $r;
			case 'npv':
				[$r, $cf] = [(float)($a[0] ?? NAN), $a[1] ?? null];
				if (!is_array($cf)) { return NAN; }
				$s = 0.0;
				foreach (array_values($cf) as $t => $c) { $s += $c / ((1 + $r) ** $t); }
				return $s;
			case 'irr':
				$cf = $a[0] ?? null;
				if (!is_array($cf) || count($cf) < 2) { return NAN; }
				$f = fn ($r) => self::call('npv', [$r, $cf]);
				$r0 = Special::findRoot($f, isset($a[1]) ? (float)$a[1] : 0.1);
				if (is_finite($r0) && $r0 > -1) { return $r0; }
				return Special::findRoot($f, -0.9999, 10.0);
			case 'mirr':
				[$cf, $fr, $rr] = [$a[0] ?? null, (float)($a[1] ?? NAN), (float)($a[2] ?? NAN)];
				if (!is_array($cf) || count($cf) < 2) { return NAN; }
				$n = count($cf) - 1;
				$pv = 0.0;
				$fv = 0.0;
				foreach (array_values($cf) as $t => $c) { if ($c < 0) { $pv += $c / ((1 + $fr) ** $t); } else { $fv += $c * ((1 + $rr) ** ($n - $t)); } }
				return (-$fv / $pv) ** (1 / $n) - 1;
			case 'list': return array_values($a);
			case 'seq':
				[$x0, $x1, $st] = [(float)($a[0] ?? NAN), (float)($a[1] ?? NAN), (float)($a[2] ?? 1.0)];
				if ($st == 0 || !is_finite($x0) || !is_finite($x1) || abs(($x1 - $x0) / $st) > 1e6) { return NAN; }
				$out = [];
				for ($x = $x0; $st > 0 ? $x <= $x1 + 1e-12 : $x >= $x1 - 1e-12; $x += $st) { $out[] = $x; }
				return $out;
			case 'at':
				$v = $a[0] ?? null;
				$i = $a[1] ?? NAN;
				if (!is_array($v) || !is_numeric($i) || floor((float)$i) != $i || $i < 1 || $i > count($v)) { return NAN; }
				$r = $v[(int)$i - 1];
				return isset($a[2]) ? self::call('at', [$r, $a[2]]) : $r;
			case 'sort': $f = self::sorted([$a[0] ?? []]); return $f ?? NAN;
			case 'cumsum':
				if (!is_array($a[0] ?? null)) { return NAN; }
				$s = 0.0;
				return array_map(function ($x) use (&$s) { $s += $x; return $s; }, $a[0]);
			case 'cummax':
			case 'cummin':
				// running maximum / minimum (peak so far, for drawdowns)
				if (!is_array($a[0] ?? null)) { return NAN; }
				$m = $name === 'cummax' ? -INF : INF;
				return array_map(function ($x) use (&$m, $name) { $m = $name === 'cummax' ? max($m, (float)$x) : min($m, (float)$x); return $m; }, $a[0]);
			case 'diff':
				$v = $a[0] ?? null;
				if (!is_array($v) || count($v) < 2) { return NAN; }
				$out = [];
				for ($i = 1; $i < count($v); $i++) { $out[] = $v[$i] - $v[$i - 1]; }
				return $out;
			case 'dot':
				[$u, $v] = [$a[0] ?? null, $a[1] ?? null];
				if (!is_array($u) || !is_array($v) || count($u) !== count($v)) { return NAN; }
				$s = 0.0;
				foreach ($u as $i => $x) { $y = $v[$i]; $s = self::scalarBin('+', $s, self::scalarBin('*', $x, $y instanceof Cx ? new Cx($y->re, -$y->im) : $y)); }
				return $s;
			case 'cross':
				[$u, $v] = [$a[0] ?? null, $a[1] ?? null];
				if (!is_array($u) || !is_array($v) || count($u) !== 3 || count($v) !== 3) { return NAN; }
				return [$u[1] * $v[2] - $u[2] * $v[1], $u[2] * $v[0] - $u[0] * $v[2], $u[0] * $v[1] - $u[1] * $v[0]];
			case 'norm':
				$v = $a[0] ?? NAN;
				if (!is_array($v)) { return $v instanceof Cx ? self::cabs($v) : abs((float)$v); }
				$s = 0.0;
				foreach (self::flat([$v]) as $x) { $s += $x instanceof Cx ? $x->re * $x->re + $x->im * $x->im : $x * $x; }
				return sqrt($s);
			case 'trans': return self::trans($a[0] ?? null);
			case 'mmul': return self::mmul($a[0] ?? null, $a[1] ?? null);
			case 'det':
				$L = self::lu($a[0] ?? null);
				if ($L === null) { return NAN; }
				if ($L['sign'] === 0) { return 0.0; }
				$d = (float)$L['sign'];
				for ($i = 0; $i < $L['n']; $i++) { $d *= $L['A'][$i][$i]; }
				return $d;
			case 'inv':
				$L = self::lu($a[0] ?? null);
				if ($L === null || $L['sign'] === 0) { return NAN; }
				$cols = [];
				for ($j = 0; $j < $L['n']; $j++) { $e = array_fill(0, $L['n'], 0.0); $e[$j] = 1.0; $cols[] = self::luSolve($L, $e); }
				return self::trans($cols);
			case 'linsolve':
				$L = self::lu($a[0] ?? null);
				$b = $a[1] ?? null;
				if ($L === null || $L['sign'] === 0 || !is_array($b) || count($b) !== $L['n']) { return NAN; }
				return self::luSolve($L, $b);
			case 'trace':
				$M = $a[0] ?? null;
				if (!self::isM($M) || count($M) !== count($M[0])) { return NAN; }
				$s = 0.0;
				for ($i = 0; $i < count($M); $i++) { $s += $M[$i][$i]; }
				return $s;
			case 'eye':
				$n = $a[0] ?? NAN;
				if (!is_numeric($n) || floor((float)$n) != $n || $n < 1 || $n > 100) { return NAN; }
				$out = [];
				for ($i = 0; $i < (int)$n; $i++) { $row = array_fill(0, (int)$n, 0.0); $row[$i] = 1.0; $out[] = $row; }
				return $out;
			case 're': $v = $a[0] ?? NAN; return $v instanceof Cx ? $v->re : $v;
			case 'im': $v = $a[0] ?? NAN; return $v instanceof Cx ? $v->im : 0.0;
			case 'conj': $v = $a[0] ?? NAN; return $v instanceof Cx ? self::simp(new Cx($v->re, -$v->im)) : $v;
			case 'arg': $v = $a[0] ?? NAN; return $v instanceof Cx ? self::carg($v) : atan2(0.0, (float)$v);
			case 'polar': $r = (float)($a[0] ?? NAN); $t = (float)($a[1] ?? NAN); return self::simp(new Cx($r * cos($t), $r * sin($t)));
			case 'csqrt': return self::csqrt(self::C($a[0] ?? NAN));
			case 'cln': return self::cln(self::C($a[0] ?? NAN));
			case 'cpow': return self::cpow(self::C($a[0] ?? NAN), self::C($a[1] ?? NAN));
		}
		throw new \RuntimeException('unknown function "' . $name . '"');
	}

	private static function trans(mixed $M): mixed {
		if (!self::isM($M)) { return is_array($M) ? array_map(fn ($x) => [$x], $M) : NAN; }
		$out = [];
		foreach ($M[0] as $j => $_) { $out[] = array_map(fn ($r) => $r[$j], $M); }
		return $out;
	}
	private static function mmul(mixed $A, mixed $B): mixed {
		if (!self::isM($A)) { return NAN; }
		$vec = !self::isM($B);
		if ($vec && !is_array($B)) { return NAN; }
		$Bm = $vec ? array_map(fn ($x) => [$x], $B) : $B;
		if (count($A[0]) !== count($Bm)) { return NAN; }
		$out = [];
		foreach ($A as $r) {
			$row = [];
			foreach ($Bm[0] as $j => $_) { $s = 0.0; foreach ($r as $k => $x) { $s += $x * $Bm[$k][$j]; } $row[] = $s; }
			$out[] = $row;
		}
		return $vec ? array_map(fn ($r) => $r[0], $out) : $out;
	}
	private static function lu(mixed $M): ?array {
		if (!self::isM($M) || count($M) !== count($M[0])) { return null; }
		$n = count($M);
		$A = array_map(fn ($r) => array_map('floatval', $r), $M);
		$perm = range(0, $n - 1);
		$sign = 1;
		for ($k = 0; $k < $n; $k++) {
			$p = $k;
			for ($i = $k + 1; $i < $n; $i++) { if (abs($A[$i][$k]) > abs($A[$p][$k])) { $p = $i; } }
			if ($A[$p][$k] == 0) { return ['A' => $A, 'perm' => $perm, 'sign' => 0, 'n' => $n]; }
			if ($p !== $k) { [$A[$p], $A[$k]] = [$A[$k], $A[$p]]; [$perm[$p], $perm[$k]] = [$perm[$k], $perm[$p]]; $sign = -$sign; }
			for ($i = $k + 1; $i < $n; $i++) {
				$A[$i][$k] /= $A[$k][$k];
				for ($j = $k + 1; $j < $n; $j++) { $A[$i][$j] -= $A[$i][$k] * $A[$k][$j]; }
			}
		}
		return ['A' => $A, 'perm' => $perm, 'sign' => $sign, 'n' => $n];
	}
	private static function luSolve(array $L, array $b): array {
		$n = $L['n'];
		$y = [];
		for ($i = 0; $i < $n; $i++) { $s = (float)$b[$L['perm'][$i]]; for ($j = 0; $j < $i; $j++) { $s -= $L['A'][$i][$j] * $y[$j]; } $y[$i] = $s; }
		$x = array_fill(0, $n, 0.0);
		for ($i = $n - 1; $i >= 0; $i--) { $s = $y[$i]; for ($j = $i + 1; $j < $n; $j++) { $s -= $L['A'][$i][$j] * $x[$j]; } $x[$i] = $s / $L['A'][$i][$i]; }
		return $x;
	}
}
