<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Service;

/**
 * Number theory, combinatorics and special functions — the PHP port of the MATHLIB block in
 * js/formulabase.js (source: regibase-build/fb-mathlib.js). The two MUST give the same numbers:
 * an exported spreadsheet caches the value computed here next to the formula the app showed.
 * Integers are exact (GMP) and come back as floats, like the JS side returns Numbers. A
 * non-integer where an integer is required gives NAN.
 */
class MathLib {
	private const BIG_LIMIT = 1e15;
	private const MR_BASES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];

	/** Names this library answers to (lower case), for the parser's function table. */
	public const NAMES = [
		'gcd', 'lcm', 'fact', 'binom', 'perm', 'isprime', 'nextprime', 'prevprime', 'primepi', 'nthprime',
		'phi', 'sigma', 'tau', 'mu', 'omega', 'bigomega', 'rad', 'lpf', 'gpf', 'carmichael', 'powmod',
		'modinv', 'crt', 'fib', 'lucas', 'catalan', 'bell', 'partitions', 'stirling1', 'stirling2',
		'derange', 'digitsum', 'digitalroot', 'numdigits', 'reversenum', 'collatz', 'legendre', 'jacobi',
		'ord', 'primroot', 'isqrt', 'issquare', 'isperfect',
		'gamma', 'lgamma', 'beta', 'erf', 'erfc', 'normcdf', 'normpdf', 'norminv', 'zeta', 'li', 'lambertw',
		'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'atan2',
		'factmod', 'digamma', 'gammainc', 'gammaincc', 'betainc', 'gammapdf', 'gammacdf', 'gammainv', 'betapdf', 'betacdf', 'betainv',
		'chi2pdf', 'chi2cdf', 'chi2inv', 'tpdf', 'tcdf', 'tinv', 'fpdf', 'fcdf', 'finv', 'binompdf', 'binomcdf', 'poisspdf', 'poisscdf',
		'exppdf', 'expcdf', 'expinv', 'lognpdf', 'logncdf', 'logninv', 'weibpdf', 'weibcdf', 'weibinv', 'geompdf', 'geomcdf', 'hygepdf', 'nbinpdf',
		'erfinv', 'expint', 'ei', 'si', 'ci', 'besselj', 'bessely', 'besseli', 'besselk', 'ellipk', 'ellipe', 'ellipf', 'ellipeinc', 'polylog',
	];

	private static function isInt(float $x): bool {
		return is_finite($x) && floor($x) == $x && abs($x) <= 9.2e18;
	}
	private static function posInt(float $x): bool { return self::isInt($x) && $x >= 1; }
	private static function nonNegInt(float $x): bool { return self::isInt($x) && $x >= 0; }
	private static function g(float $x): \GMP { return gmp_init(sprintf('%.0f', $x)); }
	private static function f(\GMP $g): float { return (float)gmp_strval($g); }

	public static function isPrimeG(\GMP $n): bool {
		if (gmp_cmp($n, 2) < 0) {
			return false;
		}
		foreach (self::MR_BASES as $p) {
			if (gmp_cmp($n, $p) === 0) {
				return true;
			}
			if (gmp_cmp(gmp_mod($n, $p), 0) === 0) {
				return false;
			}
		}
		$d = gmp_sub($n, 1);
		$s = 0;
		while (gmp_cmp(gmp_mod($d, 2), 0) === 0) {
			$d = gmp_div_q($d, 2);
			$s++;
		}
		$nm1 = gmp_sub($n, 1);
		foreach (self::MR_BASES as $a) {
			$x = gmp_powm($a, $d, $n);
			if (gmp_cmp($x, 1) === 0 || gmp_cmp($x, $nm1) === 0) {
				continue;
			}
			$ok = false;
			for ($i = 1; $i < $s; $i++) {
				$x = gmp_mod(gmp_mul($x, $x), $n);
				if (gmp_cmp($x, $nm1) === 0) {
					$ok = true;
					break;
				}
			}
			if (!$ok) {
				return false;
			}
		}
		return true;
	}

	private static function rho(\GMP $n): \GMP {
		if (gmp_cmp(gmp_mod($n, 2), 0) === 0) {
			return gmp_init(2);
		}
		for ($c = 1; $c < 200; $c++) {
			$x = gmp_init(2);
			$y = gmp_init(2);
			$d = gmp_init(1);
			while (gmp_cmp($d, 1) === 0) {
				$x = gmp_mod(gmp_add(gmp_mul($x, $x), $c), $n);
				$y = gmp_mod(gmp_add(gmp_mul($y, $y), $c), $n);
				$y = gmp_mod(gmp_add(gmp_mul($y, $y), $c), $n);
				$d = gmp_gcd(gmp_abs(gmp_sub($x, $y)), $n);
			}
			if (gmp_cmp($d, $n) !== 0) {
				return $d;
			}
		}
		return $n;
	}

	/** @return array<string,int> prime (decimal string) => exponent */
	private static function factor(\GMP $n): array {
		$out = [];
		foreach ([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47] as $p) {
			while (gmp_cmp(gmp_mod($n, $p), 0) === 0) {
				$out[(string)$p] = ($out[(string)$p] ?? 0) + 1;
				$n = gmp_div_q($n, $p);
			}
		}
		$stack = gmp_cmp($n, 1) > 0 ? [$n] : [];
		while ($stack) {
			$m = array_pop($stack);
			if (gmp_cmp($m, 1) === 0) {
				continue;
			}
			if (self::isPrimeG($m)) {
				$k = gmp_strval($m);
				$out[$k] = ($out[$k] ?? 0) + 1;
				continue;
			}
			$found = null;
			for ($p = 53; $p < 20000 && gmp_cmp(gmp_mul($p, $p), $m) <= 0; $p += 2) {
				if (gmp_cmp(gmp_mod($m, $p), 0) === 0) {
					$found = gmp_init($p);
					break;
				}
			}
			$d = $found ?? self::rho($m);
			$stack[] = $d;
			$stack[] = gmp_div_q($m, $d);
		}
		return $out;
	}

	private static function factors(float $n): ?array {
		return self::posInt($n) ? self::factor(self::g($n)) : null;
	}

	private static function bfact(int $n): \GMP { return gmp_fact(max(0, $n)); }
	private static function bbinom(int $n, int $k): \GMP { return ($k < 0 || $k > $n) ? gmp_init(0) : gmp_binomial($n, $k); }

	/** @param list<float> $a */
	public static function call(string $name, array $a): float {
		$x = $a[0] ?? NAN;
		switch ($name) {
			case 'gcd':
				foreach ($a as $v) { if (!self::isInt($v)) { return NAN; } }
				$r = gmp_init(0);
				foreach ($a as $v) { $r = gmp_gcd($r, self::g($v)); }
				return self::f($r);
			case 'lcm':
				foreach ($a as $v) { if (!self::isInt($v)) { return NAN; } }
				$r = gmp_init(1);
				foreach ($a as $v) { $r = ($v == 0) ? gmp_init(0) : gmp_lcm($r, self::g($v)); if (gmp_cmp($r, 0) === 0) { break; } }
				return self::f(gmp_abs($r));
			case 'fact':
				if (!self::nonNegInt($x)) { return NAN; }
				return $x > 170 ? INF : self::f(self::bfact((int)$x));
			case 'binom':
				if (!self::nonNegInt($x) || !self::isInt($a[1]) || $x > 100000) { return NAN; }
				return self::f(self::bbinom((int)$x, (int)$a[1]));
			case 'perm':
				if (!self::nonNegInt($x) || !self::isInt($a[1]) || $x > 100000) { return NAN; }
				if ($a[1] < 0 || $a[1] > $x) { return 0.0; }
				return self::f(gmp_div_q(self::bfact((int)$x), self::bfact((int)($x - $a[1]))));
			case 'isprime':
				if (!self::isInt($x)) { return NAN; }
				return ($x >= 2 && self::isPrimeG(self::g($x))) ? 1.0 : 0.0;
			case 'nextprime':
				if (!self::isInt($x) || $x > self::BIG_LIMIT) { return NAN; }
				$m = $x < 2 ? gmp_init(2) : gmp_add(self::g($x), 1);
				while (!self::isPrimeG($m)) { $m = gmp_add($m, 1); }
				return self::f($m);
			case 'prevprime':
				if (!self::isInt($x) || $x <= 2 || $x > self::BIG_LIMIT) { return NAN; }
				$m = gmp_sub(self::g($x), 1);
				while (gmp_cmp($m, 2) >= 0 && !self::isPrimeG($m)) { $m = gmp_sub($m, 1); }
				return gmp_cmp($m, 2) >= 0 ? self::f($m) : NAN;
			case 'primepi': return self::primepi($x);
			case 'nthprime': return self::nthprime($x);
			case 'phi':
				$f = self::factors($x);
				if ($f === null) { return NAN; }
				$r = self::g($x);
				foreach ($f as $p => $e) { $r = gmp_mul(gmp_div_q($r, gmp_init($p)), gmp_sub(gmp_init($p), 1)); }
				return self::f($r);
			case 'sigma':
			case 'tau':
				$k = $name === 'tau' ? 0.0 : ($a[1] ?? 1.0);
				if (!self::nonNegInt($k)) { return NAN; }
				$f = self::factors($x);
				if ($f === null) { return NAN; }
				$r = gmp_init(1);
				foreach ($f as $p => $e) {
					if ($k == 0) { $r = gmp_mul($r, $e + 1); continue; }
					$pk = gmp_pow(gmp_init($p), (int)$k);
					$r = gmp_mul($r, gmp_div_q(gmp_sub(gmp_pow($pk, $e + 1), 1), gmp_sub($pk, 1)));
				}
				return self::f($r);
			case 'mu':
				$f = self::factors($x);
				if ($f === null) { return NAN; }
				foreach ($f as $e) { if ($e > 1) { return 0.0; } }
				return count($f) % 2 ? -1.0 : 1.0;
			case 'omega':
				$f = self::factors($x);
				return $f === null ? NAN : (float)count($f);
			case 'bigomega':
				$f = self::factors($x);
				return $f === null ? NAN : (float)array_sum($f);
			case 'rad':
				$f = self::factors($x);
				if ($f === null) { return NAN; }
				$r = gmp_init(1);
				foreach (array_keys($f) as $p) { $r = gmp_mul($r, gmp_init((string)$p)); }
				return self::f($r);
			case 'lpf':
			case 'gpf':
				$f = self::factors($x);
				if (!$f) { return NAN; }
				$ps = array_map(fn ($p) => (float)$p, array_keys($f));
				return $name === 'lpf' ? min($ps) : max($ps);
			case 'carmichael': return self::carmichael($x);
			case 'powmod':
				[$b, $e, $m] = [$a[0] ?? NAN, $a[1] ?? NAN, $a[2] ?? NAN];
				if (!self::isInt($b) || !self::isInt($e) || !self::posInt($m)) { return NAN; }
				if ($e < 0) {
					$inv = self::call('modinv', [$b, $m]);
					return is_nan($inv) ? NAN : self::call('powmod', [$inv, -$e, $m]);
				}
				if ($m == 1) { return 0.0; }
				return self::f(gmp_powm(gmp_mod(self::g($b), self::g($m)), self::g($e), self::g($m)));
			case 'modinv':
				if (!self::isInt($x) || !self::posInt($a[1] ?? NAN)) { return NAN; }
				$M = self::g($a[1]);
				$A = gmp_mod(self::g($x), $M);
				if (gmp_cmp(gmp_gcd($A, $M), 1) !== 0) { return NAN; }
				if (gmp_cmp($M, 1) === 0) { return 0.0; }
				return self::f(gmp_invert($A, $M));
			case 'crt': return self::crt($a);
			case 'fib':
				if (!self::isInt($x) || abs($x) > 1e5) { return NAN; }
				$v = self::f(self::fibPair((int)abs($x))[0]);
				return ($x < 0 && ((int)abs($x)) % 2 === 0) ? -$v : $v;
			case 'lucas':
				if (!self::nonNegInt($x) || $x > 1e5) { return NAN; }
				[$fa, $fb] = self::fibPair((int)$x);
				return self::f(gmp_sub(gmp_mul($fb, 2), $fa));
			case 'catalan':
				if (!self::nonNegInt($x) || $x > 50000) { return NAN; }
				return self::f(gmp_div_q(self::bbinom(2 * (int)$x, (int)$x), (int)$x + 1));
			case 'bell':
				if (!self::nonNegInt($x) || $x > 1000) { return NAN; }
				$row = [gmp_init(1)];
				for ($i = 0; $i < (int)$x; $i++) {
					$next = [end($row)];
					foreach ($row as $v) { $next[] = gmp_add(end($next), $v); }
					$row = $next;
				}
				return self::f($row[0]);
			case 'partitions': return self::partitions($x);
			case 'stirling2':
				[$n, $k] = [$x, $a[1] ?? NAN];
				if (!self::nonNegInt($n) || !self::nonNegInt($k) || $n > 2000) { return NAN; }
				if ($k > $n) { return 0.0; }
				if ($n == 0) { return $k == 0 ? 1.0 : 0.0; }
				$s = gmp_init(0);
				for ($j = 0; $j <= $k; $j++) {
					$t = gmp_mul(self::bbinom((int)$k, $j), gmp_pow($j, (int)$n));
					$s = (((int)$k - $j) % 2) ? gmp_sub($s, $t) : gmp_add($s, $t);
				}
				return self::f(gmp_div_q($s, self::bfact((int)$k)));
			case 'stirling1':
				[$n, $k] = [$x, $a[1] ?? NAN];
				if (!self::nonNegInt($n) || !self::nonNegInt($k) || $n > 2000) { return NAN; }
				$row = [gmp_init(1)];
				for ($i = 0; $i < (int)$n; $i++) {
					$next = array_fill(0, $i + 2, gmp_init(0));
					for ($j = 0; $j <= $i; $j++) {
						$next[$j + 1] = gmp_add($next[$j + 1], $row[$j]);
						$next[$j] = gmp_add($next[$j], gmp_mul($i, $row[$j]));
					}
					$row = $next;
				}
				return $k <= $n ? self::f($row[(int)$k]) : 0.0;
			case 'derange':
				if (!self::nonNegInt($x) || $x > 5000) { return NAN; }
				if ($x == 0) { return 1.0; }
				[$p, $q] = [gmp_init(1), gmp_init(0)];
				for ($i = 2; $i <= (int)$x; $i++) { $c = gmp_mul($i - 1, gmp_add($p, $q)); $p = $q; $q = $c; }
				return self::f($q);
			case 'digitsum':
				$base = $a[1] ?? 10.0;
				if (!self::isInt($x) || !self::isInt($base) || $base < 2) { return NAN; }
				$m = gmp_abs(self::g($x));
				$s = gmp_init(0);
				while (gmp_cmp($m, 0) > 0) { $s = gmp_add($s, gmp_mod($m, (int)$base)); $m = gmp_div_q($m, (int)$base); }
				return self::f($s);
			case 'digitalroot':
				if (!self::nonNegInt($x)) { return NAN; }
				return $x == 0 ? 0.0 : (float)(1 + gmp_intval(gmp_mod(gmp_sub(self::g($x), 1), 9)));
			case 'numdigits':
				$base = $a[1] ?? 10.0;
				if (!self::isInt($x) || !self::isInt($base) || $base < 2) { return NAN; }
				$m = gmp_abs(self::g($x));
				if (gmp_cmp($m, 0) === 0) { return 1.0; }
				$c = 0;
				while (gmp_cmp($m, 0) > 0) { $m = gmp_div_q($m, (int)$base); $c++; }
				return (float)$c;
			case 'reversenum':
				if (!self::nonNegInt($x)) { return NAN; }
				return self::f(gmp_init(ltrim(strrev(gmp_strval(self::g($x))), '0') ?: '0'));
			case 'collatz':
				if (!self::posInt($x)) { return NAN; }
				$m = self::g($x);
				$c = 0;
				while (gmp_cmp($m, 1) !== 0 && $c < 1000000) {
					$m = gmp_cmp(gmp_mod($m, 2), 1) === 0 ? gmp_add(gmp_mul($m, 3), 1) : gmp_div_q($m, 2);
					$c++;
				}
				return (float)$c;
			case 'jacobi':
				if (!self::isInt($x) || !self::posInt($a[1] ?? NAN) || ((int)$a[1]) % 2 === 0) { return NAN; }
				return (float)gmp_jacobi(gmp_mod(self::g($x), self::g($a[1])), self::g($a[1]));
			case 'legendre':
				if (!self::isInt($a[1] ?? NAN) || $a[1] < 3 || !self::isPrimeG(self::g($a[1]))) { return NAN; }
				return self::call('jacobi', [$x, $a[1]]);
			case 'ord': return self::ord($x, $a[1] ?? NAN);
			case 'primroot': return self::primroot($x);
			case 'isqrt':
				if (!self::nonNegInt($x)) { return NAN; }
				return self::f(gmp_sqrt(self::g($x)));
			case 'issquare':
				if (!self::isInt($x)) { return NAN; }
				return ($x >= 0 && gmp_perfect_square(self::g($x))) ? 1.0 : 0.0;
			case 'isperfect':
				if (!self::posInt($x)) { return NAN; }
				return self::call('sigma', [$x, 1.0]) == 2 * $x ? 1.0 : 0.0;
			case 'gamma': return self::gamma($x);
			case 'lgamma': return self::lgamma($x);
			case 'beta': return exp(self::lgamma($x) + self::lgamma($a[1]) - self::lgamma($x + $a[1]));
			case 'erf': return self::erf($x);
			case 'erfc': return self::erfc($x);
			case 'normcdf':
				[$m, $s] = [$a[1] ?? 0.0, $a[2] ?? 1.0];
				return $s > 0 ? 0.5 * self::erfc(-($x - $m) / ($s * M_SQRT2)) : NAN;
			case 'normpdf':
				[$m, $s] = [$a[1] ?? 0.0, $a[2] ?? 1.0];
				if (!($s > 0)) { return NAN; }
				$z = ($x - $m) / $s;
				return exp(-0.5 * $z * $z) / ($s * sqrt(2 * M_PI));
			case 'norminv': return self::norminv($x, $a[1] ?? 0.0, $a[2] ?? 1.0);
			case 'zeta': return self::zeta($x);
			case 'li': return self::li($x);
			case 'lambertw': return self::lambertw($x);
			case 'sinh': return sinh($x);
			case 'cosh': return cosh($x);
			case 'tanh': return tanh($x);
			case 'asinh': return asinh($x);
			case 'acosh': return acosh($x);
			case 'atanh': return atanh($x);
			case 'atan2': return atan2($x, $a[1] ?? NAN);
			case 'factmod':
				$m = $a[1] ?? NAN;
				if (!self::nonNegInt($x) || !self::posInt($m) || $x > 1e6) { return NAN; }
				$M = self::g($m);
				$r = gmp_mod(gmp_init(1), $M);
				for ($i = 2; $i <= (int)$x; $i++) { $r = gmp_mod(gmp_mul($r, $i), $M); }
				return self::f($r);
		}
		$v = Special::call($name, $a);
		if ($v !== null) {
			return $v;
		}
		throw new \RuntimeException('unknown function "' . $name . '"');
	}

	/** Fast doubling: [F(n), F(n+1)]. */
	private static function fibPair(int $n): array {
		if ($n === 0) {
			return [gmp_init(0), gmp_init(1)];
		}
		[$a, $b] = self::fibPair($n >> 1);
		$c = gmp_mul($a, gmp_sub(gmp_mul($b, 2), $a));
		$d = gmp_add(gmp_mul($a, $a), gmp_mul($b, $b));
		return ($n & 1) ? [$d, gmp_add($c, $d)] : [$c, $d];
	}

	private static function primepi(float $x): float {
		if (!is_finite($x)) { return NAN; }
		$x = (int)floor($x);
		if ($x < 2) { return 0.0; }
		if ($x > 1e11) { return NAN; }
		$r = (int)floor(sqrt($x));
		while (($r + 1) * ($r + 1) <= $x) { $r++; }
		while ($r * $r > $x) { $r--; }
		$small = [];
		$large = [];
		for ($v = 1; $v <= $r; $v++) { $small[$v] = $v - 1; $large[$v] = intdiv($x, $v) - 1; }
		for ($p = 2; $p <= $r; $p++) {
			if ($small[$p] === $small[$p - 1]) { continue; }
			$sp = $small[$p - 1];
			$p2 = $p * $p;
			$lim = min($r, intdiv($x, $p2));
			for ($i = 1; $i <= $lim; $i++) {
				$d = $i * $p;
				$large[$i] -= ($d <= $r ? $large[$d] : $small[intdiv($x, $d)]) - $sp;
			}
			for ($v = $r; $v >= $p2; $v--) { $small[$v] -= $small[intdiv($v, $p)] - $sp; }
		}
		return (float)$large[1];
	}

	private static function nthprime(float $n): float {
		if (!self::posInt($n) || $n > 2e6) { return NAN; }
		$n = (int)$n;
		if ($n < 6) { return (float)[2, 3, 5, 7, 11][$n - 1]; }
		$lim = (int)ceil($n * (log($n) + log(log($n)))) + 10;
		$sieve = str_repeat("\0", $lim + 1);
		$c = 0;
		for ($i = 2; $i <= $lim; $i++) {
			if ($sieve[$i] === "\0") {
				$c++;
				if ($c === $n) { return (float)$i; }
				for ($j = $i * $i; $j <= $lim; $j += $i) { $sieve[$j] = "\1"; }
			}
		}
		return NAN;
	}

	private static function carmichael(float $n): float {
		$f = self::factors($n);
		if ($f === null) { return NAN; }
		$r = gmp_init(1);
		foreach ($f as $p => $e) {
			$l = gmp_mul(gmp_sub(gmp_init($p), 1), gmp_pow(gmp_init($p), $e - 1));
			if ((string)$p === '2' && $e >= 3) { $l = gmp_div_q($l, 2); }
			$r = gmp_lcm($r, $l);
		}
		return self::f($r);
	}

	/** @param list<float> $a */
	private static function crt(array $a): float {
		[$a1, $m1, $a2, $m2] = [$a[0] ?? NAN, $a[1] ?? NAN, $a[2] ?? NAN, $a[3] ?? NAN];
		if (!self::isInt($a1) || !self::isInt($a2) || !self::posInt($m1) || !self::posInt($m2)) { return NAN; }
		[$A1, $M1, $A2, $M2] = [self::g($a1), self::g($m1), self::g($a2), self::g($m2)];
		$g = gmp_gcd($M1, $M2);
		if (gmp_cmp(gmp_mod(gmp_sub($A2, $A1), $g), 0) !== 0) { return NAN; }
		$l = gmp_mul(gmp_div_q($M1, $g), $M2);
		$m2g = gmp_div_q($M2, $g);
		$inv = gmp_cmp($m2g, 1) === 0 ? gmp_init(0) : gmp_invert(gmp_mod(gmp_div_q($M1, $g), $m2g), $m2g);
		$t = gmp_mod(gmp_mul(gmp_div_q(gmp_sub($A2, $A1), $g), $inv), $m2g);
		$x = gmp_mod(gmp_add($A1, gmp_mul($t, $M1)), $l);
		return self::f($x);
	}

	private static function partitions(float $n): float {
		if (!self::nonNegInt($n) || $n > 100000) { return NAN; }
		$n = (int)$n;
		$p = [gmp_init(1)];
		for ($m = 1; $m <= $n; $m++) {
			$s = gmp_init(0);
			for ($k = 1; ; $k++) {
				$g1 = intdiv($k * (3 * $k - 1), 2);
				if ($g1 > $m) { break; }
				$plus = $k % 2 === 1;
				$s = $plus ? gmp_add($s, $p[$m - $g1]) : gmp_sub($s, $p[$m - $g1]);
				$g2 = intdiv($k * (3 * $k + 1), 2);
				if ($g2 <= $m) { $s = $plus ? gmp_add($s, $p[$m - $g2]) : gmp_sub($s, $p[$m - $g2]); }
			}
			$p[] = $s;
		}
		return self::f($p[$n]);
	}

	private static function ord(float $a, float $n): float {
		if (!self::isInt($a) || !self::posInt($n) || $n < 2) { return NAN; }
		$M = self::g($n);
		$A = gmp_mod(self::g($a), $M);
		if (gmp_cmp(gmp_gcd($A, $M), 1) !== 0) { return NAN; }
		$r = self::g(self::carmichael($n));
		foreach (array_keys(self::factor($r)) as $p) {
			$p = gmp_init((string)$p);
			while (gmp_cmp(gmp_mod($r, $p), 0) === 0 && gmp_cmp(gmp_powm($A, gmp_div_q($r, $p), $M), 1) === 0) {
				$r = gmp_div_q($r, $p);
			}
		}
		return self::f($r);
	}

	private static function primroot(float $n): float {
		if (!self::posInt($n) || $n > 1e12) { return NAN; }
		if ($n <= 4) { return $n == 1 ? 0.0 : $n - 1; }
		$lam = self::carmichael($n);
		if ($lam != self::call('phi', [$n])) { return NAN; }
		$M = self::g($n);
		$L = self::g($lam);
		$ps = array_keys(self::factor($L));
		for ($g = 2; $g < $n; $g++) {
			if (gmp_cmp(gmp_gcd($g, $M), 1) !== 0) { continue; }
			$ok = true;
			foreach ($ps as $p) {
				if (gmp_cmp(gmp_powm($g, gmp_div_q($L, gmp_init((string)$p)), $M), 1) === 0) { $ok = false; break; }
			}
			if ($ok) { return (float)$g; }
		}
		return NAN;
	}

	private const LG = 7;
	private const LC = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

	public static function gamma(float $x): float {
		if (is_nan($x)) { return NAN; }
		if (floor($x) == $x && $x <= 0) { return NAN; }
		if (floor($x) == $x && $x <= 171) { return self::call('fact', [$x - 1]); }
		if ($x < 0.5) { return M_PI / (sin(M_PI * $x) * self::gamma(1 - $x)); }
		$x -= 1;
		$a = self::LC[0];
		$t = $x + self::LG + 0.5;
		for ($i = 1; $i < self::LG + 2; $i++) { $a += self::LC[$i] / ($x + $i); }
		return sqrt(2 * M_PI) * ($t ** ($x + 0.5)) * exp(-$t) * $a;
	}

	public static function lgamma(float $x): float {
		if (is_nan($x) || $x <= 0) { return NAN; }
		if ($x < 0.5) { return log(M_PI / abs(sin(M_PI * $x))) - self::lgamma(1 - $x); }
		$x -= 1;
		$a = self::LC[0];
		$t = $x + self::LG + 0.5;
		for ($i = 1; $i < self::LG + 2; $i++) { $a += self::LC[$i] / ($x + $i); }
		return 0.5 * log(2 * M_PI) + ($x + 0.5) * log($t) - $t + log($a);
	}

	public static function erfc(float $x): float {
		if (is_nan($x)) { return NAN; }
		if ($x < 0) { return 2 - self::erfc(-$x); }
		if ($x < 2.5) { return 1 - self::erf($x); }
		$f = 0.0;
		for ($n = 60; $n >= 1; $n--) { $f = ($n / 2) / ($x + $f); }
		return exp(-$x * $x) / sqrt(M_PI) / ($x + $f);
	}

	public static function erf(float $x): float {
		if (is_nan($x)) { return NAN; }
		if (abs($x) >= 2.5) { return $x > 0 ? 1 - self::erfc($x) : self::erfc(-$x) - 1; }
		$sum = $x;
		$term = $x;
		$x2 = $x * $x;
		for ($n = 1; $n < 200; $n++) {
			$term *= -$x2 / $n;
			$add = $term / (2 * $n + 1);
			$sum += $add;
			if (abs($add) < 1e-17 * abs($sum)) { break; }
		}
		return (2 / sqrt(M_PI)) * $sum;
	}

	public static function norminv(float $p, float $m, float $s): float {
		if (!($p > 0 && $p < 1) || !($s > 0)) { return NAN; }
		$a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
		$b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
		$c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
		$d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
		$pl = 0.02425;
		if ($p < $pl) {
			$q = sqrt(-2 * log($p));
			$x = ((((($c[0] * $q + $c[1]) * $q + $c[2]) * $q + $c[3]) * $q + $c[4]) * $q + $c[5]) / (((($d[0] * $q + $d[1]) * $q + $d[2]) * $q + $d[3]) * $q + 1);
		} elseif ($p <= 1 - $pl) {
			$q = $p - 0.5;
			$r = $q * $q;
			$x = ((((($a[0] * $r + $a[1]) * $r + $a[2]) * $r + $a[3]) * $r + $a[4]) * $r + $a[5]) * $q / ((((($b[0] * $r + $b[1]) * $r + $b[2]) * $r + $b[3]) * $r + $b[4]) * $r + 1);
		} else {
			$q = sqrt(-2 * log(1 - $p));
			$x = -((((($c[0] * $q + $c[1]) * $q + $c[2]) * $q + $c[3]) * $q + $c[4]) * $q + $c[5]) / (((($d[0] * $q + $d[1]) * $q + $d[2]) * $q + $d[3]) * $q + 1);
		}
		$e = 0.5 * self::erfc(-$x / M_SQRT2) - $p;
		$u = $e * sqrt(2 * M_PI) * exp($x * $x / 2);
		$x = $x - $u / (1 + $x * $u / 2);
		return $m + $s * $x;
	}

	public static function zeta(float $s): float {
		if (is_nan($s) || $s == 1) { return NAN; }
		if ($s < 0) {
			if (floor($s) == $s && fmod($s, 2) == 0) { return 0.0; }
			return (2 ** $s) * (M_PI ** ($s - 1)) * sin(M_PI * $s / 2) * self::gamma(1 - $s) * self::zeta(1 - $s);
		}
		if ($s == 0) { return -0.5; }
		$n = 60;
		$dk = [];
		$sum = 0.0;
		for ($i = 0; $i <= $n; $i++) {
			$sum += $n * exp(self::lgamma($n + $i) - self::lgamma($n - $i + 1) - self::lgamma(2 * $i + 1)) * (4 ** $i);
			$dk[] = $sum;
		}
		$t = 0.0;
		for ($k = 0; $k < $n; $k++) { $t += (($k % 2) ? -1 : 1) * ($dk[$k] - $dk[$n]) / (($k + 1) ** $s); }
		$eta = -$t / $dk[$n];
		return $eta / (1 - 2 ** (1 - $s));
	}

	private static function li(float $x): float {
		if (!($x > 0) || $x == 1) { return NAN; }
		$lnx = log($x);
		$sum = 0.0;
		$fac = 1.0;
		$inner = 0.0;
		for ($n = 1; $n < 200; $n++) {
			$fac *= $n;
			if ((($n - 1) % 2) === 0) { $inner += 1 / (($n - 1) + 1); }
			$term = (($n - 1) % 2 ? -1 : 1) * ($lnx ** $n) / ($fac * (2 ** ($n - 1))) * $inner;
			$sum += $term;
			if (abs($term) < 1e-17 * abs($sum) && $n > 10) { break; }
		}
		return 0.5772156649015329 + log(abs($lnx)) + sqrt($x) * $sum;
	}

	private static function lambertw(float $x): float {
		if (is_nan($x) || !($x >= -1 / M_E)) { return NAN; }
		if ($x == 0) { return 0.0; }
		$w = $x < 1 ? ($x > -0.3 ? $x : -1 + sqrt(2 * (1 + M_E * $x))) : log($x) - log(log($x) + 1);
		for ($i = 0; $i < 60; $i++) {
			$e = exp($w);
			$f = $w * $e - $x;
			$d = $e * ($w + 1);
			$nw = $w - $f / ($d - ($w + 2) * $f / (2 * $w + 2));
			if (abs($nw - $w) < 1e-15 * (1 + abs($nw))) { return $nw; }
			$w = $nw;
		}
		return $w;
	}
}
