<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Service;

/**
 * Special functions, probability distributions and the numerical calculus helpers (integration,
 * differentiation, root finding) — the PHP port of the same code in js/formulabase.js
 * (source: regibase-build/fb-mathlib.js). Both sides must give the same numbers.
 */
class Special {
	private const EG = 0.5772156649015329;

	private static function isInt(float $x): bool { return is_finite($x) && floor($x) == $x; }
	private static function nonNegInt(float $x): bool { return self::isInt($x) && $x >= 0; }

	/** @param list<float> $a  @return float|null null when the name is not one of these */
	public static function call(string $name, array $a): ?float {
		$x = $a[0] ?? NAN;
		$y = $a[1] ?? NAN;
		$z = $a[2] ?? NAN;
		switch ($name) {
			case 'digamma': return self::digamma($x);
			case 'gammainc': return self::gammainc($x, $y);
			case 'gammaincc': return self::gammaincc($x, $y);
			case 'betainc': return self::betainc($x, $y, $z);
			case 'gammapdf': return self::gammapdf($x, $y, $a[2] ?? 1.0);
			case 'gammacdf': return self::gammacdf($x, $y, $a[2] ?? 1.0);
			case 'gammainv': return self::gammainv($x, $y, $a[2] ?? 1.0);
			case 'betapdf': return self::betapdf($x, $y, $z);
			case 'betacdf': return self::betacdf($x, $y, $z);
			case 'betainv': return self::betainv($x, $y, $z);
			case 'chi2pdf': return self::gammapdf($x, $y / 2, 2.0);
			case 'chi2cdf': return self::gammacdf($x, $y / 2, 2.0);
			case 'chi2inv': return self::gammainv($x, $y / 2, 2.0);
			case 'tpdf':
				if (!($y > 0)) { return NAN; }
				return exp(MathLib::lgamma(($y + 1) / 2) - MathLib::lgamma($y / 2) - 0.5 * log($y * M_PI) - ($y + 1) / 2 * log(1 + $x * $x / $y));
			case 'tcdf': return self::tcdf($x, $y);
			case 'tinv':
				if (!($y > 0) || !($x > 0 && $x < 1)) { return NAN; }
				return self::invert(fn ($t) => self::tcdf($t, $y), $x, -INF, INF);
			case 'fpdf':
				[$d1, $d2] = [$y, $z];
				if (!($d1 > 0) || !($d2 > 0)) { return NAN; }
				if ($x < 0) { return 0.0; }
				if ($x == 0) { return $d1 == 2 ? 1.0 : ($d1 < 2 ? INF : 0.0); }
				return exp(0.5 * ($d1 * log($d1 * $x) + $d2 * log($d2) - ($d1 + $d2) * log($d1 * $x + $d2)) - log($x) - (MathLib::lgamma($d1 / 2) + MathLib::lgamma($d2 / 2) - MathLib::lgamma(($d1 + $d2) / 2)));
			case 'fcdf': return self::fcdf($x, $y, $z);
			case 'finv':
				if (!($y > 0) || !($z > 0)) { return NAN; }
				return self::invert(fn ($t) => self::fcdf($t, $y, $z), $x, 0.0, INF);
			case 'binompdf':
				[$k, $n, $p] = [$x, $y, $z];
				if (!self::nonNegInt($n) || !self::isInt($k) || !($p >= 0 && $p <= 1)) { return NAN; }
				if ($k < 0 || $k > $n) { return 0.0; }
				if ($p == 0) { return $k == 0 ? 1.0 : 0.0; }
				if ($p == 1) { return $k == $n ? 1.0 : 0.0; }
				return exp(MathLib::lgamma($n + 1) - MathLib::lgamma($k + 1) - MathLib::lgamma($n - $k + 1) + $k * log($p) + ($n - $k) * log(1 - $p));
			case 'binomcdf':
				[$k, $n, $p] = [$x, $y, $z];
				if (!self::nonNegInt($n) || !($p >= 0 && $p <= 1) || is_nan($k)) { return NAN; }
				$k = floor($k);
				if ($k < 0) { return 0.0; }
				if ($k >= $n) { return 1.0; }
				return self::betainc(1 - $p, $n - $k, $k + 1);
			case 'poisspdf':
				[$k, $l] = [$x, $y];
				if (!self::isInt($k) || !($l >= 0)) { return NAN; }
				if ($k < 0) { return 0.0; }
				if ($l == 0) { return $k == 0 ? 1.0 : 0.0; }
				return exp($k * log($l) - $l - MathLib::lgamma($k + 1));
			case 'poisscdf':
				[$k, $l] = [$x, $y];
				if (is_nan($k) || !($l >= 0)) { return NAN; }
				$k = floor($k);
				if ($k < 0) { return 0.0; }
				if ($l == 0) { return 1.0; }
				return self::gammaincc($k + 1, $l);
			case 'exppdf': return $y > 0 ? ($x < 0 ? 0.0 : $y * exp(-$y * $x)) : NAN;
			case 'expcdf': return $y > 0 ? ($x < 0 ? 0.0 : 1 - exp(-$y * $x)) : NAN;
			case 'expinv': return ($y > 0 && $x >= 0 && $x < 1) ? -log(1 - $x) / $y : NAN;
			case 'lognpdf':
				[$m, $s] = [$a[1] ?? 0.0, $a[2] ?? 1.0];
				if (!($s > 0)) { return NAN; }
				if ($x <= 0) { return 0.0; }
				$zz = (log($x) - $m) / $s;
				return exp(-0.5 * $zz * $zz) / ($x * $s * sqrt(2 * M_PI));
			case 'logncdf':
				[$m, $s] = [$a[1] ?? 0.0, $a[2] ?? 1.0];
				if (!($s > 0)) { return NAN; }
				return $x <= 0 ? 0.0 : 0.5 * MathLib::erfc(-(log($x) - $m) / ($s * M_SQRT2));
			case 'logninv':
				$zz = MathLib::norminv($x, $a[1] ?? 0.0, $a[2] ?? 1.0);
				return is_nan($zz) ? NAN : exp($zz);
			case 'weibpdf': return ($y > 0 && $z > 0) ? ($x < 0 ? 0.0 : ($y / $z) * (($x / $z) ** ($y - 1)) * exp(-(($x / $z) ** $y))) : NAN;
			case 'weibcdf': return ($y > 0 && $z > 0) ? ($x < 0 ? 0.0 : 1 - exp(-(($x / $z) ** $y))) : NAN;
			case 'weibinv': return ($y > 0 && $z > 0 && $x >= 0 && $x < 1) ? $z * ((-log(1 - $x)) ** (1 / $y)) : NAN;
			case 'geompdf': return (self::isInt($x) && $y > 0 && $y <= 1) ? ($x < 1 ? 0.0 : ((1 - $y) ** ($x - 1)) * $y) : NAN;
			case 'geomcdf': return (!is_nan($x) && $y > 0 && $y <= 1) ? ($x < 1 ? 0.0 : 1 - ((1 - $y) ** floor($x))) : NAN;
			case 'hygepdf':
				[$k, $N, $K, $n] = [$x, $y, $z, $a[3] ?? NAN];
				foreach ([$k, $N, $K, $n] as $v) { if (!self::nonNegInt($v)) { return NAN; } }
				if ($K > $N || $n > $N) { return NAN; }
				if ($k > $K || $k > $n || $n - $k > $N - $K) { return 0.0; }
				$lb = fn ($p, $q) => MathLib::lgamma($p + 1) - MathLib::lgamma($q + 1) - MathLib::lgamma($p - $q + 1);
				return exp($lb($K, $k) + $lb($N - $K, $n - $k) - $lb($N, $n));
			case 'nbinpdf':
				[$k, $r, $p] = [$x, $y, $z];
				return (self::nonNegInt($k) && $r > 0 && $p > 0 && $p <= 1) ? exp(MathLib::lgamma($k + $r) - MathLib::lgamma($k + 1) - MathLib::lgamma($r) + $r * log($p) + $k * log(1 - $p)) : NAN;
			case 'erfinv':
				if ($x > -1 && $x < 1) { return MathLib::norminv(($x + 1) / 2, 0.0, 1.0) / M_SQRT2; }
				return $x == 1 ? INF : ($x == -1 ? -INF : NAN);
			case 'expint': return self::expint($x);
			case 'ei': return self::ei($x);
			case 'si': return self::si($x);
			case 'ci': return self::ci($x);
			case 'besselj': return self::besselj($x, $y);
			case 'bessely': return self::bessely($x, $y);
			case 'besseli': return self::besseli($x, $y);
			case 'besselk': return self::besselk($x, $y);
			case 'ellipk': return self::ellipk($x);
			case 'ellipe': return self::ellipe($x);
			case 'ellipf': return self::ellipf($x, $y);
			case 'ellipeinc': return self::ellipeinc($x, $y);
			case 'polylog': return self::polylog($x, $y);
		}
		return null;
	}

	public static function digamma(float $x): float {
		if (is_nan($x) || (self::isInt($x) && $x <= 0)) { return NAN; }
		if ($x < 0) { return self::digamma(1 - $x) - M_PI / tan(M_PI * $x); }
		$r = 0.0;
		while ($x < 6) { $r -= 1 / $x; $x += 1; }
		$f = 1 / ($x * $x);
		return $r + log($x) - 0.5 / $x - $f * (1 / 12 - $f * (1 / 120 - $f * (1 / 252 - $f * (1 / 240 - $f / 132))));
	}

	public static function gammainc(float $a, float $x): float {
		if (!($a > 0) || !($x >= 0)) { return NAN; }
		if ($x == 0) { return 0.0; }
		if ($x < $a + 1) {
			$ap = $a;
			$sum = 1 / $a;
			$del = $sum;
			for ($n = 0; $n < 1000; $n++) {
				$ap += 1;
				$del *= $x / $ap;
				$sum += $del;
				if (abs($del) < abs($sum) * 1e-16) { break; }
			}
			return $sum * exp(-$x + $a * log($x) - MathLib::lgamma($a));
		}
		return 1 - self::gammaincc($a, $x);
	}

	public static function gammaincc(float $a, float $x): float {
		if (!($a > 0) || !($x >= 0)) { return NAN; }
		if ($x < $a + 1) { return 1 - self::gammainc($a, $x); }
		$b = $x + 1 - $a;
		$c = 1 / 1e-300;
		$d = 1 / $b;
		$h = $d;
		for ($i = 1; $i < 1000; $i++) {
			$an = -$i * ($i - $a);
			$b += 2;
			$d = $an * $d + $b;
			if (abs($d) < 1e-300) { $d = 1e-300; }
			$c = $b + $an / $c;
			if (abs($c) < 1e-300) { $c = 1e-300; }
			$d = 1 / $d;
			$del = $d * $c;
			$h *= $del;
			if (abs($del - 1) < 1e-16) { break; }
		}
		return exp(-$x + $a * log($x) - MathLib::lgamma($a)) * $h;
	}

	private static function betacf(float $x, float $a, float $b): float {
		$qab = $a + $b;
		$qap = $a + 1;
		$qam = $a - 1;
		$c = 1.0;
		$d = 1 - $qab * $x / $qap;
		if (abs($d) < 1e-300) { $d = 1e-300; }
		$d = 1 / $d;
		$h = $d;
		for ($m = 1; $m <= 1000; $m++) {
			$m2 = 2 * $m;
			$aa = $m * ($b - $m) * $x / (($qam + $m2) * ($a + $m2));
			$d = 1 + $aa * $d;
			if (abs($d) < 1e-300) { $d = 1e-300; }
			$c = 1 + $aa / $c;
			if (abs($c) < 1e-300) { $c = 1e-300; }
			$d = 1 / $d;
			$h *= $d * $c;
			$aa = -($a + $m) * ($qab + $m) * $x / (($a + $m2) * ($qap + $m2));
			$d = 1 + $aa * $d;
			if (abs($d) < 1e-300) { $d = 1e-300; }
			$c = 1 + $aa / $c;
			if (abs($c) < 1e-300) { $c = 1e-300; }
			$d = 1 / $d;
			$del = $d * $c;
			$h *= $del;
			if (abs($del - 1) < 1e-16) { break; }
		}
		return $h;
	}

	public static function betainc(float $x, float $a, float $b): float {
		if (!($a > 0) || !($b > 0) || !($x >= 0 && $x <= 1)) { return NAN; }
		if ($x == 0 || $x == 1) { return $x; }
		$bt = exp(MathLib::lgamma($a + $b) - MathLib::lgamma($a) - MathLib::lgamma($b) + $a * log($x) + $b * log(1 - $x));
		return $x < ($a + 1) / ($a + $b + 2) ? $bt * self::betacf($x, $a, $b) / $a : 1 - $bt * self::betacf(1 - $x, $b, $a) / $b;
	}

	/** Monotone inverse of a CDF by bracketing + safeguarded secant/bisection (mirrors invert() in JS). */
	public static function invert(callable $cdf, float $p, float $lo, float $hi): float {
		if (!($p >= 0 && $p <= 1)) { return NAN; }
		if ($p == 0) { return $lo; }
		if ($p == 1) { return $hi; }
		$a = $lo;
		$b = $hi;
		if (!is_finite($b)) { $b = 1.0; while ($cdf($b) < $p && $b < 1e300) { $b *= 2; } }
		if (!is_finite($a)) { $a = -1.0; while ($cdf($a) > $p && $a > -1e300) { $a *= 2; } }
		$fa = $cdf($a) - $p;
		$fb = $cdf($b) - $p;
		for ($i = 0; $i < 300; $i++) {
			$m = $b - $fb * ($b - $a) / ($fb - $fa);
			if (!($m > min($a, $b) && $m < max($a, $b))) { $m = ($a + $b) / 2; }
			if ($i % 3 === 2) { $m = ($a + $b) / 2; }
			$fm = $cdf($m) - $p;
			if ($fm == 0 || abs($b - $a) < 1e-15 * max(1, abs($m))) { return $m; }
			if (($fm < 0) === ($fa < 0)) { $a = $m; $fa = $fm; } else { $b = $m; $fb = $fm; }
		}
		return ($a + $b) / 2;
	}

	private static function gammacdf(float $x, float $k, float $th): float {
		if (!($k > 0) || !($th > 0)) { return NAN; }
		return $x <= 0 ? 0.0 : self::gammainc($k, $x / $th);
	}
	private static function gammapdf(float $x, float $k, float $th): float {
		if (!($k > 0) || !($th > 0)) { return NAN; }
		if ($x < 0) { return 0.0; }
		if ($x == 0) { return $k == 1 ? 1 / $th : ($k < 1 ? INF : 0.0); }
		return exp(($k - 1) * log($x) - $x / $th - MathLib::lgamma($k) - $k * log($th));
	}
	private static function gammainv(float $p, float $k, float $th): float {
		if (!($k > 0) || !($th > 0)) { return NAN; }
		return self::invert(fn ($t) => self::gammacdf($t, $k, $th), $p, 0.0, INF);
	}
	private static function betapdf(float $x, float $a, float $b): float {
		if (!($a > 0) || !($b > 0)) { return NAN; }
		if ($x < 0 || $x > 1) { return 0.0; }
		return exp(($a - 1) * log($x) + ($b - 1) * log(1 - $x) - MathLib::lgamma($a) - MathLib::lgamma($b) + MathLib::lgamma($a + $b));
	}
	private static function betacdf(float $x, float $a, float $b): float {
		if (!($a > 0) || !($b > 0)) { return NAN; }
		return $x <= 0 ? 0.0 : ($x >= 1 ? 1.0 : self::betainc($x, $a, $b));
	}
	private static function betainv(float $p, float $a, float $b): float {
		if (!($a > 0) || !($b > 0)) { return NAN; }
		return self::invert(fn ($t) => self::betacdf($t, $a, $b), $p, 0.0, 1.0);
	}
	private static function tcdf(float $x, float $v): float {
		if (!($v > 0)) { return NAN; }
		$ib = self::betainc($v / ($v + $x * $x), $v / 2, 0.5);
		return $x >= 0 ? 1 - 0.5 * $ib : 0.5 * $ib;
	}
	private static function fcdf(float $x, float $d1, float $d2): float {
		if (!($d1 > 0) || !($d2 > 0)) { return NAN; }
		return $x <= 0 ? 0.0 : self::betainc($d1 * $x / ($d1 * $x + $d2), $d1 / 2, $d2 / 2);
	}

	public static function expint(float $x): float {
		if (!($x > 0)) { return NAN; }
		if ($x <= 1) {
			$sum = 0.0;
			$term = 1.0;
			for ($k = 1; $k < 200; $k++) {
				$term *= -$x / $k;
				$add = -$term / $k;
				$sum += $add;
				if (abs($add) < 1e-17 * abs($sum)) { break; }
			}
			return -self::EG - log($x) + $sum;
		}
		$b = $x + 1;
		$c = 1 / 1e-300;
		$d = 1 / $b;
		$h = $d;
		for ($i = 1; $i < 1000; $i++) {
			$an = -$i * $i;
			$b += 2;
			$d = 1 / ($an * $d + $b);
			$c = $b + $an / $c;
			$del = $c * $d;
			$h *= $del;
			if (abs($del - 1) < 1e-16) { break; }
		}
		return $h * exp(-$x);
	}

	public static function ei(float $x): float {
		if ($x == 0 || is_nan($x)) { return NAN; }
		if ($x < 0) { return -self::expint(-$x); }
		if ($x < 40) {
			$sum = 0.0;
			$term = 1.0;
			for ($k = 1; $k < 500; $k++) {
				$term *= $x / $k;
				$add = $term / $k;
				$sum += $add;
				if ($add < 1e-17 * $sum) { break; }
			}
			return self::EG + log($x) + $sum;
		}
		$sum = 1.0;
		$term = 1.0;
		for ($k = 1; $k < 40; $k++) {
			$nt = $term * $k / $x;
			if ($nt > $term) { break; }
			$term = $nt;
			$sum += $term;
		}
		return exp($x) / $x * $sum;
	}

	/** @return array{0:float,1:float} E1(ix) as [re, im] */
	private static function e1i(float $x): array {
		[$bR, $bI, $cR, $cI] = [1.0, $x, 1e300, 0.0];
		$den = $bR * $bR + $bI * $bI;
		[$dR, $dI] = [$bR / $den, -$bI / $den];
		[$hR, $hI] = [$dR, $dI];
		for ($i = 1; $i < 500; $i++) {
			$an = -$i * $i;
			$bR += 2;
			$tR = $an * $dR + $bR;
			$tI = $an * $dI + $bI;
			$den = $tR * $tR + $tI * $tI;
			$dR = $tR / $den;
			$dI = -$tI / $den;
			$den = $cR * $cR + $cI * $cI;
			$tR = $bR + $an * $cR / $den;
			$tI = $bI - $an * $cI / $den;
			$cR = $tR;
			$cI = $tI;
			$delR = $cR * $dR - $cI * $dI;
			$delI = $cR * $dI + $cI * $dR;
			$tR = $hR * $delR - $hI * $delI;
			$hI = $hR * $delI + $hI * $delR;
			$hR = $tR;
			if (abs($delR - 1) + abs($delI) < 1e-16) { break; }
		}
		[$eR, $eI] = [cos($x), -sin($x)];
		return [$hR * $eR - $hI * $eI, $hR * $eI + $hI * $eR];
	}

	public static function si(float $x): float {
		if ($x < 0) { return -self::si(-$x); }
		if ($x == 0) { return 0.0; }
		if ($x <= 4) {
			$sum = 0.0;
			$term = $x;
			for ($k = 0; $k < 100; $k++) {
				$add = $term / (2 * $k + 1);
				$sum += $add;
				if (abs($add) < 1e-17 * abs($sum)) { break; }
				$term *= -$x * $x / ((2 * $k + 2) * (2 * $k + 3));
			}
			return $sum;
		}
		return M_PI / 2 + self::e1i($x)[1];
	}

	public static function ci(float $x): float {
		if (!($x > 0)) { return NAN; }
		if ($x <= 4) {
			$sum = 0.0;
			$term = -$x * $x / 2;
			for ($k = 1; $k < 100; $k++) {
				$add = $term / (2 * $k);
				$sum += $add;
				if (abs($add) < 1e-17 * abs($sum)) { break; }
				$term *= -$x * $x / ((2 * $k + 1) * (2 * $k + 2));
			}
			return self::EG + log($x) + $sum;
		}
		return -self::e1i($x)[0];
	}

	public static function besselj(float $n, float $x): float {
		if (!self::isInt($n) || is_nan($x)) { return NAN; }
		if ($n < 0) { return (((int)$n) % 2 ? -1 : 1) * self::besselj(-$n, $x); }
		$M = max(64, (int)ceil(2 * abs($x) + 2 * $n + 64));
		// A limit on the work: besselj(0, 1e12) was 2×10¹² turns of this loop (REVIEW P1).
		if ($M > 2000000) { return NAN; }
		$s = 0.0;
		for ($k = 0; $k < $M; $k++) {
			$t = ($k + 0.5) * M_PI / $M;
			$s += cos($n * $t - $x * sin($t));
		}
		return $s / $M;
	}

	public static function besseli(float $n, float $x): float {
		if (!self::isInt($n) || is_nan($x)) { return NAN; }
		$n = abs($n);
		$M = max(64, (int)ceil(2 * abs($x) + 2 * $n + 64));
		if ($M > 2000000) { return NAN; }
		$s = 0.0;
		for ($k = 0; $k < $M; $k++) {
			$t = ($k + 0.5) * M_PI / $M;
			$s += exp($x * cos($t)) * cos($n * $t);
		}
		return $s / $M;
	}

	public static function besselk(float $n, float $x): float {
		if (!self::isInt($n) || !($x > 0)) { return NAN; }
		$n = abs($n);
		$h = 0.02;
		$s = 0.5 * exp(-$x);
		for ($k = 1; $k < 100000; $k++) {
			$t = $k * $h;
			$v = exp(-$x * cosh($t)) * cosh($n * $t);
			$s += $v;
			if ($v < 1e-18 * $s && $x * cosh($t) > 40) { break; }
		}
		return $s * $h;
	}

	public static function bessely(float $n, float $x): float {
		if (!self::isInt($n) || !($x > 0)) { return NAN; }
		if ($n < 0) { return (((int)$n) % 2 ? -1 : 1) * self::bessely(-$n, $x); }
		$a = self::integrate(fn ($t) => sin($x * sin($t) - $n * $t), 0.0, M_PI) / M_PI;
		$sgn = ((int)$n) % 2 ? -1 : 1;
		$tail = self::integrate(fn ($t) => (exp($n * $t) + $sgn * exp(-$n * $t)) * exp(-$x * sinh($t)), 0.0, asinh(max(1, (800 + $n * 20) / $x))) / M_PI;
		return $a - $tail;
	}

	public static function ellipk(float $k): float {
		if (!(abs($k) < 1)) { return abs($k) == 1 ? INF : NAN; }
		$a = 1.0;
		$b = sqrt(1 - $k * $k);
		for ($i = 0; $i < 60 && abs($a - $b) > 1e-16 * $a; $i++) { $t = ($a + $b) / 2; $b = sqrt($a * $b); $a = $t; }
		return M_PI / (2 * $a);
	}

	public static function ellipe(float $k): float {
		if (!(abs($k) <= 1)) { return NAN; }
		if (abs($k) == 1) { return 1.0; }
		$a = 1.0;
		$b = sqrt(1 - $k * $k);
		$sum = $k * $k / 2;
		$p = 0.5;
		for ($i = 0; $i < 60; $i++) {
			$c = ($a - $b) / 2;
			$t = ($a + $b) / 2;
			$b = sqrt($a * $b);
			$a = $t;
			$p *= 2;
			$sum += $p * $c * $c;
			if (abs($c) < 1e-17) { break; }
		}
		return M_PI / (2 * $a) * (1 - $sum);
	}

	private static function carlsonRF(float $x, float $y, float $z): float {
		for ($i = 0; $i < 100; $i++) {
			$l = sqrt($x * $y) + sqrt($y * $z) + sqrt($z * $x);
			$x = ($x + $l) / 4;
			$y = ($y + $l) / 4;
			$z = ($z + $l) / 4;
			$m = ($x + $y + $z) / 3;
			if (max(abs($x - $m), abs($y - $m), abs($z - $m)) < 1e-10 * $m) { break; }
		}
		$m = ($x + $y + $z) / 3;
		$X = 1 - $x / $m;
		$Y = 1 - $y / $m;
		$Z = -$X - $Y;
		$E2 = $X * $Y - $Z * $Z;
		$E3 = $X * $Y * $Z;
		return (1 - $E2 / 10 + $E3 / 14 + $E2 * $E2 / 24 - 3 * $E2 * $E3 / 44) / sqrt($m);
	}

	private static function carlsonRD(float $x, float $y, float $z): float {
		$sum = 0.0;
		$fac = 1.0;
		for ($i = 0; $i < 100; $i++) {
			$l = sqrt($x * $y) + sqrt($y * $z) + sqrt($z * $x);
			$sum += $fac / (sqrt($z) * ($z + $l));
			$fac /= 4;
			$x = ($x + $l) / 4;
			$y = ($y + $l) / 4;
			$z = ($z + $l) / 4;
			$m = ($x + $y + 3 * $z) / 5;
			if (max(abs($x - $m), abs($y - $m), abs($z - $m)) < 1e-10 * $m) { break; }
		}
		$m = ($x + $y + 3 * $z) / 5;
		$X = 1 - $x / $m;
		$Y = 1 - $y / $m;
		$Z = -($X + $Y) / 3;
		$ea = $X * $Y;
		$eb = $Z * $Z;
		$ec = $ea - $eb;
		$ed = $ea - 6 * $eb;
		$ee = $ed + $ec + $ec;
		return 3 * $sum + $fac * (1 + $ed * (-3 / 14 + 9 / 88 * $ed - 9 / 52 * $Z * $ee) + $Z * (1 / 6 * $ee + $Z * (-9 / 22 * $ec + $Z * 3 / 26 * $ea))) / ($m * sqrt($m));
	}

	public static function ellipf(float $phi, float $k): float {
		if (is_nan($phi) || !(abs($k) <= 1)) { return NAN; }
		$n = round($phi / M_PI);
		$r = $phi - $n * M_PI;
		$sr = sin($r);
		$cr = cos($r);
		return 2 * $n * self::ellipk($k) + $sr * self::carlsonRF($cr * $cr, 1 - $k * $k * $sr * $sr, 1.0);
	}

	public static function ellipeinc(float $phi, float $k): float {
		if (is_nan($phi) || !(abs($k) <= 1)) { return NAN; }
		$n = round($phi / M_PI);
		$r = $phi - $n * M_PI;
		$s = sin($r);
		$c = cos($r);
		$q = 1 - $k * $k * $s * $s;
		return 2 * $n * self::ellipe($k) + $s * self::carlsonRF($c * $c, $q, 1.0) - $k * $k * $s * $s * $s / 3 * self::carlsonRD($c * $c, $q, 1.0);
	}

	public static function polylog(float $s, float $z): float {
		if (is_nan($s) || !($z >= -1 && $z <= 1)) { return NAN; }
		if ($z == 0) { return 0.0; }
		if ($z == 1) { return $s > 1 ? MathLib::zeta($s) : NAN; }
		if ($z == -1) { return -(1 - 2 ** (1 - $s)) * MathLib::zeta($s); }
		if ($s == 1) { return -log(1 - $z); }
		if (abs($z) > 0.5 && $s == 2 && $z > 0) {
			$w = 1 - $z;
			return M_PI * M_PI / 6 - log($z) * log($w) - self::polylog(2.0, $w);
		}
		$sum = 0.0;
		$zk = 1.0;
		for ($k = 1; $k < 100000; $k++) {
			$zk *= $z;
			$add = $zk / ($k ** $s);
			$sum += $add;
			if (abs($add) < 1e-17 * abs($sum)) { break; }
		}
		return $sum;
	}

	private const XGK = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926, 0.741531185599394439863864773280788, 0.586087235467691130294144845693013, 0.405845151377397166906606412076961, 0.207784955007898467600689403773245, 0.0];
	private const WGK = [0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518, 0.140653259715525918745189590510238, 0.169004726639267902826583426598550, 0.190350578064785409913256402421014, 0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
	private const WG = [0.129484966168869693270611432679082, 0.279705391489276667901467771423780, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

	/** @return array{0:float,1:float} */
	private static function gk(callable $f, float $a, float $b): array {
		$c = ($a + $b) / 2;
		$h = ($b - $a) / 2;
		$fc = $f($c);
		$k = self::WGK[7] * $fc;
		$g = self::WG[3] * $fc;
		for ($j = 0; $j < 7; $j++) {
			$dx = $h * self::XGK[$j];
			$f1 = $f($c - $dx);
			$f2 = $f($c + $dx);
			$k += self::WGK[$j] * ($f1 + $f2);
			if ($j % 2 === 1) { $g += self::WG[intdiv($j - 1, 2)] * ($f1 + $f2); }
		}
		return [$k * $h, abs(($k - $g) * $h)];
	}

	public static function integrate(callable $f, float $a, float $b, float $tol = 1e-12): float {
		if (!is_finite($a) || !is_finite($b)) {
			if ($a == $b) { return 0.0; }
			$g = function ($t) use ($f) {
				$x = $t / (1 - $t * $t);
				$w = (1 + $t * $t) / ((1 - $t * $t) * (1 - $t * $t));
				$v = $f($x) * $w;
				return is_finite($v) ? $v : 0.0;
			};
			$lo = is_finite($a) ? ($a == 0 ? 0.0 : (-1 + sqrt(1 + 4 * $a * $a)) / (2 * $a)) : -1.0;
			$hi = is_finite($b) ? ($b == 0 ? 0.0 : (-1 + sqrt(1 + 4 * $b * $b)) / (2 * $b)) : 1.0;
			return self::integrate($g, $lo, $hi, $tol);
		}
		if ($a == $b) { return 0.0; }
		$whole = self::gk($f, $a, $b);
		if ($whole[1] <= $tol * max(1, abs($whole[0]))) { return $whole[0]; }
		$stack = [[$a, $b]];
		$total = 0.0;
		$n = 0;
		while ($stack && $n < 20000) {
			[$x0, $x1] = array_pop($stack);
			[$v, $e] = self::gk($f, $x0, $x1);
			$n++;
			if ($e <= max($tol * abs($v), 1e-15 * abs($x1 - $x0)) || abs($x1 - $x0) < 1e-12 * max(1, abs($x0))) {
				$total += $v;
			} else {
				$m = ($x0 + $x1) / 2;
				$stack[] = [$m, $x1];
				$stack[] = [$x0, $m];
			}
		}
		return $total;
	}

	public static function derivative(callable $f, float $x, float $order = 1.0): float {
		$order = (int)$order;
		if (!in_array($order, [1, 2, 3, 4], true)) { return NAN; }
		$D = function ($h) use ($f, $x, $order) {
			if ($order === 1) { return ($f($x + $h) - $f($x - $h)) / (2 * $h); }
			if ($order === 2) { return ($f($x + $h) - 2 * $f($x) + $f($x - $h)) / ($h * $h); }
			if ($order === 3) { return ($f($x + 2 * $h) - 2 * $f($x + $h) + 2 * $f($x - $h) - $f($x - 2 * $h)) / (2 * $h * $h * $h); }
			return ($f($x + 2 * $h) - 4 * $f($x + $h) + 6 * $f($x) - 4 * $f($x - $h) + $f($x - 2 * $h)) / ($h * $h * $h * $h);
		};
		$h = ($order === 1 ? 1e-2 : ($order === 2 ? 5e-2 : 1e-1)) * max(1, abs($x));
		$T = [];
		for ($i = 0; $i < 6; $i++) {
			$T[$i] = [$D($h)];
			for ($j = 1; $j <= $i; $j++) { $T[$i][$j] = $T[$i][$j - 1] + ($T[$i][$j - 1] - $T[$i - 1][$j - 1]) / (4 ** $j - 1); }
			$h /= 2;
		}
		return $T[5][5];
	}

	public static function findRoot(callable $f, float $a, ?float $b = null): float {
		if ($b === null) {
			$x0 = $a;
			foreach ([$x0, $x0 * 1.1 + 0.1, $x0 - 1, $x0 + 1, 0.1, 1.0, -1.0, 10.0] as $s0) {
				$x1 = $s0;
				$x2 = $s0 + (abs($s0) > 1e-6 ? $s0 * 1e-3 : 1e-3);
				$f1 = $f($x1);
				if (!is_finite($f1)) { continue; }
				for ($i = 0; $i < 100; $i++) {
					$f2 = $f($x2);
					if (!is_finite($f2)) { $x2 = ($x1 + $x2) / 2; continue; }
					if ($f2 == 0 || abs($x2 - $x1) < 1e-15 * max(1, abs($x2))) {
						if (abs($f2) < 1e-9 * max(1, abs($f1))) { return $x2; }
						break;
					}
					$d = $f2 - $f1;
					if ($d == 0) { break; }
					$x3 = $x2 - $f2 * ($x2 - $x1) / $d;
					$x1 = $x2;
					$f1 = $f2;
					$x2 = $x3;
					if (!is_finite($x2)) { break; }
				}
			}
			return NAN;
		}
		$fa = $f($a);
		$fb = $f($b);
		if (!is_finite($fa) || !is_finite($fb)) { return NAN; }
		if ($fa == 0) { return $a; }
		if ($fb == 0) { return $b; }
		if (($fa > 0) === ($fb > 0)) { return NAN; }
		for ($i = 0; $i < 300; $i++) {
			$m = $b - $fb * ($b - $a) / ($fb - $fa);
			if (!($m > min($a, $b) && $m < max($a, $b)) || $i % 4 === 3) { $m = ($a + $b) / 2; }
			$fm = $f($m);
			if ($fm == 0 || abs($b - $a) < 1e-15 * max(1, abs($m))) { return $m; }
			if (($fm > 0) === ($fa > 0)) { $a = $m; $fa = $fm; } else { $b = $m; $fb = $fm; }
		}
		return ($a + $b) / 2;
	}
}
