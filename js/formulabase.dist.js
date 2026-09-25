/* FormulaBase — Nextcloud native SPA (buildless Vue 3).
 * Collections of reusable formulas; type numbers in and read the result live,
 * with a step-by-step calculation trace and a per-formula history log.
 * The math engine is a small recursive-descent parser + AST evaluator —
 * no eval / no new Function (App Store: no unsafe-eval). */
(function () {
  'use strict';
  // vue-private.js moved the runtime off window.Vue (see the note there).
  // Shadow the global for this whole IIFE — the precompiled render function
  // destructures `Vue` too, and window.Vue is intentionally not set.
  const Vue = window.__FormulaBaseVue || window.Vue;
  const { createApp } = Vue;

  const BASE = ((window.OC && OC.generateUrl) ? OC.generateUrl('/apps/formulabase') : '/apps/formulabase') + '/';
  let TOKEN = (window.OC && OC.requestToken) ? OC.requestToken : '';
  let rootProxy = null;
  // In-app language override map (fetched from /api/i18n/<lang>); null → follow Nextcloud's own locale.
  let i18nOverride = null;

  // Fold to lower case and hiragana → katakana, so emoji search matches however the
  // user types it (CLDR Japanese names use katakana: "ねこ" must find "ネコの顔").
  function kana(s) {
    return String(s).toLowerCase().replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  }
  function i18nSubst(s, vars) {
    return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
  }
  function T(text, vars) {
    if (i18nOverride) { return i18nSubst(i18nOverride[text] != null ? i18nOverride[text] : text, vars); }
    try { if (typeof window.t === 'function') { return i18nSubst(window.t('formulabase', text), vars); } } catch (e) { /* raw */ }
    return i18nSubst(text, vars);
  }

  // Re-read the freshest CSRF request token available (OC.requestToken is rotated by
  // Nextcloud; the <head data-requesttoken> attribute is the source of truth on load).
  function freshToken() {
    try { if (window.OC && OC.requestToken) return OC.requestToken; } catch (e) { /* */ }
    try { const h = document.getElementsByTagName('head')[0]; const t = h && h.getAttribute('data-requesttoken'); if (t) return t; } catch (e) { /* */ }
    try { if (window.oc_requesttoken) return window.oc_requesttoken; } catch (e) { /* */ }
    return TOKEN;
  }

  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const doFetch = (tok) => fetch(BASE + 'api/' + path, {
      headers: { 'Content-Type': 'application/json', 'requesttoken': tok },
      credentials: 'same-origin',
      ...opts,
    });
    let res = await doFetch(TOKEN);
    // A stale CSRF token makes Nextcloud reject state-changing requests (412, sometimes 403).
    // Refresh the request token and retry once so records/saves don't fail silently.
    if (method !== 'GET' && (res.status === 412 || res.status === 403)) {
      const fresh = freshToken();
      if (fresh) TOKEN = fresh;
      res = await doFetch(TOKEN);
    }
    if (res.status === 401) { if (rootProxy) rootProxy.authenticated = false; throw new Error('unauthorized'); }
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((body && body.error) || res.statusText);
    return body;
  }

  /* ---------- Safe expression engine (parser → AST → evaluator, no eval) ---------- */
  /* MATHLIB-BEGIN — number theory, combinatorics and special functions for the engine.
   * Integer functions work on exact integers (BigInt) and return an ordinary number: exact up to
   * 2^53, the nearest double beyond that (the same way a calculator shows a big factorial). A
   * non-integer where an integer is required gives NaN, which the app shows as "no result".
   * Kept in sync with lib/Service/FormulaCompiler.php (the PHP port used for exports).
   * Source of truth: /root/regibase-build/fb-mathlib.js — copied between the markers by the build. */
  const ML = (function () {
    const BIG_LIMIT = 1e15; // arguments beyond this are refused where the work would explode
    const isInt = (x) => typeof x === 'number' && Number.isFinite(x) && Number.isInteger(x);
    const B = (x) => BigInt(x);
    const N = (b) => Number(b);
    const babs = (b) => (b < 0n ? -b : b);
    function bgcd(a, b) { a = babs(a); b = babs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
    function bpowmod(base, exp, m) {
      if (m === 1n) return 0n;
      let r = 1n; base %= m; if (base < 0n) base += m;
      while (exp > 0n) { if (exp & 1n) r = (r * base) % m; exp >>= 1n; base = (base * base) % m; }
      return r;
    }
    // Deterministic Miller–Rabin for n < 3.3e24 (the first 12 prime bases).
    const MR_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
    function bIsPrime(n) {
      if (n < 2n) return false;
      for (const p of MR_BASES) { if (n === p) return true; if (n % p === 0n) return false; }
      let d = n - 1n; let s = 0;
      while ((d & 1n) === 0n) { d >>= 1n; s++; }
      outer: for (const a of MR_BASES) {
        let x = bpowmod(a, d, n);
        if (x === 1n || x === n - 1n) continue;
        for (let i = 1; i < s; i++) { x = (x * x) % n; if (x === n - 1n) continue outer; }
        return false;
      }
      return true;
    }
    function rho(n) {
      if ((n & 1n) === 0n) return 2n;
      for (let c = 1n; c < 200n; c++) {
        let x = 2n, y = 2n, d = 1n;
        const f = (v) => (v * v + c) % n;
        while (d === 1n) { x = f(x); y = f(f(y)); d = bgcd(x > y ? x - y : y - x, n); }
        if (d !== n) return d;
      }
      return n;
    }
    // Prime factorisation as a Map(prime BigInt -> exponent). n must be >= 1.
    function factor(n) {
      const out = new Map();
      const add = (p, k) => out.set(p, (out.get(p) || 0) + k);
      for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n]) {
        while (n % p === 0n) { add(p, 1); n /= p; }
      }
      const stack = n > 1n ? [n] : [];
      while (stack.length) {
        const m = stack.pop();
        if (m === 1n) continue;
        if (bIsPrime(m)) { add(m, 1); continue; }
        // small trial first (cheap), then Pollard's rho
        let found = 0n;
        for (let p = 53n; p * p <= m && p < 20000n; p += 2n) { if (m % p === 0n) { found = p; break; } }
        const d = found || rho(m);
        stack.push(d, m / d);
      }
      return out;
    }
    const posInt = (x) => isInt(x) && x >= 1 && Math.abs(x) <= 9.2e18;
    const nonNegInt = (x) => isInt(x) && x >= 0;

    function gcd() { const a = Array.from(arguments); if (!a.length || !a.every(isInt)) return NaN; return N(a.map(B).reduce(bgcd)); }
    function lcm() {
      const a = Array.from(arguments); if (!a.length || !a.every(isInt)) return NaN;
      return N(a.map(B).reduce((x, y) => (x === 0n || y === 0n ? 0n : babs(x * y) / bgcd(x, y))));
    }
    function bfact(n) { let r = 1n; for (let i = 2n; i <= n; i++) r *= i; return r; }
    function fact(n) { if (!nonNegInt(n)) return NaN; if (n > 170) return Infinity; return N(bfact(B(n))); }
    function bbinom(n, k) { if (k < 0n || k > n) return 0n; if (k > n - k) k = n - k; let r = 1n; for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
    function binom(n, k) { if (!nonNegInt(n) || !isInt(k) || n > 100000) return NaN; return N(bbinom(B(n), B(k))); }
    function perm(n, k) { if (!nonNegInt(n) || !isInt(k) || n > 100000) return NaN; if (k < 0 || k > n) return 0; let r = 1n; for (let i = 0n; i < B(k); i++) r *= B(n) - i; return N(r); }
    function isprime(n) { if (!isInt(n)) return NaN; return n >= 2 && bIsPrime(B(n)) ? 1 : 0; }
    function nextprime(n) { if (!isInt(n) || n > BIG_LIMIT) return NaN; let m = n < 2 ? 2n : B(n) + 1n; while (!bIsPrime(m)) m++; return N(m); }
    function prevprime(n) { if (!isInt(n) || n <= 2 || n > BIG_LIMIT) return NaN; let m = B(n) - 1n; while (m >= 2n && !bIsPrime(m)) m--; return m >= 2n ? N(m) : NaN; }
    // π(x): Lucy_Hedgehog's O(x^(3/4)) sieve on two flat arrays, exact for x up to 1e11.
    function primepi(x) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return NaN;
      x = Math.floor(x); if (x < 2) return 0; if (x > 1e11) return NaN;
      const r = Math.floor(Math.sqrt(x));
      const small = new Float64Array(r + 2); const large = new Float64Array(r + 2);
      for (let v = 1; v <= r; v++) { small[v] = v - 1; large[v] = Math.floor(x / v) - 1; }
      for (let p = 2; p <= r; p++) {
        if (small[p] === small[p - 1]) continue;
        const sp = small[p - 1]; const p2 = p * p;
        const lim = Math.min(r, Math.floor(x / p2));
        for (let i = 1; i <= lim; i++) {
          const d = i * p;
          large[i] -= (d <= r ? large[d] : small[Math.floor(x / d)]) - sp;
        }
        for (let v = r; v >= p2; v--) small[v] -= small[Math.floor(v / p)] - sp;
      }
      return large[1];
    }
    function nthprime(n) {
      if (!posInt(n) || n > 2e6) return NaN;
      if (n < 6) return [2, 3, 5, 7, 11][n - 1];
      const lim = Math.ceil(n * (Math.log(n) + Math.log(Math.log(n)))) + 10;
      const sieve = new Uint8Array(lim + 1); let c = 0;
      for (let i = 2; i <= lim; i++) {
        if (!sieve[i]) { c++; if (c === n) return i; for (let j = i * i; j <= lim; j += i) sieve[j] = 1; }
      }
      return NaN;
    }
    function withFactors(n, fn) { if (!posInt(n)) return NaN; return fn(factor(B(n)), B(n)); }
    const phi = (n) => withFactors(n, (f, m) => { let r = m; for (const p of f.keys()) r = (r / p) * (p - 1n); return N(r); });
    function sigma(n, k) {
      if (k === undefined) k = 1; if (!nonNegInt(k)) return NaN;
      // sigma(2, 1e10) asked for a number with ten billion digits (REVIEW P1).
      if (k > 1000) return NaN;
      return withFactors(n, (f) => {
        let r = 1n; const K = B(k);
        for (const [p, e] of f) { if (K === 0n) { r *= B(e + 1); continue; } const pk = p ** K; r *= (pk ** B(e + 1) - 1n) / (pk - 1n); }
        return N(r);
      });
    }
    const tau = (n) => sigma(n, 0);
    const mu = (n) => withFactors(n, (f) => { for (const e of f.values()) if (e > 1) return 0; return f.size % 2 ? -1 : 1; });
    const omega = (n) => withFactors(n, (f) => f.size);
    const bigomega = (n) => withFactors(n, (f) => { let s = 0; for (const e of f.values()) s += e; return s; });
    const rad = (n) => withFactors(n, (f) => { let r = 1n; for (const p of f.keys()) r *= p; return N(r); });
    const lpf = (n) => withFactors(n, (f) => (f.size ? N([...f.keys()].reduce((a, b) => (a < b ? a : b))) : NaN));
    const gpf = (n) => withFactors(n, (f) => (f.size ? N([...f.keys()].reduce((a, b) => (a > b ? a : b))) : NaN));
    // Carmichael's λ(n): the exponent of the multiplicative group mod n.
    const carmichael = (n) => withFactors(n, (f) => {
      let r = 1n;
      for (const [p, e] of f) {
        let l = (p - 1n) * p ** B(e - 1);
        if (p === 2n && e >= 3) l /= 2n;
        r = (r / bgcd(r, l)) * l;
      }
      return N(r);
    });
    function powmod(a, b, m) {
      if (!isInt(a) || !isInt(b) || !posInt(m)) return NaN;
      if (b < 0) { const inv = modinv(a, m); return isNaN(inv) ? NaN : powmod(inv, -b, m); }
      return N(bpowmod(B(a), B(b), B(m)));
    }
    function egcd(a, b) { let [or, r] = [a, b]; let [os, s] = [1n, 0n]; while (r) { const q = or / r; [or, r] = [r, or - q * r]; [os, s] = [s, os - q * s]; } return [or, os]; }
    function modinv(a, m) {
      if (!isInt(a) || !posInt(m)) return NaN;
      const M = B(m); let A = B(a) % M; if (A < 0n) A += M;
      const [g, x] = egcd(A, M); if (g !== 1n) return NaN;
      return N(((x % M) + M) % M);
    }
    // x ≡ a1 (mod m1), x ≡ a2 (mod m2), …: the least non-negative solution (moduli need not be coprime).
    function crt() {
      const v = Array.from(arguments);
      if (v.length < 2 || v.length % 2) return NaN;
      let A = null, L = null;
      for (let i = 0; i < v.length; i += 2) {
        if (!isInt(v[i]) || !posInt(v[i + 1])) return NaN;
        const a = B(v[i]), m = B(v[i + 1]);
        if (A === null) { A = ((a % m) + m) % m; L = m; continue; }
        const g = bgcd(L, m); if ((a - A) % g !== 0n) return NaN;
        const l = (L / g) * m;
        const [, p] = egcd(L / g, m / g);
        let x = A + (((a - A) / g) * p % (m / g)) * L;
        A = ((x % l) + l) % l; L = l;
      }
      return N(A);
    }
    // Fast doubling: (F(n), F(n+1)).
    function fibPair(n) { if (n === 0n) return [0n, 1n]; const [a, b] = fibPair(n >> 1n); const c = a * (2n * b - a); const d = a * a + b * b; return (n & 1n) ? [d, c + d] : [c, d]; }
    function fib(n) { if (!isInt(n) || Math.abs(n) > 1e5) return NaN; const k = B(Math.abs(n)); const f = fibPair(k)[0]; return N(n < 0 && (Math.abs(n) % 2 === 0) ? -f : f); }
    function lucas(n) { if (!nonNegInt(n) || n > 1e5) return NaN; const [a, b] = fibPair(B(n)); return N(2n * b - a); }
    function catalan(n) { if (!nonNegInt(n) || n > 50000) return NaN; return N(bbinom(2n * B(n), B(n)) / (B(n) + 1n)); }
    function bell(n) {
      if (!nonNegInt(n) || n > 1000) return NaN;
      let row = [1n];
      for (let i = 0; i < n; i++) { const next = [row[row.length - 1]]; for (const v of row) next.push(next[next.length - 1] + v); row = next; }
      return N(row[0]);
    }
    // p(n) by Euler's pentagonal-number recurrence.
    function partitions(n) {
      if (!nonNegInt(n) || n > 100000) return NaN;
      const p = [1n];
      for (let m = 1; m <= n; m++) {
        let s = 0n;
        for (let k = 1; ; k++) {
          const g1 = (k * (3 * k - 1)) / 2; if (g1 > m) break;
          const sign = k % 2 ? 1n : -1n;
          s += sign * p[m - g1];
          const g2 = (k * (3 * k + 1)) / 2; if (g2 <= m) s += sign * p[m - g2];
        }
        p.push(s);
      }
      return N(p[n]);
    }
    function stirling2(n, k) {
      if (!nonNegInt(n) || !nonNegInt(k) || n > 2000) return NaN;
      if (k > n) return 0; if (n === 0) return k === 0 ? 1 : 0;
      let s = 0n;
      for (let j = 0; j <= k; j++) { const t = bbinom(B(k), B(j)) * B(j) ** B(n); s += ((k - j) % 2 ? -t : t); }
      return N(s / bfact(B(k)));
    }
    // Unsigned Stirling numbers of the first kind (permutations of n with k cycles).
    function stirling1(n, k) {
      if (!nonNegInt(n) || !nonNegInt(k) || n > 2000) return NaN;
      let row = [1n];
      for (let i = 0; i < n; i++) { const next = new Array(i + 2).fill(0n); for (let j = 0; j <= i; j++) { next[j + 1] += row[j]; next[j] += B(i) * row[j]; } row = next; }
      return k <= n ? N(row[k]) : 0;
    }
    function derange(n) { if (!nonNegInt(n) || n > 5000) return NaN; let a = 1n, b = 0n; if (n === 0) return 1; for (let i = 2n; i <= B(n); i++) { const c = (i - 1n) * (a + b); a = b; b = c; } return N(b); }
    function digitsum(n, base) {
      if (base === undefined) base = 10; if (!isInt(n) || !isInt(base) || base < 2) return NaN;
      let m = babs(B(n)); const b = B(base); let s = 0n; while (m) { s += m % b; m /= b; } return N(s);
    }
    function digitalroot(n) { if (!nonNegInt(n)) return NaN; return n === 0 ? 0 : 1 + ((n - 1) % 9); }
    function numdigits(n, base) {
      if (base === undefined) base = 10; if (!isInt(n) || !isInt(base) || base < 2) return NaN;
      let m = babs(B(n)); if (m === 0n) return 1; let c = 0; const b = B(base); while (m) { m /= b; c++; } return c;
    }
    function reversenum(n) { if (!nonNegInt(n)) return NaN; return N(B(String(B(n)).split('').reverse().join(''))); }
    function collatz(n) { if (!posInt(n)) return NaN; let m = B(n), c = 0; while (m !== 1n && c < 1e6) { m = (m & 1n) ? 3n * m + 1n : m >> 1n; c++; } return c; }
    function jacobi(a, n) {
      if (!isInt(a) || !posInt(n) || n % 2 === 0) return NaN;
      let A = B(a), M = B(n); A %= M; if (A < 0n) A += M; let t = 1;
      while (A !== 0n) {
        while ((A & 1n) === 0n) { A >>= 1n; const r = M % 8n; if (r === 3n || r === 5n) t = -t; }
        [A, M] = [M, A]; if (A % 4n === 3n && M % 4n === 3n) t = -t; A %= M;
      }
      return M === 1n ? t : 0;
    }
    function legendre(a, p) { if (!isInt(p) || p < 3 || !bIsPrime(B(p))) return NaN; return jacobi(a, p); }
    // Multiplicative order of a mod n (NaN when gcd(a, n) > 1).
    function ord(a, n) {
      if (!isInt(a) || !posInt(n) || n < 2) return NaN;
      const A = ((B(a) % B(n)) + B(n)) % B(n); const M = B(n);
      if (bgcd(A, M) !== 1n) return NaN;
      let r = B(carmichael(n));
      for (const p of factor(r).keys()) { while (r % p === 0n && bpowmod(A, r / p, M) === 1n) r /= p; }
      return N(r);
    }
    // The least primitive root mod n (n = 2, 4, p^k or 2p^k); NaN when there is none.
    function primroot(n) {
      if (!posInt(n) || n > 1e12) return NaN;
      if (n <= 4) return n === 1 ? 0 : n - 1;
      const lam = carmichael(n); if (lam !== phi(n)) return NaN;
      const M = B(n), L = B(lam); const ps = [...factor(L).keys()];
      for (let g = 2n; g < M; g++) {
        if (bgcd(g, M) !== 1n) continue;
        if (ps.every((p) => bpowmod(g, L / p, M) !== 1n)) return N(g);
      }
      return NaN;
    }
    function isqrt(n) { if (!nonNegInt(n)) return NaN; const m = B(n); if (m < 2n) return n; let x = B(Math.floor(Math.sqrt(n))); while (x * x > m) x--; while ((x + 1n) * (x + 1n) <= m) x++; return N(x); }
    function issquare(n) { if (!isInt(n)) return NaN; if (n < 0) return 0; const r = B(isqrt(n)); return r * r === B(n) ? 1 : 0; }
    function isperfect(n) { if (!posInt(n)) return NaN; return sigma(n, 1) === 2 * n ? 1 : 0; }

    // ---- continuous special functions ----
    const LG = 7; const LC = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    function gamma(x) {
      if (typeof x !== 'number' || Number.isNaN(x)) return NaN;
      if (isInt(x) && x <= 0) return NaN;
      if (isInt(x) && x <= 171) return fact(x - 1);
      if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
      x -= 1; let a = LC[0]; const t = x + LG + 0.5;
      for (let i = 1; i < LG + 2; i++) a += LC[i] / (x + i);
      return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
    }
    function lgamma(x) {
      if (typeof x !== 'number' || Number.isNaN(x) || x <= 0) return NaN;
      if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
      x -= 1; let a = LC[0]; const t = x + LG + 0.5;
      for (let i = 1; i < LG + 2; i++) a += LC[i] / (x + i);
      return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
    }
    function betafn(a, b) { return Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b)); }
    // erf/erfc to double precision: Taylor series near 0, Lentz continued fraction in the tail.
    function erfc(x) {
      if (typeof x !== 'number' || Number.isNaN(x)) return NaN;
      if (x < 0) return 2 - erfc(-x);
      if (x < 2.5) return 1 - erf(x);
      // continued fraction erfc(x) = exp(-x²)/√π · 1/(x + 1/2/(x + 1/(x + 3/2/(x + …))))
      let f = 0; for (let n = 60; n >= 1; n--) f = (n / 2) / (x + f);
      return Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
    }
    function erf(x) {
      if (typeof x !== 'number' || Number.isNaN(x)) return NaN;
      if (Math.abs(x) >= 2.5) return x > 0 ? 1 - erfc(x) : erfc(-x) - 1;
      let sum = x, term = x; const x2 = x * x;
      for (let n = 1; n < 200; n++) { term *= -x2 / n; const add = term / (2 * n + 1); sum += add; if (Math.abs(add) < 1e-17 * Math.abs(sum)) break; }
      return (2 / Math.sqrt(Math.PI)) * sum;
    }
    function normcdf(x, m, s) { if (m === undefined) m = 0; if (s === undefined) s = 1; if (!(s > 0)) return NaN; return 0.5 * erfc(-(x - m) / (s * Math.SQRT2)); }
    function normpdf(x, m, s) { if (m === undefined) m = 0; if (s === undefined) s = 1; if (!(s > 0)) return NaN; const z = (x - m) / s; return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI)); }
    // Acklam's rational approximation, then one Halley step against erfc (≈1e-15).
    function norminv(p, m, s) {
      if (m === undefined) m = 0; if (s === undefined) s = 1;
      if (!(p > 0 && p < 1) || !(s > 0)) return NaN;
      const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
      const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
      const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
      const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
      const pl = 0.02425; let q, r, x;
      if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
      else if (p <= 1 - pl) { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
      else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
      const e = 0.5 * erfc(-x / Math.SQRT2) - p; const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
      x = x - u / (1 + x * u / 2);
      return m + s * x;
    }
    // Riemann ζ(s) for real s > 0, s ≠ 1 (Borwein's algorithm on the alternating η series);
    // for s < 0 by the functional equation.
    function zeta(s) {
      if (typeof s !== 'number' || Number.isNaN(s) || s === 1) return NaN;
      if (s < 0) { if (isInt(s) && s % 2 === 0) return 0; return Math.pow(2, s) * Math.pow(Math.PI, s - 1) * Math.sin(Math.PI * s / 2) * gamma(1 - s) * zeta(1 - s); }
      if (s === 0) return -0.5;
      const n = 60; const dk = []; let sum = 0;
      for (let i = 0; i <= n; i++) { sum += (n * gammaFactRatio(n, i) * Math.pow(4, i)); dk.push(sum); }
      let t = 0; for (let k = 0; k < n; k++) t += (k % 2 ? -1 : 1) * (dk[k] - dk[n]) / Math.pow(k + 1, s);
      const eta = -t / dk[n];
      return eta / (1 - Math.pow(2, 1 - s));
    }
    // (n+i-1)! / ((n-i)! (2i)!) for Borwein's d_k
    function gammaFactRatio(n, i) { return Math.exp(lgamma(n + i) - lgamma(n - i + 1) - lgamma(2 * i + 1)); }
    // Logarithmic integral li(x), Ramanujan's fast-converging series (x > 0, x ≠ 1).
    function li(x) {
      if (!(x > 0) || x === 1) return NaN;
      const lnx = Math.log(x); let sum = 0, fac = 1, inner = 0;
      for (let n = 1; n < 200; n++) {
        fac *= n; if (((n - 1) % 2) === 0) inner += 1 / ((n - 1) / 2 * 2 + 1);
        const term = Math.pow(-1, n - 1) * Math.pow(lnx, n) / (fac * Math.pow(2, n - 1)) * inner;
        sum += term; if (Math.abs(term) < 1e-17 * Math.abs(sum) && n > 10) break;
      }
      return 0.5772156649015329 + Math.log(Math.abs(lnx)) + Math.sqrt(x) * sum;
    }
    // Lambert W, principal branch (x ≥ −1/e), Halley's iteration.
    function lambertw(x) {
      if (typeof x !== 'number' || !(x >= -1 / Math.E)) return NaN;
      if (x === 0) return 0;
      let w = x < 1 ? (x > -0.3 ? x : -1 + Math.sqrt(2 * (1 + Math.E * x))) : Math.log(x) - Math.log(Math.log(x) + 1);
      for (let i = 0; i < 60; i++) {
        const e = Math.exp(w); const f = w * e - x; const d = e * (w + 1);
        const nw = w - f / (d - (w + 2) * f / (2 * w + 2));
        if (Math.abs(nw - w) < 1e-15 * (1 + Math.abs(nw))) { w = nw; break; }
        w = nw;
      }
      return w;
    }
    // n! mod m, exact (Wilson's theorem and friends).
    function factmod(n, m) { if (!nonNegInt(n) || !posInt(m) || n > 1e6) return NaN; const M = B(m); let r = 1n % M; for (let i = 2n; i <= B(n); i++) r = (r * i) % M; return N(r); }

    // ---- more special functions ----
    const EG = 0.5772156649015329;
    function digamma(x) {
      if (typeof x !== 'number' || Number.isNaN(x) || (isInt(x) && x <= 0)) return NaN;
      if (x < 0) return digamma(1 - x) - Math.PI / Math.tan(Math.PI * x);
      let r = 0; while (x < 6) { r -= 1 / x; x += 1; }
      const f = 1 / (x * x);
      return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))));
    }
    // Regularised incomplete gamma P(a, x) and Q = 1 − P (Numerical Recipes: series / Lentz CF).
    function gammainc(a, x) {
      if (!(a > 0) || !(x >= 0)) return NaN; if (x === 0) return 0;
      if (x < a + 1) { let ap = a, sum = 1 / a, del = sum; for (let n = 0; n < 1000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-16) break; } return sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
      return 1 - gammaincc(a, x);
    }
    function gammaincc(a, x) {
      if (!(a > 0) || !(x >= 0)) return NaN; if (x < a + 1) return 1 - gammainc(a, x);
      let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
      for (let i = 1; i < 1000; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break; }
      return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
    }
    // Regularised incomplete beta I_x(a, b).
    function betacf(x, a, b) {
      const qab = a + b, qap = a + 1, qam = a - 1; let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let h = d;
      for (let m = 1; m <= 1000; m++) {
        const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del;
        if (Math.abs(del - 1) < 1e-16) break;
      }
      return h;
    }
    function betainc(x, a, b) {
      if (!(a > 0) || !(b > 0) || !(x >= 0 && x <= 1)) return NaN; if (x === 0 || x === 1) return x;
      const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
      return x < (a + 1) / (a + b + 2) ? bt * betacf(x, a, b) / a : 1 - bt * betacf(1 - x, b, a) / b;
    }
    // Monotone inverse by bracketing + bisection/Newton-free safeguarded secant (robust for CDFs).
    function invert(cdf, p, lo, hi) {
      if (!(p >= 0 && p <= 1)) return NaN; if (p === 0) return lo; if (p === 1) return hi;
      let a = lo, b = hi;
      if (!Number.isFinite(b)) { b = 1; while (cdf(b) < p && b < 1e300) b *= 2; }
      if (!Number.isFinite(a)) { a = -1; while (cdf(a) > p && a > -1e300) a *= 2; }
      let fa = cdf(a) - p, fb = cdf(b) - p;
      for (let i = 0; i < 300; i++) {
        let m = b - fb * (b - a) / (fb - fa); if (!(m > Math.min(a, b) && m < Math.max(a, b))) m = (a + b) / 2;
        if (i % 3 === 2) m = (a + b) / 2;
        const fm = cdf(m) - p;
        if (fm === 0 || Math.abs(b - a) < 1e-15 * Math.max(1, Math.abs(m))) return m;
        if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else { b = m; fb = fm; }
      }
      return (a + b) / 2;
    }
    const gammacdf = (x, k, th) => { if (th === undefined) th = 1; if (!(k > 0) || !(th > 0)) return NaN; return x <= 0 ? 0 : gammainc(k, x / th); };
    const gammapdf = (x, k, th) => { if (th === undefined) th = 1; if (!(k > 0) || !(th > 0)) return NaN; if (x < 0) return 0; if (x === 0) return k === 1 ? 1 / th : (k < 1 ? Infinity : 0); return Math.exp((k - 1) * Math.log(x) - x / th - lgamma(k) - k * Math.log(th)); };
    const gammainv = (p, k, th) => { if (th === undefined) th = 1; if (!(k > 0) || !(th > 0)) return NaN; return invert((x) => gammacdf(x, k, th), p, 0, Infinity); };
    const betapdf = (x, a, b) => { if (!(a > 0) || !(b > 0)) return NaN; if (x < 0 || x > 1) return 0; return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lgamma(a) - lgamma(b) + lgamma(a + b)); };
    const betacdf = (x, a, b) => { if (!(a > 0) || !(b > 0)) return NaN; return x <= 0 ? 0 : x >= 1 ? 1 : betainc(x, a, b); };
    const betainv = (p, a, b) => { if (!(a > 0) || !(b > 0)) return NaN; return invert((x) => betacdf(x, a, b), p, 0, 1); };
    const chi2pdf = (x, k) => gammapdf(x, k / 2, 2);
    const chi2cdf = (x, k) => gammacdf(x, k / 2, 2);
    const chi2inv = (p, k) => gammainv(p, k / 2, 2);
    const tpdf = (x, v) => { if (!(v > 0)) return NaN; return Math.exp(lgamma((v + 1) / 2) - lgamma(v / 2) - 0.5 * Math.log(v * Math.PI) - (v + 1) / 2 * Math.log(1 + x * x / v)); };
    const tcdf = (x, v) => { if (!(v > 0)) return NaN; const ib = betainc(v / (v + x * x), v / 2, 0.5); return x >= 0 ? 1 - 0.5 * ib : 0.5 * ib; };
    const tinv = (p, v) => { if (!(v > 0) || !(p > 0 && p < 1)) return NaN; return invert((x) => tcdf(x, v), p, -Infinity, Infinity); };
    const fpdf = (x, d1, d2) => { if (!(d1 > 0) || !(d2 > 0)) return NaN; if (x < 0) return 0; if (x === 0) return d1 === 2 ? 1 : (d1 < 2 ? Infinity : 0); return Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2))); };
    const fcdf = (x, d1, d2) => { if (!(d1 > 0) || !(d2 > 0)) return NaN; return x <= 0 ? 0 : betainc(d1 * x / (d1 * x + d2), d1 / 2, d2 / 2); };
    const finv = (p, d1, d2) => { if (!(d1 > 0) || !(d2 > 0)) return NaN; return invert((x) => fcdf(x, d1, d2), p, 0, Infinity); };
    const binompdf = (k, n, p) => { if (!nonNegInt(n) || !isInt(k) || !(p >= 0 && p <= 1)) return NaN; if (k < 0 || k > n) return 0; if (p === 0) return k === 0 ? 1 : 0; if (p === 1) return k === n ? 1 : 0; return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p)); };
    const binomcdf = (k, n, p) => { if (!nonNegInt(n) || !(p >= 0 && p <= 1) || typeof k !== 'number') return NaN; k = Math.floor(k); if (k < 0) return 0; if (k >= n) return 1; return betainc(1 - p, n - k, k + 1); };
    const poisspdf = (k, l) => { if (!isInt(k) || !(l >= 0)) return NaN; if (k < 0) return 0; if (l === 0) return k === 0 ? 1 : 0; return Math.exp(k * Math.log(l) - l - lgamma(k + 1)); };
    const poisscdf = (k, l) => { if (typeof k !== 'number' || !(l >= 0)) return NaN; k = Math.floor(k); if (k < 0) return 0; if (l === 0) return 1; return gammaincc(k + 1, l); };
    const exppdf = (x, l) => (l > 0 ? (x < 0 ? 0 : l * Math.exp(-l * x)) : NaN);
    const expcdf = (x, l) => (l > 0 ? (x < 0 ? 0 : 1 - Math.exp(-l * x)) : NaN);
    const expinv = (p, l) => (l > 0 && p >= 0 && p < 1 ? -Math.log(1 - p) / l : NaN);
    const lognpdf = (x, m, s) => { if (m === undefined) m = 0; if (s === undefined) s = 1; if (!(s > 0)) return NaN; if (x <= 0) return 0; const z = (Math.log(x) - m) / s; return Math.exp(-0.5 * z * z) / (x * s * Math.sqrt(2 * Math.PI)); };
    const logncdf = (x, m, s) => { if (m === undefined) m = 0; if (s === undefined) s = 1; if (!(s > 0)) return NaN; return x <= 0 ? 0 : normcdf(Math.log(x), m, s); };
    const logninv = (p, m, s) => { if (m === undefined) m = 0; if (s === undefined) s = 1; const z = norminv(p, m, s); return Number.isNaN(z) ? NaN : Math.exp(z); };
    const weibpdf = (x, k, l) => (k > 0 && l > 0 ? (x < 0 ? 0 : (k / l) * Math.pow(x / l, k - 1) * Math.exp(-Math.pow(x / l, k))) : NaN);
    const weibcdf = (x, k, l) => (k > 0 && l > 0 ? (x < 0 ? 0 : 1 - Math.exp(-Math.pow(x / l, k))) : NaN);
    const weibinv = (p, k, l) => (k > 0 && l > 0 && p >= 0 && p < 1 ? l * Math.pow(-Math.log(1 - p), 1 / k) : NaN);
    const geompdf = (k, p) => (isInt(k) && p > 0 && p <= 1 ? (k < 1 ? 0 : Math.pow(1 - p, k - 1) * p) : NaN);
    const geomcdf = (k, p) => (typeof k === 'number' && p > 0 && p <= 1 ? (k < 1 ? 0 : 1 - Math.pow(1 - p, Math.floor(k))) : NaN);
    const hygepdf = (k, NN, K, n) => { if (![k, NN, K, n].every(nonNegInt) || K > NN || n > NN) return NaN; if (k > K || k > n || n - k > NN - K) return 0; const lb = (a, b) => lgamma(a + 1) - lgamma(b + 1) - lgamma(a - b + 1); return Math.exp(lb(K, k) + lb(NN - K, n - k) - lb(NN, n)); };
    const nbinpdf = (k, r, p) => (nonNegInt(k) && r > 0 && p > 0 && p <= 1 ? Math.exp(lgamma(k + r) - lgamma(k + 1) - lgamma(r) + r * Math.log(p) + k * Math.log(1 - p)) : NaN);
    const erfinv = (y) => (y > -1 && y < 1 ? norminv((y + 1) / 2) / Math.SQRT2 : (y === 1 ? Infinity : y === -1 ? -Infinity : NaN));
    // Exponential integrals E1(x) and Ei(x).
    function expint(x) {
      if (!(x > 0)) return NaN;
      if (x <= 1) { let sum = 0, term = 1; for (let k = 1; k < 200; k++) { term *= -x / k; const add = -term / k; sum += add; if (Math.abs(add) < 1e-17 * Math.abs(sum)) break; } return -EG - Math.log(x) + sum; }
      let b = x + 1, c = 1 / 1e-300, d = 1 / b, h = d;
      for (let i = 1; i < 1000; i++) { const an = -i * i; b += 2; d = 1 / (an * d + b); c = b + an / c; const del = c * d; h *= del; if (Math.abs(del - 1) < 1e-16) break; }
      return h * Math.exp(-x);
    }
    function ei(x) {
      if (x === 0 || Number.isNaN(x)) return NaN;
      if (x < 0) return -expint(-x);
      if (x < 40) { let sum = 0, term = 1; for (let k = 1; k < 500; k++) { term *= x / k; const add = term / k; sum += add; if (add < 1e-17 * sum) break; } return EG + Math.log(x) + sum; }
      let sum = 1, term = 1; for (let k = 1; k < 40; k++) { const nt = term * k / x; if (nt > term) break; term = nt; sum += term; } return Math.exp(x) / x * sum;
    }
    // Sine and cosine integrals Si, Ci (series, then the asymptotic auxiliary functions).
    function si(x) {
      if (x < 0) return -si(-x); if (x === 0) return 0;
      if (x <= 4) { let sum = 0, term = x; for (let k = 0; k < 100; k++) { const add = term / (2 * k + 1); sum += add; if (Math.abs(add) < 1e-17 * Math.abs(sum)) break; term *= -x * x / ((2 * k + 2) * (2 * k + 3)); } return sum; }
      return Math.PI / 2 + e1i(x)[1];
    }
    function ci(x) {
      if (!(x > 0)) return NaN;
      if (x <= 4) { let sum = 0, term = -x * x / 2; for (let k = 1; k < 100; k++) { const add = term / (2 * k); sum += add; if (Math.abs(add) < 1e-17 * Math.abs(sum)) break; term *= -x * x / ((2 * k + 1) * (2 * k + 2)); } return EG + Math.log(x) + sum; }
      return -e1i(x)[0];
    }
    // E1(ix) for x > 0 by the continued fraction (complex Lentz): E1(ix) = −Ci(x) + i(Si(x) − π/2).
    function e1i(x) {
      let bR = 1, bI = x, cR = 1e300, cI = 0; let dR, dI; { const den = bR * bR + bI * bI; dR = bR / den; dI = -bI / den; }
      let hR = dR, hI = dI;
      for (let i = 1; i < 500; i++) {
        const an = -i * i; bR += 2;
        let tR = an * dR + bR, tI = an * dI + bI; let den = tR * tR + tI * tI; dR = tR / den; dI = -tI / den;
        den = cR * cR + cI * cI; tR = bR + an * cR / den; tI = bI - an * cI / den; cR = tR; cI = tI;
        const delR = cR * dR - cI * dI, delI = cR * dI + cI * dR; tR = hR * delR - hI * delI; hI = hR * delI + hI * delR; hR = tR;
        if (Math.abs(delR - 1) + Math.abs(delI) < 1e-16) break;
      }
      const eR = Math.cos(x), eI = -Math.sin(x);
      return [hR * eR - hI * eI, hR * eI + hI * eR];
    }
    // Bessel functions of integer order, from their integral representations (trapezoid rule on a
    // periodic integrand is spectrally accurate; the tails of Y and K decay double-exponentially).
    function besselj(n, x) {
      if (!isInt(n) || typeof x !== 'number' || Number.isNaN(x)) return NaN;
      if (n < 0) return (n % 2 ? -1 : 1) * besselj(-n, x);
      const M = Math.max(64, Math.ceil(2 * Math.abs(x) + 2 * n + 64)); let s = 0;
      // A limit on the work: besselj(0, 1e12) was 2×10¹² turns of this loop (REVIEW P1/C2).
      if (M > 2e6) return NaN;
      for (let k = 0; k < M; k++) { const t = (k + 0.5) * Math.PI / M; s += Math.cos(n * t - x * Math.sin(t)); }
      return s / M;
    }
    function besseli(n, x) {
      if (!isInt(n) || typeof x !== 'number' || Number.isNaN(x)) return NaN;
      n = Math.abs(n); const M = Math.max(64, Math.ceil(2 * Math.abs(x) + 2 * n + 64)); let s = 0;
      if (M > 2e6) return NaN;
      for (let k = 0; k < M; k++) { const t = (k + 0.5) * Math.PI / M; s += Math.exp(x * Math.cos(t)) * Math.cos(n * t); }
      return s / M;
    }
    function besselk(n, x) {
      if (!isInt(n) || !(x > 0)) return NaN; n = Math.abs(n);
      const h = 0.02; let s = 0.5 * Math.exp(-x);
      for (let k = 1; k < 100000; k++) { const t = k * h; const v = Math.exp(-x * Math.cosh(t)) * Math.cosh(n * t); s += v; if (v < 1e-18 * s && x * Math.cosh(t) > 40) break; }
      return s * h;
    }
    function bessely(n, x) {
      if (!isInt(n) || !(x > 0)) return NaN;
      if (n < 0) return (n % 2 ? -1 : 1) * bessely(-n, x);
      const a = integrate((t) => Math.sin(x * Math.sin(t) - n * t), 0, Math.PI) / Math.PI;
      const tail = integrate((t) => (Math.exp(n * t) + (n % 2 ? -1 : 1) * Math.exp(-n * t)) * Math.exp(-x * Math.sinh(t)), 0, Math.asinh(Math.max(1, (800 + n * 20) / x))) / Math.PI;
      return a - tail;
    }
    // Complete elliptic integrals K(k), E(k) (modulus k, |k| < 1) by the AGM; incomplete via Carlson.
    function ellipk(k) { if (!(Math.abs(k) < 1)) return Math.abs(k) === 1 ? Infinity : NaN; let a = 1, b = Math.sqrt(1 - k * k); for (let i = 0; i < 60 && Math.abs(a - b) > 1e-16 * a; i++) { const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; } return Math.PI / (2 * a); }
    function ellipe(k) {
      if (!(Math.abs(k) <= 1)) return NaN; if (Math.abs(k) === 1) return 1;
      let a = 1, b = Math.sqrt(1 - k * k), sum = k * k / 2, p = 0.5;
      for (let i = 0; i < 60; i++) { const c = (a - b) / 2; const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; p *= 2; sum += p * c * c; if (Math.abs(c) < 1e-17) break; }
      return Math.PI / (2 * a) * (1 - sum);
    }
    function carlsonRF(x, y, z) {
      for (let i = 0; i < 100; i++) { const l = Math.sqrt(x * y) + Math.sqrt(y * z) + Math.sqrt(z * x); x = (x + l) / 4; y = (y + l) / 4; z = (z + l) / 4; const m = (x + y + z) / 3; if (Math.max(Math.abs(x - m), Math.abs(y - m), Math.abs(z - m)) < 1e-10 * m) break; }
      const m = (x + y + z) / 3; const X = 1 - x / m, Y = 1 - y / m, Z = -X - Y; const E2 = X * Y - Z * Z, E3 = X * Y * Z;
      return (1 - E2 / 10 + E3 / 14 + E2 * E2 / 24 - 3 * E2 * E3 / 44) / Math.sqrt(m);
    }
    function carlsonRD(x, y, z) {
      let sum = 0, fac = 1;
      for (let i = 0; i < 100; i++) { const l = Math.sqrt(x * y) + Math.sqrt(y * z) + Math.sqrt(z * x); sum += fac / (Math.sqrt(z) * (z + l)); fac /= 4; x = (x + l) / 4; y = (y + l) / 4; z = (z + l) / 4; const m = (x + y + 3 * z) / 5; if (Math.max(Math.abs(x - m), Math.abs(y - m), Math.abs(z - m)) < 1e-10 * m) break; }
      const m = (x + y + 3 * z) / 5; const X = 1 - x / m, Y = 1 - y / m, Z = -(X + Y) / 3;
      const ea = X * Y, eb = Z * Z, ec = ea - eb, ed = ea - 6 * eb, ee = ed + ec + ec;
      return 3 * sum + fac * (1 + ed * (-3 / 14 + 9 / 88 * ed - 9 / 52 * Z * ee) + Z * (1 / 6 * ee + Z * (-9 / 22 * ec + Z * 3 / 26 * ea))) / (m * Math.sqrt(m));
    }
    function ellipf(phi, k) { if (typeof phi !== 'number' || !(Math.abs(k) <= 1)) return NaN; const s = Math.sin(phi), c = Math.cos(phi); const n = Math.round(phi / Math.PI); const r = phi - n * Math.PI; const sr = Math.sin(r), cr = Math.cos(r); const base = sr * carlsonRF(cr * cr, 1 - k * k * sr * sr, 1); void s; void c; return 2 * n * ellipk(k) + base; }
    function ellipeinc(phi, k) { if (typeof phi !== 'number' || !(Math.abs(k) <= 1)) return NaN; const n = Math.round(phi / Math.PI); const r = phi - n * Math.PI; const s = Math.sin(r), c = Math.cos(r), q = 1 - k * k * s * s; return 2 * n * ellipe(k) + s * carlsonRF(c * c, q, 1) - k * k * s * s * s / 3 * carlsonRD(c * c, q, 1); }
    // Polylogarithm Li_s(z) for real z in [−1, 1] (series; z = ±1 through ζ and η).
    function polylog(s, z) {
      if (typeof s !== 'number' || typeof z !== 'number' || !(z >= -1 && z <= 1)) return NaN;
      if (z === 0) return 0; if (z === 1) return s > 1 ? zeta(s) : NaN; if (z === -1) return -(1 - Math.pow(2, 1 - s)) * zeta(s);
      if (s === 1) return -Math.log(1 - z);
      if (Math.abs(z) > 0.5 && s === 2) { const w = 1 - z; if (z > 0) return Math.PI * Math.PI / 6 - Math.log(z) * Math.log(w) - polylog(2, w); }
      let sum = 0, zk = 1; for (let k = 1; k < 100000; k++) { zk *= z; const add = zk / Math.pow(k, s); sum += add; if (Math.abs(add) < 1e-17 * Math.abs(sum)) break; }
      return sum;
    }
    // Adaptive Gauss–Kronrod (7/15) integration, also used by integral(x, a, b, …).
    const XGK = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926, 0.741531185599394439863864773280788, 0.586087235467691130294144845693013, 0.405845151377397166906606412076961, 0.207784955007898467600689403773245, 0];
    const WGK = [0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518, 0.140653259715525918745189590510238, 0.169004726639267902826583426598550, 0.190350578064785409913256402421014, 0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
    const WG = [0.129484966168869693270611432679082, 0.279705391489276667901467771423780, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];
    function gk(f, a, b) {
      const c = (a + b) / 2, h = (b - a) / 2; let k = WGK[7] * f(c), g = WG[3] * f(c);
      for (let j = 0; j < 7; j++) { const dx = h * XGK[j]; const f1 = f(c - dx), f2 = f(c + dx); k += WGK[j] * (f1 + f2); if (j % 2 === 1) g += WG[(j - 1) / 2] * (f1 + f2); }
      return [k * h, Math.abs((k - g) * h)];
    }
    function integrate(f, a, b, tol) {
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        // map an infinite range onto a finite one: x = t / (1 − t²)
        if (a === b) return 0;
        const g = (t) => { const x = t / (1 - t * t); const w = (1 + t * t) / ((1 - t * t) * (1 - t * t)); const v = f(x) * w; return Number.isFinite(v) ? v : 0; };
        const lo = Number.isFinite(a) ? (a === 0 ? 0 : (-1 + Math.sqrt(1 + 4 * a * a)) / (2 * a)) : -1;
        const hi = Number.isFinite(b) ? (b === 0 ? 0 : (-1 + Math.sqrt(1 + 4 * b * b)) / (2 * b)) : 1;
        return integrate(g, lo, hi, tol);
      }
      tol = tol || 1e-12; if (a === b) return 0;
      const stack = [[a, b]]; let total = 0, n = 0;
      const whole = gk(f, a, b); if (whole[1] <= tol * Math.max(1, Math.abs(whole[0]))) return whole[0];
      while (stack.length && n < 20000) {
        const [x0, x1] = stack.pop(); const [v, e] = gk(f, x0, x1); n++;
        if (e <= Math.max(tol * Math.abs(v), 1e-15 * Math.abs(x1 - x0)) || Math.abs(x1 - x0) < 1e-12 * Math.max(1, Math.abs(x0))) total += v;
        else { const m = (x0 + x1) / 2; stack.push([m, x1], [x0, m]); }
      }
      return total;
    }
    // Numerical derivative of order 1–4 by Richardson-extrapolated central differences.
    function derivative(f, x, order) {
      order = order || 1; if (![1, 2, 3, 4].includes(order)) return NaN;
      const D = (h) => {
        if (order === 1) return (f(x + h) - f(x - h)) / (2 * h);
        if (order === 2) return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
        if (order === 3) return (f(x + 2 * h) - 2 * f(x + h) + 2 * f(x - h) - f(x - 2 * h)) / (2 * h * h * h);
        return (f(x + 2 * h) - 4 * f(x + h) + 6 * f(x) - 4 * f(x - h) + f(x - 2 * h)) / (h * h * h * h);
      };
      const h0 = (order === 1 ? 1e-2 : order === 2 ? 5e-2 : 1e-1) * Math.max(1, Math.abs(x));
      const T = []; let h = h0;
      for (let i = 0; i < 6; i++) { T[i] = [D(h)]; for (let j = 1; j <= i; j++) T[i][j] = T[i][j - 1] + (T[i][j - 1] - T[i - 1][j - 1]) / (Math.pow(4, j) - 1); h /= 2; }
      return T[5][5];
    }
    // Root of f near x0 (secant, then bracket + bisection), or in [a, b] (Brent-style).
    function findRoot(f, a, b) {
      if (b === undefined) {
        const x0 = a; const tries = [x0, x0 * 1.1 + 0.1, x0 - 1, x0 + 1, 0.1, 1, -1, 10];
        for (const s0 of tries) {
          let x1 = s0, x2 = s0 + (Math.abs(s0) > 1e-6 ? s0 * 1e-3 : 1e-3), f1 = f(x1);
          if (!Number.isFinite(f1)) continue;
          for (let i = 0; i < 100; i++) {
            const f2 = f(x2); if (!Number.isFinite(f2)) { x2 = (x1 + x2) / 2; continue; }
            if (f2 === 0 || Math.abs(x2 - x1) < 1e-15 * Math.max(1, Math.abs(x2))) { if (Math.abs(f2) < 1e-9 * Math.max(1, Math.abs(f1))) return x2; break; }
            const d = f2 - f1; if (d === 0) break;
            const x3 = x2 - f2 * (x2 - x1) / d; x1 = x2; f1 = f2; x2 = x3; if (!Number.isFinite(x2)) break;
          }
        }
        return NaN;
      }
      let fa = f(a), fb = f(b); if (!Number.isFinite(fa) || !Number.isFinite(fb)) return NaN;
      if (fa === 0) return a; if (fb === 0) return b; if ((fa > 0) === (fb > 0)) return NaN;
      for (let i = 0; i < 300; i++) {
        let m = b - fb * (b - a) / (fb - fa); if (!(m > Math.min(a, b) && m < Math.max(a, b)) || i % 4 === 3) m = (a + b) / 2;
        const fm = f(m); if (fm === 0 || Math.abs(b - a) < 1e-15 * Math.max(1, Math.abs(m))) return m;
        if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else { b = m; fb = fm; }
      }
      return (a + b) / 2;
    }

    return {
      factmod, digamma, gammainc, gammaincc, betainc, gammapdf, gammacdf, gammainv, betapdf, betacdf, betainv,
      chi2pdf, chi2cdf, chi2inv, tpdf, tcdf, tinv, fpdf, fcdf, finv, binompdf, binomcdf, poisspdf, poisscdf,
      exppdf, expcdf, expinv, lognpdf, logncdf, logninv, weibpdf, weibcdf, weibinv, geompdf, geomcdf, hygepdf, nbinpdf,
      erfinv, expint, ei, si, ci, besselj, bessely, besseli, besselk, ellipk, ellipe, ellipf, ellipeinc, polylog,
      _integrate: integrate, _derivative: derivative, _findRoot: findRoot,
      gcd, lcm, fact, binom, perm, isprime, nextprime, prevprime, primepi, nthprime, phi, sigma, tau, mu,
      omega, bigomega, radical: rad, lpf, gpf, carmichael, powmod, modinv, crt, fib, lucas, catalan, bell, partitions,
      stirling1, stirling2, derange, digitsum, digitalroot, numdigits, reversenum, collatz, legendre, jacobi,
      ord, primroot, isqrt, issquare, isperfect,
      gamma, lgamma, beta: betafn, erf, erfc, normcdf, normpdf, norminv, zeta, li, lambertw,
      sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
      atan2: Math.atan2,
    };
  })();

  /* ---- values beyond plain numbers: complex numbers, lists (vectors) and matrices ----
   * A list is a JS array of values, a matrix an array of equal-length arrays. Complex numbers
   * are Cx objects; a complex result whose imaginary part is exactly 0 becomes a plain number. */
  const VAL = (function () {
    class Cx { constructor(re, im) { this.re = re; this.im = im; } }
    const isC = (v) => v instanceof Cx;
    const isA = Array.isArray;
    const isM = (v) => isA(v) && v.length > 0 && v.every(isA);
    const C = (v) => (isC(v) ? v : new Cx(Number(v), 0));
    const simp = (c) => (c.im === 0 ? c.re : c);
    const cadd = (a, b) => simp(new Cx(a.re + b.re, a.im + b.im));
    const csub = (a, b) => simp(new Cx(a.re - b.re, a.im - b.im));
    const cmul = (a, b) => simp(new Cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re));
    const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return simp(new Cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)); };
    const cabs = (a) => Math.hypot(a.re, a.im);
    const carg = (a) => Math.atan2(a.im, a.re);
    const cexp = (a) => { const r = Math.exp(a.re); return simp(new Cx(r * Math.cos(a.im), r * Math.sin(a.im))); };
    const cln = (a) => simp(new Cx(Math.log(cabs(a)), carg(a)));
    const cpow = (a, b) => {
      if (a.re === 0 && a.im === 0) return (b.re > 0 || (b.re === 0 && b.im === 0 && false)) ? 0 : (b.re === 0 && b.im === 0 ? 1 : NaN);
      if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 64) { let r = new Cx(1, 0); let base = a; let n = Math.abs(b.re); while (n) { if (n & 1) r = C(cmul(r, base)); base = C(cmul(base, base)); n >>= 1; } return b.re < 0 ? cdiv(new Cx(1, 0), r) : simp(r); }
      return cexp(C(cmul(b, C(cln(a)))));
    };
    const csqrt = (a) => { const r = cabs(a); const re = Math.sqrt((r + a.re) / 2); const im = Math.sign(a.im || 1) * Math.sqrt((r - a.re) / 2); return simp(new Cx(re, a.im === 0 && a.re >= 0 ? 0 : im)); };
    const csin = (a) => simp(new Cx(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im)));
    const ccos = (a) => simp(new Cx(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im)));
    const ctan = (a) => cdiv(C(csin(a)), C(ccos(a)));
    const csinh = (a) => simp(new Cx(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im)));
    const ccosh = (a) => simp(new Cx(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im)));
    const ctanh = (a) => cdiv(C(csinh(a)), C(ccosh(a)));
    // Scalar binary operation on numbers or complex values.
    function scalarBin(op, a, b) {
      if (!isC(a) && !isC(b)) {
        return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : op === '%' ? a % b : op === '^' ? Math.pow(a, b)
          : op === '<' ? +(a < b) : op === '<=' ? +(a <= b) : op === '>' ? +(a > b) : op === '>=' ? +(a >= b) : op === '==' ? +(a === b) : op === '!=' ? +(a !== b) : NaN;
      }
      const A = C(a), B = C(b);
      if (op === '+') return cadd(A, B); if (op === '-') return csub(A, B); if (op === '*') return cmul(A, B); if (op === '/') return cdiv(A, B);
      if (op === '^') {
        // a real negative base with a real exponent stays real in plain arithmetic; complex only when asked
        return cpow(A, B);
      }
      if (op === '==') return +(A.re === B.re && A.im === B.im); if (op === '!=') return +(A.re !== B.re || A.im !== B.im);
      return NaN;
    }
    // Element-wise with broadcasting: scalar ⊕ list, list ⊕ list (same length), matrix likewise.
    function bin(op, a, b) {
      if (isA(a) || isA(b)) {
        if (isA(a) && isA(b)) { if (a.length !== b.length) return NaN; return a.map((x, i) => bin(op, x, b[i])); }
        return isA(a) ? a.map((x) => bin(op, x, b)) : b.map((y) => bin(op, a, y));
      }
      return scalarBin(op, a, b);
    }
    function neg(a) { if (isA(a)) return a.map(neg); if (isC(a)) return simp(new Cx(-a.re, -a.im)); return -a; }
    // Lift a numeric function over lists/matrices; complex arguments use cfn when given.
    function lift(fn, cfn) {
      const f = function () {
        const args = Array.from(arguments);
        const ai = args.findIndex(isA);
        if (ai >= 0) return args[ai].map((x) => { const a2 = args.slice(); a2[ai] = x; return f.apply(null, a2); });
        if (args.some(isC)) return cfn ? cfn.apply(null, args.map(C)) : NaN;
        return fn.apply(null, args);
      };
      return f;
    }
    const flat = (args) => { const out = []; const walk = (v) => { if (isA(v)) v.forEach(walk); else out.push(v); }; args.forEach(walk); return out; };
    const nums = (args) => { const f = flat(args); return f.every((x) => typeof x === 'number') ? f : null; };
    function sumv() { const f = flat(Array.from(arguments)); let acc = 0; for (const x of f) acc = scalarBin('+', acc, x); return acc; }
    function prodv() { const f = flat(Array.from(arguments)); let acc = 1; for (const x of f) acc = scalarBin('*', acc, x); return acc; }
    const count = function () { return flat(Array.from(arguments)).length; };
    function mean() { const f = nums(Array.from(arguments)); if (!f || !f.length) return NaN; return f.reduce((a, b) => a + b, 0) / f.length; }
    function sorted(args) { const f = nums(args); return f ? f.slice().sort((a, b) => a - b) : null; }
    function median() { const f = sorted(Array.from(arguments)); if (!f || !f.length) return NaN; const m = f.length >> 1; return f.length % 2 ? f[m] : (f[m - 1] + f[m]) / 2; }
    function mode() { const f = sorted(Array.from(arguments)); if (!f || !f.length) return NaN; let best = f[0], bc = 0, cur = f[0], c = 0; for (const x of f) { if (x === cur) c++; else { cur = x; c = 1; } if (c > bc) { bc = c; best = cur; } } return best; }
    function ss(f) { const m = f.reduce((a, b) => a + b, 0) / f.length; return f.reduce((a, x) => a + (x - m) * (x - m), 0); }
    function variance() { const f = nums(Array.from(arguments)); return f && f.length > 1 ? ss(f) / (f.length - 1) : NaN; }
    function varp() { const f = nums(Array.from(arguments)); return f && f.length ? ss(f) / f.length : NaN; }
    const stdev = function () { return Math.sqrt(variance.apply(null, arguments)); };
    const stdevp = function () { return Math.sqrt(varp.apply(null, arguments)); };
    function gmean() { const f = nums(Array.from(arguments)); if (!f || !f.length || f.some((x) => x <= 0)) return NaN; return Math.exp(f.reduce((a, x) => a + Math.log(x), 0) / f.length); }
    function hmean() { const f = nums(Array.from(arguments)); if (!f || !f.length || f.some((x) => x <= 0)) return NaN; return f.length / f.reduce((a, x) => a + 1 / x, 0); }
    function wmean(x, w) { if (!isA(x) || !isA(w) || x.length !== w.length || !x.length) return NaN; let sw = 0, s = 0; for (let i = 0; i < x.length; i++) { s += x[i] * w[i]; sw += w[i]; } return s / sw; }
    // Percentile with linear interpolation between order statistics (p from 0 to 1, like PERCENTILE.INC).
    function percentile(x, p) { const f = sorted([x]); if (!f || !f.length || !(p >= 0 && p <= 1)) return NaN; const h = (f.length - 1) * p; const lo = Math.floor(h); return lo + 1 < f.length ? f[lo] + (h - lo) * (f[lo + 1] - f[lo]) : f[lo]; }
    function skew(x) { const f = nums([x]); if (!f || f.length < 3) return NaN; const n = f.length, m = f.reduce((a, b) => a + b, 0) / n; const s = Math.sqrt(ss(f) / (n - 1)); return n / ((n - 1) * (n - 2)) * f.reduce((a, v) => a + Math.pow((v - m) / s, 3), 0); }
    function kurt(x) { const f = nums([x]); if (!f || f.length < 4) return NaN; const n = f.length, m = f.reduce((a, b) => a + b, 0) / n; const s2 = ss(f) / (n - 1); const k4 = f.reduce((a, v) => a + Math.pow(v - m, 4), 0) / (s2 * s2); return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * k4 - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3)); }
    function pairs(x, y) { if (!isA(x) || !isA(y) || x.length !== y.length || x.length < 2) return null; return [x, y]; }
    function cov(x, y) { const p = pairs(x, y); if (!p) return NaN; const n = x.length, mx = mean(x), my = mean(y); let s = 0; for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my); return s / (n - 1); }
    function corr(x, y) { const c = cov(x, y); return c / (stdev(x) * stdev(y)); }
    function slope(x, y) { return cov(x, y) / variance(x); }
    function intercept(x, y) { return mean(y) - slope(x, y) * mean(x); }
    function rsq(x, y) { const r = corr(x, y); return r * r; }
    // Cash flows: npv(r, cf) with cf[0] at time 0; irr(cf); mirr(cf, finance rate, reinvestment rate).
    function npv(r, cf) { if (!isA(cf)) return NaN; let s = 0; for (let t = 0; t < cf.length; t++) s += cf[t] / Math.pow(1 + r, t); return s; }
    function irr(cf, guess) {
      if (!isA(cf) || cf.length < 2) return NaN; const f = (r) => npv(r, cf);
      const r0 = ML._findRoot(f, guess === undefined ? 0.1 : guess); if (Number.isFinite(r0) && r0 > -1) return r0;
      return ML._findRoot(f, -0.9999, 10);
    }
    function mirr(cf, fr, rr) { if (!isA(cf) || cf.length < 2) return NaN; const n = cf.length - 1; let pvNeg = 0, fvPos = 0; for (let t = 0; t <= n; t++) { if (cf[t] < 0) pvNeg += cf[t] / Math.pow(1 + fr, t); else fvPos += cf[t] * Math.pow(1 + rr, n - t); } return Math.pow(-fvPos / pvNeg, 1 / n) - 1; }
    // Lists
    const list = function () { return Array.from(arguments); };
    function seq(a, b, st) { if (st === undefined) st = 1; if (!(st !== 0) || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs((b - a) / st) > 1e6) return NaN; const out = []; for (let x = a; st > 0 ? x <= b + 1e-12 : x >= b - 1e-12; x += st) out.push(x); return out; }
    function at(v, i, j) { if (!isA(v) || !Number.isInteger(i) || i < 1 || i > v.length) return NaN; const r = v[i - 1]; return j === undefined ? r : at(r, j); }
    function sortv(v) { const f = sorted([v]); return f || NaN; }
    function cumsum(v) { if (!isA(v)) return NaN; let s = 0; return v.map((x) => (s += x)); }
    // running maximum / minimum: cummax(prices) is the peak so far, for drawdowns
    function cummax(v) { if (!isA(v)) return NaN; let m = -Infinity; return v.map((x) => (m = Math.max(m, x))); }
    function cummin(v) { if (!isA(v)) return NaN; let m = Infinity; return v.map((x) => (m = Math.min(m, x))); }
    function diffv(v) { if (!isA(v) || v.length < 2) return NaN; return v.slice(1).map((x, i) => x - v[i]); }
    // Vectors and matrices
    function dot(u, v) { if (!isA(u) || !isA(v) || u.length !== v.length) return NaN; let s = 0; for (let i = 0; i < u.length; i++) s = scalarBin('+', s, scalarBin('*', u[i], isC(v[i]) ? new Cx(v[i].re, -v[i].im) : v[i])); return s; }
    function cross(u, v) { if (!isA(u) || !isA(v) || u.length !== 3 || v.length !== 3) return NaN; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; }
    function norm(v) { if (!isA(v)) return isC(v) ? cabs(v) : Math.abs(v); const f = flat([v]); return Math.sqrt(f.reduce((a, x) => a + (isC(x) ? x.re * x.re + x.im * x.im : x * x), 0)); }
    const shape = (M) => (isM(M) && M.every((r) => r.length === M[0].length) ? [M.length, M[0].length] : null);
    function trans(M) { const sh = shape(M); if (!sh) return isA(M) ? M.map((x) => [x]) : NaN; return M[0].map((_, j) => M.map((r) => r[j])); }
    function mmul(A, Bm) {
      const a = shape(A); const b = isM(Bm) ? shape(Bm) : (isA(Bm) ? [Bm.length, 1] : null); if (!a || !b || a[1] !== b[0]) return NaN;
      const Bmat = isM(Bm) ? Bm : Bm.map((x) => [x]);
      const out = A.map((r) => Bmat[0].map((_, j) => r.reduce((s, x, k) => s + x * Bmat[k][j], 0)));
      return isM(Bm) ? out : out.map((r) => r[0]);
    }
    function lu(M) {
      const sh = shape(M); if (!sh || sh[0] !== sh[1]) return null; const n = sh[0]; const A = M.map((r) => r.slice()); const perm = A.map((_, i) => i); let sign = 1;
      for (let k = 0; k < n; k++) {
        let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
        if (A[p][k] === 0) return { A, perm, sign: 0, n };
        if (p !== k) { [A[p], A[k]] = [A[k], A[p]]; [perm[p], perm[k]] = [perm[k], perm[p]]; sign = -sign; }
        for (let i = k + 1; i < n; i++) { A[i][k] /= A[k][k]; for (let j = k + 1; j < n; j++) A[i][j] -= A[i][k] * A[k][j]; }
      }
      return { A, perm, sign, n };
    }
    function det(M) { const L = lu(M); if (!L) return NaN; if (L.sign === 0) return 0; let d = L.sign; for (let i = 0; i < L.n; i++) d *= L.A[i][i]; return d; }
    function luSolve(L, b) { const n = L.n; const y = new Array(n); for (let i = 0; i < n; i++) { let s = b[L.perm[i]]; for (let j = 0; j < i; j++) s -= L.A[i][j] * y[j]; y[i] = s; } const x = new Array(n); for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let j = i + 1; j < n; j++) s -= L.A[i][j] * x[j]; x[i] = s / L.A[i][i]; } return x; }
    function linsolve(M, b) { const L = lu(M); if (!L || L.sign === 0 || !isA(b) || b.length !== L.n) return NaN; return luSolve(L, b); }
    function inv(M) { const L = lu(M); if (!L || L.sign === 0) return NaN; const cols = []; for (let j = 0; j < L.n; j++) { const e = new Array(L.n).fill(0); e[j] = 1; cols.push(luSolve(L, e)); } return trans(cols); }
    function trace(M) { const sh = shape(M); if (!sh || sh[0] !== sh[1]) return NaN; let s = 0; for (let i = 0; i < sh[0]; i++) s += M[i][i]; return s; }
    function eye(n) { if (!Number.isInteger(n) || n < 1 || n > 100) return NaN; return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))); }
    // Complex helpers exposed as functions
    const re = (a) => (isC(a) ? a.re : a); const im = (a) => (isC(a) ? a.im : 0);
    const conj = (a) => (isC(a) ? simp(new Cx(a.re, -a.im)) : a);
    const arg = (a) => (isC(a) ? carg(a) : Math.atan2(0, a));
    const polar = (r, t) => simp(new Cx(r * Math.cos(t), r * Math.sin(t)));
    return {
      Cx, isC, isA, isM, C, simp, bin, neg, lift, flat,
      complexFns: { sqrt: csqrt, exp: cexp, ln: cln, abs: cabs, sin: csin, cos: ccos, tan: ctan, sinh: csinh, cosh: ccosh, tanh: ctanh, pow: (a, b) => cpow(a, b), log: (a) => cdiv(C(cln(a)), new Cx(Math.LN10, 0)) },
      aggregates: { sum: sumv, prod: prodv, count, len: count, mean, median, mode, var: variance, stdev, varp, stdevp, gmean, hmean, wmean, percentile, quantile: percentile, skew, kurt, cov, corr, slope, intercept, rsq, npv, irr, mirr, list, seq, at, sort: sortv, cumsum, cummax, cummin, diff: diffv, dot, cross, norm, trans, mmul, det, inv, trace, eye, linsolve, re, im, conj, arg, polar },
    };
  })();
  /* MATHLIB-END */
  // Scalar maths lifted over lists; the complex-aware ones also take complex numbers.
  const CF = VAL.complexFns;
  const MATHBASE = {
    sqrt: [Math.sqrt, CF.sqrt], cbrt: [Math.cbrt], abs: [Math.abs, CF.abs], round: [Math.round],
    floor: [Math.floor], ceil: [Math.ceil], trunc: [Math.trunc], sign: [Math.sign],
    exp: [Math.exp, CF.exp], ln: [Math.log, CF.ln], log: [(x) => Math.log10(x), CF.log], log2: [Math.log2],
    sin: [Math.sin, CF.sin], cos: [Math.cos, CF.cos], tan: [Math.tan, CF.tan], asin: [Math.asin], acos: [Math.acos], atan: [Math.atan],
    pow: [Math.pow, CF.pow], mod: [(a, b) => a % b], hypot: [Math.hypot],
    root: [(x, n) => Math.sign(x) * Math.pow(Math.abs(x), 1 / n)],
    logb: [(x, b) => Math.log(x) / Math.log(b)], roundto: [(x, d) => { const f = Math.pow(10, d); return Math.round(x * f) / f; }],
    frac: [(x) => x - Math.trunc(x)], clamp: [(x, lo, hi) => Math.min(Math.max(x, lo), hi)],
    deg: [(r) => r * 180 / Math.PI], rad: [(d) => d * Math.PI / 180],
    sec: [(x) => 1 / Math.cos(x)], csc: [(x) => 1 / Math.sin(x)], cot: [(x) => 1 / Math.tan(x)],
    sinh: [Math.sinh, CF.sinh], cosh: [Math.cosh, CF.cosh], tanh: [Math.tanh, CF.tanh],
    and: [(a, b) => +(!!a && !!b)], or: [(a, b) => +(!!a || !!b)], xor: [(a, b) => +(!!a !== !!b)], not: [(a) => +!a],
  };
  const FUN = {};
  Object.keys(ML).forEach((k) => { if (k[0] !== '_') FUN[k] = VAL.lift(ML[k], CF[k]); });
  Object.keys(MATHBASE).forEach((k) => { FUN[k] = VAL.lift(MATHBASE[k][0], MATHBASE[k][1]); });
  Object.assign(FUN, VAL.aggregates);
  // min/max take numbers or lists
  FUN.min = function () { return Math.min.apply(null, VAL.flat(Array.from(arguments))); };
  FUN.max = function () { return Math.max.apply(null, VAL.flat(Array.from(arguments))); };
  // gcd/lcm of numbers or of a whole list: lcm(seq(1, 20, 1))
  FUN.gcd = function () { return ML.gcd.apply(null, VAL.flat(Array.from(arguments))); };
  FUN.lcm = function () { return ML.lcm.apply(null, VAL.flat(Array.from(arguments))); };
  // Forms that bind a variable or pick a branch; evalAST handles them. The table entries only
  // let the parser accept the names (and give the non-binding meaning where there is one).
  FUN.integral = FUN.deriv = FUN.solve = FUN.if = FUN.piecewise = () => NaN;
  // complex results on purpose: csqrt(-4) = 2i, cln(-1) = iπ, cpow(-8, 1/3) = 1 + 1.732i
  FUN.csqrt = (x) => CF.sqrt(VAL.C(x)); FUN.cln = (x) => CF.ln(VAL.C(x)); FUN.cpow = (a, b) => CF.pow(VAL.C(a), VAL.C(b));
  // sum(k, a, b, expr) Σ · prod(k, a, b, expr) Π · integral(x, a, b, expr) ∫ · deriv(x, at, expr[, order])
  // · solve(x, guess, expr) or solve(x, lo, hi, expr): the x that makes expr = 0.
  const BINDER_ARITY = { sum: [4], prod: [4], integral: [4], deriv: [3, 4], solve: [3, 4] };
  const LOOP_MAX = 1000000;
  // Whether a node mentions the name anywhere inside it.
  function mentionsVar(n, name) {
    if (!n || typeof n !== 'object') return false;
    if (n.type === 'var' && n.name === name) return true;
    return Object.keys(n).some((k) => { const v = n[k]; return Array.isArray(v) ? v.some((x) => mentionsVar(x, name)) : (v && typeof v === 'object' ? mentionsVar(v, name) : false); });
  }
  function isBinder(n, scope) {
    if (n.type !== 'call') return false;
    const kind = n.name.toLowerCase();
    const ar = BINDER_ARITY[kind];
    if (!(!!ar && ar.includes(n.args.length) && n.args[0].type === 'var')) return false;
    // sum(a, b, c, d) with four values is the total of the four, not Σ: a counter
    // always appears in the expression it counts through. Taken as Σ, 1..4 summed
    // to 8 instead of 10, on the screen and in the export alike (REVIEW P7/C1).
    // A counter that is not used in what it counts -- sum(k, 1, n, 1), "1 added n
    // times" -- is still a counter when there is no value of that name to add up.
    if ((kind === 'sum' || kind === 'prod') && !mentionsVar(n.args[3], n.args[0].name)) {
      return !!scope && !Object.prototype.hasOwnProperty.call(scope, n.args[0].name);
    }
    return true;
  }
  // Which argument is the body (the part the counter lives in).
  function binderBody(n) { const k = n.name.toLowerCase(); return k === 'deriv' ? n.args[2] : n.args[n.args.length - 1]; }
  function evalBinder(n, scope) {
    const k = n.args[0].name; const kind = n.name.toLowerCase();
    const body = binderBody(n);
    const inner = Object.assign({}, scope);
    const f = (x) => { inner[k] = x; const v = evalAST(body, inner); return typeof v === 'number' ? v : NaN; };
    if (kind === 'sum' || kind === 'prod') {
      const a = evalAST(n.args[1], scope); const b = evalAST(n.args[2], scope);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b - a > LOOP_MAX) return NaN;
      let acc = kind === 'sum' ? 0 : 1;
      for (let i = Math.ceil(a); i <= b; i++) { inner[k] = i; const v = evalAST(body, inner); acc = VAL.bin(kind === 'sum' ? '+' : '*', acc, v); }
      return acc;
    }
    if (kind === 'integral') { const a = evalAST(n.args[1], scope), b = evalAST(n.args[2], scope); if (typeof a !== 'number' || typeof b !== 'number') return NaN; return a > b ? -ML._integrate(f, b, a) : ML._integrate(f, a, b); }
    if (kind === 'deriv') { const x0 = evalAST(n.args[1], scope); const ord = n.args.length === 4 ? evalAST(n.args[3], scope) : 1; return ML._derivative(f, x0, ord); }
    if (kind === 'solve') {
      if (n.args.length === 3) return ML._findRoot(f, evalAST(n.args[1], scope));
      return ML._findRoot(f, evalAST(n.args[1], scope), evalAST(n.args[2], scope));
    }
    return NaN;
  }
  const truthy = (v) => (VAL.isC(v) ? v.re !== 0 || v.im !== 0 : !!v && !Number.isNaN(v));
  const CONST = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, infinity: Infinity };
  // Named constants (CODATA 2018 / IAU / SI exact values). Lower-case lookup, like pi and e.
  const PCONST = {
    c_light: 299792458, h_planck: 6.62607015e-34, h_bar: 1.054571817e-34, g_newton: 6.67430e-11,
    k_boltz: 1.380649e-23, n_avo: 6.02214076e23, r_gas: 8.314462618, q_e: 1.602176634e-19,
    m_e: 9.1093837015e-31, m_p: 1.67262192369e-27, m_n: 1.67492749804e-27, u_amu: 1.66053906660e-27,
    eps_0: 8.8541878128e-12, mu_0: 1.25663706212e-6, k_coulomb: 8.9875517923e9, sigma_sb: 5.670374419e-8,
    alpha_fs: 7.2973525693e-3, a_bohr: 5.29177210903e-11, r_inf: 10973731.568160, f_faraday: 96485.33212,
    g_std: 9.80665, atm_pa: 101325, au_m: 149597870700, ly_m: 9460730472580800, pc_m: 3.0856775814913673e16,
    m_sun: 1.98847e30, m_earth: 5.9722e24, r_earth: 6371000, ev_j: 1.602176634e-19, cal_j: 4.184,
    euler_gamma: 0.5772156649015329, golden_ratio: 1.618033988749895, catalan_c: 0.915965594177219, apery_c: 1.2020569031595942,
  };
  Object.assign(CONST, PCONST);
  const PREC = { '<': 0, '<=': 0, '>': 0, '>=': 0, '==': 0, '!=': 0, '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
  const CMP = ['<', '<=', '>', '>=', '==', '!='];

  function tokenize(s) {
    const toks = []; let i = 0; const n = s.length;
    while (i < n) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if ((c >= '0' && c <= '9') || c === '.') {
        let j = i + 1;
        while (j < n && /[0-9.]/.test(s[j])) j++;
        if (j < n && (s[j] === 'e' || s[j] === 'E') && /[0-9+-]/.test(s[j + 1] || '')) { j++; if (j < n && (s[j] === '+' || s[j] === '-')) j++; while (j < n && /[0-9]/.test(s[j])) j++; }
        const v = parseFloat(s.slice(i, j));
        if (isNaN(v)) throw new Error('bad number');
        // an imaginary literal: a number followed directly by i (3i, 2.5i) — not by a longer name
        if (s[j] === 'i' && !/[\p{L}\p{N}_]/u.test(s[j + 1] || '')) { toks.push({ t: 'num', v, imag: true }); i = j + 1; continue; }
        toks.push({ t: 'num', v }); i = j; continue;
      }
      if (/[\p{L}_]/u.test(c)) {
        let j = i + 1;
        while (j < n && /[\p{L}\p{N}_]/u.test(s[j])) j++;
        toks.push({ t: 'id', v: s.slice(i, j) }); i = j; continue;
      }
      const two = s.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '==' || two === '!=') { toks.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/%^(),<>'.indexOf(c) >= 0) { toks.push({ t: 'op', v: c }); i++; continue; }
      throw new Error('unexpected "' + c + '"');
    }
    return toks;
  }

  // How much one calculation may ask for. A formula of a single line -- a sum
  // inside a sum, or besselj(0, 1e12) -- could keep the page busy for days, and a
  // collection shared with others froze their tab too (REVIEW C2).
  const MAX_EXPR = 10000, MAX_DEPTH = 300, BUDGET_MS = 1500;
  const BUDGET = { steps: 0, until: 0 };
  function tooLarge() { const e = new Error('The calculation is too large to finish.'); e.budget = true; return e; }
  // One calculation from the page: evalAST with a clock on it.
  function evalTop(ast, scope) {
    BUDGET.steps = 0; BUDGET.until = Date.now() + BUDGET_MS;
    try { return evalAST(ast, scope); } finally { BUDGET.until = 0; }
  }
  function parseAST(src) {
    if (String(src || '').length > MAX_EXPR) throw new Error('The formula is too long.');
    const toks = tokenize(src);
    let depth = 0;
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const expect = (v) => { const t = next(); if (!t || t.v !== v) throw new Error('expected "' + v + '"'); };
    function pExpr() { return pCmp(); }
    // comparisons bind loosest and give 1 or 0: x > 5, a == b
    function pCmp() { let l = pAdd(); while (peek() && peek().t === 'op' && CMP.includes(peek().v)) { const op = next().v; l = { type: 'bin', op, l, r: pAdd() }; } return l; }
    function pAdd() { let l = pMul(); while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const op = next().v; l = { type: 'bin', op, l, r: pMul() }; } return l; }
    function pMul() { let l = pUnary(); while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) { const op = next().v; l = { type: 'bin', op, l, r: pUnary() }; } return l; }
    // Standard math precedence: '^' binds tighter than unary minus, so -x^2 = -(x^2), and
    // '^' is right-associative with a unary right operand so 2^-3 and 2^3^2 parse correctly.
    function pUnary() {
      if (++depth > MAX_DEPTH) throw new Error('The formula is nested too deeply.');
      try { const t = peek(); if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) { next(); return { type: 'unary', op: t.v, arg: pUnary() }; } return pPow(); } finally { depth--; }
    }
    function pPow() { const l = pPrimary(); if (peek() && peek().t === 'op' && peek().v === '^') { next(); return { type: 'bin', op: '^', l, r: pUnary() }; } return l; }
    function pPrimary() {
      const t = next();
      if (!t) throw new Error('unexpected end');
      if (t.t === 'num') return t.imag ? { type: 'num', v: t.v, imag: true } : { type: 'num', v: t.v };
      if (t.t === 'op' && t.v === '(') { const e = pExpr(); expect(')'); return e; }
      if (t.t === 'id') {
        if (peek() && peek().t === 'op' && peek().v === '(') {
          next(); const args = [];
          if (!(peek() && peek().v === ')')) { args.push(pExpr()); while (peek() && peek().v === ',') { next(); args.push(pExpr()); } }
          expect(')');
          if (!FUN[t.v.toLowerCase()]) throw new Error('unknown function "' + t.v + '"');
          return { type: 'call', name: t.v, args };
        }
        if (t.v.toLowerCase() in CONST) return { type: 'const', name: t.v };
        return { type: 'var', name: t.v };
      }
      throw new Error('unexpected "' + t.v + '"');
    }
    const ast = pExpr();
    if (p < toks.length) throw new Error('unexpected "' + toks[p].v + '"');
    return ast;
  }

  function applyBin(op, a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : op === '%' ? a % b : op === '^' ? Math.pow(a, b)
        : op === '<' ? +(a < b) : op === '<=' ? +(a <= b) : op === '>' ? +(a > b) : op === '>=' ? +(a >= b) : op === '==' ? +(a === b) : +(a !== b);
    }
    return VAL.bin(op, a, b);
  }
  // A value typed into an input box: a number, a list (1, 2, 3), a matrix (1, 2; 3, 4) or a complex number (3+4i).
  // In a typed value a bare i is the imaginary unit ("1+i"); in formulas i stays an ordinary variable.
  function parseValue(raw) {
    if (typeof raw === 'number' || Array.isArray(raw) || VAL.isC(raw)) return raw;
    const s = String(raw == null ? '' : raw).trim(); if (s === '') return NaN;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
    const one = (x) => { const t = x.trim(); if (t === '') return NaN; try { return evalAST(parseAST(t), { i: new VAL.Cx(0, 1) }); } catch (e) { return NaN; } };
    if (s.indexOf(';') >= 0) return s.split(';').map((row) => row.split(/[,\s]+/).filter((x) => x !== '').map(one));
    if (/[,]/.test(s) || /\d\s+[-+]?\d/.test(s)) return s.split(/[,\s]+/).filter((x) => x !== '').map(one);
    return one(s);
  }
  function isNumericValue(v) { return typeof v === 'number'; }
  // What a variable holds: 'number' (the usual), 'list', 'matrix' or 'complex' — from its type, or
  // guessed from its default value ("1, 2, 3" is a list, "1, 2; 3, 4" a matrix, "3+4i" complex).
  function vkind(v) {
    if (v && (v.type === 'list' || v.type === 'matrix' || v.type === 'complex')) return v.type;
    const d = v && v.default != null ? String(v.default) : '';
    if (d.indexOf(';') >= 0) return 'matrix';
    if (d.indexOf(',') >= 0) return 'list';
    if (/(^|[\d+-])i$/.test(d.replace(/\s+/g, ''))) return 'complex';
    return 'number';
  }
  // The value of one input: a number for number variables, a parsed list/matrix/complex otherwise.
  // null when it cannot be read (so the result shows "—").
  function inputValue(v, raw) {
    if (raw === '' || raw == null) raw = v.default;
    if (raw === '' || raw == null) return null;
    if (vkind(v) === 'number') { const num = Number(raw); return isNaN(num) ? null : num; }
    const val = parseValue(raw);
    const bad = (x) => (Array.isArray(x) ? x.length === 0 || x.some(bad) : (typeof x === 'number' ? Number.isNaN(x) : !VAL.isC(x)));
    return bad(val) ? null : val;
  }
  // A result of any kind, as text: 12.5 · 3 + 4i · [1, 2, 3] · [1, 2; 3, 4]
  function fmtAny(v, dec, fmt) {
    if (Array.isArray(v)) return '[' + v.map((x) => (Array.isArray(x) ? x.map((y) => fmtAny(y, dec, fmt)).join(', ') : fmtAny(x, dec, fmt))).join(VAL.isM(v) ? '; ' : ', ') + ']';
    if (VAL.isC(v)) { const im = v.im; return fmt(v.re, dec) + (im < 0 ? ' − ' : ' + ') + fmt(Math.abs(im), dec) + 'i'; }
    return fmt(v, dec);
  }
  function valueOk(v) {
    if (Array.isArray(v)) return v.length > 0 && v.every(valueOk);
    if (VAL.isC(v)) return Number.isFinite(v.re) && Number.isFinite(v.im);
    return typeof v === 'number' && Number.isFinite(v);
  }
  function hasImag(n) { return !!n && (n.imag || (n.l && hasImag(n.l)) || (n.r && hasImag(n.r)) || (n.arg && hasImag(n.arg)) || (n.args && n.args.some(hasImag))); }

  function evalAST(n, scope) {
    if (BUDGET.until && (++BUDGET.steps & 4095) === 0 && Date.now() > BUDGET.until) throw tooLarge();
    switch (n.type) {
      case 'num': return n.imag ? VAL.simp(new VAL.Cx(0, n.v)) : n.v;
      case 'const': return CONST[n.name.toLowerCase()];
      case 'var':
        if (scope && Object.prototype.hasOwnProperty.call(scope, n.name)) { const v = scope[n.name]; return typeof v === 'number' ? v : (Array.isArray(v) || VAL.isC(v) ? v : Number(v)); }
        throw new Error('unknown variable "' + n.name + '"');
      case 'unary': { const a = evalAST(n.arg, scope); return n.op === '-' ? (typeof a === 'number' ? -a : VAL.neg(a)) : a; }
      case 'bin': return applyBin(n.op, evalAST(n.l, scope), evalAST(n.r, scope));
      case 'call': {
        const k = n.name.toLowerCase();
        if (isBinder(n, scope || {})) return evalBinder(n, scope);
        // if(condition, then, else) and piecewise(c1, v1, c2, v2, …, otherwise) only evaluate the branch taken
        if (k === 'if') { if (n.args.length !== 3) return NaN; const c = evalAST(n.args[0], scope); if (Array.isArray(c)) return VAL.bin('+', VAL.bin('*', c, evalAST(n.args[1], scope)), VAL.bin('*', VAL.bin('-', 1, c), evalAST(n.args[2], scope))); return truthy(c) ? evalAST(n.args[1], scope) : evalAST(n.args[2], scope); }
        if (k === 'piecewise') { for (let i = 0; i + 1 < n.args.length; i += 2) { if (truthy(evalAST(n.args[i], scope))) return evalAST(n.args[i + 1], scope); } return n.args.length % 2 ? evalAST(n.args[n.args.length - 1], scope) : NaN; }
        return FUN[k].apply(null, n.args.map((a) => evalAST(a, scope)));
      }
    }
    throw new Error('bad node');
  }

  function collectVars(n, out, seen) {
    if (n.type === 'var') { if (!seen[n.name]) { seen[n.name] = 1; out.push(n.name); } }
    else if (n.type === 'unary') collectVars(n.arg, out, seen);
    else if (n.type === 'bin') { collectVars(n.l, out, seen); collectVars(n.r, out, seen); }
    else if (n.type === 'call') {
      if (isBinder(n)) {
        // the bound variable is not an input: collect the other arguments, then the body with it hidden
        const body = binderBody(n); const k = n.args[0].name;
        n.args.slice(1).forEach((a) => { if (a !== body) collectVars(a, out, seen); });
        const was = seen[k]; seen[k] = 1;
        collectVars(body, out, seen);
        if (!was) delete seen[k];
      } else n.args.forEach((a) => collectVars(a, out, seen));
    }
    return out;
  }
  function extractVars(expr) { try { return collectVars(parseAST(expr), [], {}); } catch (e) { return []; } }

  // Numerically solve `expr` for `key` such that evaluating it (with the rest of
  // `scope` held fixed) equals `target`. Uses the secant method retried from several
  // seed points, since the expression's derivative isn't known symbolically. Returns
  // a finite number, or null if no root is found (domain error, no convergence, etc).
  function solveVar(expr, scope, key, target) {
    const ast = parseAST(expr);
    const until = Date.now() + BUDGET_MS * 2;
    const f = (x) => {
      let v;
      if (Date.now() > until) return NaN;
      BUDGET.steps = 0; BUDGET.until = until;
      try { v = evalAST(ast, Object.assign({}, scope, { [key]: x })); } catch (e) { return NaN; } finally { BUDGET.until = 0; }
      return (typeof v === 'number' && isFinite(v)) ? v - target : NaN;
    };
    const tol = 1e-13 * Math.max(1, Math.abs(target));
    for (const x0 of [1, 2, 0.5, 10, 100, -1, -10, -100, 0.1, -0.5, 1000, -1000]) {
      let x1 = x0, x2 = x0 + (Math.abs(x0) > 1e-6 ? x0 * 1e-3 : 1e-3);
      let f1 = f(x1);
      if (!isFinite(f1)) continue;
      let solved = null;
      for (let i = 0; i < 80; i++) {
        const f2 = f(x2);
        if (!isFinite(f2)) { x2 = (x2 + x1) / 2; continue; }
        if (Math.abs(f2) < tol) { solved = x2; break; }
        const denom = f2 - f1;
        if (denom === 0) break;
        const xNext = x2 - f2 * (x2 - x1) / denom;
        if (!isFinite(xNext) || Math.abs(xNext) > 1e15) break;
        x1 = x2; f1 = f2; x2 = xNext;
      }
      if (solved != null) {
        const verify = f(solved);
        if (isFinite(verify) && Math.abs(verify) < 1e-6 * Math.max(1, Math.abs(target)) + 1e-6) return solved;
      }
    }
    return null;
  }

  function fmtV(v) { if (!isFinite(v)) return String(v); const nn = Number(v.toPrecision(12)); return String(nn); }

  function nodePrec(n) { return n.type === 'bin' ? PREC[n.op] : n.type === 'unary' ? 4 : 5; }
  function side(n, p, eq) { const np = nodePrec(n); const need = eq ? np <= p : np < p; return need ? '(' + pr(n) + ')' : pr(n); }
  function pr(n) {
    switch (n.type) {
      case 'num': return fmtV(n.v) + (n.imag ? 'i' : '');
      case 'var': return n.name;
      case 'const': return n.name;
      case 'unary': return n.op + side(n.arg, 4, false);
      case 'bin': {
        const p = PREC[n.op];
        const l = side(n.l, p, n.op === '^');
        const r = side(n.r, p, (n.op === '-' || n.op === '/' || n.op === '%'));
        return l + ' ' + n.op + ' ' + r;
      }
      case 'call': return n.name + '(' + n.args.map(pr).join(', ') + ')';
    }
    return '?';
  }

  /* ---------- Real-math rendering: AST → MathML (native, no external lib) ----------
   * Turns the machine-style expression (*, /, ^, sqrt, pi…) into proper notation:
   * fraction bars, raised exponents, radical signs, ×, π/τ. Emitted as a MathML
   * string and injected via v-html; browsers render it as genuine mathematics. */
  function mlEscape(s) { return String(s).replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); }
  // Single letters are italicised (real variable style); word-length names stay upright and readable.
  function mlIdent(name) { return name.length > 1 ? '<mi mathvariant="normal">' + mlEscape(name) + '</mi>' : '<mi>' + mlEscape(name) + '</mi>'; }
  function mlParen(inner) { return '<mrow><mo>(</mo>' + inner + '<mo>)</mo></mrow>'; }
  const ML_GREEK = { pi: 'π', tau: 'τ' };
  // A child rendered as a fraction (or raised power) is already visually grouped, so it never needs parentheses.
  function mlSide(n, p, eq) {
    if (n.type === 'bin' && (n.op === '/' || n.op === '^')) return ml(n);
    const np = nodePrec(n);
    const need = eq ? np <= p : np < p;
    const s = ml(n);
    return need ? mlParen(s) : s;
  }
  function ml(n) {
    switch (n.type) {
      case 'num': return '<mn>' + mlEscape(fmtV(n.v)) + '</mn>' + (n.imag ? '<mi>i</mi>' : '');
      case 'var': return mlIdent(n.name);
      case 'const': { const k = n.name.toLowerCase(); return '<mi>' + mlEscape(ML_GREEK[k] || n.name) + '</mi>'; }
      case 'unary': return '<mo>' + (n.op === '-' ? '−' : '+') + '</mo>' + mlSide(n.arg, 4, false);
      case 'bin': {
        if (n.op === '/') return '<mfrac><mrow>' + ml(n.l) + '</mrow><mrow>' + ml(n.r) + '</mrow></mfrac>';
        if (n.op === '^') { const base = (n.l.type === 'bin' || n.l.type === 'unary') ? mlParen(ml(n.l)) : ml(n.l); return '<msup><mrow>' + base + '</mrow><mrow>' + ml(n.r) + '</mrow></msup>'; }
        const p = PREC[n.op];
        const l = mlSide(n.l, p, false);
        const r = mlSide(n.r, p, (n.op === '-' || n.op === '%'));
        const op = n.op === '%' ? '<mo lspace="0.28em" rspace="0.28em">mod</mo>' : '<mo>' + (OP_GLYPH[n.op] || '×') + '</mo>';
        return l + op + r;
      }
      case 'call': {
        const k = n.name.toLowerCase();
        if (k === 'sqrt' && n.args.length === 1) return '<msqrt>' + ml(n.args[0]) + '</msqrt>';
        if (k === 'cbrt' && n.args.length === 1) return '<mroot><mrow>' + ml(n.args[0]) + '</mrow><mn>3</mn></mroot>';
        if (k === 'root' && n.args.length === 2) return '<mroot><mrow>' + ml(n.args[0]) + '</mrow><mrow>' + ml(n.args[1]) + '</mrow></mroot>';
        if (k === 'abs' && n.args.length === 1) return '<mrow><mo>|</mo>' + ml(n.args[0]) + '<mo>|</mo></mrow>';
        if (k === 'fact' && n.args.length === 1) return '<mrow>' + mlSide(n.args[0], 5, true) + '<mo>!</mo></mrow>';
        if (k === 'binom' && n.args.length === 2) return '<mrow><mo>(</mo><mfrac linethickness="0"><mrow>' + ml(n.args[0]) + '</mrow><mrow>' + ml(n.args[1]) + '</mrow></mfrac><mo>)</mo></mrow>';
        if (k === 'floor' && n.args.length === 1) return '<mrow><mo>⌊</mo>' + ml(n.args[0]) + '<mo>⌋</mo></mrow>';
        if (k === 'ceil' && n.args.length === 1) return '<mrow><mo>⌈</mo>' + ml(n.args[0]) + '<mo>⌉</mo></mrow>';
        if (isBinder(n) && k === 'integral') {
          return '<mrow><msubsup><mo>∫</mo><mrow>' + ml(n.args[1]) + '</mrow><mrow>' + ml(n.args[2]) + '</mrow></msubsup>' + ml(n.args[3]) + '<mspace width="0.2em"/><mi mathvariant="normal">d</mi>' + mlIdent(n.args[0].name) + '</mrow>';
        }
        if (isBinder(n) && k === 'deriv') {
          const ord = n.args.length === 4 ? ml(n.args[3]) : null;
          const d = ord ? '<msup><mi mathvariant="normal">d</mi>' + ord + '</msup>' : '<mi mathvariant="normal">d</mi>';
          const dx = ord ? '<msup>' + mlIdent(n.args[0].name) + ord + '</msup>' : mlIdent(n.args[0].name);
          return '<mrow><mfrac><mrow>' + d + '</mrow><mrow><mi mathvariant="normal">d</mi>' + dx + '</mrow></mfrac>' + mlParen(ml(n.args[2])) + '<msub><mo>|</mo><mrow>' + mlIdent(n.args[0].name) + '<mo>=</mo>' + ml(n.args[1]) + '</mrow></msub></mrow>';
        }
        if (isBinder(n) && (k === 'sum' || k === 'prod')) {
          return '<mrow><munderover><mo>' + (k === 'sum' ? '∑' : '∏') + '</mo><mrow>' + mlIdent(n.args[0].name) + '<mo>=</mo>' + ml(n.args[1]) + '</mrow><mrow>' + ml(n.args[2]) + '</mrow></munderover>' + mlParen(ml(n.args[3])) + '</mrow>';
        }
        const args = n.args.map(function (a) { return ml(a); }).join('<mo>,</mo>');
        return '<mi mathvariant="normal">' + mlEscape(n.name) + '</mi><mo>(</mo>' + args + '<mo>)</mo>';
      }
    }
    return '';
  }
  const OP_GLYPH = { '+': '+', '-': '−', '*': '×', '<': '<', '<=': '≤', '>': '>', '>=': '≥', '==': '=', '!=': '≠' };
  function mathmlOf(ast) { return '<math xmlns="http://www.w3.org/1998/Math/MathML">' + ml(ast) + '</math>'; }

  /* ---------- AST -> Canvas 2D typesetting (mirrors ml()/mlSide() above) ----------
   * Rasterising the MathML itself (svg foreignObject -> Image -> canvas) taints the canvas —
   * Chromium refuses to export pixels derived from foreignObject content, even same-origin. This
   * draws the same fraction bars / radicals / raised exponents directly with Canvas 2D primitives
   * (fillText + strokes only, nothing loaded from an image), so the exported picture matches what
   * the app displays on screen without ever touching an <img>/<svg>.
   * Returns a layout box: {w, above, below, draw(x, yBaseline)}. */
  function cLayout(ctx, n, size) {
    const REG = ''; const ITAL = 'italic ';
    function font(style, sz) { return style + Math.max(1, sz) + 'px Georgia, "Times New Roman", serif'; }
    function textBox(text, style, sz) {
      ctx.font = font(style, sz);
      const w = ctx.measureText(text).width;
      return { w, above: sz * 0.72, below: sz * 0.22, draw(x, y) { ctx.font = font(style, sz); ctx.fillText(text, x, y); } };
    }
    function hbox(parts) {
      const w = parts.reduce((s, p) => s + p.w, 0);
      const above = parts.length ? Math.max.apply(null, parts.map((p) => p.above)) : size * 0.72;
      const below = parts.length ? Math.max.apply(null, parts.map((p) => p.below)) : size * 0.22;
      return { w, above, below, draw(x, y) { let cx = x; parts.forEach((p) => { p.draw(cx, y); cx += p.w; }); } };
    }
    function parenWrap(inner, sz) { return hbox([textBox('(', REG, sz), inner, textBox(')', REG, sz)]); }
    function nprec(nd) { return nd.type === 'bin' ? PREC[nd.op] : nd.type === 'unary' ? 4 : 5; }
    function side(nd, p, eq, sz) {
      if (nd.type === 'bin' && (nd.op === '/' || nd.op === '^')) return build(nd, sz);
      const need = eq ? nprec(nd) <= p : nprec(nd) < p;
      const b = build(nd, sz);
      return need ? parenWrap(b, sz) : b;
    }
    function radical(inner, sz, indexStr) {
      const hookW = sz * 0.5; const barH = Math.max(1, sz * 0.06); const pad = sz * 0.15;
      const above = inner.above + sz * 0.25; const below = inner.below;
      const w = hookW + inner.w + pad * 2 + (indexStr ? sz * 0.35 : 0);
      const ix = indexStr ? sz * 0.35 : 0;
      return {
        w, above, below,
        draw(x, y) {
          ctx.save();
          ctx.strokeStyle = '#111111'; ctx.lineWidth = barH; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(x + ix, y - inner.below - (inner.above + inner.below) * 0.12);
          ctx.lineTo(x + ix + hookW * 0.35, y + inner.below * 0.6);
          ctx.lineTo(x + ix + hookW * 0.6, y - above);
          ctx.lineTo(x + ix + hookW + inner.w + pad * 2, y - above);
          ctx.stroke();
          ctx.restore();
          if (indexStr) { ctx.font = font(REG, sz * 0.5); ctx.fillText(indexStr, x, y - above * 0.7); }
          inner.draw(x + ix + hookW * 0.6 + pad, y);
        },
      };
    }
    function build(nd, sz) {
      switch (nd.type) {
        case 'num': return textBox(fmtV(nd.v) + (nd.imag ? 'i' : ''), REG, sz);
        case 'var': return textBox(nd.name, nd.name.length === 1 ? ITAL : REG, sz);
        case 'const': { const k = nd.name.toLowerCase(); return textBox(ML_GREEK[k] || nd.name, REG, sz); }
        case 'unary': return hbox([textBox(nd.op === '-' ? '−' : '+', REG, sz), side(nd.arg, 4, false, sz)]);
        case 'bin': {
          if (nd.op === '/') {
            const num = build(nd.l, sz * 0.92); const den = build(nd.r, sz * 0.92);
            const w = Math.max(num.w, den.w) + sz * 0.3; const gap = sz * 0.12; const barW = Math.max(1, sz * 0.06);
            return {
              w, above: num.above + num.below + gap + barW, below: den.above + den.below + gap + barW,
              draw(x, y) {
                num.draw(x + (w - num.w) / 2, y - gap - barW - num.below);
                den.draw(x + (w - den.w) / 2, y + gap + barW + den.above);
                ctx.save(); ctx.beginPath(); ctx.lineWidth = barW; ctx.strokeStyle = '#111111';
                ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke(); ctx.restore();
              },
            };
          }
          if (nd.op === '^') {
            const baseNeedsParen = nd.l.type === 'bin' || nd.l.type === 'unary';
            const base = baseNeedsParen ? parenWrap(build(nd.l, sz), sz) : build(nd.l, sz);
            const exp = build(nd.r, sz * 0.62);
            return { w: base.w + exp.w, above: base.above + exp.above * 0.55, below: base.below,
              draw(x, y) { base.draw(x, y); exp.draw(x + base.w, y - base.above * 0.55); } };
          }
          const p = PREC[nd.op];
          const l = side(nd.l, p, false, sz);
          const r = side(nd.r, p, (nd.op === '-' || nd.op === '%'), sz);
          const opStr = nd.op === '%' ? ' mod ' : (' ' + (OP_GLYPH[nd.op] || '×') + ' ');
          return hbox([l, textBox(opStr, REG, sz), r]);
        }
        case 'call': {
          const k = nd.name.toLowerCase();
          if (k === 'sqrt' && nd.args.length === 1) return radical(build(nd.args[0], sz), sz, null);
          if (k === 'cbrt' && nd.args.length === 1) return radical(build(nd.args[0], sz), sz, '3');
          if (k === 'root' && nd.args.length === 2) return radical(build(nd.args[0], sz), sz, pr(nd.args[1]));
          if (k === 'abs' && nd.args.length === 1) return hbox([textBox('|', REG, sz), build(nd.args[0], sz), textBox('|', REG, sz)]);
          const parts = [textBox(nd.name + '(', REG, sz)];
          nd.args.forEach((a, i) => { if (i > 0) parts.push(textBox(', ', REG, sz)); parts.push(build(a, sz)); });
          parts.push(textBox(')', REG, sz));
          return hbox(parts);
        }
      }
      return textBox('?', REG, sz);
    }
    return build(n, size);
  }

  function subst(n, scope) {
    switch (n.type) {
      case 'num': return n;
      case 'const': return { type: 'num', v: CONST[n.name.toLowerCase()] };
      case 'var': return { type: 'num', v: Number(scope[n.name]) };
      case 'unary': return { type: 'unary', op: n.op, arg: subst(n.arg, scope) };
      case 'bin': return { type: 'bin', op: n.op, l: subst(n.l, scope), r: subst(n.r, scope) };
      case 'call':
        if (isBinder(n)) {
          const inner = Object.assign({}, scope); delete inner[n.args[0].name]; const body = binderBody(n);
          return { type: 'call', name: n.name, args: n.args.map((a, i) => (i === 0 ? a : a === body ? substKeep(a, inner, n.args[0].name) : subst(a, scope))) };
        }
        return { type: 'call', name: n.name, args: n.args.map((a) => subst(a, scope)) };
    }
    return n;
  }
  // subst() for the body of a Σ/Π: the counter stays a variable.
  function substKeep(n, scope, keep) {
    if (n.type === 'var' && n.name === keep) return n;
    if (n.type === 'var') return { type: 'num', v: Number(scope[n.name]) };
    if (n.type === 'unary') return { type: 'unary', op: n.op, arg: substKeep(n.arg, scope, keep) };
    if (n.type === 'bin') return { type: 'bin', op: n.op, l: substKeep(n.l, scope, keep), r: substKeep(n.r, scope, keep) };
    if (n.type === 'call') return { type: 'call', name: n.name, args: n.args.map((a) => substKeep(a, scope, keep)) };
    if (n.type === 'const') return { type: 'num', v: CONST[n.name.toLowerCase()] };
    return n;
  }

  // Reduce ONE innermost operation whose operands are already numbers.
  function reduceStep(n) {
    if (n.type === 'num' || n.type === 'var' || n.type === 'const') return [n, false];
    if (n.type === 'unary') {
      if (n.arg.type === 'num') return [{ type: 'num', v: n.op === '-' ? -n.arg.v : n.arg.v }, true];
      const [a, ch] = reduceStep(n.arg); return [{ type: 'unary', op: n.op, arg: a }, ch];
    }
    if (n.type === 'bin') {
      if (n.l.type !== 'num') { const [l, ch] = reduceStep(n.l); if (ch) return [{ type: 'bin', op: n.op, l, r: n.r }, true]; }
      if (n.r.type !== 'num') { const [r, ch] = reduceStep(n.r); if (ch) return [{ type: 'bin', op: n.op, l: n.l, r }, true]; }
      if (n.l.type === 'num' && n.r.type === 'num') return [{ type: 'num', v: applyBin(n.op, n.l.v, n.r.v) }, true];
      return [n, false];
    }
    if (n.type === 'call' && (isBinder(n) || ['if', 'piecewise'].includes(n.name.toLowerCase()))) {
      // a whole Σ/Π/∫/if is one step: reduce its other arguments, then evaluate it at once
      const body = isBinder(n) ? binderBody(n) : null;
      for (let k = isBinder(n) ? 1 : 0; k < n.args.length; k++) { if (n.args[k] === body || n.args[k].type === 'num') continue; if (!isBinder(n)) break; const [a, ch] = reduceStep(n.args[k]); if (ch) { const args = n.args.slice(); args[k] = a; return [{ type: 'call', name: n.name, args }, true]; } }
      return [{ type: 'num', v: evalTop(n, {}) }, true];
    }
    if (n.type === 'call') {
      for (let k = 0; k < n.args.length; k++) {
        if (n.args[k].type !== 'num') { const [a, ch] = reduceStep(n.args[k]); if (ch) { const args = n.args.slice(); args[k] = a; return [{ type: 'call', name: n.name, args }, true]; } }
      }
      if (n.args.every((a) => a.type === 'num')) return [{ type: 'num', v: FUN[n.name.toLowerCase()].apply(null, n.args.map((a) => a.v)) }, true];
      return [n, false];
    }
    return [n, false];
  }

  // Emoji palette for the collection icon picker. Grouped by theme; the label is an
  // English translation key (t()-wrapped in the template) so ja/en both render.
  // Curated calculation/maths emoji shown as the first tab of the icon picker. The rest of
  // the palette is the full Unicode 14.0 set, fetched from /api/emoji when first opened.
  const ICONS = [
    { key: 'Calculation', tab: '🧮', e: '🧮 📐 📏 🔢 ➕ ➖ ✖️ ➗ 🟰 📊 📈 📉 💹 💲 💱 🔟'.split(' ') },
  ];

  /* FUNCHELP-BEGIN — generated from regibase-build/fb-data/funchelp.py */
  const FUNC_HELP = [{"g": "Basic", "s": "sqrt(x)", "t": "sqrt()", "d": "Square root"}, {"g": "Basic", "s": "cbrt(x)", "t": "cbrt()", "d": "Cube root"}, {"g": "Basic", "s": "root(x, n)", "t": "root()", "d": "n-th root"}, {"g": "Basic", "s": "abs(x)", "t": "abs()", "d": "Absolute value (magnitude of a complex number)"}, {"g": "Basic", "s": "exp(x)", "t": "exp()", "d": "e to the power x"}, {"g": "Basic", "s": "ln(x)", "t": "ln()", "d": "Natural logarithm"}, {"g": "Basic", "s": "log(x)", "t": "log()", "d": "Common logarithm (base 10)"}, {"g": "Basic", "s": "log2(x)", "t": "log2()", "d": "Binary logarithm (base 2)"}, {"g": "Basic", "s": "logb(x, b)", "t": "logb()", "d": "Logarithm of x to base b"}, {"g": "Basic", "s": "pow(a, b)", "t": "pow()", "d": "a to the power b (same as a^b)"}, {"g": "Basic", "s": "mod(a, b)", "t": "mod()", "d": "Remainder of a divided by b"}, {"g": "Basic", "s": "hypot(a, b, …)", "t": "hypot()", "d": "Square root of the sum of squares"}, {"g": "Basic", "s": "round(x)", "t": "round()", "d": "Round to the nearest integer"}, {"g": "Basic", "s": "roundto(x, d)", "t": "roundto()", "d": "Round to d decimal places"}, {"g": "Basic", "s": "floor(x)", "t": "floor()", "d": "Round down"}, {"g": "Basic", "s": "ceil(x)", "t": "ceil()", "d": "Round up"}, {"g": "Basic", "s": "trunc(x)", "t": "trunc()", "d": "Drop the fractional part"}, {"g": "Basic", "s": "frac(x)", "t": "frac()", "d": "Fractional part"}, {"g": "Basic", "s": "sign(x)", "t": "sign()", "d": "Sign: −1, 0 or 1"}, {"g": "Basic", "s": "min(a, b, …)", "t": "min()", "d": "Smallest value (numbers or lists)"}, {"g": "Basic", "s": "max(a, b, …)", "t": "max()", "d": "Largest value (numbers or lists)"}, {"g": "Basic", "s": "clamp(x, lo, hi)", "t": "clamp()", "d": "Limit x to the range lo…hi"}, {"g": "Trigonometry", "s": "sin(x)  cos(x)  tan(x)", "t": "sin()", "d": "Sine, cosine, tangent (x in radians)"}, {"g": "Trigonometry", "s": "sec(x)  csc(x)  cot(x)", "t": "sec()", "d": "Secant, cosecant, cotangent"}, {"g": "Trigonometry", "s": "asin(x)  acos(x)  atan(x)", "t": "asin()", "d": "Inverse sine, cosine, tangent (result in radians)"}, {"g": "Trigonometry", "s": "atan2(y, x)", "t": "atan2()", "d": "Angle of the point (x, y), from −π to π"}, {"g": "Trigonometry", "s": "sinh(x)  cosh(x)  tanh(x)", "t": "sinh()", "d": "Hyperbolic sine, cosine, tangent"}, {"g": "Trigonometry", "s": "asinh(x)  acosh(x)  atanh(x)", "t": "asinh()", "d": "Inverse hyperbolic functions"}, {"g": "Trigonometry", "s": "deg(r)", "t": "deg()", "d": "Radians to degrees"}, {"g": "Trigonometry", "s": "rad(d)", "t": "rad()", "d": "Degrees to radians"}, {"g": "Conditions", "s": "if(c, a, b)", "t": "if()", "d": "a when the condition c holds, otherwise b"}, {"g": "Conditions", "s": "piecewise(c1, v1, c2, v2, …, other)", "t": "piecewise()", "d": "The value of the first condition that holds (a piecewise function)"}, {"g": "Conditions", "s": "a < b   a <= b   a > b   a >= b   a == b   a != b", "t": " < ", "d": "Comparisons: 1 when true, 0 when false"}, {"g": "Conditions", "s": "and(a, b)  or(a, b)  xor(a, b)  not(a)", "t": "and()", "d": "Logical operations on conditions"}, {"g": "Calculus", "s": "sum(k, a, b, expr)", "t": "sum(k, 1, n, )", "d": "Σ: the sum of expr for k = a, a+1, …, b"}, {"g": "Calculus", "s": "prod(k, a, b, expr)", "t": "prod(k, 1, n, )", "d": "Π: the product of expr for k = a…b"}, {"g": "Calculus", "s": "integral(x, a, b, expr)", "t": "integral(x, 0, 1, )", "d": "∫: the definite integral of expr from a to b (limits may be ±infinity)"}, {"g": "Calculus", "s": "deriv(x, at, expr, n)", "t": "deriv(x, 0, )", "d": "The n-th derivative of expr at x = at (n = 1 to 4, default 1)"}, {"g": "Calculus", "s": "solve(x, guess, expr)", "t": "solve(x, 1, )", "d": "The x near guess that makes expr equal to 0"}, {"g": "Calculus", "s": "solve(x, lo, hi, expr)", "t": "solve(x, 0, 1, )", "d": "The x between lo and hi that makes expr equal to 0"}, {"g": "Lists", "s": "1, 2, 3", "t": "", "d": "Type a list into a list variable, separated by commas"}, {"g": "Lists", "s": "list(a, b, …)", "t": "list()", "d": "Make a list"}, {"g": "Lists", "s": "seq(a, b, step)", "t": "seq()", "d": "The list a, a+step, …, b"}, {"g": "Lists", "s": "count(v)", "t": "count()", "d": "Number of items"}, {"g": "Lists", "s": "at(v, i)", "t": "at()", "d": "The i-th item (from 1)"}, {"g": "Lists", "s": "sort(v)", "t": "sort()", "d": "Sorted list"}, {"g": "Lists", "s": "cumsum(v)", "t": "cumsum()", "d": "Running totals"}, {"g": "Lists", "s": "cummax(v)  cummin(v)", "t": "cummax()", "d": "Running maximum and minimum (peak so far)"}, {"g": "Lists", "s": "diff(v)", "t": "diff()", "d": "Differences between neighbours"}, {"g": "Statistics", "s": "sum(v)  prod(v)", "t": "sum()", "d": "Total and product of a list"}, {"g": "Statistics", "s": "mean(v)", "t": "mean()", "d": "Arithmetic mean"}, {"g": "Statistics", "s": "median(v)", "t": "median()", "d": "Median"}, {"g": "Statistics", "s": "mode(v)", "t": "mode()", "d": "Most frequent value"}, {"g": "Statistics", "s": "var(v)  stdev(v)", "t": "stdev()", "d": "Sample variance and standard deviation (n − 1)"}, {"g": "Statistics", "s": "varp(v)  stdevp(v)", "t": "stdevp()", "d": "Population variance and standard deviation (n)"}, {"g": "Statistics", "s": "gmean(v)  hmean(v)", "t": "gmean()", "d": "Geometric and harmonic mean"}, {"g": "Statistics", "s": "wmean(x, w)", "t": "wmean()", "d": "Weighted mean of x with weights w"}, {"g": "Statistics", "s": "percentile(v, p)", "t": "percentile()", "d": "Percentile, p from 0 to 1 (interpolated)"}, {"g": "Statistics", "s": "skew(v)  kurt(v)", "t": "skew()", "d": "Sample skewness and excess kurtosis"}, {"g": "Statistics", "s": "cov(x, y)  corr(x, y)", "t": "corr()", "d": "Sample covariance and correlation"}, {"g": "Statistics", "s": "slope(x, y)  intercept(x, y)  rsq(x, y)", "t": "slope()", "d": "Least-squares line and its R²"}, {"g": "Cash flows", "s": "npv(r, cf)", "t": "npv()", "d": "Net present value; cf[1] is at time 0"}, {"g": "Cash flows", "s": "irr(cf)", "t": "irr()", "d": "Internal rate of return"}, {"g": "Cash flows", "s": "mirr(cf, fr, rr)", "t": "mirr()", "d": "Modified IRR (finance rate fr, reinvestment rate rr)"}, {"g": "Vectors and matrices", "s": "1, 2; 3, 4", "t": "", "d": "Type a matrix into a matrix variable: rows separated by semicolons"}, {"g": "Vectors and matrices", "s": "dot(u, v)  cross(u, v)", "t": "dot()", "d": "Dot and cross product"}, {"g": "Vectors and matrices", "s": "norm(v)", "t": "norm()", "d": "Length of a vector (Euclidean norm)"}, {"g": "Vectors and matrices", "s": "det(M)  trace(M)", "t": "det()", "d": "Determinant and trace"}, {"g": "Vectors and matrices", "s": "inv(M)  trans(M)", "t": "inv()", "d": "Inverse and transpose"}, {"g": "Vectors and matrices", "s": "mmul(A, B)", "t": "mmul()", "d": "Matrix product"}, {"g": "Vectors and matrices", "s": "linsolve(A, b)", "t": "linsolve()", "d": "Solve the linear system A·x = b"}, {"g": "Vectors and matrices", "s": "eye(n)", "t": "eye()", "d": "n × n identity matrix"}, {"g": "Complex numbers", "s": "3 + 4i", "t": "", "d": "A complex number: a number followed by i"}, {"g": "Complex numbers", "s": "re(z)  im(z)", "t": "re()", "d": "Real and imaginary part"}, {"g": "Complex numbers", "s": "abs(z)  arg(z)", "t": "arg()", "d": "Modulus and argument (angle)"}, {"g": "Complex numbers", "s": "conj(z)", "t": "conj()", "d": "Complex conjugate"}, {"g": "Complex numbers", "s": "polar(r, θ)", "t": "polar()", "d": "The complex number with modulus r and angle θ"}, {"g": "Complex numbers", "s": "csqrt(x)  cln(x)  cpow(a, b)", "t": "csqrt()", "d": "Square root, logarithm and power with complex results (csqrt(−4) = 2i)"}, {"g": "Number theory", "s": "gcd(a, b, …)  lcm(a, b, …)", "t": "gcd()", "d": "Greatest common divisor and least common multiple (of numbers or a list)"}, {"g": "Number theory", "s": "fact(n)", "t": "fact()", "d": "Factorial n!"}, {"g": "Number theory", "s": "binom(n, k)  perm(n, k)", "t": "binom()", "d": "Combinations and permutations"}, {"g": "Number theory", "s": "isprime(n)", "t": "isprime()", "d": "1 if n is prime, otherwise 0"}, {"g": "Number theory", "s": "nextprime(n)  prevprime(n)", "t": "nextprime()", "d": "Next and previous prime"}, {"g": "Number theory", "s": "primepi(x)", "t": "primepi()", "d": "Number of primes up to x (exact up to 10¹¹)"}, {"g": "Number theory", "s": "nthprime(n)", "t": "nthprime()", "d": "The n-th prime"}, {"g": "Number theory", "s": "phi(n)", "t": "phi()", "d": "Euler's totient"}, {"g": "Number theory", "s": "sigma(n, k)", "t": "sigma()", "d": "Sum of the k-th powers of the divisors (k = 1 by default)"}, {"g": "Number theory", "s": "tau(n)", "t": "tau()", "d": "Number of divisors"}, {"g": "Number theory", "s": "mu(n)", "t": "mu()", "d": "Möbius function"}, {"g": "Number theory", "s": "omega(n)  bigomega(n)", "t": "omega()", "d": "Number of distinct prime factors, and with multiplicity"}, {"g": "Number theory", "s": "radical(n)  lpf(n)  gpf(n)", "t": "radical()", "d": "Product of the distinct primes; smallest and largest prime factor"}, {"g": "Number theory", "s": "carmichael(n)", "t": "carmichael()", "d": "Carmichael function λ(n)"}, {"g": "Number theory", "s": "powmod(a, b, m)", "t": "powmod()", "d": "a^b mod m, exact"}, {"g": "Number theory", "s": "modinv(a, m)", "t": "modinv()", "d": "Inverse of a modulo m"}, {"g": "Number theory", "s": "crt(a1, m1, a2, m2, …)", "t": "crt()", "d": "Chinese remainder theorem: x ≡ a1 (mod m1), x ≡ a2 (mod m2)"}, {"g": "Number theory", "s": "factmod(n, m)", "t": "factmod()", "d": "n! mod m, exact"}, {"g": "Number theory", "s": "fib(n)  lucas(n)", "t": "fib()", "d": "Fibonacci and Lucas numbers"}, {"g": "Number theory", "s": "catalan(n)  bell(n)  partitions(n)", "t": "catalan()", "d": "Catalan numbers, Bell numbers, partition numbers p(n)"}, {"g": "Number theory", "s": "stirling1(n, k)  stirling2(n, k)", "t": "stirling2()", "d": "Stirling numbers of the first (unsigned) and second kind"}, {"g": "Number theory", "s": "derange(n)", "t": "derange()", "d": "Derangements (subfactorial !n)"}, {"g": "Number theory", "s": "digitsum(n, b)  digitalroot(n)", "t": "digitsum()", "d": "Sum of digits (in base b) and digital root"}, {"g": "Number theory", "s": "numdigits(n, b)  reversenum(n)", "t": "numdigits()", "d": "Number of digits; digits reversed"}, {"g": "Number theory", "s": "collatz(n)", "t": "collatz()", "d": "Steps for the Collatz sequence to reach 1"}, {"g": "Number theory", "s": "legendre(a, p)  jacobi(a, n)", "t": "legendre()", "d": "Legendre and Jacobi symbols"}, {"g": "Number theory", "s": "ord(a, n)  primroot(n)", "t": "ord()", "d": "Multiplicative order; smallest primitive root"}, {"g": "Number theory", "s": "isqrt(n)  issquare(n)  isperfect(n)", "t": "isqrt()", "d": "Integer square root; perfect-square and perfect-number tests"}, {"g": "Special functions", "s": "gamma(x)  lgamma(x)", "t": "gamma()", "d": "Gamma function and its logarithm"}, {"g": "Special functions", "s": "beta(a, b)  digamma(x)", "t": "beta()", "d": "Beta function; digamma ψ(x)"}, {"g": "Special functions", "s": "erf(x)  erfc(x)  erfinv(y)", "t": "erf()", "d": "Error function, complementary, inverse"}, {"g": "Special functions", "s": "gammainc(a, x)  gammaincc(a, x)", "t": "gammainc()", "d": "Regularised incomplete gamma P and Q"}, {"g": "Special functions", "s": "betainc(x, a, b)", "t": "betainc()", "d": "Regularised incomplete beta"}, {"g": "Special functions", "s": "zeta(s)", "t": "zeta()", "d": "Riemann zeta function"}, {"g": "Special functions", "s": "li(x)  ei(x)  expint(x)", "t": "li()", "d": "Logarithmic integral, exponential integrals Ei and E₁"}, {"g": "Special functions", "s": "si(x)  ci(x)", "t": "si()", "d": "Sine and cosine integrals"}, {"g": "Special functions", "s": "lambertw(x)", "t": "lambertw()", "d": "Lambert W (principal branch)"}, {"g": "Special functions", "s": "besselj(n, x)  bessely(n, x)", "t": "besselj()", "d": "Bessel functions J and Y of integer order"}, {"g": "Special functions", "s": "besseli(n, x)  besselk(n, x)", "t": "besseli()", "d": "Modified Bessel functions I and K"}, {"g": "Special functions", "s": "ellipk(k)  ellipe(k)", "t": "ellipk()", "d": "Complete elliptic integrals K and E (modulus k)"}, {"g": "Special functions", "s": "ellipf(φ, k)  ellipeinc(φ, k)", "t": "ellipf()", "d": "Incomplete elliptic integrals F and E"}, {"g": "Special functions", "s": "polylog(s, z)", "t": "polylog()", "d": "Polylogarithm Li_s(z), −1 ≤ z ≤ 1"}, {"g": "Distributions", "s": "normpdf(x, μ, σ)  normcdf(x, μ, σ)  norminv(p, μ, σ)", "t": "normcdf()", "d": "Normal distribution (μ = 0, σ = 1 by default)"}, {"g": "Distributions", "s": "tpdf(x, ν)  tcdf(x, ν)  tinv(p, ν)", "t": "tcdf()", "d": "Student's t distribution"}, {"g": "Distributions", "s": "chi2pdf(x, k)  chi2cdf(x, k)  chi2inv(p, k)", "t": "chi2cdf()", "d": "Chi-squared distribution"}, {"g": "Distributions", "s": "fpdf(x, d1, d2)  fcdf  finv", "t": "fcdf()", "d": "F distribution"}, {"g": "Distributions", "s": "binompdf(k, n, p)  binomcdf(k, n, p)", "t": "binompdf()", "d": "Binomial distribution"}, {"g": "Distributions", "s": "poisspdf(k, λ)  poisscdf(k, λ)", "t": "poisspdf()", "d": "Poisson distribution"}, {"g": "Distributions", "s": "exppdf(x, λ)  expcdf  expinv", "t": "expcdf()", "d": "Exponential distribution (rate λ)"}, {"g": "Distributions", "s": "gammapdf(x, k, θ)  gammacdf  gammainv", "t": "gammacdf()", "d": "Gamma distribution (shape k, scale θ)"}, {"g": "Distributions", "s": "betapdf(x, a, b)  betacdf  betainv", "t": "betacdf()", "d": "Beta distribution"}, {"g": "Distributions", "s": "lognpdf(x, μ, σ)  logncdf  logninv", "t": "logncdf()", "d": "Log-normal distribution"}, {"g": "Distributions", "s": "weibpdf(x, k, λ)  weibcdf  weibinv", "t": "weibcdf()", "d": "Weibull distribution"}, {"g": "Distributions", "s": "geompdf(k, p)  geomcdf(k, p)", "t": "geompdf()", "d": "Geometric distribution (trials until the first success)"}, {"g": "Distributions", "s": "hygepdf(k, N, K, n)", "t": "hygepdf()", "d": "Hypergeometric distribution"}, {"g": "Distributions", "s": "nbinpdf(k, r, p)", "t": "nbinpdf()", "d": "Negative binomial distribution (failures before the r-th success)"}, {"g": "Constants", "s": "pi  e  tau  infinity", "t": "pi", "d": "π, e, 2π and infinity"}, {"g": "Constants", "s": "c_light", "t": "c_light", "d": "Speed of light in vacuum, m/s"}, {"g": "Constants", "s": "h_planck  h_bar", "t": "h_planck", "d": "Planck constant and reduced Planck constant, J·s"}, {"g": "Constants", "s": "g_newton", "t": "g_newton", "d": "Gravitational constant, m³/(kg·s²)"}, {"g": "Constants", "s": "k_boltz", "t": "k_boltz", "d": "Boltzmann constant, J/K"}, {"g": "Constants", "s": "n_avo", "t": "n_avo", "d": "Avogadro constant, 1/mol"}, {"g": "Constants", "s": "r_gas", "t": "r_gas", "d": "Molar gas constant, J/(mol·K)"}, {"g": "Constants", "s": "q_e", "t": "q_e", "d": "Elementary charge, C"}, {"g": "Constants", "s": "m_e  m_p  m_n  u_amu", "t": "m_e", "d": "Masses of the electron, proton, neutron; atomic mass unit, kg"}, {"g": "Constants", "s": "eps_0  mu_0  k_coulomb", "t": "eps_0", "d": "Vacuum permittivity, permeability; Coulomb constant"}, {"g": "Constants", "s": "sigma_sb", "t": "sigma_sb", "d": "Stefan–Boltzmann constant, W/(m²·K⁴)"}, {"g": "Constants", "s": "alpha_fs  a_bohr  r_inf", "t": "alpha_fs", "d": "Fine-structure constant, Bohr radius (m), Rydberg constant (1/m)"}, {"g": "Constants", "s": "f_faraday", "t": "f_faraday", "d": "Faraday constant, C/mol"}, {"g": "Constants", "s": "g_std  atm_pa", "t": "g_std", "d": "Standard gravity (m/s²) and standard atmosphere (Pa)"}, {"g": "Constants", "s": "au_m  ly_m  pc_m", "t": "au_m", "d": "Astronomical unit, light-year, parsec, in metres"}, {"g": "Constants", "s": "m_sun  m_earth  r_earth", "t": "m_sun", "d": "Masses of the Sun and the Earth (kg); mean radius of the Earth (m)"}, {"g": "Constants", "s": "ev_j  cal_j", "t": "ev_j", "d": "One electronvolt and one calorie in joules"}, {"g": "Constants", "s": "euler_gamma  golden_ratio  catalan_c  apery_c", "t": "golden_ratio", "d": "Euler–Mascheroni γ, golden ratio φ, Catalan G, Apéry ζ(3)"}];
  /* FUNCHELP-END */
  /* Input-assist palette for the formula editor. Each button inserts its `t` at the caret;
   * a trailing "()" places the caret between the parentheses so the user just types the argument.
   * Labels are the real-math glyphs; the inserted text is engine syntax (× → *, ÷ → /). */
  const PAD = [
    { g: 'ops', items: [{ l: '+', t: '+' }, { l: '−', t: '-' }, { l: '×', t: '*' }, { l: '÷', t: '/' }, { l: 'xⁿ', t: '^' }, { l: '( )', t: '()' }, { l: '%', t: '%' }] },
    { g: 'const', items: [{ l: 'π', t: 'pi' }, { l: 'e', t: 'e' }, { l: '√', t: 'sqrt()' }] },
    { g: 'fn', items: [{ l: 'sin', t: 'sin()' }, { l: 'cos', t: 'cos()' }, { l: 'tan', t: 'tan()' }, { l: 'ln', t: 'ln()' }, { l: 'log', t: 'log()' }, { l: 'abs', t: 'abs()' }, { l: 'min', t: 'min()' }, { l: 'max', t: 'max()' }, { l: 'round', t: 'round()' }, { l: 'n!', t: 'fact()' }, { l: 'nCk', t: 'binom()' }, { l: 'gcd', t: 'gcd()' }, { l: 'Σ', t: 'sum()' }] },
  ];

  // ---- tiny, dependency-free, XSS-safe Markdown renderer (for formula descriptions) ----
  function mdEscape(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function mdInline(s) {
    s = s.replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
      // escaped text already has &lt; etc.; only allow safe URL schemes
      if (/^(https?:|mailto:)/i.test(u)) return '<a href="' + u.replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
      return t;
    });
    return s;
  }
  function mdRender(src) {
    if (!src) return '';
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    let html = ''; let i = 0; let inUl = false; let inOl = false;
    const closeLists = () => { if (inUl) { html += '</ul>'; inUl = false; } if (inOl) { html += '</ol>'; inOl = false; } };
    const isBlockStart = (raw) => { const e = mdEscape(raw); return /^```/.test(raw) || /^\s*$/.test(raw) || /^(#{1,6})\s/.test(e) || /^\s*[-*+]\s/.test(e) || /^\s*\d+\.\s/.test(e) || /^\s*&gt;/.test(e); };
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) { closeLists(); i++; let code = ''; while (i < lines.length && !/^```/.test(lines[i])) { code += mdEscape(lines[i]) + '\n'; i++; } i++; html += '<pre><code>' + code + '</code></pre>'; continue; }
      if (/^\s*$/.test(line)) { closeLists(); i++; continue; }
      const esc = mdEscape(line); let m;
      if ((m = esc.match(/^(#{1,6})\s+(.*)$/))) { closeLists(); const lv = m[1].length; html += '<h' + lv + '>' + mdInline(m[2]) + '</h' + lv + '>'; i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { closeLists(); html += '<hr>'; i++; continue; }
      if ((m = esc.match(/^\s*&gt;\s?(.*)$/))) { closeLists(); html += '<blockquote>' + mdInline(m[1]) + '</blockquote>'; i++; continue; }
      if ((m = esc.match(/^\s*[-*+]\s+(.*)$/))) { if (inOl) { html += '</ol>'; inOl = false; } if (!inUl) { html += '<ul>'; inUl = true; } html += '<li>' + mdInline(m[1]) + '</li>'; i++; continue; }
      if ((m = esc.match(/^\s*\d+\.\s+(.*)$/))) { if (inUl) { html += '</ul>'; inUl = false; } if (!inOl) { html += '<ol>'; inOl = true; } html += '<li>' + mdInline(m[1]) + '</li>'; i++; continue; }
      closeLists();
      let para = esc; i++;
      while (i < lines.length && !isBlockStart(lines[i])) { para += '<br>' + mdEscape(lines[i]); i++; }
      html += '<p>' + mdInline(para) + '</p>';
    }
    closeLists();
    return html;
  }

  // Icon per genre for the template picker headers. Unknown genres fall back to 🧮.
  // Functions/operators whose output is flat, periodic-step, or many-to-one — numeric
  // root-finding on them has no reliable unique inverse, so such formulas are excluded
  // from "reverse calculation" (solve for a variable from the result).
  const NON_REVERSIBLE_RE = /\b(round|floor|ceil|trunc|sign|mod|min|max|abs|if|piecewise|isprime|nextprime|prevprime|primepi|nthprime|gcd|lcm|fact|binom|perm|phi|sigma|tau|mu|omega|bigomega|rad|lpf|gpf|carmichael|powmod|modinv|crt|factmod|fib|lucas|catalan|bell|partitions|stirling1|stirling2|derange|digitsum|digitalroot|numdigits|reversenum|collatz|legendre|jacobi|ord|primroot|isqrt|issquare|isperfect|mode|median|percentile|quantile|count|len|sort|at|and|or|xor|not)\s*\(|[<>]|==|!=/;
  function isReversible(tp) {
    if (!tp || !tp.variables || !tp.variables.length) return false;
    const e = tp.expression || '';
    if (NON_REVERSIBLE_RE.test(e)) return false;
    if (e.indexOf('%') >= 0) return false;
    if (tp.variables.some((v) => vkind(v) !== 'number')) return false;
    return true;
  }
  /* TAXONOMY-BEGIN — generated from regibase-build/fb-data/taxonomy/sync_taxonomy.py */
  const TAXONOMY = [{"g": "Mathematics", "i": "➗", "subs": [{"s": "Arithmetic and algebra", "i": "🔢"}, {"s": "Geometry and trigonometry", "i": "📐"}, {"s": "Calculus and series", "i": "∫"}, {"s": "Primes and divisors", "i": "🔑"}, {"s": "Modular arithmetic and cryptography", "i": "🔐"}, {"s": "Counting and combinatorics", "i": "🎲"}, {"s": "Integer sequences and figurate numbers", "i": "🔁"}, {"s": "Integer equations and elliptic curves", "i": "🧩"}, {"s": "Analytic number theory and special functions", "i": "ζ"}, {"s": "Number puzzles, binary and check digits", "i": "🧮"}]}, {"g": "Statistics and probability", "i": "📊", "subs": [{"s": "Descriptive statistics", "i": "📋"}, {"s": "Probability and distributions", "i": "🎯"}, {"s": "Estimation and hypothesis tests", "i": "🔬"}]}, {"g": "AI and computing", "i": "🤖", "subs": [{"s": "Machine learning", "i": "🤖"}, {"s": "Deep learning and large language models", "i": "🧠"}, {"s": "Information theory and coding", "i": "📡"}, {"s": "Computers, storage and networks", "i": "💻"}, {"s": "Graphics, images and displays", "i": "🖼️"}]}, {"g": "Physics", "i": "⚛️", "subs": [{"s": "Mechanics and motion", "i": "🏀"}, {"s": "Waves, sound and light", "i": "🔊"}, {"s": "Heat and thermodynamics", "i": "🌡️"}, {"s": "Electricity and magnetism", "i": "⚡"}, {"s": "Fluids", "i": "🌊"}, {"s": "Quantum, nuclear and relativity", "i": "🌀"}]}, {"g": "Space and Earth", "i": "🌍", "subs": [{"s": "Astronomy and cosmology", "i": "🔭"}, {"s": "Orbits and spaceflight", "i": "🛰️"}, {"s": "Earth, earthquakes and geology", "i": "🌋"}, {"s": "Weather and climate", "i": "⛅"}, {"s": "Oceans, rivers and groundwater", "i": "🏞️"}, {"s": "Environment and ecology", "i": "🌿"}]}, {"g": "Chemistry and materials", "i": "🧪", "subs": [{"s": "General chemistry", "i": "🧪"}, {"s": "Physical chemistry and electrochemistry", "i": "🔋"}, {"s": "Materials", "i": "🧱"}]}, {"g": "Engineering", "i": "🔧", "subs": [{"s": "Civil and structural engineering", "i": "🏗️"}, {"s": "Mechanical engineering", "i": "⚙️"}, {"s": "Electronics and circuits", "i": "🔌"}, {"s": "Energy and power", "i": "☀️"}, {"s": "Robotics and control", "i": "🦾"}, {"s": "Cars, aircraft, ships and navigation", "i": "✈️"}]}, {"g": "Personal money", "i": "👛", "subs": [{"s": "Interest, saving and compound growth", "i": "💰"}, {"s": "Loans, mortgages and credit cards", "i": "🏦"}, {"s": "Retirement and pensions", "i": "🌅"}, {"s": "Shopping, prices and tax", "i": "🛒"}, {"s": "Property and rent", "i": "🏘️"}]}, {"g": "Investing and markets", "i": "📈", "subs": [{"s": "Stocks and valuation", "i": "📈"}, {"s": "Bonds and interest rates", "i": "📜"}, {"s": "Options, futures and currencies", "i": "⚖️"}, {"s": "Portfolio, returns and risk", "i": "🛡️"}, {"s": "Trading, betting odds and crypto", "i": "🎰"}, {"s": "Funds and venture capital", "i": "🚀"}]}, {"g": "Business and accounting", "i": "🏢", "subs": [{"s": "Financial statement ratios", "i": "📑"}, {"s": "Capital budgeting and cost of capital", "i": "🏗️"}, {"s": "Cost accounting, depreciation and break-even", "i": "🧾"}, {"s": "Operations, inventory and quality", "i": "🏭"}, {"s": "Sales, marketing and SaaS metrics", "i": "📣"}, {"s": "Banking and credit risk", "i": "🏛️"}, {"s": "Insurance and actuarial", "i": "☂️"}]}, {"g": "Economics", "i": "🏛️", "subs": [{"s": "Markets, prices and behaviour", "i": "🏪"}, {"s": "Macroeconomics and policy", "i": "🌐"}, {"s": "Inequality, poverty and population", "i": "⚖️"}]}, {"g": "Health and life sciences", "i": "🩺", "subs": [{"s": "Body measures and fitness", "i": "🏃"}, {"s": "Clinical calculations", "i": "🩺"}, {"s": "Drugs and dosing", "i": "💊"}, {"s": "Epidemiology and public health", "i": "🦠"}, {"s": "Biology and genetics", "i": "🧬"}]}, {"g": "Everyday life", "i": "🏠", "subs": [{"s": "Unit conversion", "i": "🔄"}, {"s": "Home, building and DIY", "i": "🔨"}, {"s": "Cooking and food", "i": "🍳"}, {"s": "Calendar and time", "i": "📅"}, {"s": "Travel and driving", "i": "🚗"}, {"s": "Photography, music and hobbies", "i": "📷"}, {"s": "Farming and gardening", "i": "🌱"}, {"s": "Psychology and learning", "i": "🧠"}]}];
  /* TAXONOMY-END */
  const CAT_ICONS = {
    'Geometry': '📐', 'Math': '➗', 'Physics': '⚛️', 'Electricity': '⚡', 'Money': '💰',
    'Health': '🩺', 'Conversion': '🔄', 'Everyday': '🏠', 'Statistics': '📊',
    'Thermodynamics': '🌡️', 'Chemistry': '🧪', 'Astronomy': '🔭', 'Computing': '💻',
    'Biology': '🧬', 'Earth science': '🌍', 'Engineering': '🔧',
    'Quantum physics': '🌀', 'Relativity': '🌌', 'Fluid mechanics': '🌊', 'Optics': '🔍',
    'Photonics': '💡', 'Acoustics': '🔊', 'Electronics': '🔌', 'Signal processing': '📶',
    'Civil engineering': '🏗️', 'Mechanical engineering': '⚙️', 'Aerospace': '🚀',
    'Orbital mechanics': '🛰️', 'Cosmology': '🌠', 'Nuclear physics': '☢️',
    'Electromagnetism': '🧲', 'Physical chemistry': '⚗️', 'Electrochemistry': '🔋',
    'Statistical mechanics': '🎲', 'Meteorology': '🌦️', 'Oceanography': '🐋',
    'Geophysics': '🌋', 'Seismology': '〰️', 'Hydrology': '💧', 'Environmental science': '♻️',
    'Renewable energy': '🔆', 'Materials science': '🧱', 'Photography': '📷',
    'Finance': '📈', 'Economics': '🏦', 'Accounting': '🧾', 'Probability': '🎲',
    'Information theory': '📡', 'Cryptography': '🔐', 'Machine learning': '🤖',
    'Computer graphics': '🎨', 'Networking': '🌐', 'Robotics': '🦾', 'Navigation': '🧭',
    'Sports science': '🏃', 'Music': '🎵', 'Automotive': '🚗',
    'Aviation': '✈️', 'Marine': '⚓', 'Pharmacology': '💊', 'Epidemiology': '🦠',
    'Genetics': '🧬', 'Ecology': '🌿', 'Agriculture': '🌾', 'Number theory': '🔢',
  };

  // Width of the steps/history side panel, as a percentage of the content area (not raw px, so
  // it scales with the window instead of stranding a fixed box on a narrow or huge screen). Set
  // either by dragging the .fb-resizer boundary directly or via the Settings slider — both paths
  // write the same server-side setting (loadSettings() reads it back as steps_width_pct), so
  // reloading always restores whichever one was used last, matching "初期値" for both.
  const SIDE_WIDTH_PCT_MIN = 20;
  const SIDE_WIDTH_PCT_MAX = 50;
  const SIDE_WIDTH_PCT_DEFAULT = 30;
  function clampSideWidthPct(p) {
    const n = Number(p);
    return isFinite(n) ? Math.min(SIDE_WIDTH_PCT_MAX, Math.max(SIDE_WIDTH_PCT_MIN, n)) : SIDE_WIDTH_PCT_DEFAULT;
  }

  // Precompiled render function (eval-free). Source template lives in formulabase.js;
  // regenerate with regibase-build/formulabase-build.mjs after editing the template.
  const render = (function () {
const { createElementVNode: _createElementVNode, openBlock: _openBlock, createElementBlock: _createElementBlock, toDisplayString: _toDisplayString, createCommentVNode: _createCommentVNode, renderList: _renderList, Fragment: _Fragment, normalizeStyle: _normalizeStyle, normalizeClass: _normalizeClass, withModifiers: _withModifiers, createTextVNode: _createTextVNode, vModelText: _vModelText, withKeys: _withKeys, withDirectives: _withDirectives, vShow: _vShow, vModelSelect: _vModelSelect, vModelDynamic: _vModelDynamic, vModelRadio: _vModelRadio, vModelCheckbox: _vModelCheckbox, createStaticVNode: _createStaticVNode } = Vue

const _hoisted_1 = { class: "layout" }
const _hoisted_2 = { class: "sidebar" }
const _hoisted_3 = { class: "brand" }
const _hoisted_4 = /*#__PURE__*/_createStaticVNode("<span class=\"logo\"><svg viewBox=\"320 403 1348 1011\"><path fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" d=\"M1043.28,1357.05c-3.65-4.48-4.91-9.79-3.78-15.97l115.97-542.86c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.56-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1356.31,1233.52c19.04,0,35.15-6.16,48.32-18.49,13.16-12.31,19.75-27.17,19.75-44.54,0-11.77-4.2-21.29-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1287.4,905.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\"></path><path fill=\"#2e3192\" d=\"M1043.28,1357.05c-3.65-4.48-4.91-9.79-3.78-15.97l115.97-542.86c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.56-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1356.31,1233.52c19.04,0,35.15-6.16,48.32-18.49,13.16-12.31,19.75-27.17,19.75-44.54,0-11.77-4.2-21.29-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1287.4,905.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\"></path><path fill=\"#e56b00\" d=\"M1298.45,464.1c6.23,6.91,8.39,15.12,6.48,24.62l-33.09,137.38c-1.92,9.5-7.67,17.72-17.27,24.62s-19.66,10.36-30.2,10.36h-430.14l-41.72,177.56h401.38c10.53,0,18.92,3.47,25.16,10.38s7.92,15.11,5.05,24.61l-31.66,137.37c-1.92,9.52-7.67,17.73-17.27,24.64s-19.66,10.36-30.2,10.36h-401.38l-66.17,279.94c-1.92,9.5-7.44,17.72-16.55,24.62s-18.94,10.36-29.48,10.36h-188.47c-10.55,0-18.94-3.45-25.17-10.36s-8.39-15.12-6.47-24.62l198.53-837.22c1.91-9.5,7.42-17.72,16.53-24.62s18.94-10.38,29.5-10.38h657.44c10.55,0,18.94,3.47,25.17,10.38Z\"></path><path fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" d=\"M1298.45,464.1c6.23,6.91,8.39,15.12,6.48,24.62l-33.09,137.38c-1.92,9.5-7.67,17.72-17.27,24.62s-19.66,10.36-30.2,10.36h-430.14l-41.72,177.56h401.38c10.53,0,18.92,3.47,25.16,10.38s7.92,15.11,5.05,24.61l-31.66,137.37c-1.92,9.52-7.67,17.73-17.27,24.64s-19.66,10.36-30.2,10.36h-401.38l-66.17,279.94c-1.92,9.5-7.44,17.72-16.55,24.62s-18.94,10.36-29.48,10.36h-188.47c-10.55,0-18.94-3.45-25.17-10.36s-8.39-15.12-6.47-24.62l198.53-837.22c1.91-9.5,7.42-17.72,16.53-24.62s18.94-10.38,29.5-10.38h657.44c10.55,0,18.94,3.47,25.17,10.38Z\"></path><path fill=\"#39b54a\" d=\"M1298.45,464.1c6.23,6.91,8.39,15.12,6.48,24.62l-33.09,137.38c-1.92,9.5-7.67,17.72-17.27,24.62s-19.66,10.36-30.2,10.36h-430.14l-41.72,177.56h401.38c10.53,0,18.92,3.47,25.16,10.38s7.92,15.11,5.05,24.61l-31.66,137.37c-1.92,9.52-7.67,17.73-17.27,24.64s-19.66,10.36-30.2,10.36h-401.38l-66.17,279.94c-1.92,9.5-7.44,17.72-16.55,24.62s-18.94,10.36-29.48,10.36h-188.47c-10.55,0-18.94-3.45-25.17-10.36s-8.39-15.12-6.47-24.62l198.53-837.22c1.91-9.5,7.42-17.72,16.53-24.62s18.94-10.38,29.5-10.38h657.44c10.55,0,18.94,3.47,25.17,10.38Z\"></path></svg></span><span>FormulaBase</span>", 2)
const _hoisted_6 = {
  key: 0,
  class: "tag"
}
const _hoisted_7 = { class: "coll-list" }
const _hoisted_8 = ["onClick"]
const _hoisted_9 = ["title"]
const _hoisted_10 = { class: "ic" }
const _hoisted_11 = { class: "nm" }
const _hoisted_12 = {
  key: 1,
  class: "ct"
}
const _hoisted_13 = {
  key: 0,
  class: "empty",
  style: {"padding":"24px 8px"}
}
const _hoisted_14 = { class: "sidebar-foot" }
const _hoisted_15 = ["title"]
const _hoisted_16 = { class: "main" }
const _hoisted_17 = { class: "topbar" }
const _hoisted_18 = {
  key: 0,
  class: "title"
}
const _hoisted_19 = ["title"]
const _hoisted_20 = { class: "ic" }
const _hoisted_21 = { class: "nm" }
const _hoisted_22 = {
  key: 1,
  class: "desc"
}
const _hoisted_23 = {
  key: 1,
  class: "title"
}
const _hoisted_24 = /*#__PURE__*/_createElementVNode("span", { class: "nm" }, "FormulaBase", -1 /* HOISTED */)
const _hoisted_25 = [
  _hoisted_24
]
const _hoisted_26 = /*#__PURE__*/_createElementVNode("div", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_27 = {
  key: 2,
  class: "topbar-actions"
}
const _hoisted_28 = { class: "content fb-content" }
const _hoisted_29 = { class: "fb-listcol" }
const _hoisted_30 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_31 = {
  key: 1,
  class: "fb-welcome"
}
const _hoisted_32 = { class: "fb-welcome-card" }
const _hoisted_33 = /*#__PURE__*/_createStaticVNode("<div class=\"logo big\"><svg viewBox=\"320 403 1348 1011\"><path fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" d=\"M1043.28,1357.05c-3.65-4.48-4.91-9.79-3.78-15.97l115.97-542.86c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.56-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1356.31,1233.52c19.04,0,35.15-6.16,48.32-18.49,13.16-12.31,19.75-27.17,19.75-44.54,0-11.77-4.2-21.29-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1287.4,905.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\"></path><path fill=\"#2e3192\" d=\"M1043.28,1357.05c-3.65-4.48-4.91-9.79-3.78-15.97l115.97-542.86c1.12-6.16,4.33-11.48,9.66-15.97,5.32-4.48,11.06-6.72,17.23-6.72h262.19c37.53,0,69.33,7.14,95.38,21.43,26.05,14.29,45.51,33.06,58.4,56.3,12.88,23.25,19.33,47.77,19.33,73.53,0,12.33-1.13,22.98-3.36,31.93-5.61,28.02-15.27,50.56-28.99,67.65-13.73,17.1-27.31,30.12-40.76,39.08,25.21,20.73,37.82,47.62,37.82,80.67,0,12.89-1.68,27.46-5.04,43.7-7.85,35.29-19.05,65.42-33.61,90.34-14.57,24.93-37.12,45.1-67.65,60.5-30.54,15.42-71.01,23.11-121.43,23.11h-296.64c-6.17,0-11.07-2.23-14.71-6.72ZM1356.31,1233.52c19.04,0,35.15-6.16,48.32-18.49,13.16-12.31,19.75-27.17,19.75-44.54,0-11.77-4.2-21.29-12.6-28.57-8.4-7.27-19.62-10.92-33.61-10.92h-138.66l-21.85,102.52h138.66ZM1287.4,905.79l-20.17,95.8h130.25c16.81,0,30.53-4.2,41.18-12.61,10.64-8.4,17.36-20.17,20.17-35.29,1.12-6.72,1.68-11.2,1.68-13.45,0-11.2-3.65-19.75-10.92-25.63-7.29-5.88-17.94-8.82-31.93-8.82h-130.25Z\"></path><path fill=\"#e56b00\" d=\"M1298.45,464.1c6.23,6.91,8.39,15.12,6.48,24.62l-33.09,137.38c-1.92,9.5-7.67,17.72-17.27,24.62s-19.66,10.36-30.2,10.36h-430.14l-41.72,177.56h401.38c10.53,0,18.92,3.47,25.16,10.38s7.92,15.11,5.05,24.61l-31.66,137.37c-1.92,9.52-7.67,17.73-17.27,24.64s-19.66,10.36-30.2,10.36h-401.38l-66.17,279.94c-1.92,9.5-7.44,17.72-16.55,24.62s-18.94,10.36-29.48,10.36h-188.47c-10.55,0-18.94-3.45-25.17-10.36s-8.39-15.12-6.47-24.62l198.53-837.22c1.91-9.5,7.42-17.72,16.53-24.62s18.94-10.38,29.5-10.38h657.44c10.55,0,18.94,3.47,25.17,10.38Z\"></path><path fill=\"none\" stroke=\"#fff\" stroke-width=\"100\" d=\"M1298.45,464.1c6.23,6.91,8.39,15.12,6.48,24.62l-33.09,137.38c-1.92,9.5-7.67,17.72-17.27,24.62s-19.66,10.36-30.2,10.36h-430.14l-41.72,177.56h401.38c10.53,0,18.92,3.47,25.16,10.38s7.92,15.11,5.05,24.61l-31.66,137.37c-1.92,9.52-7.67,17.73-17.27,24.64s-19.66,10.36-30.2,10.36h-401.38l-66.17,279.94c-1.92,9.5-7.44,17.72-16.55,24.62s-18.94,10.36-29.48,10.36h-188.47c-10.55,0-18.94-3.45-25.17-10.36s-8.39-15.12-6.47-24.62l198.53-837.22c1.91-9.5,7.42-17.72,16.53-24.62s18.94-10.38,29.5-10.38h657.44c10.55,0,18.94,3.47,25.17,10.38Z\"></path><path fill=\"#39b54a\" d=\"M1298.45,464.1c6.23,6.91,8.39,15.12,6.48,24.62l-33.09,137.38c-1.92,9.5-7.67,17.72-17.27,24.62s-19.66,10.36-30.2,10.36h-430.14l-41.72,177.56h401.38c10.53,0,18.92,3.47,25.16,10.38s7.92,15.11,5.05,24.61l-31.66,137.37c-1.92,9.52-7.67,17.73-17.27,24.64s-19.66,10.36-30.2,10.36h-401.38l-66.17,279.94c-1.92,9.5-7.44,17.72-16.55,24.62s-18.94,10.36-29.48,10.36h-188.47c-10.55,0-18.94-3.45-25.17-10.36s-8.39-15.12-6.47-24.62l198.53-837.22c1.91-9.5,7.42-17.72,16.53-24.62s18.94-10.38,29.5-10.38h657.44c10.55,0,18.94,3.47,25.17,10.38Z\"></path></svg></div>", 1)
const _hoisted_34 = { class: "fb-welcome-btns" }
const _hoisted_35 = {
  key: 0,
  class: "empty-hint"
}
const _hoisted_36 = ["onFocusin", "onClick"]
const _hoisted_37 = { class: "fb-head" }
const _hoisted_38 = { class: "fb-name" }
const _hoisted_39 = ["title"]
const _hoisted_40 = { class: "fb-actions" }
const _hoisted_41 = ["onClick", "title"]
const _hoisted_42 = ["onClick"]
const _hoisted_43 = ["onClick"]
const _hoisted_44 = ["onClick"]
const _hoisted_45 = ["innerHTML"]
const _hoisted_46 = ["innerHTML"]
const _hoisted_47 = {
  key: 1,
  class: "fb-vars"
}
const _hoisted_48 = { class: "fb-vlabel" }
const _hoisted_49 = ["onClick", "title"]
const _hoisted_50 = { class: "fb-vinput" }
const _hoisted_51 = ["value", "onInput", "disabled", "placeholder"]
const _hoisted_52 = ["value", "onInput", "placeholder", "title"]
const _hoisted_53 = {
  key: 2,
  class: "fb-vunit"
}
const _hoisted_54 = {
  key: 2,
  class: "fb-solve"
}
const _hoisted_55 = { class: "fb-req" }
const _hoisted_56 = ["value", "onInput", "placeholder"]
const _hoisted_57 = {
  key: 0,
  class: "fb-runit"
}
const _hoisted_58 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_59 = {
  key: 1,
  class: "err-msg"
}
const _hoisted_60 = ["onClick"]
const _hoisted_61 = /*#__PURE__*/_createElementVNode("span", { class: "fb-req" }, "=", -1 /* HOISTED */)
const _hoisted_62 = { class: "fb-rvalue" }
const _hoisted_63 = {
  key: 0,
  class: "fb-runit"
}
const _hoisted_64 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_65 = ["onClick", "title"]
const _hoisted_66 = ["onClick"]
const _hoisted_67 = {
  key: 3,
  class: "fb-notes"
}
const _hoisted_68 = ["title"]
const _hoisted_69 = { class: "fb-side-sec" }
const _hoisted_70 = { class: "fb-side-h" }
const _hoisted_71 = { class: "fb-side-sub" }
const _hoisted_72 = { class: "fb-steps" }
const _hoisted_73 = {
  key: 0,
  class: "fb-step-op"
}
const _hoisted_74 = ["innerHTML"]
const _hoisted_75 = {
  key: 0,
  class: "fb-step-final"
}
const _hoisted_76 = { key: 0 }
const _hoisted_77 = {
  key: 1,
  class: "err-msg"
}
const _hoisted_78 = {
  key: 2,
  class: "empty-hint sm"
}
const _hoisted_79 = { class: "fb-side-sec" }
const _hoisted_80 = { class: "fb-side-h" }
const _hoisted_81 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_82 = { class: "fb-hist" }
const _hoisted_83 = ["onClick", "title"]
const _hoisted_84 = { class: "fb-hist-in" }
const _hoisted_85 = { class: "fb-hist-out" }
const _hoisted_86 = { key: 0 }
const _hoisted_87 = { class: "fb-hist-time" }
const _hoisted_88 = ["onClick", "title"]
const _hoisted_89 = ["onClick", "title"]
const _hoisted_90 = ["onClick"]
const _hoisted_91 = {
  key: 0,
  class: "modal-mask"
}
const _hoisted_92 = { class: "modal" }
const _hoisted_93 = { class: "modal-head" }
const _hoisted_94 = { class: "modal-body settings-body" }
const _hoisted_95 = { class: "field" }
const _hoisted_96 = { class: "field" }
const _hoisted_97 = ["placeholder"]
const _hoisted_98 = { class: "field-row" }
const _hoisted_99 = { class: "field" }
const _hoisted_100 = { class: "field" }
const _hoisted_101 = { class: "iconpick-head" }
const _hoisted_102 = ["title"]
const _hoisted_103 = ["placeholder"]
const _hoisted_104 = ["placeholder"]
const _hoisted_105 = { class: "emoji-tabs" }
const _hoisted_106 = ["title", "onClick"]
const _hoisted_107 = { class: "emoji-palette" }
const _hoisted_108 = { class: "emoji-cat" }
const _hoisted_109 = {
  key: 0,
  class: "emoji-none"
}
const _hoisted_110 = {
  key: 1,
  class: "emoji-none"
}
const _hoisted_111 = { class: "emoji-grid" }
const _hoisted_112 = ["onClick", "title"]
const _hoisted_113 = ["aria-expanded"]
const _hoisted_114 = { class: "share-toggle-label" }
const _hoisted_115 = { class: "share-hint" }
const _hoisted_116 = { class: "share-caret" }
const _hoisted_117 = {
  key: 0,
  class: "share-hint-text"
}
const _hoisted_118 = {
  key: 0,
  class: "share-count"
}
const _hoisted_119 = { class: "share-body" }
const _hoisted_120 = {
  key: 0,
  class: "share-list"
}
const _hoisted_121 = { class: "share-user" }
const _hoisted_122 = ["value", "onChange"]
const _hoisted_123 = { value: "view" }
const _hoisted_124 = { value: "edit" }
const _hoisted_125 = { value: "delete" }
const _hoisted_126 = ["onClick", "title"]
const _hoisted_127 = { class: "share-add" }
const _hoisted_128 = { class: "share-top" }
const _hoisted_129 = {
  key: 0,
  class: "share-search"
}
const _hoisted_130 = ["placeholder"]
const _hoisted_131 = {
  key: 0,
  class: "share-results"
}
const _hoisted_132 = ["onClick"]
const _hoisted_133 = { class: "muted" }
const _hoisted_134 = {
  key: 1,
  class: "share-picked"
}
const _hoisted_135 = { class: "share-user" }
const _hoisted_136 = { class: "muted" }
const _hoisted_137 = ["title"]
const _hoisted_138 = { class: "perm-label" }
const _hoisted_139 = /*#__PURE__*/_createElementVNode("span", {
  class: "perm-arrow",
  "aria-hidden": "true"
}, "⌄", -1 /* HOISTED */)
const _hoisted_140 = ["onClick"]
const _hoisted_141 = {
  key: 0,
  class: "share-err"
}
const _hoisted_142 = ["disabled"]
const _hoisted_143 = {
  key: 1,
  class: "field"
}
const _hoisted_144 = { class: "field-hint" }
const _hoisted_145 = { class: "modal-foot" }
const _hoisted_146 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_147 = {
  key: 1,
  class: "modal-mask"
}
const _hoisted_148 = { class: "modal wide" }
const _hoisted_149 = { class: "modal-head" }
const _hoisted_150 = { class: "modal-body" }
const _hoisted_151 = { class: "field" }
const _hoisted_152 = ["placeholder"]
const _hoisted_153 = { class: "field" }
const _hoisted_154 = { class: "fb-md-tabs" }
const _hoisted_155 = ["placeholder"]
const _hoisted_156 = ["innerHTML"]
const _hoisted_157 = { class: "field" }
const _hoisted_158 = { class: "fb-expr-hint" }
const _hoisted_159 = { class: "fb-pad" }
const _hoisted_160 = ["onClick"]
const _hoisted_161 = {
  key: 0,
  class: "fb-pad-row fb-pad-vars"
}
const _hoisted_162 = { class: "fb-pad-tag" }
const _hoisted_163 = ["onClick"]
const _hoisted_164 = ["innerHTML"]
const _hoisted_165 = { class: "fb-funcs" }
const _hoisted_166 = {
  key: 0,
  class: "fb-funcs-panel"
}
const _hoisted_167 = ["placeholder"]
const _hoisted_168 = { class: "fb-funcs-title" }
const _hoisted_169 = ["onClick", "title"]
const _hoisted_170 = {
  key: 0,
  class: "field"
}
const _hoisted_171 = { class: "err-msg" }
const _hoisted_172 = { class: "field" }
const _hoisted_173 = ["onUpdate:modelValue", "placeholder"]
const _hoisted_174 = ["onUpdate:modelValue", "placeholder"]
const _hoisted_175 = ["onUpdate:modelValue", "placeholder"]
const _hoisted_176 = ["onUpdate:modelValue", "title"]
const _hoisted_177 = { value: "" }
const _hoisted_178 = { value: "list" }
const _hoisted_179 = { value: "matrix" }
const _hoisted_180 = { value: "complex" }
const _hoisted_181 = ["type", "onUpdate:modelValue", "placeholder"]
const _hoisted_182 = ["onClick"]
const _hoisted_183 = { class: "field frow" }
const _hoisted_184 = { class: "field" }
const _hoisted_185 = { class: "modal-foot" }
const _hoisted_186 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_187 = { class: "modal" }
const _hoisted_188 = { class: "modal-head" }
const _hoisted_189 = { class: "modal-body" }
const _hoisted_190 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_191 = {
  key: 1,
  style: {"list-style":"none","margin":"0","padding":"0"}
}
const _hoisted_192 = {
  class: "mono",
  style: {"color":"var(--muted)"}
}
const _hoisted_193 = { style: {"flex":"1","font-size":"13px"} }
const _hoisted_194 = { style: {"font-size":"12px","color":"var(--muted)"} }
const _hoisted_195 = ["onClick"]
const _hoisted_196 = {
  class: "field-hint",
  style: {"margin-top":"10px"}
}
const _hoisted_197 = { class: "modal-foot" }
const _hoisted_198 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_199 = { class: "modal wide" }
const _hoisted_200 = { class: "modal-head" }
const _hoisted_201 = { class: "modal-body" }
const _hoisted_202 = { class: "empty-hint sm" }
const _hoisted_203 = { class: "tpl-search" }
const _hoisted_204 = /*#__PURE__*/_createElementVNode("span", { class: "tpl-search-ic" }, "🔍", -1 /* HOISTED */)
const _hoisted_205 = ["placeholder"]
const _hoisted_206 = ["title"]
const _hoisted_207 = { class: "tpl-search-count" }
const _hoisted_208 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_209 = {
  key: 1,
  class: "empty-hint sm"
}
const _hoisted_210 = { class: "tpl-groups" }
const _hoisted_211 = { class: "tpl-top-h" }
const _hoisted_212 = { class: "tpl-top-ic" }
const _hoisted_213 = { class: "tpl-group-n" }
const _hoisted_214 = ["onClick", "aria-expanded"]
const _hoisted_215 = /*#__PURE__*/_createElementVNode("span", { class: "tpl-group-caret" }, "▶", -1 /* HOISTED */)
const _hoisted_216 = { class: "tpl-group-ic" }
const _hoisted_217 = { class: "tpl-group-title" }
const _hoisted_218 = { class: "tpl-group-n" }
const _hoisted_219 = {
  key: 0,
  class: "tpl-grid"
}
const _hoisted_220 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_221 = { class: "tpl-card-h" }
const _hoisted_222 = ["onClick", "title", "aria-label"]
const _hoisted_223 = { class: "tpl-name" }
const _hoisted_224 = ["title"]
const _hoisted_225 = ["innerHTML"]
const _hoisted_226 = ["innerHTML"]
const _hoisted_227 = { class: "modal-foot" }
const _hoisted_228 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_229 = {
  key: 4,
  class: "modal-mask"
}
const _hoisted_230 = { class: "modal wide fb-tplset" }
const _hoisted_231 = { class: "modal-head" }
const _hoisted_232 = ["title"]
const _hoisted_233 = { class: "modal-body" }
const _hoisted_234 = { class: "empty-hint sm" }
const _hoisted_235 = { class: "fb-tplset-bar" }
const _hoisted_236 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_237 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_238 = {
  key: 1,
  class: "fb-tplset-tree"
}
const _hoisted_239 = { class: "fb-tplset-row lvl0" }
const _hoisted_240 = ["onClick"]
const _hoisted_241 = ["checked", ".indeterminate", "onChange"]
const _hoisted_242 = { class: "fb-tplset-n" }
const _hoisted_243 = { class: "fb-tplset-row lvl1" }
const _hoisted_244 = ["onClick"]
const _hoisted_245 = ["checked", ".indeterminate", "onChange"]
const _hoisted_246 = { class: "fb-tplset-n" }
const _hoisted_247 = {
  key: 0,
  class: "fb-tplset-items"
}
const _hoisted_248 = ["checked", "onChange"]
const _hoisted_249 = { class: "modal-foot" }
const _hoisted_250 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_251 = {
  key: 5,
  class: "modal-mask"
}
const _hoisted_252 = { class: "modal" }
const _hoisted_253 = { class: "modal-head" }
const _hoisted_254 = { class: "modal-body settings-body" }
const _hoisted_255 = { class: "field" }
const _hoisted_256 = { class: "radios" }
const _hoisted_257 = {
  class: "field",
  style: {"margin-top":"16px"}
}
const _hoisted_258 = { value: "auto" }
const _hoisted_259 = ["value"]
const _hoisted_260 = { class: "field-hint" }
const _hoisted_261 = {
  class: "field",
  style: {"margin-top":"16px","border-top":"1px solid var(--border)","padding-top":"14px"}
}
const _hoisted_262 = {
  class: "field-hint",
  style: {"margin-bottom":"8px"}
}
const _hoisted_263 = { style: {"display":"flex","align-items":"center","gap":"10px"} }
const _hoisted_264 = { style: {"min-width":"40px","text-align":"right"} }
const _hoisted_265 = {
  class: "field",
  style: {"margin-top":"16px","border-top":"1px solid var(--border)","padding-top":"14px"}
}
const _hoisted_266 = {
  class: "field-hint",
  style: {"margin-bottom":"8px"}
}
const _hoisted_267 = { style: {"display":"flex","gap":"8px","align-items":"center","flex-wrap":"wrap"} }
const _hoisted_268 = { style: {"font-size":"13px","color":"var(--muted)"} }
const _hoisted_269 = { style: {"font-size":"13px","color":"var(--muted)"} }
const _hoisted_270 = { style: {"display":"flex","gap":"8px","align-items":"center","flex-wrap":"wrap","margin-top":"8px"} }
const _hoisted_271 = { style: {"font-size":"13px","color":"var(--muted)"} }
const _hoisted_272 = { value: "manual" }
const _hoisted_273 = { value: "auto" }
const _hoisted_274 = {
  class: "field",
  style: {"margin-top":"16px","border-top":"1px solid var(--border)","padding-top":"14px"}
}
const _hoisted_275 = {
  class: "field-hint",
  style: {"margin-bottom":"8px"}
}
const _hoisted_276 = { style: {"display":"flex","align-items":"center","gap":"10px"} }
const _hoisted_277 = {
  class: "fp-cur",
  style: {"flex":"1"}
}
const _hoisted_278 = {
  class: "field",
  style: {"margin-top":"16px","border-top":"1px solid var(--border)","padding-top":"14px"}
}
const _hoisted_279 = {
  class: "field-hint",
  style: {"margin-bottom":"8px"}
}
const _hoisted_280 = {
  class: "field",
  style: {"margin-top":"16px","border-top":"1px solid var(--border)","padding-top":"14px"}
}
const _hoisted_281 = {
  class: "field-hint",
  style: {"margin-bottom":"8px"}
}
const _hoisted_282 = { style: {"display":"flex","gap":"8px","flex-wrap":"wrap"} }
const _hoisted_283 = { class: "modal-foot" }
const _hoisted_284 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_285 = {
  key: 6,
  class: "modal-mask"
}
const _hoisted_286 = { class: "modal" }
const _hoisted_287 = { class: "modal-head" }
const _hoisted_288 = ["disabled"]
const _hoisted_289 = { style: {"margin-top":"0","font-size":"13px","color":"var(--muted)"} }
const _hoisted_290 = { class: "field" }
const _hoisted_291 = ["placeholder"]
const _hoisted_292 = {
  key: 0,
  style: {"color":"var(--danger)","font-size":"13px"}
}
const _hoisted_293 = {
  key: 1,
  style: {"font-size":"13px","color":"var(--muted)"}
}
const _hoisted_294 = { class: "modal-foot" }
const _hoisted_295 = ["disabled"]
const _hoisted_296 = ["disabled"]
const _hoisted_297 = {
  key: 7,
  class: "modal-mask"
}
const _hoisted_298 = { class: "modal" }
const _hoisted_299 = { class: "modal-head" }
const _hoisted_300 = ["disabled"]
const _hoisted_301 = { class: "modal-body" }
const _hoisted_302 = { class: "filepick" }
const _hoisted_303 = { class: "btn sm" }
const _hoisted_304 = { class: "filepick-name" }
const _hoisted_305 = {
  class: "field",
  style: {"margin-top":"12px"}
}
const _hoisted_306 = { class: "field" }
const _hoisted_307 = { class: "radios" }
const _hoisted_308 = { style: {"color":"var(--danger)","font-size":"13px","background":"color-mix(in srgb,var(--danger) 12%,transparent)","padding":"8px 10px","border-radius":"8px"} }
const _hoisted_309 = { class: "confirm-check" }
const _hoisted_310 = {
  key: 1,
  style: {"color":"var(--danger)","font-size":"13px","margin-top":"8px"}
}
const _hoisted_311 = {
  key: 2,
  style: {"font-size":"13px","color":"var(--muted)","margin-top":"8px"}
}
const _hoisted_312 = { class: "modal-foot" }
const _hoisted_313 = ["disabled"]
const _hoisted_314 = ["disabled"]
const _hoisted_315 = { class: "modal" }
const _hoisted_316 = { class: "modal-head" }
const _hoisted_317 = { class: "modal-body" }
const _hoisted_318 = { class: "confirm-check" }
const _hoisted_319 = {
  class: "field",
  style: {"margin-top":"14px"}
}
const _hoisted_320 = { class: "radios" }
const _hoisted_321 = { class: "modal-foot" }
const _hoisted_322 = { class: "modal" }
const _hoisted_323 = { class: "modal-head" }
const _hoisted_324 = { class: "modal-body" }
const _hoisted_325 = { class: "fp-path" }
const _hoisted_326 = ["disabled"]
const _hoisted_327 = { class: "fp-cur" }
const _hoisted_328 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_329 = {
  key: 1,
  class: "empty-hint sm"
}
const _hoisted_330 = {
  key: 2,
  class: "empty-hint sm"
}
const _hoisted_331 = {
  key: 3,
  class: "fp-list"
}
const _hoisted_332 = ["onClick"]
const _hoisted_333 = { class: "ni-title" }
const _hoisted_334 = { class: "ni-cat" }
const _hoisted_335 = {
  key: 4,
  class: "field-hint",
  style: {"margin-top":"8px"}
}
const _hoisted_336 = { class: "modal-foot" }
const _hoisted_337 = ["disabled"]

return function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    _createElementVNode("aside", _hoisted_2, [
      _createElementVNode("div", _hoisted_3, [
        _hoisted_4,
        (_ctx.version)
          ? (_openBlock(), _createElementBlock("span", _hoisted_6, "v" + _toDisplayString(_ctx.version), 1 /* TEXT */))
          : _createCommentVNode("v-if", true)
      ]),
      _createElementVNode("nav", _hoisted_7, [
        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.collections, (c) => {
          return (_openBlock(), _createElementBlock("button", {
            key: c.id,
            class: _normalizeClass(["coll-item", {active: c.id===_ctx.currentId}]),
            onClick: $event => (_ctx.selectCollection(c.id))
          }, [
            _createElementVNode("span", {
              class: "ci-bar",
              style: _normalizeStyle({background: c.color || 'var(--primary)'})
            }, null, 4 /* STYLE */),
            (_ctx.shareBadge(c))
              ? (_openBlock(), _createElementBlock("span", {
                  key: 0,
                  class: "share-badge",
                  title: _ctx.shareBadgeTitle(c)
                }, _toDisplayString(_ctx.shareBadge(c)), 9 /* TEXT, PROPS */, _hoisted_9))
              : _createCommentVNode("v-if", true),
            _createElementVNode("span", _hoisted_10, _toDisplayString(c.icon), 1 /* TEXT */),
            _createElementVNode("span", _hoisted_11, _toDisplayString(c.name), 1 /* TEXT */),
            (c.id===_ctx.currentId)
              ? (_openBlock(), _createElementBlock("span", _hoisted_12, _toDisplayString(_ctx.formulas.length), 1 /* TEXT */))
              : _createCommentVNode("v-if", true)
          ], 10 /* CLASS, PROPS */, _hoisted_8))
        }), 128 /* KEYED_FRAGMENT */)),
        (!_ctx.collections.length)
          ? (_openBlock(), _createElementBlock("div", _hoisted_13, [
              _createElementVNode("div", null, _toDisplayString(_ctx.t('No collections yet.')), 1 /* TEXT */)
            ]))
          : _createCommentVNode("v-if", true)
      ]),
      _createElementVNode("div", _hoisted_14, [
        _createElementVNode("button", {
          class: "btn primary block",
          onClick: _cache[0] || (_cache[0] = $event => (_ctx.openCollectionModal()))
        }, _toDisplayString(_ctx.t('＋ New collection')), 1 /* TEXT */),
        _createElementVNode("button", {
          class: "btn sm block",
          onClick: _cache[1] || (_cache[1] = (...args) => (_ctx.openSettings && _ctx.openSettings(...args))),
          title: _ctx.t('Theme, language, etc.')
        }, _toDisplayString(_ctx.t('⚙️ Settings')), 9 /* TEXT, PROPS */, _hoisted_15)
      ])
    ]),
    _createElementVNode("main", _hoisted_16, [
      _createElementVNode("div", _hoisted_17, [
        (_ctx.current)
          ? (_openBlock(), _createElementBlock("div", _hoisted_18, [
              (_ctx.shareBadge(_ctx.current))
                ? (_openBlock(), _createElementBlock("span", {
                    key: 0,
                    class: "share-badge",
                    title: _ctx.shareBadgeTitle(_ctx.current)
                  }, _toDisplayString(_ctx.shareBadge(_ctx.current)), 9 /* TEXT, PROPS */, _hoisted_19))
                : _createCommentVNode("v-if", true),
              _createElementVNode("span", _hoisted_20, _toDisplayString(_ctx.current.icon), 1 /* TEXT */),
              _createElementVNode("span", _hoisted_21, _toDisplayString(_ctx.current.name), 1 /* TEXT */),
              (_ctx.current.description)
                ? (_openBlock(), _createElementBlock("span", _hoisted_22, _toDisplayString(_ctx.current.description), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]))
          : (_openBlock(), _createElementBlock("div", _hoisted_23, _hoisted_25)),
        _hoisted_26,
        (_ctx.current)
          ? (_openBlock(), _createElementBlock("div", _hoisted_27, [
              (_ctx.canSettings)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn sm",
                    onClick: _cache[2] || (_cache[2] = $event => (_ctx.openCollectionModal(_ctx.current)))
                  }, _toDisplayString(_ctx.t('⚙️ Collection settings')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.canEdit)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 1,
                    class: "btn sm",
                    onClick: _cache[3] || (_cache[3] = (...args) => (_ctx.openTemplates && _ctx.openTemplates(...args)))
                  }, "＋ " + _toDisplayString(_ctx.t('Templates')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.canEdit)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 2,
                    class: "btn accent sm",
                    onClick: _cache[4] || (_cache[4] = $event => (_ctx.openFormulaModal()))
                  }, "＋ " + _toDisplayString(_ctx.t('New formula')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]))
          : _createCommentVNode("v-if", true)
      ]),
      _createElementVNode("div", _hoisted_28, [
        _createElementVNode("div", _hoisted_29, [
          (_ctx.loading)
            ? (_openBlock(), _createElementBlock("div", _hoisted_30, _toDisplayString(_ctx.t('Loading…')), 1 /* TEXT */))
            : (!_ctx.current)
              ? (_openBlock(), _createElementBlock("div", _hoisted_31, [
                  _createElementVNode("div", _hoisted_32, [
                    _hoisted_33,
                    _createElementVNode("h2", null, _toDisplayString(_ctx.t('Welcome to FormulaBase')), 1 /* TEXT */),
                    _createElementVNode("p", null, _toDisplayString(_ctx.t('Create a collection, add formulas (or start from a template), then type in numbers to calculate instantly.')), 1 /* TEXT */),
                    _createElementVNode("div", _hoisted_34, [
                      _createElementVNode("button", {
                        class: "btn",
                        onClick: _cache[5] || (_cache[5] = (...args) => (_ctx.openTemplates && _ctx.openTemplates(...args)))
                      }, "📐 " + _toDisplayString(_ctx.t('Browse templates')), 1 /* TEXT */),
                      _createElementVNode("button", {
                        class: "btn primary",
                        onClick: _cache[6] || (_cache[6] = $event => (_ctx.openCollectionModal()))
                      }, _toDisplayString(_ctx.t('＋ New collection')), 1 /* TEXT */)
                    ])
                  ])
                ]))
              : (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                  (!_ctx.formulas.length)
                    ? (_openBlock(), _createElementBlock("p", _hoisted_35, _toDisplayString(_ctx.t('No formulas yet. Add one or pick a template to start calculating.')), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true),
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.formulas, (f) => {
                    return (_openBlock(), _createElementBlock("div", {
                      key: f.id,
                      class: _normalizeClass(["card fb-card", {active: f.id===_ctx.activeId}]),
                      onFocusin: $event => (_ctx.activeId=f.id),
                      onClick: $event => (_ctx.activeId=f.id)
                    }, [
                      _createElementVNode("div", _hoisted_37, [
                        _createElementVNode("div", _hoisted_38, _toDisplayString(f.name), 1 /* TEXT */),
                        (_ctx.isReversible(f))
                          ? (_openBlock(), _createElementBlock("span", {
                              key: 0,
                              class: "badge-outline",
                              title: _ctx.t('This formula can be reverse-calculated (solve for a variable from the result).')
                            }, "⇄ " + _toDisplayString(_ctx.t('Reversible')), 9 /* TEXT, PROPS */, _hoisted_39))
                          : _createCommentVNode("v-if", true),
                        _createElementVNode("div", _hoisted_40, [
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _withModifiers($event => (_ctx.copyExpr(f)), ["stop"]),
                            title: _ctx.t('Copy expression')
                          }, _toDisplayString(_ctx.copiedKey==='ex'+f.id ? '✓' : '⧉'), 9 /* TEXT, PROPS */, _hoisted_41),
                          (_ctx.canEdit)
                            ? (_openBlock(), _createElementBlock("button", {
                                key: 0,
                                class: "btn sm",
                                onClick: _withModifiers($event => (_ctx.openFormulaModal(f)), ["stop"])
                              }, _toDisplayString(_ctx.t('Edit')), 9 /* TEXT, PROPS */, _hoisted_42))
                            : _createCommentVNode("v-if", true),
                          _createElementVNode("button", {
                            class: "btn sm",
                            onClick: _withModifiers($event => (_ctx.openExportDialog(f)), ["stop"])
                          }, "📤 " + _toDisplayString(_ctx.t('Output')), 9 /* TEXT, PROPS */, _hoisted_43),
                          (_ctx.canDelete)
                            ? (_openBlock(), _createElementBlock("button", {
                                key: 1,
                                class: "btn sm danger",
                                onClick: _withModifiers($event => (_ctx.removeFormula(f)), ["stop"])
                              }, _toDisplayString(_ctx.t('Delete')), 9 /* TEXT, PROPS */, _hoisted_44))
                            : _createCommentVNode("v-if", true)
                        ])
                      ]),
                      (f.description)
                        ? (_openBlock(), _createElementBlock("div", {
                            key: 0,
                            class: "fb-desc fb-md",
                            innerHTML: _ctx.md(f.description)
                          }, null, 8 /* PROPS */, _hoisted_45))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("div", {
                        class: "fb-expr",
                        innerHTML: _ctx.mathml(f.expression)
                      }, null, 8 /* PROPS */, _hoisted_46),
                      (f.variables.length)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_47, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(f.variables, (v) => {
                              return (_openBlock(), _createElementBlock("label", {
                                class: _normalizeClass(["fb-var", { solving: _ctx.isSolving(f, v.key) }]),
                                key: v.key
                              }, [
                                _createElementVNode("span", _hoisted_48, [
                                  _createTextVNode(_toDisplayString(v.label || v.key) + " ", 1 /* TEXT */),
                                  (_ctx.isReversible(f))
                                    ? (_openBlock(), _createElementBlock("button", {
                                        key: 0,
                                        type: "button",
                                        class: _normalizeClass(["fb-solve-btn", { active: _ctx.isSolving(f, v.key) }]),
                                        onClick: _withModifiers($event => (_ctx.toggleSolve(f, v.key)), ["stop"]),
                                        title: _ctx.t('Solve this variable from the result')
                                      }, "🎯", 10 /* CLASS, PROPS */, _hoisted_49))
                                    : _createCommentVNode("v-if", true)
                                ]),
                                _createElementVNode("span", _hoisted_50, [
                                  (_ctx.vkind(v) === 'number')
                                    ? (_openBlock(), _createElementBlock("input", {
                                        key: 0,
                                        type: "number",
                                        step: "any",
                                        inputmode: "decimal",
                                        value: _ctx.inputs[f.id][v.key],
                                        onInput: $event => (_ctx.setVar(f, v.key, $event.target.value)),
                                        disabled: _ctx.isSolving(f, v.key),
                                        placeholder: _ctx.ph(v)
                                      }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_51))
                                    : (_openBlock(), _createElementBlock("input", {
                                        key: 1,
                                        type: "text",
                                        class: "fb-vtext",
                                        value: _ctx.inputs[f.id][v.key],
                                        onInput: $event => (_ctx.setVar(f, v.key, $event.target.value)),
                                        placeholder: _ctx.ph(v),
                                        title: _ctx.kindHint(v)
                                      }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_52)),
                                  (v.unit)
                                    ? (_openBlock(), _createElementBlock("span", _hoisted_53, _toDisplayString(v.unit), 1 /* TEXT */))
                                    : _createCommentVNode("v-if", true)
                                ])
                              ], 2 /* CLASS */))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.solveFor[f.id])
                        ? (_openBlock(), _createElementBlock("div", _hoisted_54, [
                            _createElementVNode("span", _hoisted_55, _toDisplayString(_ctx.t('Target result')) + " =", 1 /* TEXT */),
                            _createElementVNode("input", {
                              type: "number",
                              step: "any",
                              inputmode: "decimal",
                              class: "fb-solve-input",
                              value: _ctx.solveTarget[f.id],
                              onInput: $event => (_ctx.setTarget(f, $event.target.value)),
                              placeholder: _ctx.t('Enter the desired result')
                            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_56),
                            (f.result_unit)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_57, _toDisplayString(f.result_unit), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            _hoisted_58,
                            (_ctx.solveErr[f.id])
                              ? (_openBlock(), _createElementBlock("span", _hoisted_59, "⚠ " + _toDisplayString(_ctx.t('No solution found for this value.')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("button", {
                              class: "btn xs",
                              onClick: _withModifiers($event => (_ctx.toggleSolve(f, _ctx.solveFor[f.id])), ["stop"])
                            }, _toDisplayString(_ctx.t('Cancel')), 9 /* TEXT, PROPS */, _hoisted_60)
                          ]))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("div", {
                        class: _normalizeClass(["fb-result", {err: _ctx.result(f).err, ok: _ctx.result(f).ok}])
                      }, [
                        _hoisted_61,
                        _createElementVNode("span", _hoisted_62, _toDisplayString(_ctx.te(_ctx.result(f).text)), 1 /* TEXT */),
                        (f.result_unit && _ctx.result(f).ok)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_63, _toDisplayString(f.result_unit), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _hoisted_64,
                        (_ctx.result(f).ok)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 1,
                              class: "btn xs",
                              onClick: _withModifiers($event => (_ctx.copyResult(f)), ["stop"]),
                              title: _ctx.t('Copy result')
                            }, _toDisplayString(_ctx.copiedKey==='res'+f.id ? '✓ '+_ctx.t('Copied') : '📋 '+_ctx.t('Copy')), 9 /* TEXT, PROPS */, _hoisted_65))
                          : _createCommentVNode("v-if", true),
                        (_ctx.result(f).ok)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 2,
                              class: "btn xs",
                              onClick: _withModifiers($event => (_ctx.record(f)), ["stop"])
                            }, "✔ " + _toDisplayString(_ctx.t('Record')), 9 /* TEXT, PROPS */, _hoisted_66))
                          : _createCommentVNode("v-if", true)
                      ], 2 /* CLASS */),
                      (f.notes)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_67, _toDisplayString(f.notes), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ], 42 /* CLASS, PROPS, NEED_HYDRATION */, _hoisted_36))
                  }), 128 /* KEYED_FRAGMENT */))
                ], 64 /* STABLE_FRAGMENT */))
        ]),
        (_ctx.current && _ctx.activeFormula)
          ? (_openBlock(), _createElementBlock("div", {
              key: 0,
              class: "fb-resizer",
              onMousedown: _cache[7] || (_cache[7] = (...args) => (_ctx.startSideResize && _ctx.startSideResize(...args))),
              onTouchstart: _cache[8] || (_cache[8] = (...args) => (_ctx.startSideResize && _ctx.startSideResize(...args))),
              title: _ctx.t('Drag to resize')
            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_68))
          : _createCommentVNode("v-if", true),
        (_ctx.current && _ctx.activeFormula)
          ? (_openBlock(), _createElementBlock("aside", {
              key: 1,
              class: "fb-side",
              style: _normalizeStyle({ '--fb-side-width': _ctx.sideWidthPct + '%' })
            }, [
              _createElementVNode("div", _hoisted_69, [
                _createElementVNode("div", _hoisted_70, "🧭 " + _toDisplayString(_ctx.t('Calculation steps')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_71, _toDisplayString(_ctx.t(_ctx.activeFormula.name)), 1 /* TEXT */),
                (_ctx.stepData)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("ol", _hoisted_72, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.stepData.nodes, (nd, i) => {
                          return (_openBlock(), _createElementBlock("li", {
                            key: i,
                            class: _normalizeClass({first:i===0, last:i===_ctx.stepData.nodes.length-1})
                          }, [
                            (i>0)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_73, "↓"))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("span", {
                              class: "fb-math",
                              innerHTML: _ctx.mathmlNode(nd)
                            }, null, 8 /* PROPS */, _hoisted_74)
                          ], 2 /* CLASS */))
                        }), 128 /* KEYED_FRAGMENT */))
                      ]),
                      (_ctx.stepData.value!=null)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_75, [
                            _createTextVNode("= " + _toDisplayString(_ctx.fmt(_ctx.stepData.value, _ctx.activeFormula.decimals)), 1 /* TEXT */),
                            (_ctx.activeFormula.result_unit)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_76, _toDisplayString(_ctx.activeFormula.result_unit), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ], 64 /* STABLE_FRAGMENT */))
                  : (_ctx.stepError)
                    ? (_openBlock(), _createElementBlock("p", _hoisted_77, "⚠ " + _toDisplayString(_ctx.te(_ctx.stepError)), 1 /* TEXT */))
                    : (_openBlock(), _createElementBlock("p", _hoisted_78, _toDisplayString(_ctx.t('Enter all values to see the steps.')), 1 /* TEXT */))
              ]),
              _createElementVNode("div", _hoisted_79, [
                _createElementVNode("div", _hoisted_80, [
                  _createTextVNode("🕘 " + _toDisplayString(_ctx.t('History')) + " ", 1 /* TEXT */),
                  ((_ctx.history[_ctx.activeFormula.id]||[]).length)
                    ? (_openBlock(), _createElementBlock("button", {
                        key: 0,
                        class: "btn xs",
                        onClick: _cache[9] || (_cache[9] = $event => (_ctx.clearHistory(_ctx.activeFormula)))
                      }, _toDisplayString(_ctx.t('Clear')), 1 /* TEXT */))
                    : _createCommentVNode("v-if", true)
                ]),
                (!(_ctx.history[_ctx.activeFormula.id]||[]).length)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_81, _toDisplayString(_ctx.t('Press “Record” to log a calculation.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("ul", _hoisted_82, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.history[_ctx.activeFormula.id]||[]), (h, i) => {
                    return (_openBlock(), _createElementBlock("li", {
                      key: h.id
                    }, [
                      _createElementVNode("button", {
                        class: "fb-hist-restore",
                        onClick: $event => (_ctx.restore(_ctx.activeFormula, h)),
                        title: _ctx.t('Restore these values')
                      }, [
                        _createElementVNode("span", _hoisted_84, _toDisplayString(h.label), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_85, [
                          _createTextVNode("= " + _toDisplayString(h.result), 1 /* TEXT */),
                          (h.unit)
                            ? (_openBlock(), _createElementBlock("span", _hoisted_86, _toDisplayString(h.unit), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true)
                        ]),
                        _createElementVNode("span", _hoisted_87, _toDisplayString(_ctx.fmtTime(h.created_at)), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_83),
                      _createElementVNode("button", {
                        class: "fb-hist-copy",
                        onClick: _withModifiers($event => (_ctx.copyHistory(h,'value')), ["stop"]),
                        title: _ctx.t('Copy result')
                      }, _toDisplayString(_ctx.copiedKey==='h'+h.id+'-value' ? '✓' : '📋'), 9 /* TEXT, PROPS */, _hoisted_88),
                      _createElementVNode("button", {
                        class: "fb-hist-copy",
                        onClick: _withModifiers($event => (_ctx.copyHistory(h,'line')), ["stop"]),
                        title: _ctx.t('Copy line')
                      }, _toDisplayString(_ctx.copiedKey==='h'+h.id+'-line' ? '✓' : '📄'), 9 /* TEXT, PROPS */, _hoisted_89),
                      _createElementVNode("button", {
                        class: "fb-hist-del",
                        onClick: $event => (_ctx.deleteHistory(_ctx.activeFormula, i))
                      }, "✕", 8 /* PROPS */, _hoisted_90)
                    ]))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ])
            ], 4 /* STYLE */))
          : _createCommentVNode("v-if", true)
      ])
    ]),
    (_ctx.modal==='collection')
      ? (_openBlock(), _createElementBlock("div", _hoisted_91, [
          _createElementVNode("div", _hoisted_92, [
            _createElementVNode("div", _hoisted_93, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.collForm.id ? _ctx.t('⚙️ Collection settings') : _ctx.t('＋ New collection')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[10] || (_cache[10] = $event => (_ctx.modal=null))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_94, [
              _createElementVNode("div", _hoisted_95, [
                _createElementVNode("label", null, "🏷️ " + _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  class: "control",
                  "onUpdate:modelValue": _cache[11] || (_cache[11] = $event => ((_ctx.collForm.name) = $event)),
                  onKeyup: _cache[12] || (_cache[12] = _withKeys((...args) => (_ctx.saveCollection && _ctx.saveCollection(...args)), ["enter"]))
                }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelText, _ctx.collForm.name]
                ])
              ]),
              _createElementVNode("div", _hoisted_96, [
                _createElementVNode("label", null, "📝 " + _toDisplayString(_ctx.t('Description')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("textarea", {
                  class: "control",
                  "onUpdate:modelValue": _cache[13] || (_cache[13] = $event => ((_ctx.collForm.description) = $event)),
                  placeholder: _ctx.t('Description of this collection')
                }, null, 8 /* PROPS */, _hoisted_97), [
                  [_vModelText, _ctx.collForm.description]
                ])
              ]),
              _createElementVNode("div", _hoisted_98, [
                _createElementVNode("div", _hoisted_99, [
                  _createElementVNode("label", null, "🎨 " + _toDisplayString(_ctx.t('Color')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    type: "color",
                    class: "control",
                    "onUpdate:modelValue": _cache[14] || (_cache[14] = $event => ((_ctx.collForm.color) = $event)),
                    style: {"height":"44px","padding":"4px"}
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.collForm.color]
                  ])
                ]),
                _createElementVNode("div", _hoisted_100, [
                  _createElementVNode("label", null, "😀 " + _toDisplayString(_ctx.t('Icon')), 1 /* TEXT */),
                  _createElementVNode("div", _hoisted_101, [
                    _createElementVNode("button", {
                      type: "button",
                      class: _normalizeClass(["iconpick-cur", {open: _ctx.iconPickerOpen}]),
                      onClick: _cache[15] || (_cache[15] = _withModifiers((...args) => (_ctx.openIconPicker && _ctx.openIconPicker(...args)), ["stop"])),
                      title: _ctx.t('Click to choose an icon')
                    }, _toDisplayString(_ctx.collForm.icon || '🧮'), 11 /* TEXT, CLASS, PROPS */, _hoisted_102),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[16] || (_cache[16] = $event => ((_ctx.collForm.icon) = $event)),
                      maxlength: "16",
                      placeholder: _ctx.t('Emoji')
                    }, null, 8 /* PROPS */, _hoisted_103), [
                      [_vModelText, _ctx.collForm.icon]
                    ]),
                    (_ctx.iconPickerOpen)
                      ? (_openBlock(), _createElementBlock("div", {
                          key: 0,
                          class: "emoji-popup",
                          onClick: _cache[18] || (_cache[18] = _withModifiers(() => {}, ["stop"]))
                        }, [
                          _withDirectives(_createElementVNode("input", {
                            class: "emoji-search",
                            "onUpdate:modelValue": _cache[17] || (_cache[17] = $event => ((_ctx.emojiQuery) = $event)),
                            placeholder: _ctx.t('Search emoji')
                          }, null, 8 /* PROPS */, _hoisted_104), [
                            [_vModelText, _ctx.emojiQuery]
                          ]),
                          _createElementVNode("div", _hoisted_105, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.iconGroupsAll, (g) => {
                              return (_openBlock(), _createElementBlock("button", {
                                type: "button",
                                class: _normalizeClass(["emoji-tab", {sel: !_ctx.emojiQuery && _ctx.emojiTab===g.key}]),
                                key: g.key,
                                title: _ctx.t(g.key),
                                onClick: $event => {_ctx.emojiTab = g.key; _ctx.emojiQuery = ''}
                              }, _toDisplayString(g.tab), 11 /* TEXT, CLASS, PROPS */, _hoisted_106))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]),
                          _createElementVNode("div", _hoisted_107, [
                            _createElementVNode("div", _hoisted_108, _toDisplayString(_ctx.emojiQuery ? _ctx.t('{n} items', {n: _ctx.emojiShown.length}) : _ctx.t(_ctx.emojiTab)), 1 /* TEXT */),
                            (_ctx.emojiLoading)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_109, _toDisplayString(_ctx.t('Loading…')), 1 /* TEXT */))
                              : (!_ctx.emojiShown.length)
                                ? (_openBlock(), _createElementBlock("div", _hoisted_110, _toDisplayString(_ctx.t('No matching emoji')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true),
                            _createElementVNode("div", _hoisted_111, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.emojiShown, (em) => {
                                return (_openBlock(), _createElementBlock("button", {
                                  type: "button",
                                  class: _normalizeClass(["emoji-btn", {sel: _ctx.collForm.icon===em}]),
                                  key: em,
                                  onClick: $event => {_ctx.collForm.icon = em; _ctx.iconPickerOpen = false},
                                  title: _ctx.emojiName(em)
                                }, _toDisplayString(em), 11 /* TEXT, CLASS, PROPS */, _hoisted_112))
                              }), 128 /* KEYED_FRAGMENT */))
                            ])
                          ])
                        ]))
                      : _createCommentVNode("v-if", true)
                  ]),
                  (_ctx.iconPickerOpen)
                    ? (_openBlock(), _createElementBlock("div", {
                        key: 0,
                        class: "perm-backdrop",
                        onClick: _cache[19] || (_cache[19] = $event => (_ctx.iconPickerOpen = false))
                      }))
                    : _createCommentVNode("v-if", true)
                ])
              ]),
              (_ctx.collForm.id && _ctx.isOwner)
                ? (_openBlock(), _createElementBlock("div", {
                    key: 0,
                    class: _normalizeClass(["field share-section", {open: _ctx.shareExpanded}])
                  }, [
                    _createElementVNode("button", {
                      type: "button",
                      class: "share-toggle",
                      "aria-expanded": _ctx.shareExpanded ? 'true' : 'false',
                      onClick: _cache[20] || (_cache[20] = $event => (_ctx.shareExpanded = !_ctx.shareExpanded))
                    }, [
                      _createElementVNode("span", _hoisted_114, "👥 " + _toDisplayString(_ctx.t('Share settings')), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_115, [
                        _createElementVNode("span", _hoisted_116, _toDisplayString(_ctx.shareExpanded ? '▼' : '▶'), 1 /* TEXT */),
                        (!_ctx.shareExpanded)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_117, _toDisplayString(_ctx.t('Click to expand')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ]),
                      (_ctx.sharePanel.shares.length)
                        ? (_openBlock(), _createElementBlock("span", _hoisted_118, _toDisplayString(_ctx.sharePanel.shares.length), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ], 8 /* PROPS */, _hoisted_113),
                    _withDirectives(_createElementVNode("div", _hoisted_119, [
                      (_ctx.sharePanel.shares.length)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_120, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sharePanel.shares, (s) => {
                              return (_openBlock(), _createElementBlock("div", {
                                key: s.recipient_uid,
                                class: "share-row"
                              }, [
                                _createElementVNode("span", _hoisted_121, _toDisplayString(s.recipient_name || s.recipient_uid), 1 /* TEXT */),
                                _createElementVNode("select", {
                                  class: "share-perm",
                                  value: s.perm,
                                  onChange: $event => (_ctx.changeSharePerm(s, $event.target.value))
                                }, [
                                  _createElementVNode("option", _hoisted_123, _toDisplayString(_ctx.t('View')), 1 /* TEXT */),
                                  _createElementVNode("option", _hoisted_124, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */),
                                  _createElementVNode("option", _hoisted_125, _toDisplayString(_ctx.t('Delete')), 1 /* TEXT */)
                                ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_122),
                                _createElementVNode("button", {
                                  type: "button",
                                  class: "icon-btn",
                                  onClick: $event => (_ctx.removeShare(s)),
                                  title: _ctx.t('Remove share')
                                }, "🗑", 8 /* PROPS */, _hoisted_126)
                              ]))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("div", _hoisted_127, [
                        _createElementVNode("div", _hoisted_128, [
                          (!_ctx.sharePanel.recipient)
                            ? (_openBlock(), _createElementBlock("div", _hoisted_129, [
                                _withDirectives(_createElementVNode("input", {
                                  "onUpdate:modelValue": _cache[21] || (_cache[21] = $event => ((_ctx.sharePanel.q) = $event)),
                                  onInput: _cache[22] || (_cache[22] = (...args) => (_ctx.searchShareUsers && _ctx.searchShareUsers(...args))),
                                  placeholder: _ctx.t('Search users to share with…'),
                                  autocomplete: "off"
                                }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_130), [
                                  [_vModelText, _ctx.sharePanel.q]
                                ]),
                                (_ctx.sharePanel.results.length)
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_131, [
                                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sharePanel.results, (u) => {
                                        return (_openBlock(), _createElementBlock("button", {
                                          type: "button",
                                          key: u.uid,
                                          class: "share-result",
                                          onClick: $event => (_ctx.pickShareUser(u))
                                        }, [
                                          _createTextVNode(_toDisplayString(u.name) + " ", 1 /* TEXT */),
                                          _createElementVNode("span", _hoisted_133, "(" + _toDisplayString(u.uid) + ")", 1 /* TEXT */)
                                        ], 8 /* PROPS */, _hoisted_132))
                                      }), 128 /* KEYED_FRAGMENT */))
                                    ]))
                                  : _createCommentVNode("v-if", true)
                              ]))
                            : (_openBlock(), _createElementBlock("div", _hoisted_134, [
                                _createElementVNode("span", _hoisted_135, [
                                  _createTextVNode(_toDisplayString(_ctx.sharePanel.recipientName) + " ", 1 /* TEXT */),
                                  _createElementVNode("span", _hoisted_136, "(" + _toDisplayString(_ctx.sharePanel.recipient) + ")", 1 /* TEXT */)
                                ]),
                                _createElementVNode("button", {
                                  type: "button",
                                  class: "icon-btn",
                                  onClick: _cache[23] || (_cache[23] = (...args) => (_ctx.clearShareRecipient && _ctx.clearShareRecipient(...args)))
                                }, "✕")
                              ])),
                          _createElementVNode("div", {
                            class: _normalizeClass(["perm-wrap", {open: _ctx.permOpen}]),
                            title: _ctx.t('Permission'),
                            onClick: _cache[25] || (_cache[25] = _withModifiers($event => (_ctx.permOpen = !_ctx.permOpen), ["stop"]))
                          }, [
                            _createElementVNode("span", _hoisted_138, _toDisplayString(_ctx.permLabel), 1 /* TEXT */),
                            _hoisted_139,
                            (_ctx.permOpen)
                              ? (_openBlock(), _createElementBlock("div", {
                                  key: 0,
                                  class: "perm-menu",
                                  onClick: _cache[24] || (_cache[24] = _withModifiers(() => {}, ["stop"]))
                                }, [
                                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.permOptions, (o) => {
                                    return (_openBlock(), _createElementBlock("button", {
                                      type: "button",
                                      key: o.v,
                                      class: _normalizeClass(["perm-opt", {sel: _ctx.sharePanel.perm === o.v}]),
                                      onClick: $event => {_ctx.sharePanel.perm = o.v; _ctx.permOpen = false}
                                    }, _toDisplayString(o.label), 11 /* TEXT, CLASS, PROPS */, _hoisted_140))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ]))
                              : _createCommentVNode("v-if", true)
                          ], 10 /* CLASS, PROPS */, _hoisted_137),
                          (_ctx.permOpen)
                            ? (_openBlock(), _createElementBlock("div", {
                                key: 2,
                                class: "perm-backdrop",
                                onClick: _cache[26] || (_cache[26] = $event => (_ctx.permOpen = false))
                              }))
                            : _createCommentVNode("v-if", true)
                        ]),
                        (_ctx.sharePanel.err)
                          ? (_openBlock(), _createElementBlock("div", _hoisted_141, _toDisplayString(_ctx.sharePanel.err), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _createElementVNode("button", {
                          type: "button",
                          class: "btn sm primary",
                          disabled: !_ctx.sharePanel.recipient || _ctx.sharePanel.busy,
                          onClick: _cache[27] || (_cache[27] = (...args) => (_ctx.addShare && _ctx.addShare(...args)))
                        }, _toDisplayString(_ctx.t('Share')), 9 /* TEXT, PROPS */, _hoisted_142)
                      ])
                    ], 512 /* NEED_PATCH */), [
                      [_vShow, _ctx.shareExpanded]
                    ])
                  ], 2 /* CLASS */))
                : _createCommentVNode("v-if", true),
              (_ctx.collForm.id)
                ? (_openBlock(), _createElementBlock("div", _hoisted_143, [
                    _createElementVNode("label", null, "📤 " + _toDisplayString(_ctx.t('Export')), 1 /* TEXT */),
                    _createElementVNode("div", null, [
                      _createElementVNode("button", {
                        type: "button",
                        class: "btn sm",
                        onClick: _cache[28] || (_cache[28] = (...args) => (_ctx.exportCollectionOds && _ctx.exportCollectionOds(...args)))
                      }, "📄 " + _toDisplayString(_ctx.t('Export to ODS (spreadsheet)')), 1 /* TEXT */)
                    ]),
                    _createElementVNode("div", _hoisted_144, _toDisplayString(_ctx.t('Download this collection as an OpenDocument spreadsheet (.ods).')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_145, [
              (_ctx.collForm.id)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn danger",
                    onClick: _cache[29] || (_cache[29] = (...args) => (_ctx.removeCollection && _ctx.removeCollection(...args)))
                  }, _toDisplayString(_ctx.t('Delete')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_146,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[30] || (_cache[30] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[31] || (_cache[31] = (...args) => (_ctx.saveCollection && _ctx.saveCollection(...args)))
              }, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal==='formula')
      ? (_openBlock(), _createElementBlock("div", _hoisted_147, [
          _createElementVNode("div", _hoisted_148, [
            _createElementVNode("div", _hoisted_149, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.fForm.id ? _ctx.t('Edit formula') : _ctx.t('New formula')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[32] || (_cache[32] = $event => (_ctx.modal=null))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_150, [
              _createElementVNode("div", _hoisted_151, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Title')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  class: "control",
                  "onUpdate:modelValue": _cache[33] || (_cache[33] = $event => ((_ctx.fForm.name) = $event)),
                  placeholder: _ctx.t('e.g. Selling price')
                }, null, 8 /* PROPS */, _hoisted_152), [
                  [_vModelText, _ctx.fForm.name]
                ])
              ]),
              _createElementVNode("div", _hoisted_153, [
                _createElementVNode("label", null, [
                  _createTextVNode(_toDisplayString(_ctx.t('Description')) + " ", 1 /* TEXT */),
                  _createElementVNode("span", _hoisted_154, [
                    _createElementVNode("button", {
                      type: "button",
                      class: _normalizeClass(["btn xs", {primary: !_ctx.mdPreview}]),
                      onClick: _cache[34] || (_cache[34] = $event => (_ctx.mdPreview=false))
                    }, _toDisplayString(_ctx.t('Write')), 3 /* TEXT, CLASS */),
                    _createElementVNode("button", {
                      type: "button",
                      class: _normalizeClass(["btn xs", {primary: _ctx.mdPreview}]),
                      onClick: _cache[35] || (_cache[35] = $event => (_ctx.mdPreview=true))
                    }, _toDisplayString(_ctx.t('Preview')), 3 /* TEXT, CLASS */)
                  ])
                ]),
                (!_ctx.mdPreview)
                  ? _withDirectives((_openBlock(), _createElementBlock("textarea", {
                      key: 0,
                      class: "control",
                      "onUpdate:modelValue": _cache[36] || (_cache[36] = $event => ((_ctx.fForm.description) = $event)),
                      rows: "4",
                      placeholder: _ctx.t('Supports Markdown: **bold**, *italic*, lists, [links](https://…)')
                    }, null, 8 /* PROPS */, _hoisted_155)), [
                      [_vModelText, _ctx.fForm.description]
                    ])
                  : (_openBlock(), _createElementBlock("div", {
                      key: 1,
                      class: "fb-md-preview fb-md",
                      innerHTML: _ctx.md(_ctx.fForm.description) || '<span class="empty-hint sm">—</span>'
                    }, null, 8 /* PROPS */, _hoisted_156))
              ]),
              _createElementVNode("div", _hoisted_157, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Expression')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  class: "control mono",
                  ref: "exprInput",
                  "onUpdate:modelValue": _cache[37] || (_cache[37] = $event => ((_ctx.fForm.expression) = $event)),
                  onInput: _cache[38] || (_cache[38] = (...args) => (_ctx.onExpr && _ctx.onExpr(...args))),
                  placeholder: "price * (1 + tax / 100)"
                }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelText, _ctx.fForm.expression]
                ]),
                _createElementVNode("p", _hoisted_158, _toDisplayString(_ctx.t('Give each unknown a name, then combine them with the buttons below. Example: price * (1 + tax / 100)')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_159, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.pad, (grp) => {
                    return (_openBlock(), _createElementBlock("div", {
                      class: "fb-pad-row",
                      key: grp.g
                    }, [
                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(grp.items, (it) => {
                        return (_openBlock(), _createElementBlock("button", {
                          type: "button",
                          class: "btn xs fb-pad-btn",
                          key: it.l,
                          onClick: $event => (_ctx.insertToken(it))
                        }, _toDisplayString(it.l), 9 /* TEXT, PROPS */, _hoisted_160))
                      }), 128 /* KEYED_FRAGMENT */))
                    ]))
                  }), 128 /* KEYED_FRAGMENT */)),
                  (_ctx.fForm.variables.some(v => v.key))
                    ? (_openBlock(), _createElementBlock("div", _hoisted_161, [
                        _createElementVNode("span", _hoisted_162, _toDisplayString(_ctx.t('Variables')), 1 /* TEXT */),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.fForm.variables.filter(x => x.key), (v) => {
                          return (_openBlock(), _createElementBlock("button", {
                            type: "button",
                            class: "btn xs fb-pad-btn var",
                            key: 'pv'+v.key,
                            onClick: $event => (_ctx.insertToken({t:v.key}))
                          }, _toDisplayString(v.key), 9 /* TEXT, PROPS */, _hoisted_163))
                        }), 128 /* KEYED_FRAGMENT */))
                      ]))
                    : _createCommentVNode("v-if", true)
                ]),
                (_ctx.fForm.expression.trim() && !_ctx.fForm.exprError)
                  ? (_openBlock(), _createElementBlock("div", {
                      key: 0,
                      class: "fb-expr-preview",
                      innerHTML: _ctx.mathml(_ctx.fForm.expression)
                    }, null, 8 /* PROPS */, _hoisted_164))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("div", _hoisted_165, [
                  _createElementVNode("button", {
                    type: "button",
                    class: "btn xs",
                    onClick: _cache[39] || (_cache[39] = $event => (_ctx.showFuncs = !_ctx.showFuncs))
                  }, "📖 " + _toDisplayString(_ctx.showFuncs ? _ctx.t('Hide the function list') : _ctx.t('Functions you can use')), 1 /* TEXT */),
                  (_ctx.showFuncs)
                    ? (_openBlock(), _createElementBlock("div", _hoisted_166, [
                        _withDirectives(_createElementVNode("input", {
                          class: "control",
                          "onUpdate:modelValue": _cache[40] || (_cache[40] = $event => ((_ctx.funcQuery) = $event)),
                          placeholder: _ctx.t('Search functions')
                        }, null, 8 /* PROPS */, _hoisted_167), [
                          [_vModelText, _ctx.funcQuery]
                        ]),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.funcGroups, (grp) => {
                          return (_openBlock(), _createElementBlock("div", {
                            class: "fb-funcs-group",
                            key: grp.g
                          }, [
                            _createElementVNode("div", _hoisted_168, _toDisplayString(_ctx.t(grp.g)), 1 /* TEXT */),
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(grp.items, (it) => {
                              return (_openBlock(), _createElementBlock("button", {
                                type: "button",
                                class: "fb-funcs-item",
                                key: it.s,
                                onClick: $event => (it.t && _ctx.insertToken({ t: it.t })),
                                title: it.t ? _ctx.t('Insert into the expression') : ''
                              }, [
                                _createElementVNode("code", null, _toDisplayString(it.s), 1 /* TEXT */),
                                _createElementVNode("span", null, _toDisplayString(_ctx.t(it.d)), 1 /* TEXT */)
                              ], 8 /* PROPS */, _hoisted_169))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        }), 128 /* KEYED_FRAGMENT */))
                      ]))
                    : _createCommentVNode("v-if", true)
                ])
              ]),
              (_ctx.fForm.exprError)
                ? (_openBlock(), _createElementBlock("div", _hoisted_170, [
                    _createElementVNode("span", _hoisted_171, "⚠ " + _toDisplayString(_ctx.te(_ctx.fForm.exprError)), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_172, [
                _createElementVNode("label", null, [
                  _createTextVNode(_toDisplayString(_ctx.t('Variables')) + " ", 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs",
                    onClick: _cache[41] || (_cache[41] = (...args) => (_ctx.detectVars && _ctx.detectVars(...args)))
                  }, _toDisplayString(_ctx.t('Detect from expression')), 1 /* TEXT */)
                ]),
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.fForm.variables, (v, idx) => {
                  return (_openBlock(), _createElementBlock("div", {
                    class: "schema-row",
                    key: idx
                  }, [
                    _withDirectives(_createElementVNode("input", {
                      class: "control mono",
                      "onUpdate:modelValue": $event => ((v.key) = $event),
                      placeholder: _ctx.t('key'),
                      style: {"width":"110px"}
                    }, null, 8 /* PROPS */, _hoisted_173), [
                      [_vModelText, v.key]
                    ]),
                    _withDirectives(_createElementVNode("input", {
                      class: "control",
                      "onUpdate:modelValue": $event => ((v.label) = $event),
                      placeholder: _ctx.t('label')
                    }, null, 8 /* PROPS */, _hoisted_174), [
                      [_vModelText, v.label]
                    ]),
                    _withDirectives(_createElementVNode("input", {
                      class: "control",
                      "onUpdate:modelValue": $event => ((v.unit) = $event),
                      placeholder: _ctx.t('unit'),
                      style: {"width":"80px"}
                    }, null, 8 /* PROPS */, _hoisted_175), [
                      [_vModelText, v.unit]
                    ]),
                    _withDirectives(_createElementVNode("select", {
                      class: "control",
                      "onUpdate:modelValue": $event => ((v.type) = $event),
                      style: {"width":"96px"},
                      title: _ctx.t('What this variable holds')
                    }, [
                      _createElementVNode("option", _hoisted_177, _toDisplayString(_ctx.t('Number')), 1 /* TEXT */),
                      _createElementVNode("option", _hoisted_178, _toDisplayString(_ctx.t('List')), 1 /* TEXT */),
                      _createElementVNode("option", _hoisted_179, _toDisplayString(_ctx.t('Matrix')), 1 /* TEXT */),
                      _createElementVNode("option", _hoisted_180, _toDisplayString(_ctx.t('Complex')), 1 /* TEXT */)
                    ], 8 /* PROPS */, _hoisted_176), [
                      [_vModelSelect, v.type]
                    ]),
                    _withDirectives(_createElementVNode("input", {
                      class: "control",
                      type: v.type ? 'text' : 'number',
                      step: "any",
                      "onUpdate:modelValue": $event => ((v.default) = $event),
                      placeholder: _ctx.t('default'),
                      style: {"width":"110px"}
                    }, null, 8 /* PROPS */, _hoisted_181), [
                      [_vModelDynamic, v.default]
                    ]),
                    _createElementVNode("button", {
                      class: "btn xs danger",
                      onClick: $event => (_ctx.fForm.variables.splice(idx,1))
                    }, "✕", 8 /* PROPS */, _hoisted_182)
                  ]))
                }), 128 /* KEYED_FRAGMENT */)),
                _createElementVNode("button", {
                  class: "btn xs",
                  onClick: _cache[42] || (_cache[42] = $event => (_ctx.fForm.variables.push({key:'',label:'',unit:'',default:'',type:''})))
                }, "＋ " + _toDisplayString(_ctx.t('Add variable')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_183, [
                _createElementVNode("span", null, [
                  _createElementVNode("label", null, _toDisplayString(_ctx.t('Result unit')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    class: "control",
                    "onUpdate:modelValue": _cache[43] || (_cache[43] = $event => ((_ctx.fForm.result_unit) = $event)),
                    style: {"width":"120px"}
                  }, null, 512 /* NEED_PATCH */), [
                    [_vModelText, _ctx.fForm.result_unit]
                  ])
                ]),
                _createElementVNode("span", null, [
                  _createElementVNode("label", null, _toDisplayString(_ctx.t('Decimals')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    class: "control",
                    type: "number",
                    min: "0",
                    max: "10",
                    "onUpdate:modelValue": _cache[44] || (_cache[44] = $event => ((_ctx.fForm.decimals) = $event)),
                    style: {"width":"90px"}
                  }, null, 512 /* NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.fForm.decimals,
                      void 0,
                      { number: true }
                    ]
                  ])
                ])
              ]),
              _createElementVNode("div", _hoisted_184, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("textarea", {
                  class: "control",
                  "onUpdate:modelValue": _cache[45] || (_cache[45] = $event => ((_ctx.fForm.notes) = $event)),
                  rows: "2"
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelText, _ctx.fForm.notes]
                ])
              ])
            ]),
            _createElementVNode("div", _hoisted_185, [
              (_ctx.fForm.id)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    type: "button",
                    class: "btn",
                    onClick: _cache[46] || (_cache[46] = $event => (_ctx.openVersions(_ctx.fForm.id)))
                  }, "🕐 " + _toDisplayString(_ctx.t('Versions')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_186,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[47] || (_cache[47] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[48] || (_cache[48] = (...args) => (_ctx.saveFormula && _ctx.saveFormula(...args)))
              }, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    _createCommentVNode(" Versions kept beside a formula. Floats above the formula edit modal. "),
    (_ctx.vers.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 2,
          class: "modal-mask",
          onClick: _cache[51] || (_cache[51] = _withModifiers($event => (_ctx.vers.open=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_187, [
            _createElementVNode("div", _hoisted_188, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('Versions of “{name}”', {name: _ctx.vers.title})), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[49] || (_cache[49] = $event => (_ctx.vers.open=false))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_189, [
              (!_ctx.vers.list.length)
                ? (_openBlock(), _createElementBlock("p", _hoisted_190, _toDisplayString(_ctx.t('None yet. One is kept each time the formula is edited, if versions are switched on in the settings.')), 1 /* TEXT */))
                : (_openBlock(), _createElementBlock("ol", _hoisted_191, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.vers.list, (v) => {
                      return (_openBlock(), _createElementBlock("li", {
                        key: v.number,
                        style: {"display":"flex","align-items":"center","gap":"10px","padding":"6px 0","border-bottom":"1px solid var(--border)"}
                      }, [
                        _createElementVNode("span", _hoisted_192, "#" + _toDisplayString(String(v.number).padStart(2,'0')), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_193, _toDisplayString(_ctx.fmtVerTime(v.created_at)), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_194, _toDisplayString(v.size) + " B", 1 /* TEXT */),
                        _createElementVNode("button", {
                          type: "button",
                          class: "btn xs",
                          onClick: $event => (_ctx.restoreVersion(v.number))
                        }, _toDisplayString(_ctx.t('Put this one back')), 9 /* TEXT, PROPS */, _hoisted_195)
                      ]))
                    }), 128 /* KEYED_FRAGMENT */))
                  ])),
              _createElementVNode("p", _hoisted_196, _toDisplayString(_ctx.t('Putting a version back keeps what is there now as a version of its own, so it can be undone the same way.')), 1 /* TEXT */)
            ]),
            _createElementVNode("div", _hoisted_197, [
              _hoisted_198,
              _createElementVNode("button", {
                type: "button",
                class: "btn primary",
                onClick: _cache[50] || (_cache[50] = $event => (_ctx.vers.open=false))
              }, _toDisplayString(_ctx.t('Done')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal==='templates')
      ? (_openBlock(), _createElementBlock("div", {
          key: 3,
          class: "modal-mask",
          onClick: _cache[56] || (_cache[56] = _withModifiers($event => (_ctx.modal=null), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_199, [
            _createElementVNode("div", _hoisted_200, [
              _createElementVNode("h3", null, "📐 " + _toDisplayString(_ctx.t('Formula templates')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[52] || (_cache[52] = $event => (_ctx.modal=null))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_201, [
              _createElementVNode("p", _hoisted_202, _toDisplayString(_ctx.t('Add a ready-made formula to the current collection.')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_203, [
                _hoisted_204,
                _withDirectives(_createElementVNode("input", {
                  class: "control",
                  type: "search",
                  "onUpdate:modelValue": _cache[53] || (_cache[53] = $event => ((_ctx.tplSearch) = $event)),
                  placeholder: _ctx.t('Search templates (name, category, formula)…'),
                  autocomplete: "off"
                }, null, 8 /* PROPS */, _hoisted_205), [
                  [_vModelText, _ctx.tplSearch]
                ]),
                (_ctx.tplSearch)
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 0,
                      type: "button",
                      class: "tpl-search-clear",
                      onClick: _cache[54] || (_cache[54] = $event => (_ctx.tplSearch='')),
                      title: _ctx.t('Clear')
                    }, "✕", 8 /* PROPS */, _hoisted_206))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("span", _hoisted_207, _toDisplayString(_ctx.templateMatchCount), 1 /* TEXT */)
              ]),
              (!_ctx.tplIndexLoaded)
                ? (_openBlock(), _createElementBlock("p", _hoisted_208, _toDisplayString(_ctx.t('Loading templates…')), 1 /* TEXT */))
                : (!_ctx.templateTree.length)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_209, _toDisplayString(_ctx.t('No templates match your search.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_210, [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.templateTree, (G) => {
                  return (_openBlock(), _createElementBlock(_Fragment, {
                    key: G.g
                  }, [
                    _createElementVNode("h4", _hoisted_211, [
                      _createElementVNode("span", _hoisted_212, _toDisplayString(G.i), 1 /* TEXT */),
                      _createTextVNode(_toDisplayString(_ctx.t(G.g)), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_213, _toDisplayString(G.n), 1 /* TEXT */)
                    ]),
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(G.subs, (g) => {
                      return (_openBlock(), _createElementBlock("div", {
                        class: _normalizeClass(["tpl-group", { open: _ctx.isGroupOpen(g.cat) }]),
                        key: g.cat
                      }, [
                        _createElementVNode("button", {
                          type: "button",
                          class: "tpl-group-h",
                          onClick: $event => (_ctx.toggleGroup(g.cat)),
                          "aria-expanded": _ctx.isGroupOpen(g.cat) ? 'true' : 'false'
                        }, [
                          _hoisted_215,
                          _createElementVNode("span", _hoisted_216, _toDisplayString(_ctx.catIcon(g.cat)), 1 /* TEXT */),
                          _createElementVNode("span", _hoisted_217, _toDisplayString(_ctx.t(g.cat)), 1 /* TEXT */),
                          _createElementVNode("span", _hoisted_218, _toDisplayString(g.items.length), 1 /* TEXT */)
                        ], 8 /* PROPS */, _hoisted_214),
                        (_ctx.isGroupOpen(g.cat))
                          ? (_openBlock(), _createElementBlock("div", _hoisted_219, [
                              (!_ctx.tplCache[g.cat])
                                ? (_openBlock(), _createElementBlock("p", _hoisted_220, _toDisplayString(_ctx.t('Loading…')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true),
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.catItems(g), (tp) => {
                                return (_openBlock(), _createElementBlock("div", {
                                  class: "tpl-card",
                                  key: tp.name
                                }, [
                                  _createElementVNode("div", _hoisted_221, [
                                    _createElementVNode("button", {
                                      class: "tpl-add",
                                      onClick: $event => (_ctx.addTemplate(tp)),
                                      title: _ctx.t('Add'),
                                      "aria-label": _ctx.t('Add')
                                    }, "＋", 8 /* PROPS */, _hoisted_222),
                                    _createElementVNode("div", _hoisted_223, _toDisplayString(_ctx.t(tp.name)), 1 /* TEXT */),
                                    (_ctx.isReversible(tp))
                                      ? (_openBlock(), _createElementBlock("span", {
                                          key: 0,
                                          class: "badge-outline",
                                          title: _ctx.t('This formula can be reverse-calculated (solve for a variable from the result).')
                                        }, "⇄ " + _toDisplayString(_ctx.t('Reversible')), 9 /* TEXT, PROPS */, _hoisted_224))
                                      : _createCommentVNode("v-if", true)
                                  ]),
                                  _createElementVNode("div", {
                                    class: "tpl-expr",
                                    innerHTML: _ctx.mathml(tp.expression)
                                  }, null, 8 /* PROPS */, _hoisted_225),
                                  (tp.description)
                                    ? (_openBlock(), _createElementBlock("div", {
                                        key: 0,
                                        class: "tpl-desc fb-md",
                                        innerHTML: _ctx.md(_ctx.t(tp.description))
                                      }, null, 8 /* PROPS */, _hoisted_226))
                                    : _createCommentVNode("v-if", true)
                                ]))
                              }), 128 /* KEYED_FRAGMENT */))
                            ]))
                          : _createCommentVNode("v-if", true)
                      ], 2 /* CLASS */))
                    }), 128 /* KEYED_FRAGMENT */))
                  ], 64 /* STABLE_FRAGMENT */))
                }), 128 /* KEYED_FRAGMENT */))
              ])
            ]),
            _createElementVNode("div", _hoisted_227, [
              _hoisted_228,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[55] || (_cache[55] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal==='tplsettings')
      ? (_openBlock(), _createElementBlock("div", _hoisted_229, [
          _createElementVNode("div", _hoisted_230, [
            _createElementVNode("div", _hoisted_231, [
              _createElementVNode("h3", null, "📐 " + _toDisplayString(_ctx.t('Template settings')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[57] || (_cache[57] = (...args) => (_ctx.closeTplSettings && _ctx.closeTplSettings(...args))),
                title: _ctx.t('Cancel')
              }, "✕", 8 /* PROPS */, _hoisted_232)
            ]),
            _createElementVNode("div", _hoisted_233, [
              _createElementVNode("p", _hoisted_234, _toDisplayString(_ctx.t('Untick the templates you do not want to see. Hidden templates do not appear in the template list or its search.')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_235, [
                _createElementVNode("span", null, _toDisplayString(_ctx.t('Shown: {n} of {total}', { n: _ctx.tplSetShown, total: _ctx.tplIndex.length })), 1 /* TEXT */),
                _hoisted_236,
                _createElementVNode("button", {
                  type: "button",
                  class: "btn sm fb-tplset-all",
                  onClick: _cache[58] || (_cache[58] = (...args) => (_ctx.tplSetShowAll && _ctx.tplSetShowAll(...args)))
                }, _toDisplayString(_ctx.t('Show all')), 1 /* TEXT */)
              ]),
              (!_ctx.tplIndexLoaded)
                ? (_openBlock(), _createElementBlock("p", _hoisted_237, _toDisplayString(_ctx.t('Loading templates…')), 1 /* TEXT */))
                : (_openBlock(), _createElementBlock("div", _hoisted_238, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.tplSetTree, (G) => {
                      return (_openBlock(), _createElementBlock("div", {
                        class: "fb-tplset-g",
                        key: G.g
                      }, [
                        _createElementVNode("div", _hoisted_239, [
                          _createElementVNode("button", {
                            type: "button",
                            class: "fb-tplset-fold",
                            onClick: $event => (_ctx.tplSetFold('g', G.g))
                          }, _toDisplayString(_ctx.tplSet.openG[G.g] ? '▼' : '▶'), 9 /* TEXT, PROPS */, _hoisted_240),
                          _createElementVNode("label", null, [
                            _createElementVNode("input", {
                              type: "checkbox",
                              checked: G.state === 'all',
                              ".indeterminate": G.state === 'some',
                              onChange: $event => (_ctx.tplSetToggle(G.names, $event.target.checked))
                            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_241),
                            _createTextVNode(" " + _toDisplayString(G.i) + " " + _toDisplayString(_ctx.t(G.g)), 1 /* TEXT */)
                          ]),
                          _createElementVNode("span", _hoisted_242, _toDisplayString(G.shown) + " / " + _toDisplayString(G.names.length), 1 /* TEXT */)
                        ]),
                        (_ctx.tplSet.openG[G.g])
                          ? (_openBlock(true), _createElementBlock(_Fragment, { key: 0 }, _renderList(G.subs, (S) => {
                              return (_openBlock(), _createElementBlock("div", {
                                class: "fb-tplset-s",
                                key: S.cat
                              }, [
                                _createElementVNode("div", _hoisted_243, [
                                  _createElementVNode("button", {
                                    type: "button",
                                    class: "fb-tplset-fold",
                                    onClick: $event => (_ctx.tplSetFold('s', S.cat))
                                  }, _toDisplayString(_ctx.tplSet.openS[S.cat] ? '▼' : '▶'), 9 /* TEXT, PROPS */, _hoisted_244),
                                  _createElementVNode("label", null, [
                                    _createElementVNode("input", {
                                      type: "checkbox",
                                      checked: S.state === 'all',
                                      ".indeterminate": S.state === 'some',
                                      onChange: $event => (_ctx.tplSetToggle(S.names, $event.target.checked))
                                    }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_245),
                                    _createTextVNode(" " + _toDisplayString(_ctx.catIcon(S.cat)) + " " + _toDisplayString(_ctx.t(S.cat)), 1 /* TEXT */)
                                  ]),
                                  _createElementVNode("span", _hoisted_246, _toDisplayString(S.shown) + " / " + _toDisplayString(S.names.length), 1 /* TEXT */)
                                ]),
                                (_ctx.tplSet.openS[S.cat])
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_247, [
                                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(S.names, (nm) => {
                                        return (_openBlock(), _createElementBlock("label", {
                                          class: "fb-tplset-row lvl2",
                                          key: nm
                                        }, [
                                          _createElementVNode("input", {
                                            type: "checkbox",
                                            checked: !_ctx.tplSet.hid[nm],
                                            onChange: $event => (_ctx.tplSetToggle([nm], $event.target.checked))
                                          }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_248),
                                          _createTextVNode(" " + _toDisplayString(_ctx.t(nm)), 1 /* TEXT */)
                                        ]))
                                      }), 128 /* KEYED_FRAGMENT */))
                                    ]))
                                  : _createCommentVNode("v-if", true)
                              ]))
                            }), 128 /* KEYED_FRAGMENT */))
                          : _createCommentVNode("v-if", true)
                      ]))
                    }), 128 /* KEYED_FRAGMENT */))
                  ]))
            ]),
            _createElementVNode("div", _hoisted_249, [
              _hoisted_250,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[59] || (_cache[59] = (...args) => (_ctx.closeTplSettings && _ctx.closeTplSettings(...args)))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary fb-tplset-save",
                onClick: _cache[60] || (_cache[60] = (...args) => (_ctx.saveTplSettings && _ctx.saveTplSettings(...args)))
              }, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal==='settings')
      ? (_openBlock(), _createElementBlock("div", _hoisted_251, [
          _createElementVNode("div", _hoisted_252, [
            _createElementVNode("div", _hoisted_253, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('⚙️ Settings')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[61] || (_cache[61] = (...args) => (_ctx.cancelSettings && _ctx.cancelSettings(...args)))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_254, [
              _createElementVNode("div", _hoisted_255, [
                _createElementVNode("label", null, "🌗 " + _toDisplayString(_ctx.t('Theme')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_256, [
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "auto",
                      "onUpdate:modelValue": _cache[62] || (_cache[62] = $event => ((_ctx.settingsForm.theme) = $event)),
                      onChange: _cache[63] || (_cache[63] = (...args) => (_ctx.previewTheme && _ctx.previewTheme(...args)))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelRadio, _ctx.settingsForm.theme]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Default (match Nextcloud)')), 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "light",
                      "onUpdate:modelValue": _cache[64] || (_cache[64] = $event => ((_ctx.settingsForm.theme) = $event)),
                      onChange: _cache[65] || (_cache[65] = (...args) => (_ctx.previewTheme && _ctx.previewTheme(...args)))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelRadio, _ctx.settingsForm.theme]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Light')), 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "dark",
                      "onUpdate:modelValue": _cache[66] || (_cache[66] = $event => ((_ctx.settingsForm.theme) = $event)),
                      onChange: _cache[67] || (_cache[67] = (...args) => (_ctx.previewTheme && _ctx.previewTheme(...args)))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelRadio, _ctx.settingsForm.theme]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Dark')), 1 /* TEXT */)
                  ])
                ])
              ]),
              _createElementVNode("div", _hoisted_257, [
                _createElementVNode("label", null, "🌐 " + _toDisplayString(_ctx.t('Language')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("select", {
                  "onUpdate:modelValue": _cache[68] || (_cache[68] = $event => ((_ctx.settingsForm.language) = $event))
                }, [
                  _createElementVNode("option", _hoisted_258, _toDisplayString(_ctx.t('System default (match Nextcloud)')), 1 /* TEXT */),
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.languages, (lg) => {
                    return (_openBlock(), _createElementBlock("option", {
                      key: lg.code,
                      value: lg.code
                    }, _toDisplayString(lg.name), 9 /* TEXT, PROPS */, _hoisted_259))
                  }), 128 /* KEYED_FRAGMENT */))
                ], 512 /* NEED_PATCH */), [
                  [_vModelSelect, _ctx.settingsForm.language]
                ]),
                _createElementVNode("div", _hoisted_260, _toDisplayString(_ctx.t('The display language switches when you press “Save”.')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_261, [
                _createElementVNode("label", null, "🧭 " + _toDisplayString(_ctx.t('Calculation steps panel width')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_262, _toDisplayString(_ctx.t('How wide the calculation-steps panel opens next to a formula.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_263, [
                  _withDirectives(_createElementVNode("input", {
                    type: "range",
                    min: "20",
                    max: "50",
                    step: "1",
                    "onUpdate:modelValue": _cache[69] || (_cache[69] = $event => ((_ctx.settingsForm.stepsWidthPct) = $event)),
                    onInput: _cache[70] || (_cache[70] = (...args) => (_ctx.previewStepsWidth && _ctx.previewStepsWidth(...args))),
                    style: {"flex":"1"}
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.settingsForm.stepsWidthPct,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("span", _hoisted_264, _toDisplayString(_ctx.settingsForm.stepsWidthPct) + "%", 1 /* TEXT */)
                ])
              ]),
              _createElementVNode("div", _hoisted_265, [
                _createElementVNode("label", null, "🕐 " + _toDisplayString(_ctx.t('Formula versions')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_266, _toDisplayString(_ctx.t('The version before each edit is kept beside the formula, numbered #01 (newest) upward; the oldest falls off past the limit below. Nought keeps none.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_267, [
                  _createElementVNode("span", _hoisted_268, _toDisplayString(_ctx.t('Keep up to')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    type: "number",
                    min: "0",
                    max: "99",
                    step: "1",
                    "onUpdate:modelValue": _cache[71] || (_cache[71] = $event => ((_ctx.settingsForm.versionKeep) = $event)),
                    style: {"width":"88px"}
                  }, null, 512 /* NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.settingsForm.versionKeep,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("span", _hoisted_269, _toDisplayString(_ctx.t('versions per formula')), 1 /* TEXT */)
                ]),
                _createElementVNode("div", _hoisted_270, [
                  _createElementVNode("span", _hoisted_271, _toDisplayString(_ctx.t('A version is kept')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("select", {
                    "onUpdate:modelValue": _cache[72] || (_cache[72] = $event => ((_ctx.settingsForm.versionWhen) = $event))
                  }, [
                    _createElementVNode("option", _hoisted_272, _toDisplayString(_ctx.t('only when you ask for one')), 1 /* TEXT */),
                    _createElementVNode("option", _hoisted_273, _toDisplayString(_ctx.t('every time a formula is edited')), 1 /* TEXT */)
                  ], 512 /* NEED_PATCH */), [
                    [_vModelSelect, _ctx.settingsForm.versionWhen]
                  ])
                ])
              ]),
              _createElementVNode("div", _hoisted_274, [
                _createElementVNode("label", null, "📤 " + _toDisplayString(_ctx.t('Formula save destination')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_275, _toDisplayString(_ctx.t('The folder "Save" opens to when exporting a formula.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_276, [
                  _createElementVNode("span", _hoisted_277, "/" + _toDisplayString(_ctx.exportFolder), 1 /* TEXT */),
                  _createElementVNode("button", {
                    type: "button",
                    class: "btn sm",
                    onClick: _cache[73] || (_cache[73] = (...args) => (_ctx.openDefaultFolderPicker && _ctx.openDefaultFolderPicker(...args)))
                  }, _toDisplayString(_ctx.t('Change')), 1 /* TEXT */)
                ])
              ]),
              _createElementVNode("div", _hoisted_278, [
                _createElementVNode("label", null, "📐 " + _toDisplayString(_ctx.t('Template settings')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_279, _toDisplayString(_ctx.t('Choose which formula templates appear in the template list and its search.')), 1 /* TEXT */),
                _createElementVNode("button", {
                  type: "button",
                  class: "btn sm fb-tplset-open",
                  onClick: _cache[74] || (_cache[74] = (...args) => (_ctx.openTplSettings && _ctx.openTplSettings(...args)))
                }, "📐 " + _toDisplayString(_ctx.t('Template settings')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_280, [
                _createElementVNode("label", null, "💾 " + _toDisplayString(_ctx.t('Backup / Restore')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_281, _toDisplayString(_ctx.t('Save all your collections and formulas to a ZIP file, or restore them from one.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_282, [
                  _createElementVNode("button", {
                    type: "button",
                    class: "btn sm",
                    onClick: _cache[75] || (_cache[75] = (...args) => (_ctx.openBackup && _ctx.openBackup(...args)))
                  }, "💾 " + _toDisplayString(_ctx.t('Download all data')), 1 /* TEXT */),
                  _createElementVNode("button", {
                    type: "button",
                    class: "btn sm",
                    onClick: _cache[76] || (_cache[76] = (...args) => (_ctx.openRestore && _ctx.openRestore(...args)))
                  }, "♻ " + _toDisplayString(_ctx.t('Restore from backup')), 1 /* TEXT */)
                ])
              ])
            ]),
            _createElementVNode("div", _hoisted_283, [
              _hoisted_284,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[77] || (_cache[77] = (...args) => (_ctx.cancelSettings && _ctx.cancelSettings(...args)))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[78] || (_cache[78] = (...args) => (_ctx.saveSettings && _ctx.saveSettings(...args)))
              }, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal && _ctx.modal.type==='backup')
      ? (_openBlock(), _createElementBlock("div", _hoisted_285, [
          _createElementVNode("div", _hoisted_286, [
            _createElementVNode("div", _hoisted_287, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('💾 Download all data')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                disabled: _ctx.backupForm.busy,
                onClick: _cache[79] || (_cache[79] = $event => (_ctx.modal=null))
              }, "✕", 8 /* PROPS */, _hoisted_288)
            ]),
            _createElementVNode("form", {
              class: "modal-body",
              onSubmit: _cache[81] || (_cache[81] = _withModifiers((...args) => (_ctx.doBackup && _ctx.doBackup(...args)), ["prevent"]))
            }, [
              _createElementVNode("p", _hoisted_289, _toDisplayString(_ctx.t('Optionally set a password to encrypt the ZIP. Leave it blank for a plain (unencrypted) archive.')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_290, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Password (optional)')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  type: "password",
                  "onUpdate:modelValue": _cache[80] || (_cache[80] = $event => ((_ctx.backupForm.password) = $event)),
                  autocomplete: "new-password",
                  placeholder: _ctx.t('Blank = no encryption')
                }, null, 8 /* PROPS */, _hoisted_291), [
                  [_vModelText, _ctx.backupForm.password]
                ])
              ]),
              (_ctx.backupForm.err)
                ? (_openBlock(), _createElementBlock("div", _hoisted_292, _toDisplayString(_ctx.backupForm.err), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.backupForm.busy)
                ? (_openBlock(), _createElementBlock("div", _hoisted_293, _toDisplayString(_ctx.t('Creating…')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ], 32 /* NEED_HYDRATION */),
            _createElementVNode("div", _hoisted_294, [
              _createElementVNode("button", {
                class: "btn",
                disabled: _ctx.backupForm.busy,
                onClick: _cache[82] || (_cache[82] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Cancel')), 9 /* TEXT, PROPS */, _hoisted_295),
              _createElementVNode("button", {
                class: "btn primary",
                disabled: _ctx.backupForm.busy,
                onClick: _cache[83] || (_cache[83] = (...args) => (_ctx.doBackup && _ctx.doBackup(...args)))
              }, _toDisplayString(_ctx.t('Download')), 9 /* TEXT, PROPS */, _hoisted_296)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal && _ctx.modal.type==='restore')
      ? (_openBlock(), _createElementBlock("div", _hoisted_297, [
          _createElementVNode("div", _hoisted_298, [
            _createElementVNode("div", _hoisted_299, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('♻ Restore from backup')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                disabled: _ctx.restoreForm.busy,
                onClick: _cache[84] || (_cache[84] = $event => (_ctx.modal=null))
              }, "✕", 8 /* PROPS */, _hoisted_300)
            ]),
            _createElementVNode("div", _hoisted_301, [
              _createElementVNode("label", _hoisted_302, [
                _createElementVNode("input", {
                  type: "file",
                  accept: ".zip",
                  onChange: _cache[85] || (_cache[85] = (...args) => (_ctx.onRestoreFile && _ctx.onRestoreFile(...args)))
                }, null, 32 /* NEED_HYDRATION */),
                _createElementVNode("span", _hoisted_303, _toDisplayString(_ctx.t('📄 Choose file')), 1 /* TEXT */),
                _createElementVNode("span", _hoisted_304, _toDisplayString(_ctx.restoreForm.fileName || _ctx.t('Backup file (.zip)')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_305, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Password (only if the backup has one)')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  type: "password",
                  "onUpdate:modelValue": _cache[86] || (_cache[86] = $event => ((_ctx.restoreForm.password) = $event)),
                  autocomplete: "new-password"
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelText, _ctx.restoreForm.password]
                ])
              ]),
              _createElementVNode("div", _hoisted_306, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Restore method')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_307, [
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "overwrite",
                      "onUpdate:modelValue": _cache[87] || (_cache[87] = $event => ((_ctx.restoreForm.mode) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.restoreForm.mode]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Overwrite (delete and replace existing data)')), 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "merge",
                      "onUpdate:modelValue": _cache[88] || (_cache[88] = $event => ((_ctx.restoreForm.mode) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.restoreForm.mode]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Merge (import only non-duplicate formulas)')), 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "add",
                      "onUpdate:modelValue": _cache[89] || (_cache[89] = $event => ((_ctx.restoreForm.mode) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.restoreForm.mode]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Add (as new collections)')), 1 /* TEXT */)
                  ])
                ])
              ]),
              (_ctx.restoreForm.mode==='overwrite')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("p", _hoisted_308, _toDisplayString(_ctx.t('⚠️ Overwriting replaces ALL existing data (collections and formulas).')), 1 /* TEXT */),
                    _createElementVNode("label", _hoisted_309, [
                      _withDirectives(_createElementVNode("input", {
                        type: "checkbox",
                        "onUpdate:modelValue": _cache[90] || (_cache[90] = $event => ((_ctx.restoreForm.confirm) = $event))
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelCheckbox, _ctx.restoreForm.confirm]
                      ]),
                      _createTextVNode(" " + _toDisplayString(_ctx.t('I understand the above and confirm the restore')), 1 /* TEXT */)
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.restoreForm.err)
                ? (_openBlock(), _createElementBlock("div", _hoisted_310, _toDisplayString(_ctx.restoreForm.err), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.restoreForm.busy)
                ? (_openBlock(), _createElementBlock("div", _hoisted_311, _toDisplayString(_ctx.t('Restoring…')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_312, [
              _createElementVNode("button", {
                class: "btn",
                disabled: _ctx.restoreForm.busy,
                onClick: _cache[91] || (_cache[91] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Cancel')), 9 /* TEXT, PROPS */, _hoisted_313),
              _createElementVNode("button", {
                class: _normalizeClass(["btn", _ctx.restoreForm.mode==='overwrite' ? 'danger' : 'primary']),
                disabled: _ctx.restoreForm.busy || !_ctx.restoreForm.dataUrl || (_ctx.restoreForm.mode==='overwrite' && !_ctx.restoreForm.confirm),
                onClick: _cache[92] || (_cache[92] = (...args) => (_ctx.doRestore && _ctx.doRestore(...args)))
              }, _toDisplayString(_ctx.t('Restore')), 11 /* TEXT, CLASS, PROPS */, _hoisted_314)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.exportDialog.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 8,
          class: "modal-mask",
          onClick: _cache[102] || (_cache[102] = _withModifiers($event => (_ctx.exportDialog.open=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_315, [
            _createElementVNode("div", _hoisted_316, [
              _createElementVNode("h3", null, "📤 " + _toDisplayString(_ctx.exportDialog.formula ? _ctx.t(_ctx.exportDialog.formula.name) : ''), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[93] || (_cache[93] = $event => (_ctx.exportDialog.open=false))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_317, [
              _createElementVNode("label", _hoisted_318, [
                _withDirectives(_createElementVNode("input", {
                  type: "checkbox",
                  "onUpdate:modelValue": _cache[94] || (_cache[94] = $event => ((_ctx.exportDialog.includeSteps) = $event))
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelCheckbox, _ctx.exportDialog.includeSteps]
                ]),
                _createTextVNode(" " + _toDisplayString(_ctx.t('Include the calculation steps')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_319, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Save format')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_320, [
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "md",
                      "onUpdate:modelValue": _cache[95] || (_cache[95] = $event => ((_ctx.exportDialog.format) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.exportDialog.format]
                    ]),
                    _createTextVNode(" Markdown (.md)")
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "ods",
                      "onUpdate:modelValue": _cache[96] || (_cache[96] = $event => ((_ctx.exportDialog.format) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.exportDialog.format]
                    ]),
                    _createTextVNode(" ODS — " + _toDisplayString(_ctx.t('calculable spreadsheet')) + " (.ods)", 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "odt",
                      "onUpdate:modelValue": _cache[97] || (_cache[97] = $event => ((_ctx.exportDialog.format) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.exportDialog.format]
                    ]),
                    _createTextVNode(" ODT — " + _toDisplayString(_ctx.t('report')) + " (.odt)", 1 /* TEXT */)
                  ])
                ])
              ])
            ]),
            _createElementVNode("div", _hoisted_321, [
              _createElementVNode("button", {
                type: "button",
                class: "btn",
                onClick: _cache[98] || (_cache[98] = $event => (_ctx.exportDialog.open=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                type: "button",
                class: "btn",
                onClick: _cache[99] || (_cache[99] = $event => (_ctx.doCopyText()))
              }, "📄 " + _toDisplayString(_ctx.t('Copy as text')), 1 /* TEXT */),
              _createElementVNode("button", {
                type: "button",
                class: "btn",
                onClick: _cache[100] || (_cache[100] = $event => (_ctx.doCopyImage()))
              }, "🖼 " + _toDisplayString(_ctx.t('Copy as image')), 1 /* TEXT */),
              _createElementVNode("button", {
                type: "button",
                class: "btn primary",
                onClick: _cache[101] || (_cache[101] = $event => (_ctx.openSaveFolderPicker()))
              }, "💾 " + _toDisplayString(_ctx.t('Save to Nextcloud')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.filePicker.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 9,
          class: "modal-mask cropper-mask",
          onClick: _cache[109] || (_cache[109] = _withModifiers($event => (_ctx.fpCancel()), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_322, [
            _createElementVNode("div", _hoisted_323, [
              _createElementVNode("h3", null, "📂 " + _toDisplayString(_ctx.t('Choose a folder')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[103] || (_cache[103] = $event => (_ctx.fpCancel()))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_324, [
              _createElementVNode("div", _hoisted_325, [
                _createElementVNode("button", {
                  type: "button",
                  class: "btn sm",
                  disabled: _ctx.filePicker.parent===null || _ctx.filePicker.loading,
                  onClick: _cache[104] || (_cache[104] = $event => (_ctx.fpUp()))
                }, _toDisplayString(_ctx.t('⬆ Up')), 9 /* TEXT, PROPS */, _hoisted_326),
                _createElementVNode("span", _hoisted_327, "/" + _toDisplayString(_ctx.filePicker.path), 1 /* TEXT */)
              ]),
              (_ctx.filePicker.loading)
                ? (_openBlock(), _createElementBlock("p", _hoisted_328, _toDisplayString(_ctx.t('Loading…')), 1 /* TEXT */))
                : (_ctx.filePicker.error)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_329, _toDisplayString(_ctx.filePicker.error), 1 /* TEXT */))
                  : (!_ctx.fpVisibleEntries().length)
                    ? (_openBlock(), _createElementBlock("p", _hoisted_330, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                    : (_openBlock(), _createElementBlock("div", _hoisted_331, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.fpVisibleEntries(), (x) => {
                          return (_openBlock(), _createElementBlock("button", {
                            type: "button",
                            key: x.path,
                            class: _normalizeClass(["note-item fp-item", {sel: _ctx.filePicker.selectedFile && _ctx.filePicker.selectedFile.path===x.path}]),
                            onClick: $event => (_ctx.fpClick(x))
                          }, [
                            _createElementVNode("span", _hoisted_333, _toDisplayString(x.is_dir ? '📁' : '📄') + " " + _toDisplayString(x.name), 1 /* TEXT */),
                            _createElementVNode("span", _hoisted_334, _toDisplayString(x.is_dir ? '›' : ''), 1 /* TEXT */)
                          ], 10 /* CLASS, PROPS */, _hoisted_332))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])),
              (_ctx.filePicker.purpose==='export' && _ctx.filePicker.selectedFile)
                ? (_openBlock(), _createElementBlock("p", _hoisted_335, _toDisplayString(_ctx.t('Selected file: {name}', { name: _ctx.filePicker.selectedFile.name })), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_336, [
              _createElementVNode("button", {
                type: "button",
                class: "btn",
                onClick: _cache[105] || (_cache[105] = $event => (_ctx.fpCancel()))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              (_ctx.filePicker.purpose==='export' && _ctx.filePicker.selectedFile)
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("button", {
                      type: "button",
                      class: "btn danger",
                      onClick: _cache[106] || (_cache[106] = $event => (_ctx.fpConfirm('overwrite')))
                    }, _toDisplayString(_ctx.t('Overwrite')), 1 /* TEXT */),
                    _createElementVNode("button", {
                      type: "button",
                      class: "btn",
                      onClick: _cache[107] || (_cache[107] = $event => (_ctx.fpConfirm('append')))
                    }, _toDisplayString(_ctx.t('Append to the end')), 1 /* TEXT */)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              _createElementVNode("button", {
                type: "button",
                class: "btn primary",
                disabled: _ctx.filePicker.loading,
                onClick: _cache[108] || (_cache[108] = $event => (_ctx.fpConfirm('auto')))
              }, _toDisplayString(_ctx.t('Select this folder')), 9 /* TEXT, PROPS */, _hoisted_337)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.toast)
      ? (_openBlock(), _createElementBlock("div", {
          key: 10,
          class: _normalizeClass(["fb-toast", 'fb-toast-'+_ctx.toast.kind]),
          role: "status"
        }, _toDisplayString(_ctx.toast.msg), 3 /* TEXT, CLASS */))
      : _createCommentVNode("v-if", true)
  ]))
}
})();

  createApp({
    render,
    data() {
      return {
        authenticated: true,
        loading: true,
        version: '',
        collections: [],
        currentId: null,
        loadedId: null, loadSeq: 0,
        formulas: [],
        inputs: {},
        activeId: null,
        history: {},
        // reverse calculation: which variable (if any) is solved from a target result
        solveFor: {},
        solveTarget: {},
        solveErr: {},
        // templates are loaded on demand (not shipped in the bundle): a lightweight search
        // index fetched once when the picker opens, and full per-category bodies fetched
        // only when that category's group is expanded.
        tplIndex: [],
        tplIndexLoaded: false,
        tplCache: {},
        tplLoading: {},
        tplSearch: '',
        tplOpen: {},
        // templates the user chose not to see: whole groups, whole subcategories, single names
        tplHidden: { groups: {}, subs: {}, names: {} },
        tplSet: { hid: {}, openG: {}, openS: {}, from: null },
        iconGroups: ICONS,
        iconPickerOpen: false,
        // Full Unicode 14.0 emoji set (1,849 emoji in the 9 Unicode groups) plus the CLDR
        // names/keywords for the active language, fetched on first use and kept for the session.
        emoji: { groups: [], names: {} },
        emojiTab: 'Calculation', emojiQuery: '', emojiLoading: false,
        toast: null,
        copiedKey: null,
        modal: null,
        // Export dialog (one button per card): choose to include the steps, then Copy or Save.
        exportDialog: { open: false, formula: null, includeSteps: true, format: 'md' },
        // Steps/history side panel width, as % of the content area — see clampSideWidthPct()
        // above. Overwritten from the server setting once loadSettings() resolves.
        sideWidthPct: SIDE_WIDTH_PCT_DEFAULT,
        // Folder/file picker, shared by "Save" (purpose:'export') and the Settings default-folder
        // field (purpose:'default'). In 'export' mode a file can be selected as an overwrite/append target.
        filePicker: { open: false, purpose: 'export', formula: null, path: '', parent: null, entries: [], selectedFile: null, loading: false, error: '' },
        collForm: { id: null, name: '', icon: '🧮', color: '#2563eb', description: '' },
        fForm: { id: null, name: '', expression: '', description: '', variables: [], result_unit: '', decimals: 2, notes: '', exprError: '' },
        mdPreview: false,
        // settings (theme mode + UI language), mirrors RegiBase
        locale: 0,
        theme: 'auto',
        language: 'auto',
        languages: [{ code: 'auto', name: 'Nextcloud' }],
        exportFolder: '', // default Files-relative destination for "save formula" exports ('' = root)
        versionKeep: 10, versionWhen: 'manual',
        // versions kept beside a formula (floats above the formula edit modal)
        vers: { open: false, id: null, title: '', list: [] },
        settingsForm: { theme: 'auto', language: 'auto', stepsWidthPct: SIDE_WIDTH_PCT_DEFAULT, versionKeep: 10, versionWhen: 'manual' },
        pad: PAD,
        showFuncs: false,
        funcQuery: '',
        // internal sharing (owner-side panel inside collection settings)
        sharePanel: { shares: [], q: '', results: [], searching: false, recipient: null, recipientName: '', perm: 'view', err: '', busy: false },
        permOpen: false,
        shareExpanded: false,
        // full backup / restore
        backupForm: { password: '', busy: false, err: '' },
        restoreForm: { password: '', busy: false, err: '', fileName: '', dataUrl: '', confirm: false, mode: 'overwrite' },
      };
    },
    computed: {
      funcGroups() {
        const q = (this.funcQuery || '').trim().toLowerCase();
        const groups = [];
        for (const it of FUNC_HELP) {
          if (q && (it.s + ' ' + it.d + ' ' + this.t(it.d)).toLowerCase().indexOf(q) < 0) continue;
          let g = groups.find((x) => x.g === it.g); if (!g) { g = { g: it.g, items: [] }; groups.push(g); }
          g.items.push(it);
        }
        return groups;
      },
      current() { return this.collections.find((c) => c.id === this.currentId) || null; },
      // The curated calculation set stays the first tab, followed by the nine Unicode
      // groups in the official emoji-ordering sequence.
      iconGroupsAll() { return [...this.iconGroups, ...this.emoji.groups]; },
      // Emoji shown in the grid: the active tab, or — while searching — every emoji whose
      // CLDR name or keywords match, in group order (capped so typing stays responsive).
      emojiShown() {
        const q = this.emojiQuery.trim().toLowerCase();
        const groups = this.iconGroupsAll;
        if (!q) {
          const g = groups.find((x) => x.key === this.emojiTab) || groups[0];
          return g ? g.e : [];
        }
        const nq = kana(q);
        const out = [], seen = {}, names = this.emoji.names;
        for (const g of groups) {
          for (const em of g.e) {
            if (seen[em]) continue;
            if (em === q || kana(names[em] || '').includes(nq)) { seen[em] = true; out.push(em); }
            if (out.length >= 400) return out;
          }
        }
        return out;
      },
      // ---- sharing permissions for the current collection ----
      curPerm() { return this.current ? (this.current.perm || 'owner') : 'owner'; },
      isOwner() { return this.current ? this.current.is_owner !== false : true; },
      canEdit() { return ['owner', 'edit', 'delete'].includes(this.curPerm); },
      canDelete() { return ['owner', 'delete'].includes(this.curPerm); },
      // editing collection settings/title needs ownership or the 'delete' level
      canSettings() { return ['owner', 'delete'].includes(this.curPerm); },
      permOptions() {
        return [{ v: 'view', label: this.t('View') }, { v: 'edit', label: this.t('Edit') }, { v: 'delete', label: this.t('Delete') }];
      },
      permLabel() {
        const o = this.permOptions.find((x) => x.v === this.sharePanel.perm);
        return o ? o.label : this.t('View');
      },
      // The visible templates in field order (TAXONOMY), filtered by the search box. Hidden
      // templates are dropped first, so no search, count or list can show them.
      templateTree() {
        const q = (this.tplSearch || '').trim().toLowerCase();
        const match = (tp) => {
          if (!q) return true;
          const hay = [tp.name, T(tp.name), tp.cat, T(tp.cat), tp.group, T(tp.group), tp.expression]
            .concat((tp.variables || []).map((v) => v.label + ' ' + T(v.label || '') + ' ' + v.key));
          return hay.some((s) => (s || '').toString().toLowerCase().includes(q));
        };
        const bySub = {};
        for (const tp of this.tplIndex) {
          if (this.isTplHidden(tp) || !match(tp)) continue;
          (bySub[tp.cat] = bySub[tp.cat] || []).push(tp);
        }
        const out = [];
        for (const G of TAXONOMY) {
          const subs = G.subs.filter((S) => bySub[S.s]).map((S) => ({ cat: S.s, items: bySub[S.s] }));
          if (subs.length) out.push({ g: G.g, i: G.i, subs, n: subs.reduce((k, x) => k + x.items.length, 0) });
        }
        return out;
      },
      templatesByCat() { return this.templateTree.reduce((a, G) => a.concat(G.subs), []); },
      templateMatchCount() {
        const shown = this.tplIndex.filter((tp) => !this.isTplHidden(tp)).length;
        return this.templatesByCat.reduce((n, g) => n + g.items.length, 0) + ' / ' + shown;
      },
      // Tree for the template-settings dialog (all templates, hidden or not).
      tplSetTree() {
        const bySub = {};
        for (const tp of this.tplIndex) (bySub[tp.cat] = bySub[tp.cat] || []).push(tp.name);
        const st = (names) => { const shown = names.filter((n) => !this.tplSet.hid[n]).length; return { shown, state: shown === names.length ? 'all' : shown ? 'some' : 'none' }; };
        return TAXONOMY.map((G) => {
          const subs = G.subs.filter((S) => bySub[S.s]).map((S) => Object.assign({ cat: S.s, names: bySub[S.s] }, st(bySub[S.s])));
          const names = subs.reduce((a, S) => a.concat(S.names), []);
          return Object.assign({ g: G.g, i: G.i, subs, names }, st(names));
        }).filter((G) => G.names.length);
      },
      tplSetShown() { return this.tplIndex.filter((tp) => !this.tplSet.hid[tp.name]).length; },
      activeFormula() { return this.formulas.find((f) => f.id === this.activeId) || this.formulas[0] || null; },
      stepData() { return this.computeSteps(this.activeFormula); },
      stepError() {
        const f = this.activeFormula; if (!f) return '';
        try { parseAST(f.expression); } catch (e) { return e.message || 'invalid'; }
        const r = this.result(f); return r.err ? r.text.replace(/^⚠ /, '') : '';
      },
    },
    methods: {
      t(s, vars) { return this.locale, T(s, vars); },
      notify(msg, kind) {
        const id = (this._toastId = (this._toastId || 0) + 1);
        this.toast = { msg, kind: kind || 'info', id };
        setTimeout(() => { if (this.toast && this.toast.id === id) this.toast = null; }, 2600);
      },
      flashCopy(key) { this.copiedKey = key; setTimeout(() => { if (this.copiedKey === key) this.copiedKey = null; }, 1200); },
      async copyText(text) {
        let ok = false;
        try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
        if (!ok) {
          try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.focus(); ta.select();
            ok = document.execCommand('copy'); document.body.removeChild(ta);
          } catch (e) { ok = false; }
        }
        return ok;
      },
      async copyValue(key, text) {
        const ok = await this.copyText(text);
        this.flashCopy(key);
        this.notify(ok ? T('Copied') : T('Copy failed'), ok ? 'success' : 'error');
      },
      copyResult(f) { const r = this.result(f); if (!r.ok) return; return this.copyValue('res' + f.id, r.text); },
      copyExpr(f) { return this.copyValue('ex' + f.id, f.expression); },
      copyHistory(h, mode) {
        const txt = mode === 'line' ? (h.label + ' = ' + h.result + (h.unit ? ' ' + h.unit : '')) : h.result;
        return this.copyValue('h' + h.id + '-' + (mode || 'value'), txt);
      },
      // The substitution/reduction trace for an arbitrary formula card (not just the active
      // one, since the export/copy buttons now live on every card, not only the side panel).
      computeSteps(f) {
        if (!f) return null;
        const scope = this.scopeFor(f); if (!scope) return null;
        let ast; try { ast = parseAST(f.expression); } catch (e) { return null; }
        // the step-by-step trace is for plain numbers; lists, matrices and complex values show the result only
        if (Object.values(scope).some((v) => typeof v !== 'number') || hasImag(ast)) return null;
        const nodes = [ast];
        let cur = subst(ast, scope);
        nodes.push(cur);
        let last = pr(cur); let guard = 0;
        while (cur.type !== 'num' && guard < 200) { const [nx, ch] = reduceStep(cur); if (!ch) break; cur = nx; const s = pr(cur); if (s !== last) { nodes.push(cur); last = s; } guard++; }
        return { nodes, value: cur.type === 'num' ? cur.v : null };
      },
      // Plain-text lines of the substitution/reduction trace ("expr", "= step1", ..., "= result unit"),
      // shared by the Markdown export, the ODS/ODT "Calculation steps" section, and the copy-as-image render.
      stepsPlainLines(f) {
        const sd = this.computeSteps(f); if (!sd) return [];
        const lines = sd.nodes.map((nd, i) => (i > 0 ? '= ' : '') + pr(nd));
        if (sd.value != null) lines.push('= ' + this.fmt(sd.value, f.decimals) + (f.result_unit ? ' ' + f.result_unit : ''));
        return lines;
      },
      // Markdown rendering of the formula (name/expression/values), optionally with the
      // substitution/reduction trace appended as a fenced code block. The formula is always
      // represented BOTH ways: as text (the `Expression:` line) and, when an image is given,
      // as the rendered-math picture (an inline data-URI image), matching the ODS/ODT output.
      stepsMarkdown(f, includeSteps, image) {
        const lines = ['### ' + f.name, ''];
        if (image) lines.push('![' + f.name.replace(/[[\]]/g, '') + '](' + image + ')', '');
        lines.push('**' + this.t('Expression') + ':** `' + f.expression + '`');
        const ins = this.inputs[f.id] || {};
        const varLines = (f.variables || [])
          .filter((v) => ins[v.key] !== undefined && ins[v.key] !== '' && !this.isSolving(f, v.key))
          .map((v) => '- ' + (v.label || v.key) + ' = ' + ins[v.key] + (v.unit ? ' ' + v.unit : ''));
        if (varLines.length) lines.push('', '**' + this.t('Values') + ':**', ...varLines);
        if (includeSteps) {
          const stepLines = this.stepsPlainLines(f);
          if (stepLines.length) lines.push('', '**' + this.t('Calculation steps') + ':**', '', '```', ...stepLines, '```');
        } else {
          const r = this.result(f);
          if (r.ok) lines.push('', '**' + this.t('Result') + ':** ' + r.text + (f.result_unit ? ' ' + f.result_unit : ''));
        }
        return lines.join('\n');
      },
      // Drag the boundary between the formula list and the side panel. Width (%) is derived
      // fresh from the pointer position each move (not accumulated deltas) so it can't drift,
      // and is only saved once the drag ends — not on every pixel of movement.
      startSideResize(e) {
        const content = e.currentTarget.closest('.fb-content');
        if (!content) return;
        e.preventDefault();
        const rect = content.getBoundingClientRect();
        const move = (ev) => {
          const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
          if (ev.cancelable) ev.preventDefault();
          this.sideWidthPct = Math.round(clampSideWidthPct((rect.right - x) / rect.width * 100));
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          document.removeEventListener('touchmove', move);
          document.removeEventListener('touchend', up);
          this.saveSideWidthPct();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', up);
      },
      // Fire-and-forget persist, mirroring setDefaultExportFolder(): a direct-manipulation
      // preference (drag or the Settings slider) that should stick without an explicit Save.
      async saveSideWidthPct() {
        try { await api('settings', { method: 'PUT', body: JSON.stringify({ steps_width_pct: Math.round(this.sideWidthPct) }) }); } catch (e) { /* best-effort */ }
      },
      // ---- unified export dialog: one button per card opens this, offering Copy / Save ----
      openExportDialog(f) {
        this.exportDialog = { open: true, formula: f, includeSteps: true, format: 'md' };
      },
      currentValues(f) {
        const ins = this.inputs[f.id] || {};
        const values = {};
        (f.variables || []).forEach((v) => {
          if (ins[v.key] === undefined || ins[v.key] === '') return;
          // lists, matrices and complex numbers go as the typed text; the server reads them the same way
          if (vkind(v) !== 'number') values[v.key] = String(ins[v.key]);
          else if (isFinite(Number(ins[v.key]))) values[v.key] = Number(ins[v.key]);
        });
        return values;
      },
      // Copy as text: the same Markdown trace the Save-as-.md format writes, as plain text only —
      // for paste targets where an embedded picture would be unwanted noise (a chat message, a
      // code block, a spreadsheet cell).
      doCopyText() {
        const { formula: f, includeSteps } = this.exportDialog;
        this.exportDialog.open = false;
        this.copyText(this.stepsMarkdown(f, includeSteps))
          .then((ok) => this.notify(ok ? T('Copied') : T('Copy failed'), ok ? 'success' : 'error'));
      },
      // Copy as image: renders the on-screen formula typesetting (+ optional calculation-step
      // trace) to a canvas and writes *only* image/png to the clipboard, so a paste target that
      // reads a single MIME type (chat, an image field, Nextcloud Text) reliably gets the picture
      // instead of a target-chosen fallback to whichever type it preferred out of a mixed write.
      //
      // navigator.clipboard.write() is called synchronously, right here in the click handler (the
      // MIME type gets a *Promise* of its Blob rather than an already-resolved one) so the call
      // itself doesn't lose the click's "user activation" window while the canvas renders. If the
      // write is rejected anyway, this falls back to the plain-text copy so something is always
      // copied, and logs the real rejection reason to the console instead of only a generic toast.
      doCopyImage() {
        const { formula: f, includeSteps } = this.exportDialog;
        this.exportDialog.open = false;
        const fallbackToText = (reason) => {
          if (reason) console.error('[FormulaBase] image copy failed, falling back to plain text:', reason);
          this.copyText(this.stepsMarkdown(f, includeSteps))
            .then((ok) => this.notify(ok ? T('Copied') : T('Copy failed'), ok ? 'success' : 'error'));
        };
        if (!navigator.clipboard || !window.ClipboardItem) { fallbackToText('no Async Clipboard / ClipboardItem support'); return; }
        try {
          const pngPromise = this.buildFormulaCanvas(f, includeSteps).then((canvas) => new Promise((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')));
          navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })])
            .then(() => this.notify(T('Copied'), 'success'))
            .catch(fallbackToText);
        } catch (e) { fallbackToText(e); }
      },
      // Save = opens the folder/file picker; confirming there calls doSaveExport().
      openSaveFolderPicker() {
        const { formula, format } = this.exportDialog;
        this.exportDialog.open = false;
        this.filePicker = {
          open: true, purpose: 'export', formula, format, path: this.exportFolder || '', parent: null,
          entries: [], selectedFile: null, loading: true, error: '',
        };
        this.fpLoad(this.exportFolder || '');
      },
      async fpLoad(path) {
        this.filePicker.loading = true; this.filePicker.error = ''; this.filePicker.selectedFile = null;
        try {
          const r = await api('files/browse?path=' + encodeURIComponent(path));
          this.filePicker.path = r.path || '';
          this.filePicker.parent = (r.parent === undefined ? null : r.parent);
          this.filePicker.entries = Array.isArray(r.entries) ? r.entries : [];
        } catch (e) {
          this.filePicker.error = T('Could not open the folder');
          this.filePicker.entries = [];
        } finally { this.filePicker.loading = false; }
      },
      // In 'export' mode, only folders and files matching the chosen save format can be picked
      // as an overwrite/append target — a Markdown trace can't sensibly land inside an .ods.
      fpVisibleEntries() {
        if (this.filePicker.purpose === 'default') return this.filePicker.entries.filter((x) => x.is_dir);
        const ext = '.' + (this.filePicker.format || 'md');
        return this.filePicker.entries.filter((x) => x.is_dir || x.name.toLowerCase().endsWith(ext));
      },
      fpClick(x) {
        if (x.is_dir) { this.fpLoad(x.path); return; }
        if (this.filePicker.purpose !== 'export') return;
        this.filePicker.selectedFile = (this.filePicker.selectedFile && this.filePicker.selectedFile.path === x.path) ? null : x;
      },
      fpUp() { if (this.filePicker.parent !== null && !this.filePicker.loading) this.fpLoad(this.filePicker.parent); },
      fpCancel() { this.filePicker.open = false; },
      fpConfirm(mode) {
        if (this.filePicker.purpose === 'default') {
          this.filePicker.open = false;
          this.setDefaultExportFolder(this.filePicker.path);
          return;
        }
        const { formula, path, selectedFile } = this.filePicker;
        this.filePicker.open = false;
        const target = (mode !== 'auto' && selectedFile) ? { path: selectedFile.path, mode } : null;
        this.doSaveExport(formula, path, target);
      },
      async doSaveExport(f, folder, target) {
        const { includeSteps, format } = this.exportDialog;
        const steps = includeSteps ? this.stepsPlainLines(f) : [];
        // Every format gets the formula both ways: as text, and (unless rendering fails) as the
        // rendered-math picture — embedded inline for Markdown, embedded as a real image for ODS/ODT.
        // The image's own pixel size varies a lot (a one-term formula vs. Heron's nested fractions),
        // so its width/height go along too — the ODF frame is sized to match, not a fixed box that
        // would squash or crop whatever doesn't happen to fit a 10cm x 3cm rectangle.
        let image = ''; let imageWidth = 0; let imageHeight = 0;
        try {
          const rendered = await this.renderFormulaPng(f, includeSteps);
          image = rendered.dataUrl; imageWidth = rendered.width; imageHeight = rendered.height;
        } catch (e) { image = ''; }
        const content = format === 'md' ? this.stepsMarkdown(f, includeSteps, image) : '';
        const values = this.currentValues(f);
        try {
          const r = await api('formulas/' + f.id + '/export', {
            method: 'POST',
            body: JSON.stringify({ format, folder, filename: f.name, content, values, image, imageWidth, imageHeight, steps, target }),
          });
          this.notify(T('Saved to {name}', { name: r.name }), 'success');
        } catch (e) { this.notify(T('Save failed'), 'error'); }
      },
      // Render the formula into a <canvas> — shared by "copy as image" and the ODS/ODT export
      // (embedded formula image). Uses cLayout() to typeset the same AST the app's own MathML
      // view renders (fraction bars, radicals, raised exponents) with plain Canvas 2D drawing
      // commands (fillText + strokes) only — no <img>, no SVG, no foreignObject. Those were
      // tainting the canvas (Chrome refuses to export pixels derived from foreignObject content,
      // even same-origin: "Tainted canvases may not be exported"), which made every copy/save
      // that needed the image silently fail. Nothing here is loaded from an external source, so
      // the canvas can never be tainted, and the picture matches what's on screen — not a
      // flattened one-line rewrite.
      async buildFormulaCanvas(f, includeSteps) {
        const pad = 16; const scale = 2;
        const titleSize = 18; const exprSize = 26; const stepSize = 17;
        const gap = 14; const arrowGap = 6;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'alphabetic';

        let exprAst = null;
        try { exprAst = parseAST(f.expression); } catch (e) { exprAst = null; }
        const title = f.name;
        const exprBox = exprAst ? cLayout(ctx, exprAst, exprSize) : null;

        // Reuse the same reduction trace the "Calculation steps" panel shows (real AST nodes,
        // not flattened text), each laid out with the same typesetting engine.
        let stepBoxes = [];
        let resultLine = '';
        if (includeSteps) {
          const sd = this.computeSteps(f);
          if (sd) {
            stepBoxes = sd.nodes.map((nd) => cLayout(ctx, nd, stepSize));
            if (sd.value != null) resultLine = '= ' + this.fmt(sd.value, f.decimals) + (f.result_unit ? ' ' + f.result_unit : '');
          }
        }

        // Width follows the content — a fixed width clipped wide expressions/traces (e.g. Heron's
        // formula's nested fractions) off the right edge of the image.
        ctx.font = '700 ' + titleSize + 'px Arial, Helvetica, sans-serif';
        let contentW = ctx.measureText(title).width;
        if (exprBox) contentW = Math.max(contentW, exprBox.w);
        stepBoxes.forEach((b, i) => { contentW = Math.max(contentW, b.w + (i > 0 ? stepSize * 0.9 : 0)); });
        if (resultLine) { ctx.font = '700 ' + stepSize + 'px Arial, Helvetica, sans-serif'; contentW = Math.max(contentW, ctx.measureText(resultLine).width); }
        const width = Math.max(280, Math.ceil(contentW) + pad * 2);

        // ---- measure total height ----
        let height = pad * 2 + titleSize * 1.3;
        if (exprBox) height += gap + exprBox.above + exprBox.below;
        if (stepBoxes.length) {
          height += gap;
          stepBoxes.forEach((b, i) => { height += (i > 0 ? arrowGap : 0) + b.above + b.below; });
          if (resultLine) height += arrowGap + stepSize * 1.3;
        }

        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        ctx.scale(scale, scale);
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#111111';

        let y = pad;
        ctx.font = '700 ' + titleSize + 'px Arial, Helvetica, sans-serif';
        ctx.fillText(title, pad, y + titleSize * 0.9, width - pad * 2);
        y += titleSize * 1.3;

        if (exprBox) {
          y += gap + exprBox.above;
          exprBox.draw(pad, y);
          y += exprBox.below;
        }

        if (stepBoxes.length) {
          y += gap;
          stepBoxes.forEach((b, i) => {
            if (i > 0) { ctx.font = stepSize + 'px Arial, Helvetica, sans-serif'; ctx.fillText('↓', pad, y + arrowGap + b.above); y += arrowGap; }
            y += b.above;
            b.draw(pad + (i > 0 ? stepSize * 0.9 : 0), y);
            y += b.below;
          });
          if (resultLine) {
            y += arrowGap + stepSize * 1.1;
            ctx.font = '700 ' + stepSize + 'px Arial, Helvetica, sans-serif';
            ctx.fillStyle = '#1a7a3c';
            ctx.fillText(resultLine, pad, y);
          }
        }

        return canvas;
      },
      async renderFormulaPng(f, includeSteps) {
        const canvas = await this.buildFormulaCanvas(f, includeSteps);
        return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
      },
      // ---- default export folder (Settings) ----
      openDefaultFolderPicker() {
        this.filePicker = {
          open: true, purpose: 'default', formula: null, path: this.exportFolder || '', parent: null,
          entries: [], selectedFile: null, loading: true, error: '',
        };
        this.fpLoad(this.exportFolder || '');
      },
      async setDefaultExportFolder(path) {
        this.exportFolder = path || '';
        try { await api('settings', { method: 'PUT', body: JSON.stringify({ export_folder: this.exportFolder }) }); } catch (e) { /* best-effort */ }
      },
      te(m) {
        if (!m) return m;
        // Localise engine errors as whole, natural sentences (the old approach translated only
        // the leading token, giving awkward word order in Japanese). Keep any leading ⚠ marker,
        // pull the offending name out of the English message, and drop it into a translated template.
        let pre = '';
        const w = m.match(/^⚠\s*/); if (w) { pre = w[0]; m = m.slice(w[0].length); }
        const pats = [
          [/^unknown variable "(.*)"$/, 'The variable “%s” is not defined'],
          [/^unknown function "(.*)"$/, 'The function “%s” does not exist'],
          [/^expected "(.*)"$/, '“%s” is missing here'],
          [/^unexpected "(.*)"$/, 'Unexpected “%s”'],
        ];
        let out = m;
        for (const p of pats) { const mm = m.match(p[0]); if (mm) { out = T(p[1]).replace('%s', mm[1]); return pre + out; } }
        const plain = { 'unexpected end': 'The expression is incomplete', 'bad number': 'Invalid number format' };
        if (plain[m]) out = T(plain[m]);
        return pre + out;
      },
      fmt(v, d) { return fmtNum(v, d); },
      // Render an expression string as real MathML; fall back to escaped plain text if it can't parse.
      mathml(expr) { try { return mathmlOf(parseAST(String(expr))); } catch (e) { return mlEscape(expr == null ? '' : String(expr)); } },
      isReversible(tp) { return isReversible(tp); },
      // Render an already-parsed AST node (used for the substitution/reduction trace).
      mathmlNode(n) { try { return mathmlOf(n); } catch (e) { return mlEscape(pr(n)); } },
      // Insert a palette token at the caret in the expression input; place the caret inside "()".
      insertToken(it) {
        const el = this.$refs.exprInput;
        const cur = this.fForm.expression || '';
        let s = cur.length, e = cur.length;
        if (el && el.selectionStart != null) { s = el.selectionStart; e = el.selectionEnd; }
        const tok = it.t;
        this.fForm.expression = cur.slice(0, s) + tok + cur.slice(e);
        this.onExpr();
        const caret = s + tok.length - (tok.endsWith('()') ? 1 : 0);
        this.$nextTick(() => { if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (_) { /* */ } } });
      },
      /* ---- settings: theme (appearance mode) + UI language, persisted per user ---- */
      // Ported verbatim from RegiBase (js/regibase.js) — the reference app I was told to match.
      // Handles both #hex and rgb() forms of --color-main-background; the earlier rgb()-only
      // version failed on a hex Light theme and fell back to the OS setting (the "won't go light" bug).
      parseColor(s) {
        if (!s) return null;
        s = s.trim();
        let m = s.match(/^#([0-9a-f]{3})$/i);
        if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]; }
        m = s.match(/^#([0-9a-f]{6})$/i);
        if (m) { const h = m[1]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
        m = s.match(/rgba?\(([^)]+)\)/i);
        if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2]]; }
        return null;
      },
      detectNcDark() {
        try {
          const bg = getComputedStyle(document.body).getPropertyValue('--color-main-background');
          const rgb = this.parseColor(bg);
          if (rgb) { const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255; return lum < 0.5; }
        } catch (e) { /* ignore */ }
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      },
      applyTheme() {
        const dark = this.theme === 'dark' ? true : this.theme === 'light' ? false : this.detectNcDark();
        const el = document.getElementById('formulabase-root');
        if (el) el.setAttribute('data-fbtheme', dark ? 'dark' : 'light');
      },
      previewTheme() { this.theme = this.settingsForm.theme || 'auto'; this.applyTheme(); },
      async applyLanguage(lang) {
        if (!lang || lang === 'auto') { i18nOverride = null; }
        else {
          try { const r = await api('i18n/' + encodeURIComponent(lang)); i18nOverride = (r && r.translations) ? r.translations : {}; }
          catch (e) { i18nOverride = null; }
        }
        this.locale++;
        // emoji names/keywords are language-specific too — drop them so the picker refetches
        this.emoji = { groups: [], names: {} };
      },
      async loadSettings() {
        try {
          const s = await api('settings');
          this.theme = s.theme || 'auto';
          this.language = s.language || 'auto';
          this.languages = s.languages || this.languages;
          this.exportFolder = s.export_folder || '';
          this.sideWidthPct = clampSideWidthPct(s.steps_width_pct);
          this.versionKeep = s.version_keep == null ? 10 : s.version_keep;
          this.versionWhen = s.version_when || 'manual';
          this.setTplHidden(s.tpl_hidden);
          this.applyTheme();
          await this.applyLanguage(this.language);
        } catch (e) { this.applyTheme(); }
      },
      openSettings() {
        this._themeBefore = this.theme;
        this._sideWidthPctBefore = this.sideWidthPct;
        this.settingsForm = { theme: this.theme, language: this.language, stepsWidthPct: this.sideWidthPct, versionKeep: this.versionKeep, versionWhen: this.versionWhen };
        this.modal = 'settings';
      },
      cancelSettings() {
        this.theme = this._themeBefore || 'auto';
        this.sideWidthPct = clampSideWidthPct(this._sideWidthPctBefore);
        this.applyTheme();
        this.modal = null;
      },
      previewStepsWidth() { this.sideWidthPct = clampSideWidthPct(this.settingsForm.stepsWidthPct); },
      async saveSettings() {
        try {
          const s = await api('settings', {
            method: 'PUT',
            body: JSON.stringify({
              theme: this.settingsForm.theme,
              language: this.settingsForm.language,
              steps_width_pct: this.settingsForm.stepsWidthPct,
              version_keep: this.settingsForm.versionKeep,
              version_when: this.settingsForm.versionWhen,
            }),
          });
          this.theme = s.theme || 'auto';
          this.language = s.language || 'auto';
          this.languages = s.languages || this.languages;
          this.sideWidthPct = clampSideWidthPct(s.steps_width_pct);
          this.versionKeep = s.version_keep == null ? 10 : s.version_keep;
          this.versionWhen = s.version_when || 'manual';
          this.applyTheme();
          await this.applyLanguage(this.language);
          this.modal = null;
          this.notify(T('Settings saved'), 'success');
        } catch (e) { this.notify(T('Could not save.'), 'error'); }
      },
      ph(v) { return (v.default !== '' && v.default != null) ? String(v.default) : '0'; },
      scopeFor(f) {
        const scope = {}; const src = this.inputs[f.id] || {};
        for (const v of f.variables) {
          const val = inputValue(v, src[v.key]);
          if (val == null) return null;
          scope[v.key] = val;
        }
        return scope;
      },
      vkind(v) { return vkind(v); },
      kindHint(v) {
        const k = vkind(v);
        return k === 'list' ? T('A list of numbers separated by commas, e.g. 1, 2, 3')
          : k === 'matrix' ? T('Rows separated by semicolons, e.g. 1, 2; 3, 4')
            : T('A complex number, e.g. 3+4i');
      },
      result(f) {
        const scope = this.scopeFor(f);
        if (!scope) return { ok: false, err: false, text: '—' };
        try {
          const val = evalTop(parseAST(f.expression), scope);
          if (!valueOk(val)) return { ok: false, err: true, text: (val === Infinity || val === -Infinity) ? '∞' : '—' };
          return { ok: true, err: false, text: fmtAny(val, f.decimals, fmtNum), value: val };
        } catch (e) { return { ok: false, err: true, text: '⚠ ' + (e.budget ? T('The calculation is too large to finish.') : (e.message || 'error')) }; }
      },
      /* reverse calculation: pick a variable, enter the target result, solve for it numerically */
      isSolving(f, key) { return this.solveFor[f.id] === key; },
      setVar(f, key, val) {
        const inputs = this.inputs[f.id] || (this.inputs[f.id] = {});
        inputs[key] = val;
        if (this.solveFor[f.id] && this.solveFor[f.id] !== key) this.applySolve(f);
      },
      setTarget(f, val) { this.solveTarget[f.id] = val; this.applySolve(f); },
      toggleSolve(f, key) {
        if (this.solveFor[f.id] === key) { this.solveFor[f.id] = null; this.solveErr[f.id] = false; return; }
        this.solveFor[f.id] = key;
        this.solveErr[f.id] = false;
        if (!this.solveTarget[f.id]) {
          const r = this.result(f);
          this.solveTarget[f.id] = r.ok ? String(r.value) : '';
        }
        this.applySolve(f);
      },
      applySolve(f) {
        const key = this.solveFor[f.id];
        if (!key) return;
        const inputs = this.inputs[f.id] || (this.inputs[f.id] = {});
        const raw = this.solveTarget[f.id];
        const target = Number(raw);
        this.solveErr[f.id] = false;
        if (raw === '' || raw == null || isNaN(target)) { inputs[key] = ''; return; }
        const scope = {};
        for (const v of f.variables) {
          if (v.key === key) continue;
          const val = inputValue(v, inputs[v.key]);
          if (val == null) { inputs[key] = ''; return; }
          scope[v.key] = val;
        }
        let x = null;
        try { x = solveVar(f.expression, scope, key, target); } catch (e) { x = null; }
        if (x == null || !isFinite(x)) { inputs[key] = ''; this.solveErr[f.id] = true; return; }
        inputs[key] = String(x);
      },
      async loadCollections() {
        try {
          this.collections = await api('collections');
          if (this.collections.length && this.currentId == null) await this.selectCollection(this.collections[0].id);
        } catch (e) { /* ignore */ }
        this.loading = false;
      },
      async selectCollection(id) { this.currentId = id; await this.loadFormulas(); },
      async loadFormulas() {
        if (this.currentId == null) { this.formulas = []; this.loadedId = null; return; }
        // A newer request (or a switch to another collection) wins: an answer that
        // arrives late is thrown away, or the heading showed one collection and the
        // cards another (REVIEW C9).
        const want = this.currentId;
        const seq = (this.loadSeq = (this.loadSeq || 0) + 1);
        const list = await api('collections/' + want + '/formulas');
        if (seq !== this.loadSeq || want !== this.currentId) return;
        // The same collection read again -- after one formula was saved, added,
        // deleted or put back -- keeps what was typed into the others. Everything
        // used to go back to the defaults, and the numbers typed were gone for good
        // (REVIEW C8). Only a switch to another collection starts afresh.
        const same = this.loadedId === want;
        const old = same ? (this.inputs || {}) : {};
        this.formulas = list;
        const inputs = {};
        for (const f of this.formulas) {
          inputs[f.id] = {};
          const had = old[f.id];
          for (const v of (f.variables || [])) {
            inputs[f.id][v.key] = (had && Object.prototype.hasOwnProperty.call(had, v.key))
              ? had[v.key]
              : ((v.default !== '' && v.default != null) ? v.default : '');
          }
        }
        this.inputs = inputs;
        const alive = new Set(this.formulas.map((f) => String(f.id)));
        const keep = (m) => { const out = {}; if (same) { for (const k of Object.keys(m || {})) if (alive.has(String(k))) out[k] = m[k]; } return out; };
        this.history = keep(this.history);
        this.solveFor = keep(this.solveFor);
        this.solveTarget = keep(this.solveTarget);
        this.solveErr = keep(this.solveErr);
        if (!same || !this.formulas.some((f) => f.id === this.activeId)) {
          this.activeId = this.formulas.length ? this.formulas[0].id : null;
        }
        this.loadedId = want;
        if (this.activeId != null) this.loadHistory(this.activeId);
      },
      /* history (persisted server-side, per user, per formula) */
      fmtTime(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(); },
      async loadHistory(fid) {
        if (fid == null) return;
        try { this.history[fid] = await api('formulas/' + fid + '/history'); } catch (e) { this.history[fid] = []; }
      },
      async record(f) {
        const r = this.result(f); if (!r.ok) return;
        const src = this.inputs[f.id] || {};
        const snap = {}; const parts = [];
        for (const v of f.variables) { const val = (src[v.key] === '' || src[v.key] == null) ? v.default : src[v.key]; snap[v.key] = val; parts.push((v.label || v.key) + '=' + val + (v.unit ? v.unit : '')); }
        const body = JSON.stringify({ inputs: snap, label: parts.join(', '), result: r.text, unit: f.result_unit || '' });
        try {
          const entry = await api('formulas/' + f.id + '/history', { method: 'POST', body });
          const list = this.history[f.id] || (this.history[f.id] = []);
          list.unshift(entry);
          if (list.length > 50) list.length = 50;
          this.notify(T('Recorded'), 'success');
        } catch (e) { this.notify(T('Could not record the calculation.'), 'error'); }
      },
      restore(f, h) { const dst = this.inputs[f.id] || (this.inputs[f.id] = {}); for (const k in h.inputs) dst[k] = h.inputs[k]; this.activeId = f.id; },
      async deleteHistory(f, i) {
        const list = this.history[f.id] || []; const entry = list[i]; if (!entry) return;
        try { await api('history/' + entry.id, { method: 'DELETE' }); list.splice(i, 1); } catch (e) { this.notify(T('Could not delete.'), 'error'); }
      },
      async clearHistory(f) {
        try { await api('formulas/' + f.id + '/history', { method: 'DELETE' }); this.history[f.id] = []; } catch (e) { this.notify(T('Could not clear history.'), 'error'); }
      },
      /* icon (emoji) picker — the Unicode set is ~150 KB, so it is loaded on first use only */
      async loadEmoji() {
        if (this.emoji.groups.length || this.emojiLoading) return;
        this.emojiLoading = true;
        try {
          const r = await api('emoji/' + encodeURIComponent(this.language || 'auto'));
          this.emoji = { groups: r.groups || [], names: r.names || {} };
        } catch (e) { /* the calculation tab still works without it */ }
        this.emojiLoading = false;
      },
      openIconPicker() {
        this.iconPickerOpen = !this.iconPickerOpen;
        if (!this.iconPickerOpen) return;
        this.emojiQuery = '';
        this.loadEmoji();
      },
      // CLDR short name for the tooltip; the stored value is "name|keyword keyword".
      emojiName(em) {
        const n = this.emoji.names[em];
        return n ? n.split('|')[0] : em;
      },
      /* collections */
      openCollectionModal(c) {
        this.collForm = c ? { id: c.id, name: c.name, icon: c.icon, color: c.color, description: c.description || '' } : { id: null, name: '', icon: '🧮', color: '#2563eb', description: '' };
        this.iconPickerOpen = false;
        this.sharePanel = { shares: [], q: '', results: [], searching: false, recipient: null, recipientName: '', perm: 'view', err: '', busy: false };
        this.permOpen = false;
        this.shareExpanded = false;
        this.modal = 'collection';
        if (c && this.isOwner) this.loadShares();
      },
      exportCollectionOds() {
        if (!this.collForm.id) return;
        window.location.href = BASE + 'api/collections/' + this.collForm.id + '/export?format=ods';
      },
      // ---- internal sharing (owner side) ----
      shareBadge(c) { if (!c) return ''; if (c.shared_by_me) return '🔗'; if (c.shared_with_me) return '👥'; return ''; },
      shareBadgeTitle(c) { if (!c) return ''; if (c.shared_by_me) return T('Shared by you'); if (c.shared_with_me) return T('Shared with you'); return ''; },
      async loadShares() {
        if (!this.collForm.id) return;
        try { const r = await api('collections/' + this.collForm.id + '/shares'); this.sharePanel.shares = r.shares || []; }
        catch (e) { /* not owner or none */ }
      },
      async searchShareUsers() {
        const q = this.sharePanel.q.trim();
        if (!q) { this.sharePanel.results = []; return; }
        this.sharePanel.searching = true;
        try {
          const r = await api('users/search?q=' + encodeURIComponent(q));
          const already = new Set(this.sharePanel.shares.map((s) => s.recipient_uid));
          this.sharePanel.results = (r.users || []).filter((u) => !already.has(u.uid));
        } catch (e) { this.sharePanel.results = []; }
        finally { this.sharePanel.searching = false; }
      },
      pickShareUser(u) { this.sharePanel.recipient = u.uid; this.sharePanel.recipientName = u.name; this.sharePanel.results = []; this.sharePanel.q = ''; },
      clearShareRecipient() { this.sharePanel.recipient = null; this.sharePanel.recipientName = ''; },
      async addShare() {
        const sp = this.sharePanel;
        sp.err = '';
        if (!sp.recipient || !this.collForm.id) return;
        sp.busy = true;
        try {
          const body = { recipient: sp.recipient, perm: sp.perm };
          const s = await api('collections/' + this.collForm.id + '/shares', { method: 'POST', body: JSON.stringify(body) });
          this.sharePanel.shares.push(s);
          this.clearShareRecipient();
          sp.perm = 'view';
          await this.loadCollections();
          this.notify(T('Shared'), 'success');
        } catch (e) { sp.err = e.message || String(e); }
        finally { sp.busy = false; }
      },
      async changeSharePerm(s, perm) {
        try { const r = await api('collections/' + this.collForm.id + '/shares/' + encodeURIComponent(s.recipient_uid), { method: 'PATCH', body: JSON.stringify({ perm }) }); s.perm = r.perm; }
        catch (e) { this.notify(e.message || String(e), 'error'); }
      },
      async removeShare(s) {
        if (!confirm(T('Stop sharing with {name}?', { name: s.recipient_name || s.recipient_uid }))) return;
        try {
          await api('collections/' + this.collForm.id + '/shares/' + encodeURIComponent(s.recipient_uid), { method: 'DELETE' });
          this.sharePanel.shares = this.sharePanel.shares.filter((x) => x.recipient_uid !== s.recipient_uid);
          await this.loadCollections();
        } catch (e) { this.notify(e.message || String(e), 'error'); }
      },
      // ---- full backup / restore ----
      openBackup() { this.backupForm = { password: '', busy: false, err: '' }; this.modal = { type: 'backup' }; },
      openRestore() { this.restoreForm = { password: '', busy: false, err: '', fileName: '', dataUrl: '', confirm: false, mode: 'overwrite' }; this.modal = { type: 'restore' }; },
      async doBackup() {
        this.backupForm.busy = true; this.backupForm.err = '';
        try {
          const res = await fetch(BASE + 'api/backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'requesttoken': freshToken() },
            credentials: 'same-origin',
            body: JSON.stringify({ password: this.backupForm.password || '' }),
          });
          if (!res.ok) { let m = ''; try { m = (await res.json()).error; } catch (e) { /* ignore */ } throw new Error(m || res.statusText); }
          const blob = await res.blob();
          const uid = (window.OC && OC.getCurrentUser && OC.getCurrentUser()) ? OC.getCurrentUser().uid : 'user';
          const d = new Date();
          const ymd = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
          const fname = 'FormulaBase-' + uid + '_' + ymd + '_backup.zip';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = fname;
          document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          this.modal = null; this.notify(T('Backup downloaded'), 'success');
        } catch (e) { this.backupForm.err = e.message || String(e); }
        finally { this.backupForm.busy = false; }
      },
      onRestoreFile(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        // The file chosen before is let go of at once: until the new one is read,
        // there is nothing to send. Pressing Restore in that moment sent the file
        // chosen before -- an older backup over everything, in overwrite mode
        // (REVIEW C11). A read that finishes after yet another file was chosen is
        // thrown away.
        this.restoreForm.fileName = f.name;
        this.restoreForm.dataUrl = '';
        const token = (this.restoreToken = (this.restoreToken || 0) + 1);
        const r = new FileReader();
        r.onload = () => { if (token === this.restoreToken) this.restoreForm.dataUrl = String(r.result || ''); };
        r.readAsDataURL(f);
      },
      async doRestore() {
        if (!this.restoreForm.dataUrl) { this.restoreForm.err = T('Please choose a file'); return; }
        if (this.restoreForm.mode === 'overwrite' && !this.restoreForm.confirm) { this.restoreForm.err = T('Please check the confirmation box'); return; }
        this.restoreForm.busy = true; this.restoreForm.err = '';
        try {
          const res = await api('restore', { method: 'POST', body: JSON.stringify({ password: this.restoreForm.password || '', dataUrl: this.restoreForm.dataUrl, mode: this.restoreForm.mode }) });
          this.modal = null;
          this.notify(T('Restored') + '（' + T('Imported {n} formulas', { n: res.formulas }) + '）', 'success');
          this.currentId = null; this.formulas = [];
          await this.loadCollections();
        } catch (e) { this.restoreForm.err = e.message || String(e); }
        finally { this.restoreForm.busy = false; }
      },
      async saveCollection() {
        const name = (this.collForm.name || '').trim(); if (!name) return;
        const body = JSON.stringify({ name, icon: this.collForm.icon || '🧮', color: this.collForm.color, description: this.collForm.description || '' });
        try {
          if (this.collForm.id) {
            const upd = await api('collections/' + this.collForm.id, { method: 'PATCH', body });
            const i = this.collections.findIndex((c) => c.id === upd.id); if (i >= 0) this.collections[i] = upd;
          } else {
            const created = await api('collections', { method: 'POST', body });
            this.collections.push(created); await this.selectCollection(created.id);
          }
          this.modal = null;
        } catch (e) { this.notify(T('Could not save.'), 'error'); }
      },
      async removeCollection() {
        if (!this.collForm.id) return;
        if (!window.confirm(T('Delete this collection and all its formulas?'))) return;
        try {
          await api('collections/' + this.collForm.id, { method: 'DELETE' });
          this.collections = this.collections.filter((c) => c.id !== this.collForm.id);
          if (this.currentId === this.collForm.id) { this.currentId = null; this.formulas = []; if (this.collections.length) await this.selectCollection(this.collections[0].id); }
          this.modal = null;
        } catch (e) { this.notify(T('Could not delete.'), 'error'); }
      },
      /* formulas */
      md(s) { return mdRender(s); },
      openFormulaModal(f) {
        // Edit what's actually on screen, not the raw stored string: older formulas (and
        // anything added from a template before it was localized at add-time) may still hold
        // the English canonical text used as the t() lookup key. Prefilling with t(...) means
        // the edit form always matches the displayed card, and saving without further changes
        // quietly upgrades that one record to real text in the current language.
        //
        // But what is SAVED is what was there, unless the writer changed it. Common
        // English words (Distance, Speed, Time, Notes) are translation keys too, so a
        // formula the writer named in English was saved back in Japanese after only
        // the decimals were changed -- and a shared collection's owner lost their
        // wording without seeing it (REVIEW C10). Each field remembers what it held
        // and what was shown; saveFormula writes the stored text back when the shown
        // text was left alone.
        const shown = (raw) => (raw ? this.t(raw) : raw);
        this.fForm = f
          ? {
            id: f.id, name: shown(f.name), expression: f.expression, description: f.description ? shown(f.description) : '',
            variables: JSON.parse(JSON.stringify(f.variables || [])).map((v) => Object.assign(v, { label: v.label ? shown(v.label) : v.label, _rawLabel: v.label, _shownLabel: v.label ? shown(v.label) : v.label, type: v.type || (vkind(v) === 'number' ? '' : vkind(v)) })),
            result_unit: f.result_unit, decimals: f.decimals, notes: f.notes ? shown(f.notes) : '', exprError: '',
            _raw: { name: f.name, description: f.description || '', notes: f.notes || '' },
            _shown: { name: shown(f.name), description: f.description ? shown(f.description) : '', notes: f.notes ? shown(f.notes) : '' },
          }
          : { id: null, name: '', expression: '', description: '', variables: [], result_unit: '', decimals: 2, notes: '', exprError: '' };
        this.mdPreview = false;
        this.onExpr(); this.modal = 'formula';
      },
      onExpr() {
        const expr = (this.fForm.expression || '').trim();
        if (!expr) { this.fForm.exprError = ''; return; }
        const scope = {};
        for (const v of this.fForm.variables) if (v.key) { const val = v.type ? inputValue(v, v.default) : 1; scope[v.key] = val == null ? (v.type === 'list' ? [1, 2] : v.type === 'matrix' ? [[1, 0], [0, 1]] : 1) : val; }
        for (const k of extractVars(expr)) if (!(k in scope)) scope[k] = 1;
        try { evalTop(parseAST(expr), scope); this.fForm.exprError = ''; } catch (e) { this.fForm.exprError = e.budget ? T('The calculation is too large to finish.') : (e.message || 'invalid'); }
      },
      detectVars() {
        const have = {}; for (const v of this.fForm.variables) if (v.key) have[v.key] = 1;
        for (const k of extractVars(this.fForm.expression)) if (!have[k]) { this.fForm.variables.push({ key: k, label: '', unit: '', default: '', type: '' }); have[k] = 1; }
        this.onExpr();
      },
      async saveFormula() {
        const name = (this.fForm.name || '').trim();
        if (!name) { this.fForm.exprError = T('Name is required'); return; }
        this.onExpr(); if (this.fForm.exprError) return;
        // A field left as it was shown goes back as it was stored (REVIEW C10).
        const R = this.fForm._raw || null; const S = this.fForm._shown || {};
        const back = (field, now) => (R && (now || '') === (S[field] || '') ? R[field] : now);
        const vars = this.fForm.variables.filter((v) => (v.key || '').trim()).map((v) => Object.assign({ key: v.key.trim(), label: (v._shownLabel !== undefined && (v.label || '') === (v._shownLabel || '')) ? (v._rawLabel || '') : (v.label || ''), unit: v.unit || '', default: v.default === '' ? '' : v.default }, v.type ? { type: v.type } : {}));
        const body = JSON.stringify({ name: back('name', name) || name, expression: this.fForm.expression || '', description: back('description', this.fForm.description || '') || '', variables: vars, result_unit: this.fForm.result_unit || '', decimals: this.fForm.decimals == null ? 2 : this.fForm.decimals, notes: back('notes', this.fForm.notes || '') || '' });
        try {
          if (this.fForm.id) await api('formulas/' + this.fForm.id, { method: 'PUT', body });
          else await api('collections/' + this.currentId + '/formulas', { method: 'POST', body });
          this.modal = null; await this.loadFormulas();
        } catch (e) { this.notify(T('Could not save.'), 'error'); }
      },
      // ---- per-formula version history ----
      async openVersions(id) {
        if (!id) return;
        const f = this.formulas.find((x) => x.id === id);
        this.vers = { open: true, id, title: (f && this.t(f.name)) || '', list: [] };
        await this.reloadVersions();
      },
      async reloadVersions() {
        try {
          const r = await api('formulas/' + this.vers.id + '/versions');
          this.vers.list = r.versions || [];
        } catch (e) { this.notify(T('Could not read the versions.'), 'error'); }
      },
      async restoreVersion(number) {
        if (!window.confirm(T('Put version #{n} back? What is in the formula now is kept as a version of its own.', { n: String(number).padStart(2, '0') }))) return;
        try {
          const back = await api('formulas/' + this.vers.id + '/versions/restore', { method: 'POST', body: JSON.stringify({ number }) });
          await this.reloadVersions();
          await this.loadFormulas();
          if (this.fForm.id === this.vers.id && back) this.openFormulaModal(back);
          this.notify(T('Version #{n} restored', { n: String(number).padStart(2, '0') }), 'success');
        } catch (e) { this.notify(T('Could not restore.'), 'error'); }
      },
      fmtVerTime(s) {
        try { const d = new Date(s); if (isNaN(d)) return s; return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
        catch (e) { return s; }
      },
      async removeFormula(f) {
        if (!window.confirm(T('Delete this formula?'))) return;
        try { await api('formulas/' + f.id, { method: 'DELETE' }); await this.loadFormulas(); }
        catch (e) { this.notify(T('Could not delete.'), 'error'); }
      },
      /* templates: the search index loads once when the picker opens; a category's full
         body (description/notes/variables) loads only the first time it's expanded. */
      async openTemplates() {
        this.tplSearch = ''; this.tplOpen = {}; this.modal = 'templates';
        await this.loadTplIndex();
      },
      async loadTplIndex() {
        if (this.tplIndexLoaded) return;
        try { this.tplIndex = await api('templates/index'); this.tplIndexLoaded = true; }
        catch (e) { this.notify(T('Could not load templates.'), 'error'); }
      },
      isTplHidden(tp) {
        const h = this.tplHidden;
        return !!(h.names[tp.name] || h.subs[tp.cat] || h.groups[tp.group]);
      },
      setTplHidden(v) {
        const o = (a) => { const m = {}; (Array.isArray(a) ? a : []).forEach((x) => { m[String(x)] = true; }); return m; };
        v = v || {};
        this.tplHidden = { groups: o(v.groups), subs: o(v.subs), names: o(v.names) };
      },
      /* Template settings: works on a draft of hidden names; Save stores it compactly
         (a whole group or subcategory as one entry). The dialog closes only by ✕, Cancel or Save. */
      async openTplSettings() {
        this.tplSet = { hid: {}, openG: {}, openS: {}, from: this.modal };
        this.modal = 'tplsettings';
        await this.loadTplIndex();
        const hid = {};
        for (const tp of this.tplIndex) if (this.isTplHidden(tp)) hid[tp.name] = true;
        this.tplSet.hid = hid;
      },
      closeTplSettings() { this.modal = this.tplSet.from === 'settings' ? 'settings' : null; },
      tplSetFold(kind, key) {
        const k = kind === 'g' ? 'openG' : 'openS';
        this.tplSet[k] = Object.assign({}, this.tplSet[k], { [key]: !this.tplSet[k][key] });
      },
      tplSetToggle(names, show) {
        const hid = Object.assign({}, this.tplSet.hid);
        names.forEach((n) => { if (show) delete hid[n]; else hid[n] = true; });
        this.tplSet.hid = hid;
      },
      tplSetShowAll() { this.tplSet.hid = {}; },
      async saveTplSettings() {
        const out = { groups: [], subs: [], names: [] };
        for (const G of this.tplSetTree) {
          if (G.state === 'none') { out.groups.push(G.g); continue; }
          for (const S of G.subs) {
            if (S.state === 'none') out.subs.push(S.cat);
            else if (S.state === 'some') S.names.forEach((n) => { if (this.tplSet.hid[n]) out.names.push(n); });
          }
        }
        try {
          const s = await api('settings', { method: 'PUT', body: JSON.stringify({ tpl_hidden: out }) });
          this.setTplHidden(s.tpl_hidden);
          this.notify(T('Settings saved'), 'success');
          this.closeTplSettings();
        } catch (e) { this.notify(T('Could not save.'), 'error'); }
      },
      async ensureCatLoaded(cat) {
        if (this.tplCache[cat] || this.tplLoading[cat]) return;
        this.tplLoading = Object.assign({}, this.tplLoading, { [cat]: true });
        try {
          const items = await api('templates/cat/' + encodeURIComponent(cat));
          this.tplCache = Object.assign({}, this.tplCache, { [cat]: items });
        } catch (e) { this.notify(T('Could not load templates.'), 'error'); }
        finally { this.tplLoading = Object.assign({}, this.tplLoading, { [cat]: false }); }
      },
      toggleGroup(cat) {
        const opening = !this.tplOpen[cat];
        this.tplOpen = Object.assign({}, this.tplOpen, { [cat]: opening });
        if (opening) this.ensureCatLoaded(cat);
      },
      // tplCache holds every template in the category regardless of search; restrict what's
      // actually rendered to the names that matched in templatesByCat (the search index pass).
      catItems(g) {
        const cached = this.tplCache[g.cat] || [];
        const names = new Set(g.items.map((it) => it.name));
        return cached.filter((tp) => names.has(tp.name));
      },
      isGroupOpen(cat) { if ((this.tplSearch || '').trim()) return true; return !!this.tplOpen[cat]; },
      catIcon(cat) {
        for (const G of TAXONOMY) for (const S of G.subs) if (S.s === cat) return S.i;
        return CAT_ICONS[cat] || '🧮';
      },
      async addTemplate(tp) {
        try {
          if (this.currentId == null) {
            const created = await api('collections', { method: 'POST', body: JSON.stringify({ name: T('My formulas'), icon: '🧮', color: '#2563eb' }) });
            this.collections.push(created); this.currentId = created.id;
          }
          // Templates are stored/matched by their English canonical string (used as the t()
          // lookup key), so the browse list and card can show it translated. But once added,
          // this becomes the user's OWN formula: bake in the current UI language's text now,
          // so it edits and reads the same as anything they typed themselves — not an English
          // key that only *looks* translated because it happens to pass through t() on display.
          const body = JSON.stringify({
            name: this.t(tp.name),
            expression: tp.expression,
            description: tp.description ? this.t(tp.description) : '',
            variables: (tp.variables || []).map((v) => Object.assign({}, v, { label: v.label ? this.t(v.label) : v.label })),
            result_unit: tp.result_unit || '',
            decimals: tp.decimals == null ? 2 : tp.decimals,
            notes: tp.notes ? this.t(tp.notes) : '',
          });
          await api('collections/' + this.currentId + '/formulas', { method: 'POST', body });
          await this.loadFormulas();
          this.notify(T('Added'), 'success');
        } catch (e) { this.notify(T('Could not save.'), 'error'); }
      },
    },
    watch: {
      activeId(id) { if (id != null && !this.history[id]) this.loadHistory(id); },
      // search force-opens every matching group; make sure their bodies are actually loaded
      tplSearch() {
        if (!(this.tplSearch || '').trim()) return;
        for (const g of this.templatesByCat) this.ensureCatLoaded(g.cat);
      },
    },
    mounted() {
      rootProxy = this;
      try { const el = document.getElementById('formulabase-root'); if (el) this.version = el.getAttribute('data-version') || ''; } catch (e) { /* */ }
      this.loadSettings();
      this.loadCollections();
      // Re-evaluate the auto theme when the OS/Nextcloud scheme changes.
      try {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => { if (this.theme === 'auto') this.applyTheme(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
      } catch (e) { /* */ }
    },
  }).mount('#formulabase-root');

  function fmtNum(v, dec) {
    dec = (dec == null ? 2 : dec);
    v = Number(v);
    if (!isFinite(v)) return String(v);
    const fixed = v.toFixed(dec);
    // If a non-zero value collapses to 0 at the chosen precision, show significant
    // figures instead of a misleading "0.00" (keeps normal-range display untouched).
    if (v !== 0 && parseFloat(fixed) === 0) {
      const a = Math.abs(v);
      if (a < 1e-4) return v.toExponential(3);            // e.g. 6.213e-21
      let d = 3 - Math.floor(Math.log10(a));              // ~4 significant figures
      d = Math.max(dec, Math.min(12, d));
      return v.toFixed(d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    }
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
})();
