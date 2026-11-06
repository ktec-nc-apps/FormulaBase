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

	/**
	 * @param list<float> $a  @return float|null null when the name is not one of these
	 * The loops below call FormulaCompiler::tick() so the formula's time limit holds
	 * inside them, and divide with fdiv() where a 0 can occur (REVIEW 2026-10-04 高1, 5).
	 */
	public static function call(string $name, array $a): ?float {
		FormulaCompiler::tick();
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
			case 'betainv':
				if (!($y > 0) || !($z > 0) || !($x >= 0 && $x <= 1)) { return NAN; }
				return self::betaQuantile($x, 1 - $x, $y, $z)[0];
			case 'chi2pdf': return self::gammapdf($x, $y / 2, 2.0);
			case 'chi2cdf': return self::gammacdf($x, $y / 2, 2.0);
			case 'chi2inv': return self::gammainv($x, $y / 2, 2.0);
			case 'tpdf':
				if (!($y > 0) || is_nan($x)) { return NAN; }
				return is_finite($x) ? exp(self::ltpdf($x, $y)) : 0.0;
			case 'tcdf': return self::tcdf($x, $y);
			case 'tinv': return self::tinv($x, $y);
			case 'fpdf': return self::fpdf($x, $y, $z);
			case 'fcdf': return self::fcdf($x, $y, $z);
			case 'finv':
				if (!($y > 0) || !($z > 0) || !($x >= 0 && $x <= 1)) { return NAN; }
				if ($x == 0) { return 0.0; }
				if ($x == 1) { return INF; }
				$xy = self::betaQuantile($x, 1 - $x, $y / 2, $z / 2);
				return ($z / $y) * fdiv($xy[0], $xy[1]);
			case 'binompdf':
				[$k, $n, $p] = [$x, $y, $z];
				if (!self::nonNegInt($n) || !self::isInt($k) || !($p >= 0 && $p <= 1)) { return NAN; }
				if ($k < 0 || $k > $n) { return 0.0; }
				if ($p == 0) { return $k == 0 ? 1.0 : 0.0; }
				if ($p == 1) { return $k == $n ? 1.0 : 0.0; }
				return exp(self::lbinomRaw($k, $n - $k, $p, 1 - $p));
			case 'binomcdf':
				[$k, $n, $p] = [$x, $y, $z];
				if (!self::nonNegInt($n) || !($p >= 0 && $p <= 1) || is_nan($k)) { return NAN; }
				$k = floor($k);
				if ($k < 0) { return 0.0; }
				if ($k >= $n) { return 1.0; }
				if ($p == 0) { return 1.0; }
				if ($p == 1) { return 0.0; }
				return self::betaPair(1 - $p, $p, $n - $k, $k + 1)[0];
			case 'poisspdf':
				[$k, $l] = [$x, $y];
				if (!self::isInt($k) || !($l >= 0)) { return NAN; }
				if ($k < 0) { return 0.0; }
				if ($l == 0) { return $k == 0 ? 1.0 : 0.0; }
				return exp(self::lpoisRaw($k, $l));
			case 'poisscdf':
				[$k, $l] = [$x, $y];
				if (is_nan($k) || !($l >= 0)) { return NAN; }
				$k = floor($k);
				if ($k < 0) { return 0.0; }
				if ($l == 0) { return 1.0; }
				return self::gammaPQ($k + 1, $l)[1];
			case 'exppdf': return $y > 0 ? ($x < 0 ? 0.0 : $y * exp(-$y * $x)) : NAN;
			case 'expcdf': return $y > 0 ? ($x < 0 ? 0.0 : -expm1(-$y * $x)) : NAN;
			case 'expinv': return ($y > 0 && $x >= 0 && $x < 1) ? -log1p(-$x) / $y : NAN;
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
				if ($x == 0 && ($a[2] ?? 1.0) > 0) { return 0.0; }
				$zz = MathLib::norminv($x, $a[1] ?? 0.0, $a[2] ?? 1.0);
				return is_nan($zz) ? NAN : exp($zz);
			case 'weibpdf': return ($y > 0 && $z > 0) ? ($x < 0 ? 0.0 : ($y / $z) * (($x / $z) ** ($y - 1)) * exp(-(($x / $z) ** $y))) : NAN;
			case 'weibcdf': return ($y > 0 && $z > 0) ? ($x < 0 ? 0.0 : -expm1(-(($x / $z) ** $y))) : NAN;
			case 'weibinv': return ($y > 0 && $z > 0 && $x >= 0 && $x < 1) ? $z * ((-log1p(-$x)) ** (1 / $y)) : NAN;
			case 'geompdf':
				if (!(self::isInt($x) && $y > 0 && $y <= 1)) { return NAN; }
				if ($x < 1) { return 0.0; }
				if ($y == 1) { return $x == 1 ? 1.0 : 0.0; }
				return exp(($x - 1) * log1p(-$y)) * $y;
			case 'geomcdf':
				if (!(!is_nan($x) && $y > 0 && $y <= 1)) { return NAN; }
				if ($x < 1) { return 0.0; }
				return $y == 1 ? 1.0 : -expm1(floor($x) * log1p(-$y));
			case 'hygepdf':
				// through three binomial terms with the same p (as R's dhyper)
				[$k, $N, $K, $n] = [$x, $y, $z, $a[3] ?? NAN];
				foreach ([$k, $N, $K, $n] as $v) { if (!self::nonNegInt($v)) { return NAN; } }
				if ($K > $N || $n > $N) { return NAN; }
				if ($k > $K || $k > $n || $n - $k > $N - $K) { return 0.0; }
				$p = $n / $N;
				$q = ($N - $n) / $N;
				return exp(self::lbinomRaw($k, $K - $k, $p, $q) + self::lbinomRaw($n - $k, $N - $K - $n + $k, $p, $q) - self::lbinomRaw($n, $N - $n, $p, $q));
			case 'nbinpdf':
				[$k, $r, $p] = [$x, $y, $z];
				if (self::nonNegInt($k) && $r > 0 && $p == 1) { return $k == 0 ? 1.0 : 0.0; }
				return (self::nonNegInt($k) && $r > 0 && $p > 0 && $p <= 1) ? $r / ($r + $k) * exp(self::lbinomRaw($r, $k, $p, 1 - $p)) : NAN;
			case 'erfinv': return self::erfinv($x);
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
		if ($x < 0) { return self::digamma(1 - $x) - fdiv(M_PI, tan(M_PI * $x)); }
		$r = 0.0;
		while ($x < 6) { $r -= fdiv(1, $x); $x += 1; }
		$f = 1 / ($x * $x);
		return $r + log($x) - 0.5 / $x - $f * (1 / 12 - $f * (1 / 120 - $f * (1 / 252 - $f * (1 / 240 - $f / 132))));
	}

	// ---- the pieces every distribution is built from (the same algorithms as js/formulabase.js) ----

	private const IT_MAX = 100000; // far more than any convergent case needs (Temme takes the large-a centre)

	/** the remainder of Stirling's formula, ln Γ(x) − (x − ½) ln x + x − ln √(2π) (Loader's stirlerr), x > 0 */
	public static function lgcor(float $x): float {
		return $x >= 10 ? MathLib::lgcorBig($x) : MathLib::lgamma($x) - ($x - 0.5) * log($x) + $x - MathLib::LN_SQRT_2PI;
	}

	/** ln B(a, b), a, b > 0, without the cancellation of three log-gammas when one is large */
	public static function lbeta(float $a, float $b): float {
		$p = min($a, $b);
		$q = max($a, $b);
		$r = 1 / (1 + $q / $p); // p/(p + q) without overflow
		if ($p >= 10) {
			return -0.5 * log($q) + MathLib::LN_SQRT_2PI + MathLib::lgcorBig($p) + MathLib::lgcorBig($q) - MathLib::lgcorBig($p + $q) + ($p - 0.5) * log($r) + $q * log1p(-$r);
		}
		if ($q >= 10) {
			return MathLib::lgamma($p) + MathLib::lgcorBig($q) - MathLib::lgcorBig($p + $q) + $p - $p * (log($q) + log1p($p / $q)) + ($q - 0.5) * log1p(-$r);
		}
		return MathLib::lgamma($p) + MathLib::lgamma($q) - MathLib::lgamma($p + $q);
	}

	/** x ln(x/M) + M − x, without cancellation when x ≈ M (Loader 2000) */
	private static function bd0(float $x, float $M): float {
		if ($x == 0) { return $M; }
		$hs = 0.5 * $x + 0.5 * $M; // (x + M)/2 without overflow
		if (abs($x - $M) < 0.2 * $hs) {
			$v = (0.5 * $x - 0.5 * $M) / $hs;
			$s = ($x - $M) * $v;
			$ej = $x * $v * 2;
			$v *= $v;
			for ($j = 1; $j < 1000; $j++) {
				$ej *= $v;
				$s1 = $s + $ej / (2 * $j + 1);
				if ($s1 == $s) { return $s1; }
				$s = $s1;
			}
			return $s;
		}
		$r = fdiv($x, $M);
		return $x * ($r > 0 && $r < INF ? log($r) : log($x) - log($M)) + $M - $x;
	}

	/** a·b − p exactly, p being the rounded product a·b (Dekker); 0 where the parts would overflow */
	private static function prodErr(float $a, float $b, float $p): float {
		if (!(abs($p) < 1e290 && abs($p) > 1e-290 && abs($a) < 1e290 && abs($b) < 1e290)) { return 0.0; }
		$t = 134217729 * $a;
		$ah = $t - ($t - $a);
		$al = $a - $ah;
		$t = 134217729 * $b;
		$bh = $t - ($t - $b);
		$bl = $b - $bh;
		return (($ah * $bh - $p) + $ah * $bl + $al * $bh) + $al * $bl;
	}

	/** the change of bd0(x, M) when M moves by e (first order) */
	private static function roundFix(float $e, float $x, float $M): float {
		return $e == 0 ? 0.0 : $e * (1 - fdiv($x, $M));
	}

	/**
	 * ln( Γ(n+1)/(Γ(x+1)Γ(y+1)) p^x q^y ), n = x + y, x, y ≥ 0 (real): Loader's saddle-point form.
	 * q is 1 − p; the smaller of the two is taken as exact and the rounding of the other is allowed for.
	 */
	private static function lbinomRaw(float $x, float $y, float $p, float $q): float {
		if ($p == 0) { return $x == 0 ? 0.0 : -INF; }
		if ($q == 0) { return $y == 0 ? 0.0 : -INF; }
		$n = $x + $y;
		if ($x == 0) { return $n == 0 ? 0.0 : $n * ($p < 0.5 ? log1p(-$p) : log($q)); }
		if ($y == 0) { return $n * ($q < 0.5 ? log1p(-$q) : log($p)); }
		$np = $n * $p;
		$nq = $n * $q;
		// the rounding of n·p and n·q, taken back to first order (Dekker's exact product)
		$lc = self::lgcor($n) - self::lgcor($x) - self::lgcor($y) - self::bd0($x, $np) - self::bd0($y, $nq)
			- self::roundFix(self::prodErr($n, $p, $np), $x, $np) - self::roundFix(self::prodErr($n, $q, $nq), $y, $nq);
		$corr = $p <= $q ? ($p - (1 - $q)) * ($x - $y * $p / $q) : ($q - (1 - $p)) * ($y - $x * $q / $p);
		return $lc + $corr - 0.5 * (MathLib::LN_2PI + log($x) + log($y / $n));
	}

	/** ln( λ^x e^−λ / Γ(x+1) ), x ≥ 0 (real) */
	private static function lpoisRaw(float $x, float $lam): float {
		if ($lam == 0) { return $x == 0 ? 0.0 : -INF; }
		if (!is_finite($lam)) { return -INF; }
		if ($x == 0) { return -$lam; }
		return -self::lgcor($x) - self::bd0($x, $lam) - 0.5 * (MathLib::LN_2PI + log($x));
	}

	/** Taylor coefficients in η of Temme's c_0 … c_3 (DLMF 8.12.8–11; DiDonato & Morris's d_kn) */
	private const TEMME = [
		[-0.3333333333333333, 0.08333333333333333, -0.014814814814814815, 0.0011574074074074073, 0.0003527336860670194, -0.0001787551440329218, 3.919263178522438e-05, -2.185448510679992e-06, -1.85406221071516e-06, 8.296711340953087e-07, -1.7665952736826078e-07, 6.707853543401498e-09, 1.0261809784240309e-08, -4.382036018453353e-09, 9.14769958223679e-10, -2.5514193994946248e-11],
		[-0.001851851851851852, -0.003472222222222222, 0.0026455026455026454, -0.0009902263374485596, 0.00020576131687242798, -4.018775720164609e-07, -1.8098550334489977e-05, 7.64916091608111e-06, -1.6120900894563446e-06, 4.647127802807434e-09, 1.378633446915721e-07, -5.752545603517705e-08, 1.1951628599778148e-08, -1.7543241719747647e-11],
		[0.004133597883597883, -0.0026813271604938273, 0.0007716049382716049, 2.0093878600823047e-06, -0.0001073665322636516, 5.2923448829120125e-05, -1.2760635188618728e-05, 3.423578734096138e-08, 1.3721957309062934e-06, -6.298992138380055e-07, 1.4280614206064242e-07, -2.0477098421990866e-10],
		[0.0006494341563786008, 0.00022947209362139917, -0.0004691894943952557, 0.00026772063206283885, -7.561801671883977e-05, -2.396505113867297e-07, 1.1082654115347302e-05, -5.6749528269915965e-06, 1.4230900732435883e-06, -2.7861080291528143e-11]];

	/**
	 * [P, Q] for large a and x within 10 % of a: Temme's uniform asymptotic expansion
	 * Q = ½ erfc(η√(a/2)) + e^(−aη²/2)/√(2πa) Σ c_k(η) a^−k, η²/2 = μ − ln(1 + μ), μ = x/a − 1
	 * @return array{float, float}
	 */
	private static function gammaTemme(float $a, float $x): array {
		$mu = ($x - $a) / $a;
		$h = 0.0;
		$pw = $mu * $mu;
		for ($n = 2; $n < 60; $n++) {
			$t = $pw / $n;
			$h += $n % 2 ? -$t : $t;
			$pw *= $mu;
			if (abs($pw) < 1e-18 * $h) { break; }
		}
		$eta = $mu < 0 ? -sqrt(2 * $h) : sqrt(2 * $h);
		$R = 0.0;
		$ak = 1.0;
		foreach (self::TEMME as $c) {
			$v = 0.0;
			for ($j = count($c) - 1; $j >= 0; $j--) { $v = $v * $eta + $c[$j]; }
			$R += $v * $ak;
			$ak /= $a;
		}
		$R *= exp(-$a * $h) / sqrt(2 * M_PI * $a);
		$z = $eta * sqrt($a / 2);
		return [0.5 * MathLib::erfc(-$z) - $R, 0.5 * MathLib::erfc($z) + $R];
	}

	/**
	 * Regularised incomplete gamma: [P(a, x), Q(a, x)], each computed directly where it is the small one.
	 * Small a: P = x^a/Γ(a+1)·(1 + a Σ (−x)^n/((a+n) n!)), Q from it with expm1. Otherwise the series for P
	 * (x < a + 1) or the continued fraction for Q (modified Lentz), with the factor x^a e^−x/Γ(a+1)
	 * from Loader's saddle-point form (no cancellation between ln Γ(a) and a ln x for large a).
	 * @return array{float, float}
	 */
	private static function gammaPQ(float $a, float $x): array {
		if (is_nan($x) || is_nan($a)) { return [NAN, NAN]; }
		if ($x == 0) { return [0.0, 1.0]; }
		if ($x == INF) { return [1.0, 0.0]; }
		if ($a > 1e5 && abs($x - $a) < 0.1 * $a) { return self::gammaTemme($a, $x); }
		if ($a < 1 && $x < 1.5) {
			$T = 0.0;
			$term = 1.0;
			for ($n = 1; $n < 200; $n++) {
				$term *= -$x / $n;
				$add = $term / ($a + $n);
				$T += $add;
				if (abs($add) <= 1e-17 * abs($T)) { break; }
			}
			$lxa = $a * log($x) - MathLib::lgamma1p($a);
			$e = exp($lxa);
			return [$e * (1 + $a * $T), -expm1($lxa) - $e * $a * $T];
		}
		$lpre = self::lpoisRaw($a, $x);
		if ($x < $a + 1) {
			$sum = 1.0;
			$del = 1.0;
			$ap = $a;
			for ($n = 1; $n < self::IT_MAX; $n++) {
				$ap += 1;
				$del *= $x / $ap;
				$sum += $del;
				if ($del < 1e-17 * $sum) { break; }
				if (($n & 1023) === 0) { FormulaCompiler::tick(1024); }
			}
			$P = exp($lpre) * $sum;
			return [$P, 1 - $P];
		}
		$b = $x + 1 - $a;
		$c = 1e300;
		$d = 1 / $b;
		$h = $d;
		for ($i = 1; $i < self::IT_MAX; $i++) {
			$an = -$i * ($i - $a);
			$b += 2;
			$d = $an * $d + $b;
			if (abs($d) < 1e-300) { $d = 1e-300; }
			$c = $b + $an / $c;
			if (abs($c) < 1e-300) { $c = 1e-300; }
			$d = 1 / $d;
			$del = $d * $c;
			$h *= $del;
			if (abs($del - 1) < 3e-16) { break; }
			if (($i & 1023) === 0) { FormulaCompiler::tick(1024); }
		}
		$Q = exp($lpre + log($a)) * $h;
		return [1 - $Q, $Q];
	}

	public static function gammainc(float $a, float $x): float {
		if (!($a > 0) || !($x >= 0)) { return NAN; }
		return self::gammaPQ($a, $x)[0];
	}

	public static function gammaincc(float $a, float $x): float {
		if (!($a > 0) || !($x >= 0)) { return NAN; }
		return self::gammaPQ($a, $x)[1];
	}

	/**
	 * I_x(a, b) / (x^a y^b / B(a, b)) by the continued fraction of DiDonato & Morris (TOMS 708, BFRAC),
	 * written with λ = a − (a + b)x and y = 1 − x so that no step cancels; for x below the mean (λ ≥ 0).
	 */
	private static function bfrac(float $a, float $b, float $x, float $y, float $lam): float {
		$c = 1 + $lam;
		$c0 = $b / $a;
		$c1 = 1 + 1 / $a;
		$yp1 = $y + 1;
		$n = 0.0;
		$p = 1.0;
		$s = $a + 1;
		$an = 0.0;
		$bn = 1.0;
		$anp1 = 1.0;
		$bnp1 = $c / $c1;
		$r = $c1 / $c;
		for ($it = 1; $it < self::IT_MAX; $it++) {
			$n += 1;
			$t = $n / $a;
			$w = $n * ($b - $n) * $x;
			$e = $a / $s;
			$alpha = $p * ($p + $c0) * $e * $e * ($w * $x);
			$e = (1 + $t) / ($c1 + $t + $t);
			$beta = $n + $w / $s + $e * ($c + $n * $yp1);
			$p = 1 + $t;
			$s += 2;
			$t = $alpha * $an + $beta * $anp1;
			$an = $anp1;
			$anp1 = $t;
			$t = $alpha * $bn + $beta * $bnp1;
			$bn = $bnp1;
			$bnp1 = $t;
			$r0 = $r;
			$r = fdiv($anp1, $bnp1);
			if (!(abs($r - $r0) > 4e-16 * $r)) { break; }
			$an = fdiv($an, $bnp1);
			$bn = fdiv($bn, $bnp1);
			$anp1 = $r;
			$bnp1 = 1.0;
			if (($it & 1023) === 0) { FormulaCompiler::tick(1024); }
		}
		return $r;
	}

	/**
	 * [I_x(a, b), 1 − I_x(a, b)] with y = 1 − x passed in (the smaller of x, y exact); the factor
	 * x^a y^b / B(a, b) comes from the saddle-point form, so large a and b lose nothing.
	 * @return array{float, float}
	 */
	private static function betaPair(float $x, float $y, float $a, float $b): array {
		if (is_nan($x) || is_nan($y) || is_nan($a) || is_nan($b)) { return [NAN, NAN]; }
		if ($x <= 0) { return [0.0, 1.0]; }
		if ($y <= 0) { return [1.0, 0.0]; }
		// a shape below 1e-300: all the mass sits at that end, to double precision
		if ($a < 1e-300 || $b < 1e-300) { return [$b / ($a + $b), $a / ($a + $b)]; }
		$lam = $a > $b ? ($a + $b) * $y - $b : $a - ($a + $b) * $x;
		$swap = $lam < 0;
		if ($swap) {
			[$a, $b] = [$b, $a];
			[$x, $y] = [$y, $x];
			$lam = -$lam;
		}
		$w = exp(self::lbinomRaw($a, $b, $x, $y) + log($a * ($b / ($a + $b)))) * self::bfrac($a, $b, $x, $y, $lam);
		return $swap ? [1 - $w, $w] : [$w, 1 - $w];
	}

	public static function betainc(float $x, float $a, float $b): float {
		if (!($a > 0) || !($b > 0) || !($x >= 0 && $x <= 1)) { return NAN; }
		if ($x == 0 || $x == 1) { return $x; }
		return self::betaPair($x, 1 - $x, $a, $b)[0];
	}

	/**
	 * The root of g on (lo, hi), g increasing; $f(x) gives [g(x), g′(x)]. Newton steps, a Newton step in
	 * ln x when the plain one leaves the bracket, and bisection (geometric across orders of magnitude) last.
	 */
	private static function newtonRoot(callable $f, float $x, float $lo, float $hi): float {
		$near = 0; // steps already down at the noise of g: a few of those and x is as good as it gets
		for ($i = 0; $i < 400; $i++) {
			FormulaCompiler::tick();
			[$g, $dg] = $f($x);
			if ($g == 0) { return $x; }
			if ($g < 0 || is_nan($g)) { $lo = $x; } else { $hi = $x; }
			if (!($hi > $lo)) { return $x; }
			$xn = $x - fdiv($g, $dg);
			if (abs($xn - $x) <= 1e-14 * abs($x) || (abs($xn - $x) <= 1e-11 * abs($x) && ++$near >= 4)) { return $xn > $lo && $xn < $hi ? $xn : $x; }
			if (!($xn > $lo && $xn < $hi)) {
				$xn = $x * exp(-fdiv($g, $x * $dg));
				if (!($xn > $lo && $xn < $hi)) {
					if ($lo > 0 && $hi == INF) {
						$xn = 8 * $lo;
					} elseif ($lo <= 0 && $hi < INF) {
						$xn = $lo < 0 ? 0.5 * ($lo + $hi) : $hi / 8;
					} else {
						$xn = $lo > 0 && $hi > 4 * $lo ? sqrt($lo) * sqrt($hi) : 0.5 * ($lo + $hi);
					}
				}
			}
			if ($hi - $lo <= 4.5e-16 * abs($xn)) { return $xn; }
			$x = $xn;
		}
		return $x;
	}

	/** ln of the gamma density x^(k−1) e^−x / Γ(k) (scale 1), x > 0 */
	private static function lgammaPdf(float $x, float $k): float {
		return $k < 1 ? self::lpoisRaw($k, $x) + log($k / $x) : self::lpoisRaw($k - 1, $x);
	}

	/** ln of the beta density, 0 < x < 1 (y = 1 − x) */
	private static function lbetaPdf(float $x, float $y, float $a, float $b): float {
		if ($a <= 2 || $b <= 2) {
			return ($a - 1) * log($x) + ($b - 1) * ($y < 0.5 ? log($y) : log1p(-$x)) - self::lbeta($a, $b);
		}
		return log($a + $b - 1) + self::lbinomRaw($a - 1, $b - 1, $x, $y);
	}

	private static function gammacdf(float $x, float $k, float $th): float {
		if (!($k > 0) || !($th > 0)) { return NAN; }
		return $x <= 0 ? 0.0 : self::gammaPQ($k, $x / $th)[0];
	}

	private static function gammapdf(float $x, float $k, float $th): float {
		if (!($k > 0) || !($th > 0)) { return NAN; }
		if ($x < 0) { return 0.0; }
		if ($x == 0) { return $k == 1 ? 1 / $th : ($k < 1 ? INF : 0.0); }
		$lam = $x / $th;
		return $k < 1 ? exp(self::lpoisRaw($k, $lam)) * $k / $x : exp(self::lpoisRaw($k - 1, $lam)) / $th;
	}

	/** the quantile of the gamma distribution (scale 1): Newton on ln P (or ln Q in the upper half) */
	private static function gammaQuantile(float $p, float $k): float {
		$lower = $p <= 0.5;
		$pp = $lower ? $p : 1 - $p;
		$z = -MathLib::norminv($pp, 0.0, 1.0);
		$c = 1 - 1 / (9 * $k) + ($lower ? -$z : $z) / (3 * sqrt($k));
		$x = $k * $c * $c * $c; // Wilson–Hilferty
		if ($lower) {
			// P(x) ≤ x^k/Γ(k+1): a lower bound
			$pl = exp((log($pp) + ($k <= 1 ? MathLib::lgamma1p($k) : MathLib::lgamma($k + 1))) / $k);
			if ($pl < 1e-300) { return $pl; } // P(x) = x^k/Γ(k+1)·(1 + O(x)) there
			if ($pl < INF && !($x > $pl)) { $x = $pl; }
		} elseif (!($x > 0)) {
			$x = max(-log($pp) + ($k - 1) * log(max(1.0, -log($pp))) - MathLib::lgamma($k), 1e-3);
		}
		$lpp = log($pp);
		return self::newtonRoot(static function (float $t) use ($k, $lower, $lpp): array {
			$pq = self::gammaPQ($k, $t);
			$v = $lower ? $pq[0] : $pq[1];
			$lf = self::lgammaPdf($t, $k);
			return [$lower ? log($v) - $lpp : $lpp - log($v), exp($lf - log($v))];
		}, $x, 0.0, INF);
	}

	private static function gammainv(float $p, float $k, float $th): float {
		if (!($k > 0) || !($th > 0) || !($p >= 0 && $p <= 1)) { return NAN; }
		if ($p == 0) { return 0.0; }
		if ($p == 1) { return INF; }
		return $th * self::gammaQuantile($p, $k);
	}

	private static function betapdf(float $x, float $a, float $b): float {
		if (!($a > 0) || !($b > 0)) { return NAN; }
		if ($x < 0 || $x > 1) { return 0.0; }
		// the ends: x^(a−1)(1−x)^(b−1) is 0·∞ there; the density's limit is B(a,b)^−1 times the other factor
		if ($x == 0) { return $a < 1 ? INF : ($a == 1 ? $b : 0.0); }
		if ($x == 1) { return $b < 1 ? INF : ($b == 1 ? $a : 0.0); }
		return exp(self::lbetaPdf($x, 1 - $x, $a, $b));
	}

	private static function betacdf(float $x, float $a, float $b): float {
		if (!($a > 0) || !($b > 0)) { return NAN; }
		return $x <= 0 ? 0.0 : ($x >= 1 ? 1.0 : self::betaPair($x, 1 - $x, $a, $b)[0]);
	}

	/**
	 * The quantile of the beta distribution as [x, 1 − x], the smaller of the two solved for directly.
	 * @return array{float, float}
	 */
	private static function betaQuantile(float $p, float $q, float $a, float $b): array {
		if ($p <= 0) { return [0.0, 1.0]; }
		if ($q <= 0) { return [1.0, 0.0]; }
		// which side of ½ the root lies on: solve for the smaller of x and 1 − x
		$mid = self::betaPair(0.5, 0.5, $a, $b);
		if (is_nan($mid[0])) { return [NAN, NAN]; }
		$swap = $p > $mid[0];
		$A = $swap ? $b : $a;
		$Bp = $swap ? $a : $b;
		$P = $swap ? $q : $p;
		$Q = $swap ? $p : $q;
		// AS 109's starting value for I_x(A, B) = P
		$lowT = $P <= 0.5;
		$tp = $lowT ? $P : $Q;
		$aa = $lowT ? $A : $Bp;
		$bb = $lowT ? $Bp : $A;
		$y = -MathLib::norminv($tp, 0.0, 1.0);
		$lb = self::lbeta($aa, $bb);
		if ($aa > 1 && $bb > 1) {
			$r = ($y * $y - 3) / 6;
			$s = 1 / (2 * $aa - 1);
			$t = 1 / (2 * $bb - 1);
			$h = 2 / ($s + $t);
			$w = $y * sqrt($h + $r) / $h - ($t - $s) * ($r + 5 / 6 - 2 / (3 * $h));
			$x0 = $aa / ($aa + $bb * exp(2 * $w));
		} else {
			$r = 2 * $bb;
			$t0 = 1 / (9 * $bb);
			$t = $r * ((1 - $t0 + $y * sqrt($t0)) ** 3);
			if ($t <= 0) {
				$x0 = 1 - exp((log1p(-$tp) + log($bb) + $lb) / $bb);
			} else {
				$t2 = (4 * $aa + $r - 2) / $t;
				$x0 = $t2 <= 1 ? exp((log($tp * $aa) + $lb) / $aa) : 1 - 2 / ($t2 + 1);
			}
		}
		if (!$lowT) { $x0 = 1 - $x0; }
		$lowR = $P <= $Q;
		$lr = log($lowR ? $P : $Q);
		// I_x(A, B) = x^A/(A B(A, B))·(1 + O(x)): far below the smallest normal double that is the answer
		$xpl = exp((log($P) + log($A) + self::lbeta($A, $Bp)) / $A);
		if ($lowR && $xpl < 1e-300) { return $swap ? [1 - $xpl, $xpl] : [$xpl, 1 - $xpl]; }
		if (!($x0 > 0 && $x0 < 0.5)) { $x0 = min(0.25, max($xpl, 1e-300)); }
		$x = self::newtonRoot(static function (float $t) use ($A, $Bp, $lowR, $lr): array {
			$pr = self::betaPair($t, 1 - $t, $A, $Bp);
			$v = $lowR ? $pr[0] : $pr[1];
			$lf = self::lbetaPdf($t, 1 - $t, $A, $Bp);
			return [$lowR ? log($v) - $lr : $lr - log($v), exp($lf - log($v))];
		}, $x0, 0.0, 0.5 + 1e-9);
		return $swap ? [1 - $x, $x] : [$x, 1 - $x];
	}

	/** ln of Student's t density (Loader's form, as R's dt) */
	private static function ltpdf(float $x, float $v): float {
		$t = -self::bd0($v / 2, ($v + 1) / 2) + self::lgcor(($v + 1) / 2) - self::lgcor($v / 2);
		$x2n = $x * $x / $v;
		if (!($x2n <= 1 / 2.220446049250313e-16)) {
			$lx2n = log(abs($x)) - log($v) / 2;
			$u = $v * $lx2n;
		} elseif ($x2n > 0.2) {
			$lx2n = log(1 + $x2n) / 2;
			$u = $v * $lx2n;
		} else {
			$lx2n = log1p($x2n) / 2;
			$u = -self::bd0($v / 2, ($v + $x * $x) / 2) + $x * $x / 2;
		}
		return $t - $u - MathLib::LN_SQRT_2PI - $lx2n;
	}

	/**
	 * [P(T ≤ −|x|), P(|T| ≤ |x|)]: the one-sided tail and the central part, each direct
	 * @return array{float, float}
	 */
	private static function tParts(float $x, float $v): array {
		$t2 = $x * $x;
		if ($t2 < $v) {
			$xc = $t2 / ($v + $t2);
			$yt = 1 - $xc;
		} else {
			$yt = $t2 == INF ? $v / $x / $x : $v / ($v + $t2);
			$xc = 1 - $yt;
		}
		$pr = self::betaPair($xc, $yt, 0.5, $v / 2);
		return [0.5 * $pr[1], $pr[0]];
	}

	/** ln P(T ≤ −|x|); far out, where ν/x² is below 1e-280, I_y(ν/2, ½) = y^(ν/2)/((ν/2) B(ν/2, ½)) to double precision */
	private static function tLogTail(float $x, float $v): float {
		$ly = log($v) - 2 * log(abs($x));
		if ($ly < -644) { return $v / 2 * $ly - log($v / 2) - self::lbeta($v / 2, 0.5) - M_LN2; }
		return log(self::tParts($x, $v)[0]);
	}

	private static function tcdf(float $x, float $v): float {
		if (!($v > 0) || is_nan($x)) { return NAN; }
		if ($x == INF) { return 1.0; }
		if ($x == -INF) { return 0.0; }
		if ($v > 1e20) { return 0.5 * MathLib::erfc(-$x / M_SQRT2); } // the normal distribution to double precision
		$pt = self::tParts($x, $v);
		return $x > 0 ? ($pt[0] < 0.25 ? 1 - $pt[0] : 0.5 + 0.5 * $pt[1]) : $pt[0];
	}

	private static function tinv(float $p, float $v): float {
		if (!($v > 0) || !($p > 0 && $p < 1)) { return NAN; }
		if ($p == 0.5) { return 0.0; }
		if ($v > 1e20) { return MathLib::norminv($p, 0.0, 1.0); }
		$tail = $p < 0.5 ? $p : 1 - $p;
		$sign = $p < 0.5 ? -1.0 : 1.0;
		$useTail = $tail <= 0.25;
		$target = $useTail ? $tail : 0.5 - $tail; // 0.5 − tail is exact here
		$lt = log($target);
		// start: Cornish–Fisher from the normal quantile, capped by the power-law tail (an upper bound)
		$z = -MathLib::norminv($tail, 0.0, 1.0);
		$z3 = $z * $z * $z;
		$t0 = $z + fdiv($z3 + $z, 4 * $v) + fdiv(5 * $z3 * $z * $z + 16 * $z3 + 3 * $z, 96 * $v * $v);
		$tpl = exp((($v - 1) / 2 * log($v) - log($tail) - self::lbeta($v / 2, 0.5)) / $v);
		if (!($t0 > 0) || $tpl < $t0) { $t0 = $tpl; }
		if ($useTail && !(self::tLogTail(PHP_FLOAT_MAX, $v) < $lt)) { return $sign * INF; }
		if (!($t0 < PHP_FLOAT_MAX)) { $t0 = PHP_FLOAT_MAX; }
		$t = self::newtonRoot(static function (float $u) use ($v, $useTail, $lt): array {
			$lf = self::ltpdf($u, $v);
			if ($useTail) {
				$l = self::tLogTail($u, $v);
				return [$lt - $l, exp($lf - $l)];
			}
			$c = 0.5 * self::tParts($u, $v)[1];
			return [log($c) - $lt, fdiv(exp($lf), $c)];
		}, $t0, 0.0, INF);
		return $sign * $t;
	}

	/** F density (as R's df, through the binomial saddle-point form) */
	private static function fpdf(float $x, float $m, float $n): float {
		if (!($m > 0) || !($n > 0)) { return NAN; }
		if ($x < 0) { return 0.0; }
		if ($x == 0) { return $m == 2 ? 1.0 : ($m < 2 ? INF : 0.0); }
		$xm = $x * $m;
		if (!is_finite($xm)) { return 0.0; }
		if ($xm < $n) {
			$p = $xm / ($n + $xm);
			$q = 1 - $p;
		} else {
			$q = $n / ($n + $xm);
			$p = 1 - $q;
		}
		if ($m >= 2) { return $m * $q / 2 * exp(self::lbinomRaw(($m - 2) / 2, $n / 2, $p, $q)); }
		return fdiv($m * $m * $q, 2 * $p * ($m + $n)) * exp(self::lbinomRaw($m / 2, $n / 2, $p, $q));
	}

	private static function fcdf(float $x, float $d1, float $d2): float {
		if (!($d1 > 0) || !($d2 > 0) || is_nan($x)) { return NAN; }
		if ($x <= 0) { return 0.0; }
		// a degree of freedom beyond 1e20 is infinite to double precision (as R's pf)
		if ($d1 > 1e20 || $d2 > 1e20) {
			if ($d1 > 1e20 && $d2 > 1e20) { return $x < 1 ? 0.0 : 1.0; }
			return $d2 > 1e20 ? self::gammaPQ($d1 / 2, $d1 * $x / 2)[0] : self::gammaPQ($d2 / 2, $d2 / $x / 2)[1];
		}
		$u = $d1 * $x;
		if (!is_finite($u)) { return 1.0; }
		if ($u < $d2) {
			$px = $u / ($d2 + $u);
			$qx = 1 - $px;
		} else {
			$qx = $d2 / ($d2 + $u);
			$px = 1 - $qx;
		}
		return self::betaPair($px, $qx, $d1 / 2, $d2 / 2)[0];
	}

	/** erf⁻¹: from the normal quantile, then Newton steps on erf (or on erfc beyond ½, where 1 − y is exact) */
	private static function erfinv(float $y): float {
		if (!($y > -1 && $y < 1)) { return $y == 1 ? INF : ($y == -1 ? -INF : NAN); }
		if ($y == 0) { return $y; }
		$ay = abs($y);
		$z = $ay < 1e-8 ? $ay * 0.886226925452758 : -MathLib::norminv((1 - $ay) / 2, 0.0, 1.0) / M_SQRT2;
		for ($i = 0; $i < 2; $i++) {
			$e = $ay <= 0.5 ? MathLib::erf($z) - $ay : (1 - $ay) - MathLib::erfc($z);
			$z -= $e / (1.1283791670955126 * exp(-$z * $z));
		}
		return $y < 0 ? -$z : $z;
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
			$d = fdiv(1, $an * $d + $b);
			$c = $b + fdiv($an, $c);
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
			$dR = fdiv($tR, $den);
			$dI = fdiv(-$tI, $den);
			$den = $cR * $cR + $cI * $cI;
			$tR = $bR + fdiv($an * $cR, $den);
			$tI = $bI - fdiv($an * $cI, $den);
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

	/** Past this order the integrals below no longer converge in the work allowed. */
	private const BESSEL_MAX_ORDER = 1000.0;

	/**
	 * Σ (±1)^k (x/2)^(2k+ν) / (k! Γ(k+ν+1)): J for $sign = −1, I for +1. Exact to rounding for small x,
	 * where the integral forms lose everything to cancellation (J_10.5(0.1) is 1.8e-21).
	 */
	private static function besselSeries(float $n, float $x, int $sign): float {
		$h = $x / 2;
		$g = MathLib::gamma($n + 1);
		$t = fdiv($h ** $n, $g);
		$sum = $t;
		for ($k = 0; $k < 400; $k++) {
			$t *= $sign * $h * $h / (($k + 1) * ($k + 1 + $n));
			$sum += $t;
			if (abs($t) <= 1e-17 * abs($sum) && $k > $x) { break; }
		}
		return $sum;
	}

	public static function besselj(float $n, float $x): float {
		if (is_nan($x) || is_nan($n)) { return NAN; }
		if (!self::isInt($n)) {
			// any real order, x > 0 (a negative x gives a complex value): the integral form of J_ν
			if (!($x > 0) && !($x == 0 && $n > 0) || abs($n) > self::BESSEL_MAX_ORDER) { return NAN; }
			if ($x == 0) { return 0.0; }
			if ($x <= 8) { return self::besselSeries($n, $x, -1); }
			$a = self::integrate(fn ($t) => cos($n * $t - $x * sin($t)), 0.0, M_PI) / M_PI;
			$tail = sin($n * M_PI) / M_PI * self::integrate(fn ($t) => exp(-$x * sinh($t) - $n * $t), 0.0, asinh(max(1, (800 + abs($n) * 20) / $x)));
			return $a - $tail;
		}
		if ($n < 0) { return (((int)$n) % 2 ? -1 : 1) * self::besselj(-$n, $x); }
		$M = max(64, (int)ceil(2 * abs($x) + 2 * $n + 64));
		// A limit on the work: besselj(0, 1e12) was 2×10¹² turns of this loop (REVIEW P1).
		if ($M > 2000000) { return NAN; }
		$s = 0.0;
		for ($k = 0; $k < $M; $k++) {
			FormulaCompiler::tick();
			$t = ($k + 0.5) * M_PI / $M;
			$s += cos($n * $t - $x * sin($t));
		}
		return $s / $M;
	}

	public static function besseli(float $n, float $x): float {
		if (is_nan($x) || is_nan($n)) { return NAN; }
		if (!self::isInt($n)) {
			if (!($x > 0) && !($x == 0 && $n > 0) || abs($n) > self::BESSEL_MAX_ORDER) { return NAN; }
			if ($x == 0) { return 0.0; }
			if ($x <= 30) { return self::besselSeries($n, $x, 1); }
			$a = self::integrate(fn ($t) => exp($x * cos($t)) * cos($n * $t), 0.0, M_PI) / M_PI;
			$tail = sin($n * M_PI) / M_PI * self::integrate(fn ($t) => exp(-$x * cosh($t) - $n * $t), 0.0, acosh(max(1, (800 + abs($n) * 20) / $x)));
			return $a - $tail;
		}
		$n = abs($n);
		$M = max(64, (int)ceil(2 * abs($x) + 2 * $n + 64));
		if ($M > 2000000) { return NAN; }
		$s = 0.0;
		for ($k = 0; $k < $M; $k++) {
			FormulaCompiler::tick();
			$t = ($k + 0.5) * M_PI / $M;
			$s += exp($x * cos($t)) * cos($n * $t);
		}
		return $s / $M;
	}

	public static function besselk(float $n, float $x): float {
		// K_ν(x) = ∫ exp(−x cosh t) cosh(νt) dt holds for every real order; K_−ν = K_ν
		if (is_nan($n) || !($x > 0) || abs($n) > self::BESSEL_MAX_ORDER) { return NAN; }
		$n = abs($n);
		$h = 0.02;
		$s = 0.5 * exp(-$x);
		for ($k = 1; $k < 100000; $k++) {
			FormulaCompiler::tick();
			$t = $k * $h;
			$v = exp(-$x * cosh($t)) * cosh($n * $t);
			$s += $v;
			if ($v < 1e-18 * $s && $x * cosh($t) > 40) { break; }
		}
		return $s * $h;
	}

	public static function bessely(float $n, float $x): float {
		if (is_nan($n) || !($x > 0) || abs($n) > self::BESSEL_MAX_ORDER) { return NAN; }
		$int = self::isInt($n);
		if ($int && $n < 0) { return (((int)$n) % 2 ? -1 : 1) * self::bessely(-$n, $x); }
		$a = self::integrate(fn ($t) => sin($x * sin($t) - $n * $t), 0.0, M_PI) / M_PI;
		// cos(νπ) is ±1 for an integer order, anything in between for the others
		$sgn = $int ? (((int)$n) % 2 ? -1.0 : 1.0) : cos($n * M_PI);
		$tail = self::integrate(fn ($t) => (exp($n * $t) + $sgn * exp(-$n * $t)) * exp(-$x * sinh($t)), 0.0, asinh(max(1, (800 + abs($n) * 20) / $x))) / M_PI;
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
		// n = 0 is the usual case: 0 × K(±1) = 0 × ∞ must not turn it into NaN
		$whole = $n == 0 ? 0.0 : 2 * $n * self::ellipk($k);
		return $whole + $sr * self::carlsonRF($cr * $cr, 1 - $k * $k * $sr * $sr, 1.0);
	}

	public static function ellipeinc(float $phi, float $k): float {
		if (is_nan($phi) || !(abs($k) <= 1)) { return NAN; }
		$n = round($phi / M_PI);
		$r = $phi - $n * M_PI;
		$s = sin($r);
		$c = cos($r);
		$q = 1 - $k * $k * $s * $s;
		return ($n == 0 ? 0.0 : 2 * $n * self::ellipe($k)) + $s * self::carlsonRF($c * $c, $q, 1.0) - $k * $k * $s * $s * $s / 3 * self::carlsonRD($c * $c, $q, 1.0);
	}

	public static function polylog(float $s, float $z): float {
		if (is_nan($s) || !($z >= -1 && $z <= 1)) { return NAN; }
		if ($z == 0) { return 0.0; }
		if ($z == 1) { return $s > 1 ? MathLib::zeta($s) : NAN; }
		if ($z == -1) { return $s == 1 ? -M_LN2 : -(1 - 2 ** (1 - $s)) * MathLib::zeta($s); }
		if ($s == 1) { return -log(1 - $z); }
		if (abs($z) > 0.5 && $s == 2 && $z > 0) {
			$w = 1 - $z;
			return M_PI * M_PI / 6 - log($z) * log($w) - self::polylog(2.0, $w);
		}
		$sum = 0.0;
		$zk = 1.0;
		for ($k = 1; $k < 100000; $k++) {
			FormulaCompiler::tick();
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
			FormulaCompiler::tick();
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
					$x3 = $x2 - fdiv($f2 * ($x2 - $x1), $d);
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
			$m = $b - fdiv($fb * ($b - $a), $fb - $fa);
			if (!($m > min($a, $b) && $m < max($a, $b)) || $i % 4 === 3) { $m = ($a + $b) / 2; }
			$fm = $f($m);
			if ($fm == 0 || abs($b - $a) < 1e-15 * max(1, abs($m))) { return $m; }
			if (($fm > 0) === ($fa > 0)) { $a = $m; $fa = $fm; } else { $b = $m; $fb = $fm; }
		}
		return ($a + $b) / 2;
	}
}
