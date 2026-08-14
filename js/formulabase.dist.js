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
  const FUN = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round,
    floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, sign: Math.sign,
    exp: Math.exp, ln: Math.log, log: (x) => Math.log10(x), log2: Math.log2,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    min: Math.min, max: Math.max, pow: Math.pow, mod: (a, b) => a % b, hypot: Math.hypot,
    root: (x, n) => Math.sign(x) * Math.pow(Math.abs(x), 1 / n),
  };
  const CONST = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };

  function tokenize(s) {
    const toks = []; let i = 0; const n = s.length;
    while (i < n) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if ((c >= '0' && c <= '9') || c === '.') {
        let j = i + 1;
        while (j < n && /[0-9.]/.test(s[j])) j++;
        if (j < n && (s[j] === 'e' || s[j] === 'E')) { j++; if (j < n && (s[j] === '+' || s[j] === '-')) j++; while (j < n && /[0-9]/.test(s[j])) j++; }
        const v = parseFloat(s.slice(i, j));
        if (isNaN(v)) throw new Error('bad number');
        toks.push({ t: 'num', v }); i = j; continue;
      }
      if (/[\p{L}_]/u.test(c)) {
        let j = i + 1;
        while (j < n && /[\p{L}\p{N}_]/u.test(s[j])) j++;
        toks.push({ t: 'id', v: s.slice(i, j) }); i = j; continue;
      }
      if ('+-*/%^(),'.indexOf(c) >= 0) { toks.push({ t: 'op', v: c }); i++; continue; }
      throw new Error('unexpected "' + c + '"');
    }
    return toks;
  }

  function parseAST(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const expect = (v) => { const t = next(); if (!t || t.v !== v) throw new Error('expected "' + v + '"'); };
    function pExpr() { return pAdd(); }
    function pAdd() { let l = pMul(); while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const op = next().v; l = { type: 'bin', op, l, r: pMul() }; } return l; }
    function pMul() { let l = pUnary(); while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) { const op = next().v; l = { type: 'bin', op, l, r: pUnary() }; } return l; }
    // Standard math precedence: '^' binds tighter than unary minus, so -x^2 = -(x^2), and
    // '^' is right-associative with a unary right operand so 2^-3 and 2^3^2 parse correctly.
    function pUnary() { const t = peek(); if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) { next(); return { type: 'unary', op: t.v, arg: pUnary() }; } return pPow(); }
    function pPow() { const l = pPrimary(); if (peek() && peek().t === 'op' && peek().v === '^') { next(); return { type: 'bin', op: '^', l, r: pUnary() }; } return l; }
    function pPrimary() {
      const t = next();
      if (!t) throw new Error('unexpected end');
      if (t.t === 'num') return { type: 'num', v: t.v };
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

  function applyBin(op, a, b) { return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : op === '%' ? a % b : Math.pow(a, b); }

  function evalAST(n, scope) {
    switch (n.type) {
      case 'num': return n.v;
      case 'const': return CONST[n.name.toLowerCase()];
      case 'var':
        if (scope && Object.prototype.hasOwnProperty.call(scope, n.name)) return Number(scope[n.name]);
        throw new Error('unknown variable "' + n.name + '"');
      case 'unary': { const a = evalAST(n.arg, scope); return n.op === '-' ? -a : a; }
      case 'bin': return applyBin(n.op, evalAST(n.l, scope), evalAST(n.r, scope));
      case 'call': return FUN[n.name.toLowerCase()].apply(null, n.args.map((a) => evalAST(a, scope)));
    }
    throw new Error('bad node');
  }

  function collectVars(n, out, seen) {
    if (n.type === 'var') { if (!seen[n.name]) { seen[n.name] = 1; out.push(n.name); } }
    else if (n.type === 'unary') collectVars(n.arg, out, seen);
    else if (n.type === 'bin') { collectVars(n.l, out, seen); collectVars(n.r, out, seen); }
    else if (n.type === 'call') n.args.forEach((a) => collectVars(a, out, seen));
    return out;
  }
  function extractVars(expr) { try { return collectVars(parseAST(expr), [], {}); } catch (e) { return []; } }

  // Numerically solve `expr` for `key` such that evaluating it (with the rest of
  // `scope` held fixed) equals `target`. Uses the secant method retried from several
  // seed points, since the expression's derivative isn't known symbolically. Returns
  // a finite number, or null if no root is found (domain error, no convergence, etc).
  function solveVar(expr, scope, key, target) {
    const ast = parseAST(expr);
    const f = (x) => {
      let v;
      try { v = evalAST(ast, Object.assign({}, scope, { [key]: x })); } catch (e) { return NaN; }
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
      case 'num': return fmtV(n.v);
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
      case 'num': return '<mn>' + mlEscape(fmtV(n.v)) + '</mn>';
      case 'var': return mlIdent(n.name);
      case 'const': { const k = n.name.toLowerCase(); return '<mi>' + mlEscape(ML_GREEK[k] || n.name) + '</mi>'; }
      case 'unary': return '<mo>' + (n.op === '-' ? '−' : '+') + '</mo>' + mlSide(n.arg, 4, false);
      case 'bin': {
        if (n.op === '/') return '<mfrac><mrow>' + ml(n.l) + '</mrow><mrow>' + ml(n.r) + '</mrow></mfrac>';
        if (n.op === '^') { const base = (n.l.type === 'bin' || n.l.type === 'unary') ? mlParen(ml(n.l)) : ml(n.l); return '<msup><mrow>' + base + '</mrow><mrow>' + ml(n.r) + '</mrow></msup>'; }
        const p = PREC[n.op];
        const l = mlSide(n.l, p, false);
        const r = mlSide(n.r, p, (n.op === '-' || n.op === '%'));
        const op = n.op === '%' ? '<mo lspace="0.28em" rspace="0.28em">mod</mo>' : '<mo>' + (n.op === '+' ? '+' : n.op === '-' ? '−' : '×') + '</mo>';
        return l + op + r;
      }
      case 'call': {
        const k = n.name.toLowerCase();
        if (k === 'sqrt' && n.args.length === 1) return '<msqrt>' + ml(n.args[0]) + '</msqrt>';
        if (k === 'cbrt' && n.args.length === 1) return '<mroot><mrow>' + ml(n.args[0]) + '</mrow><mn>3</mn></mroot>';
        if (k === 'root' && n.args.length === 2) return '<mroot><mrow>' + ml(n.args[0]) + '</mrow><mrow>' + ml(n.args[1]) + '</mrow></mroot>';
        if (k === 'abs' && n.args.length === 1) return '<mrow><mo>|</mo>' + ml(n.args[0]) + '<mo>|</mo></mrow>';
        const args = n.args.map(function (a) { return ml(a); }).join('<mo>,</mo>');
        return '<mi mathvariant="normal">' + mlEscape(n.name) + '</mi><mo>(</mo>' + args + '<mo>)</mo>';
      }
    }
    return '';
  }
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
        case 'num': return textBox(fmtV(nd.v), REG, sz);
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
          const opStr = nd.op === '%' ? ' mod ' : (' ' + (nd.op === '+' ? '+' : nd.op === '-' ? '−' : '×') + ' ');
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
      case 'call': return { type: 'call', name: n.name, args: n.args.map((a) => subst(a, scope)) };
    }
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

  /* Input-assist palette for the formula editor. Each button inserts its `t` at the caret;
   * a trailing "()" places the caret between the parentheses so the user just types the argument.
   * Labels are the real-math glyphs; the inserted text is engine syntax (× → *, ÷ → /). */
  const PAD = [
    { g: 'ops', items: [{ l: '+', t: '+' }, { l: '−', t: '-' }, { l: '×', t: '*' }, { l: '÷', t: '/' }, { l: 'xⁿ', t: '^' }, { l: '( )', t: '()' }, { l: '%', t: '%' }] },
    { g: 'const', items: [{ l: 'π', t: 'pi' }, { l: 'e', t: 'e' }, { l: '√', t: 'sqrt()' }] },
    { g: 'fn', items: [{ l: 'sin', t: 'sin()' }, { l: 'cos', t: 'cos()' }, { l: 'tan', t: 'tan()' }, { l: 'ln', t: 'ln()' }, { l: 'log', t: 'log()' }, { l: 'abs', t: 'abs()' }, { l: 'min', t: 'min()' }, { l: 'max', t: 'max()' }, { l: 'round', t: 'round()' }] },
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
  const NON_REVERSIBLE_RE = /\b(round|floor|ceil|trunc|sign|mod|min|max|abs)\b/;
  function isReversible(tp) {
    if (!tp || !tp.variables || !tp.variables.length) return false;
    const e = tp.expression || '';
    if (NON_REVERSIBLE_RE.test(e)) return false;
    if (e.indexOf('%') >= 0) return false;
    return true;
  }
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
const { createElementVNode: _createElementVNode, toDisplayString: _toDisplayString, openBlock: _openBlock, createElementBlock: _createElementBlock, createCommentVNode: _createCommentVNode, renderList: _renderList, Fragment: _Fragment, normalizeStyle: _normalizeStyle, normalizeClass: _normalizeClass, withModifiers: _withModifiers, createTextVNode: _createTextVNode, vModelText: _vModelText, withKeys: _withKeys, withDirectives: _withDirectives, vShow: _vShow, vModelRadio: _vModelRadio, vModelSelect: _vModelSelect, vModelCheckbox: _vModelCheckbox } = Vue

const _hoisted_1 = { class: "layout" }
const _hoisted_2 = { class: "sidebar" }
const _hoisted_3 = { class: "brand" }
const _hoisted_4 = /*#__PURE__*/_createElementVNode("span", { class: "logo" }, "🧮", -1 /* HOISTED */)
const _hoisted_5 = /*#__PURE__*/_createElementVNode("span", null, "FormulaBase", -1 /* HOISTED */)
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
const _hoisted_33 = /*#__PURE__*/_createElementVNode("div", { class: "logo big" }, "🧮", -1 /* HOISTED */)
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
const _hoisted_52 = {
  key: 0,
  class: "fb-vunit"
}
const _hoisted_53 = {
  key: 2,
  class: "fb-solve"
}
const _hoisted_54 = { class: "fb-req" }
const _hoisted_55 = ["value", "onInput", "placeholder"]
const _hoisted_56 = {
  key: 0,
  class: "fb-runit"
}
const _hoisted_57 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_58 = {
  key: 1,
  class: "err-msg"
}
const _hoisted_59 = ["onClick"]
const _hoisted_60 = /*#__PURE__*/_createElementVNode("span", { class: "fb-req" }, "=", -1 /* HOISTED */)
const _hoisted_61 = { class: "fb-rvalue" }
const _hoisted_62 = {
  key: 0,
  class: "fb-runit"
}
const _hoisted_63 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_64 = ["onClick", "title"]
const _hoisted_65 = ["onClick"]
const _hoisted_66 = {
  key: 3,
  class: "fb-notes"
}
const _hoisted_67 = ["title"]
const _hoisted_68 = { class: "fb-side-sec" }
const _hoisted_69 = { class: "fb-side-h" }
const _hoisted_70 = { class: "fb-side-sub" }
const _hoisted_71 = { class: "fb-steps" }
const _hoisted_72 = {
  key: 0,
  class: "fb-step-op"
}
const _hoisted_73 = ["innerHTML"]
const _hoisted_74 = {
  key: 0,
  class: "fb-step-final"
}
const _hoisted_75 = { key: 0 }
const _hoisted_76 = {
  key: 1,
  class: "err-msg"
}
const _hoisted_77 = {
  key: 2,
  class: "empty-hint sm"
}
const _hoisted_78 = { class: "fb-side-sec" }
const _hoisted_79 = { class: "fb-side-h" }
const _hoisted_80 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_81 = { class: "fb-hist" }
const _hoisted_82 = ["onClick", "title"]
const _hoisted_83 = { class: "fb-hist-in" }
const _hoisted_84 = { class: "fb-hist-out" }
const _hoisted_85 = { key: 0 }
const _hoisted_86 = { class: "fb-hist-time" }
const _hoisted_87 = ["onClick", "title"]
const _hoisted_88 = ["onClick", "title"]
const _hoisted_89 = ["onClick"]
const _hoisted_90 = { class: "modal" }
const _hoisted_91 = { class: "modal-head" }
const _hoisted_92 = { class: "modal-body settings-body" }
const _hoisted_93 = { class: "field" }
const _hoisted_94 = { class: "field" }
const _hoisted_95 = ["placeholder"]
const _hoisted_96 = { class: "field-row" }
const _hoisted_97 = { class: "field" }
const _hoisted_98 = { class: "field" }
const _hoisted_99 = { class: "iconpick-head" }
const _hoisted_100 = ["title"]
const _hoisted_101 = ["placeholder"]
const _hoisted_102 = ["placeholder"]
const _hoisted_103 = { class: "emoji-tabs" }
const _hoisted_104 = ["title", "onClick"]
const _hoisted_105 = { class: "emoji-palette" }
const _hoisted_106 = { class: "emoji-cat" }
const _hoisted_107 = {
  key: 0,
  class: "emoji-none"
}
const _hoisted_108 = {
  key: 1,
  class: "emoji-none"
}
const _hoisted_109 = { class: "emoji-grid" }
const _hoisted_110 = ["onClick", "title"]
const _hoisted_111 = ["aria-expanded"]
const _hoisted_112 = { class: "share-toggle-label" }
const _hoisted_113 = { class: "share-hint" }
const _hoisted_114 = { class: "share-caret" }
const _hoisted_115 = {
  key: 0,
  class: "share-hint-text"
}
const _hoisted_116 = {
  key: 0,
  class: "share-count"
}
const _hoisted_117 = { class: "share-body" }
const _hoisted_118 = {
  key: 0,
  class: "share-list"
}
const _hoisted_119 = { class: "share-user" }
const _hoisted_120 = ["value", "onChange"]
const _hoisted_121 = { value: "view" }
const _hoisted_122 = { value: "edit" }
const _hoisted_123 = { value: "delete" }
const _hoisted_124 = ["onClick", "title"]
const _hoisted_125 = { class: "share-add" }
const _hoisted_126 = { class: "share-top" }
const _hoisted_127 = {
  key: 0,
  class: "share-search"
}
const _hoisted_128 = ["placeholder"]
const _hoisted_129 = {
  key: 0,
  class: "share-results"
}
const _hoisted_130 = ["onClick"]
const _hoisted_131 = { class: "muted" }
const _hoisted_132 = {
  key: 1,
  class: "share-picked"
}
const _hoisted_133 = { class: "share-user" }
const _hoisted_134 = { class: "muted" }
const _hoisted_135 = ["title"]
const _hoisted_136 = { class: "perm-label" }
const _hoisted_137 = /*#__PURE__*/_createElementVNode("span", {
  class: "perm-arrow",
  "aria-hidden": "true"
}, "⌄", -1 /* HOISTED */)
const _hoisted_138 = ["onClick"]
const _hoisted_139 = {
  key: 0,
  class: "share-err"
}
const _hoisted_140 = ["disabled"]
const _hoisted_141 = {
  key: 1,
  class: "field"
}
const _hoisted_142 = { class: "field-hint" }
const _hoisted_143 = { class: "modal-foot" }
const _hoisted_144 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_145 = { class: "modal wide" }
const _hoisted_146 = { class: "modal-head" }
const _hoisted_147 = { class: "modal-body" }
const _hoisted_148 = { class: "field" }
const _hoisted_149 = ["placeholder"]
const _hoisted_150 = { class: "field" }
const _hoisted_151 = { class: "fb-md-tabs" }
const _hoisted_152 = ["placeholder"]
const _hoisted_153 = ["innerHTML"]
const _hoisted_154 = { class: "field" }
const _hoisted_155 = { class: "fb-expr-hint" }
const _hoisted_156 = { class: "fb-pad" }
const _hoisted_157 = ["onClick"]
const _hoisted_158 = {
  key: 0,
  class: "fb-pad-row fb-pad-vars"
}
const _hoisted_159 = { class: "fb-pad-tag" }
const _hoisted_160 = ["onClick"]
const _hoisted_161 = ["innerHTML"]
const _hoisted_162 = {
  key: 0,
  class: "field"
}
const _hoisted_163 = { class: "err-msg" }
const _hoisted_164 = { class: "field" }
const _hoisted_165 = ["onUpdate:modelValue", "placeholder"]
const _hoisted_166 = ["onUpdate:modelValue", "placeholder"]
const _hoisted_167 = ["onUpdate:modelValue", "placeholder"]
const _hoisted_168 = ["onUpdate:modelValue", "placeholder"]
const _hoisted_169 = ["onClick"]
const _hoisted_170 = { class: "field frow" }
const _hoisted_171 = { class: "field" }
const _hoisted_172 = { class: "modal-foot" }
const _hoisted_173 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_174 = { class: "modal wide" }
const _hoisted_175 = { class: "modal-head" }
const _hoisted_176 = { class: "modal-body" }
const _hoisted_177 = { class: "empty-hint sm" }
const _hoisted_178 = { class: "tpl-search" }
const _hoisted_179 = /*#__PURE__*/_createElementVNode("span", { class: "tpl-search-ic" }, "🔍", -1 /* HOISTED */)
const _hoisted_180 = ["placeholder"]
const _hoisted_181 = ["title"]
const _hoisted_182 = { class: "tpl-search-count" }
const _hoisted_183 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_184 = {
  key: 1,
  class: "empty-hint sm"
}
const _hoisted_185 = { class: "tpl-groups" }
const _hoisted_186 = ["onClick", "aria-expanded"]
const _hoisted_187 = /*#__PURE__*/_createElementVNode("span", { class: "tpl-group-caret" }, "▶", -1 /* HOISTED */)
const _hoisted_188 = { class: "tpl-group-ic" }
const _hoisted_189 = { class: "tpl-group-title" }
const _hoisted_190 = { class: "tpl-group-n" }
const _hoisted_191 = {
  key: 0,
  class: "tpl-grid"
}
const _hoisted_192 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_193 = { class: "tpl-card-h" }
const _hoisted_194 = ["onClick", "title", "aria-label"]
const _hoisted_195 = { class: "tpl-name" }
const _hoisted_196 = ["title"]
const _hoisted_197 = ["innerHTML"]
const _hoisted_198 = ["innerHTML"]
const _hoisted_199 = { class: "modal-foot" }
const _hoisted_200 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_201 = { class: "modal" }
const _hoisted_202 = { class: "modal-head" }
const _hoisted_203 = { class: "modal-body settings-body" }
const _hoisted_204 = { class: "field" }
const _hoisted_205 = { class: "radios" }
const _hoisted_206 = {
  class: "field",
  style: {"margin-top":"16px"}
}
const _hoisted_207 = { value: "auto" }
const _hoisted_208 = ["value"]
const _hoisted_209 = { class: "field-hint" }
const _hoisted_210 = {
  class: "field",
  style: {"margin-top":"16px","border-top":"1px solid var(--border)","padding-top":"14px"}
}
const _hoisted_211 = {
  class: "field-hint",
  style: {"margin-bottom":"8px"}
}
const _hoisted_212 = { style: {"display":"flex","align-items":"center","gap":"10px"} }
const _hoisted_213 = { style: {"min-width":"40px","text-align":"right"} }
const _hoisted_214 = {
  class: "field",
  style: {"margin-top":"16px","border-top":"1px solid var(--border)","padding-top":"14px"}
}
const _hoisted_215 = {
  class: "field-hint",
  style: {"margin-bottom":"8px"}
}
const _hoisted_216 = { style: {"display":"flex","align-items":"center","gap":"10px"} }
const _hoisted_217 = {
  class: "fp-cur",
  style: {"flex":"1"}
}
const _hoisted_218 = {
  class: "field",
  style: {"margin-top":"16px","border-top":"1px solid var(--border)","padding-top":"14px"}
}
const _hoisted_219 = {
  class: "field-hint",
  style: {"margin-bottom":"8px"}
}
const _hoisted_220 = { style: {"display":"flex","gap":"8px","flex-wrap":"wrap"} }
const _hoisted_221 = { class: "modal-foot" }
const _hoisted_222 = /*#__PURE__*/_createElementVNode("span", { class: "spacer" }, null, -1 /* HOISTED */)
const _hoisted_223 = { class: "modal" }
const _hoisted_224 = { class: "modal-head" }
const _hoisted_225 = ["disabled"]
const _hoisted_226 = { style: {"margin-top":"0","font-size":"13px","color":"var(--muted)"} }
const _hoisted_227 = { class: "field" }
const _hoisted_228 = ["placeholder"]
const _hoisted_229 = {
  key: 0,
  style: {"color":"var(--danger)","font-size":"13px"}
}
const _hoisted_230 = {
  key: 1,
  style: {"font-size":"13px","color":"var(--muted)"}
}
const _hoisted_231 = { class: "modal-foot" }
const _hoisted_232 = ["disabled"]
const _hoisted_233 = ["disabled"]
const _hoisted_234 = { class: "modal" }
const _hoisted_235 = { class: "modal-head" }
const _hoisted_236 = ["disabled"]
const _hoisted_237 = { class: "modal-body" }
const _hoisted_238 = { class: "filepick" }
const _hoisted_239 = { class: "btn sm" }
const _hoisted_240 = { class: "filepick-name" }
const _hoisted_241 = {
  class: "field",
  style: {"margin-top":"12px"}
}
const _hoisted_242 = { class: "field" }
const _hoisted_243 = { class: "radios" }
const _hoisted_244 = { style: {"color":"var(--danger)","font-size":"13px","background":"color-mix(in srgb,var(--danger) 12%,transparent)","padding":"8px 10px","border-radius":"8px"} }
const _hoisted_245 = { class: "confirm-check" }
const _hoisted_246 = {
  key: 1,
  style: {"color":"var(--danger)","font-size":"13px","margin-top":"8px"}
}
const _hoisted_247 = {
  key: 2,
  style: {"font-size":"13px","color":"var(--muted)","margin-top":"8px"}
}
const _hoisted_248 = { class: "modal-foot" }
const _hoisted_249 = ["disabled"]
const _hoisted_250 = ["disabled"]
const _hoisted_251 = { class: "modal" }
const _hoisted_252 = { class: "modal-head" }
const _hoisted_253 = { class: "modal-body" }
const _hoisted_254 = { class: "confirm-check" }
const _hoisted_255 = {
  class: "field",
  style: {"margin-top":"14px"}
}
const _hoisted_256 = { class: "radios" }
const _hoisted_257 = { class: "modal-foot" }
const _hoisted_258 = { class: "modal" }
const _hoisted_259 = { class: "modal-head" }
const _hoisted_260 = { class: "modal-body" }
const _hoisted_261 = { class: "fp-path" }
const _hoisted_262 = ["disabled"]
const _hoisted_263 = { class: "fp-cur" }
const _hoisted_264 = {
  key: 0,
  class: "empty-hint sm"
}
const _hoisted_265 = {
  key: 1,
  class: "empty-hint sm"
}
const _hoisted_266 = {
  key: 2,
  class: "empty-hint sm"
}
const _hoisted_267 = {
  key: 3,
  class: "fp-list"
}
const _hoisted_268 = ["onClick"]
const _hoisted_269 = { class: "ni-title" }
const _hoisted_270 = { class: "ni-cat" }
const _hoisted_271 = {
  key: 4,
  class: "field-hint",
  style: {"margin-top":"8px"}
}
const _hoisted_272 = { class: "modal-foot" }
const _hoisted_273 = ["disabled"]

return function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    _createElementVNode("aside", _hoisted_2, [
      _createElementVNode("div", _hoisted_3, [
        _hoisted_4,
        _hoisted_5,
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
                        _createElementVNode("div", _hoisted_38, _toDisplayString(_ctx.t(f.name)), 1 /* TEXT */),
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
                            innerHTML: _ctx.md(_ctx.t(f.description))
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
                                  _createTextVNode(_toDisplayString(v.label ? _ctx.t(v.label) : v.key) + " ", 1 /* TEXT */),
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
                                  _createElementVNode("input", {
                                    type: "number",
                                    step: "any",
                                    inputmode: "decimal",
                                    value: _ctx.inputs[f.id][v.key],
                                    onInput: $event => (_ctx.setVar(f, v.key, $event.target.value)),
                                    disabled: _ctx.isSolving(f, v.key),
                                    placeholder: _ctx.ph(v)
                                  }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_51),
                                  (v.unit)
                                    ? (_openBlock(), _createElementBlock("span", _hoisted_52, _toDisplayString(v.unit), 1 /* TEXT */))
                                    : _createCommentVNode("v-if", true)
                                ])
                              ], 2 /* CLASS */))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        : _createCommentVNode("v-if", true),
                      (_ctx.solveFor[f.id])
                        ? (_openBlock(), _createElementBlock("div", _hoisted_53, [
                            _createElementVNode("span", _hoisted_54, _toDisplayString(_ctx.t('Target result')) + " =", 1 /* TEXT */),
                            _createElementVNode("input", {
                              type: "number",
                              step: "any",
                              inputmode: "decimal",
                              class: "fb-solve-input",
                              value: _ctx.solveTarget[f.id],
                              onInput: $event => (_ctx.setTarget(f, $event.target.value)),
                              placeholder: _ctx.t('Enter the desired result')
                            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_55),
                            (f.result_unit)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_56, _toDisplayString(f.result_unit), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            _hoisted_57,
                            (_ctx.solveErr[f.id])
                              ? (_openBlock(), _createElementBlock("span", _hoisted_58, "⚠ " + _toDisplayString(_ctx.t('No solution found for this value.')), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("button", {
                              class: "btn xs",
                              onClick: _withModifiers($event => (_ctx.toggleSolve(f, _ctx.solveFor[f.id])), ["stop"])
                            }, _toDisplayString(_ctx.t('Cancel')), 9 /* TEXT, PROPS */, _hoisted_59)
                          ]))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("div", {
                        class: _normalizeClass(["fb-result", {err: _ctx.result(f).err, ok: _ctx.result(f).ok}])
                      }, [
                        _hoisted_60,
                        _createElementVNode("span", _hoisted_61, _toDisplayString(_ctx.te(_ctx.result(f).text)), 1 /* TEXT */),
                        (f.result_unit && _ctx.result(f).ok)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_62, _toDisplayString(f.result_unit), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _hoisted_63,
                        (_ctx.result(f).ok)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 1,
                              class: "btn xs",
                              onClick: _withModifiers($event => (_ctx.copyResult(f)), ["stop"]),
                              title: _ctx.t('Copy result')
                            }, _toDisplayString(_ctx.copiedKey==='res'+f.id ? '✓ '+_ctx.t('Copied') : '📋 '+_ctx.t('Copy')), 9 /* TEXT, PROPS */, _hoisted_64))
                          : _createCommentVNode("v-if", true),
                        (_ctx.result(f).ok)
                          ? (_openBlock(), _createElementBlock("button", {
                              key: 2,
                              class: "btn xs",
                              onClick: _withModifiers($event => (_ctx.record(f)), ["stop"])
                            }, "✔ " + _toDisplayString(_ctx.t('Record')), 9 /* TEXT, PROPS */, _hoisted_65))
                          : _createCommentVNode("v-if", true)
                      ], 2 /* CLASS */),
                      (f.notes)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_66, _toDisplayString(_ctx.t(f.notes)), 1 /* TEXT */))
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
            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_67))
          : _createCommentVNode("v-if", true),
        (_ctx.current && _ctx.activeFormula)
          ? (_openBlock(), _createElementBlock("aside", {
              key: 1,
              class: "fb-side",
              style: _normalizeStyle({ '--fb-side-width': _ctx.sideWidthPct + '%' })
            }, [
              _createElementVNode("div", _hoisted_68, [
                _createElementVNode("div", _hoisted_69, "🧭 " + _toDisplayString(_ctx.t('Calculation steps')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_70, _toDisplayString(_ctx.t(_ctx.activeFormula.name)), 1 /* TEXT */),
                (_ctx.stepData)
                  ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                      _createElementVNode("ol", _hoisted_71, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.stepData.nodes, (nd, i) => {
                          return (_openBlock(), _createElementBlock("li", {
                            key: i,
                            class: _normalizeClass({first:i===0, last:i===_ctx.stepData.nodes.length-1})
                          }, [
                            (i>0)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_72, "↓"))
                              : _createCommentVNode("v-if", true),
                            _createElementVNode("span", {
                              class: "fb-math",
                              innerHTML: _ctx.mathmlNode(nd)
                            }, null, 8 /* PROPS */, _hoisted_73)
                          ], 2 /* CLASS */))
                        }), 128 /* KEYED_FRAGMENT */))
                      ]),
                      (_ctx.stepData.value!=null)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_74, [
                            _createTextVNode("= " + _toDisplayString(_ctx.fmt(_ctx.stepData.value, _ctx.activeFormula.decimals)), 1 /* TEXT */),
                            (_ctx.activeFormula.result_unit)
                              ? (_openBlock(), _createElementBlock("span", _hoisted_75, _toDisplayString(_ctx.activeFormula.result_unit), 1 /* TEXT */))
                              : _createCommentVNode("v-if", true)
                          ]))
                        : _createCommentVNode("v-if", true)
                    ], 64 /* STABLE_FRAGMENT */))
                  : (_ctx.stepError)
                    ? (_openBlock(), _createElementBlock("p", _hoisted_76, "⚠ " + _toDisplayString(_ctx.te(_ctx.stepError)), 1 /* TEXT */))
                    : (_openBlock(), _createElementBlock("p", _hoisted_77, _toDisplayString(_ctx.t('Enter all values to see the steps.')), 1 /* TEXT */))
              ]),
              _createElementVNode("div", _hoisted_78, [
                _createElementVNode("div", _hoisted_79, [
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
                  ? (_openBlock(), _createElementBlock("p", _hoisted_80, _toDisplayString(_ctx.t('Press “Record” to log a calculation.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("ul", _hoisted_81, [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList((_ctx.history[_ctx.activeFormula.id]||[]), (h, i) => {
                    return (_openBlock(), _createElementBlock("li", {
                      key: h.id
                    }, [
                      _createElementVNode("button", {
                        class: "fb-hist-restore",
                        onClick: $event => (_ctx.restore(_ctx.activeFormula, h)),
                        title: _ctx.t('Restore these values')
                      }, [
                        _createElementVNode("span", _hoisted_83, _toDisplayString(h.label), 1 /* TEXT */),
                        _createElementVNode("span", _hoisted_84, [
                          _createTextVNode("= " + _toDisplayString(h.result), 1 /* TEXT */),
                          (h.unit)
                            ? (_openBlock(), _createElementBlock("span", _hoisted_85, _toDisplayString(h.unit), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true)
                        ]),
                        _createElementVNode("span", _hoisted_86, _toDisplayString(_ctx.fmtTime(h.created_at)), 1 /* TEXT */)
                      ], 8 /* PROPS */, _hoisted_82),
                      _createElementVNode("button", {
                        class: "fb-hist-copy",
                        onClick: _withModifiers($event => (_ctx.copyHistory(h,'value')), ["stop"]),
                        title: _ctx.t('Copy result')
                      }, _toDisplayString(_ctx.copiedKey==='h'+h.id+'-value' ? '✓' : '📋'), 9 /* TEXT, PROPS */, _hoisted_87),
                      _createElementVNode("button", {
                        class: "fb-hist-copy",
                        onClick: _withModifiers($event => (_ctx.copyHistory(h,'line')), ["stop"]),
                        title: _ctx.t('Copy line')
                      }, _toDisplayString(_ctx.copiedKey==='h'+h.id+'-line' ? '✓' : '📄'), 9 /* TEXT, PROPS */, _hoisted_88),
                      _createElementVNode("button", {
                        class: "fb-hist-del",
                        onClick: $event => (_ctx.deleteHistory(_ctx.activeFormula, i))
                      }, "✕", 8 /* PROPS */, _hoisted_89)
                    ]))
                  }), 128 /* KEYED_FRAGMENT */))
                ])
              ])
            ], 4 /* STYLE */))
          : _createCommentVNode("v-if", true)
      ])
    ]),
    (_ctx.modal==='collection')
      ? (_openBlock(), _createElementBlock("div", {
          key: 0,
          class: "modal-mask",
          onClick: _cache[32] || (_cache[32] = _withModifiers($event => (_ctx.modal=null), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_90, [
            _createElementVNode("div", _hoisted_91, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.collForm.id ? _ctx.t('⚙️ Collection settings') : _ctx.t('＋ New collection')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[10] || (_cache[10] = $event => (_ctx.modal=null))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_92, [
              _createElementVNode("div", _hoisted_93, [
                _createElementVNode("label", null, "🏷️ " + _toDisplayString(_ctx.t('Name')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  class: "control",
                  "onUpdate:modelValue": _cache[11] || (_cache[11] = $event => ((_ctx.collForm.name) = $event)),
                  onKeyup: _cache[12] || (_cache[12] = _withKeys((...args) => (_ctx.saveCollection && _ctx.saveCollection(...args)), ["enter"]))
                }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelText, _ctx.collForm.name]
                ])
              ]),
              _createElementVNode("div", _hoisted_94, [
                _createElementVNode("label", null, "📝 " + _toDisplayString(_ctx.t('Description')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("textarea", {
                  class: "control",
                  "onUpdate:modelValue": _cache[13] || (_cache[13] = $event => ((_ctx.collForm.description) = $event)),
                  placeholder: _ctx.t('Description of this collection')
                }, null, 8 /* PROPS */, _hoisted_95), [
                  [_vModelText, _ctx.collForm.description]
                ])
              ]),
              _createElementVNode("div", _hoisted_96, [
                _createElementVNode("div", _hoisted_97, [
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
                _createElementVNode("div", _hoisted_98, [
                  _createElementVNode("label", null, "😀 " + _toDisplayString(_ctx.t('Icon')), 1 /* TEXT */),
                  _createElementVNode("div", _hoisted_99, [
                    _createElementVNode("button", {
                      type: "button",
                      class: _normalizeClass(["iconpick-cur", {open: _ctx.iconPickerOpen}]),
                      onClick: _cache[15] || (_cache[15] = _withModifiers((...args) => (_ctx.openIconPicker && _ctx.openIconPicker(...args)), ["stop"])),
                      title: _ctx.t('Click to choose an icon')
                    }, _toDisplayString(_ctx.collForm.icon || '🧮'), 11 /* TEXT, CLASS, PROPS */, _hoisted_100),
                    _withDirectives(_createElementVNode("input", {
                      "onUpdate:modelValue": _cache[16] || (_cache[16] = $event => ((_ctx.collForm.icon) = $event)),
                      maxlength: "16",
                      placeholder: _ctx.t('Emoji')
                    }, null, 8 /* PROPS */, _hoisted_101), [
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
                          }, null, 8 /* PROPS */, _hoisted_102), [
                            [_vModelText, _ctx.emojiQuery]
                          ]),
                          _createElementVNode("div", _hoisted_103, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.iconGroupsAll, (g) => {
                              return (_openBlock(), _createElementBlock("button", {
                                type: "button",
                                class: _normalizeClass(["emoji-tab", {sel: !_ctx.emojiQuery && _ctx.emojiTab===g.key}]),
                                key: g.key,
                                title: _ctx.t(g.key),
                                onClick: $event => {_ctx.emojiTab = g.key; _ctx.emojiQuery = ''}
                              }, _toDisplayString(g.tab), 11 /* TEXT, CLASS, PROPS */, _hoisted_104))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]),
                          _createElementVNode("div", _hoisted_105, [
                            _createElementVNode("div", _hoisted_106, _toDisplayString(_ctx.emojiQuery ? _ctx.t('{n} items', {n: _ctx.emojiShown.length}) : _ctx.t(_ctx.emojiTab)), 1 /* TEXT */),
                            (_ctx.emojiLoading)
                              ? (_openBlock(), _createElementBlock("div", _hoisted_107, _toDisplayString(_ctx.t('Loading…')), 1 /* TEXT */))
                              : (!_ctx.emojiShown.length)
                                ? (_openBlock(), _createElementBlock("div", _hoisted_108, _toDisplayString(_ctx.t('No matching emoji')), 1 /* TEXT */))
                                : _createCommentVNode("v-if", true),
                            _createElementVNode("div", _hoisted_109, [
                              (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.emojiShown, (em) => {
                                return (_openBlock(), _createElementBlock("button", {
                                  type: "button",
                                  class: _normalizeClass(["emoji-btn", {sel: _ctx.collForm.icon===em}]),
                                  key: em,
                                  onClick: $event => {_ctx.collForm.icon = em; _ctx.iconPickerOpen = false},
                                  title: _ctx.emojiName(em)
                                }, _toDisplayString(em), 11 /* TEXT, CLASS, PROPS */, _hoisted_110))
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
                      _createElementVNode("span", _hoisted_112, "👥 " + _toDisplayString(_ctx.t('Share settings')), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_113, [
                        _createElementVNode("span", _hoisted_114, _toDisplayString(_ctx.shareExpanded ? '▼' : '▶'), 1 /* TEXT */),
                        (!_ctx.shareExpanded)
                          ? (_openBlock(), _createElementBlock("span", _hoisted_115, _toDisplayString(_ctx.t('Click to expand')), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true)
                      ]),
                      (_ctx.sharePanel.shares.length)
                        ? (_openBlock(), _createElementBlock("span", _hoisted_116, _toDisplayString(_ctx.sharePanel.shares.length), 1 /* TEXT */))
                        : _createCommentVNode("v-if", true)
                    ], 8 /* PROPS */, _hoisted_111),
                    _withDirectives(_createElementVNode("div", _hoisted_117, [
                      (_ctx.sharePanel.shares.length)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_118, [
                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sharePanel.shares, (s) => {
                              return (_openBlock(), _createElementBlock("div", {
                                key: s.recipient_uid,
                                class: "share-row"
                              }, [
                                _createElementVNode("span", _hoisted_119, _toDisplayString(s.recipient_name || s.recipient_uid), 1 /* TEXT */),
                                _createElementVNode("select", {
                                  class: "share-perm",
                                  value: s.perm,
                                  onChange: $event => (_ctx.changeSharePerm(s, $event.target.value))
                                }, [
                                  _createElementVNode("option", _hoisted_121, _toDisplayString(_ctx.t('View')), 1 /* TEXT */),
                                  _createElementVNode("option", _hoisted_122, _toDisplayString(_ctx.t('Edit')), 1 /* TEXT */),
                                  _createElementVNode("option", _hoisted_123, _toDisplayString(_ctx.t('Delete')), 1 /* TEXT */)
                                ], 40 /* PROPS, NEED_HYDRATION */, _hoisted_120),
                                _createElementVNode("button", {
                                  type: "button",
                                  class: "icon-btn",
                                  onClick: $event => (_ctx.removeShare(s)),
                                  title: _ctx.t('Remove share')
                                }, "🗑", 8 /* PROPS */, _hoisted_124)
                              ]))
                            }), 128 /* KEYED_FRAGMENT */))
                          ]))
                        : _createCommentVNode("v-if", true),
                      _createElementVNode("div", _hoisted_125, [
                        _createElementVNode("div", _hoisted_126, [
                          (!_ctx.sharePanel.recipient)
                            ? (_openBlock(), _createElementBlock("div", _hoisted_127, [
                                _withDirectives(_createElementVNode("input", {
                                  "onUpdate:modelValue": _cache[21] || (_cache[21] = $event => ((_ctx.sharePanel.q) = $event)),
                                  onInput: _cache[22] || (_cache[22] = (...args) => (_ctx.searchShareUsers && _ctx.searchShareUsers(...args))),
                                  placeholder: _ctx.t('Search users to share with…'),
                                  autocomplete: "off"
                                }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_128), [
                                  [_vModelText, _ctx.sharePanel.q]
                                ]),
                                (_ctx.sharePanel.results.length)
                                  ? (_openBlock(), _createElementBlock("div", _hoisted_129, [
                                      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.sharePanel.results, (u) => {
                                        return (_openBlock(), _createElementBlock("button", {
                                          type: "button",
                                          key: u.uid,
                                          class: "share-result",
                                          onClick: $event => (_ctx.pickShareUser(u))
                                        }, [
                                          _createTextVNode(_toDisplayString(u.name) + " ", 1 /* TEXT */),
                                          _createElementVNode("span", _hoisted_131, "(" + _toDisplayString(u.uid) + ")", 1 /* TEXT */)
                                        ], 8 /* PROPS */, _hoisted_130))
                                      }), 128 /* KEYED_FRAGMENT */))
                                    ]))
                                  : _createCommentVNode("v-if", true)
                              ]))
                            : (_openBlock(), _createElementBlock("div", _hoisted_132, [
                                _createElementVNode("span", _hoisted_133, [
                                  _createTextVNode(_toDisplayString(_ctx.sharePanel.recipientName) + " ", 1 /* TEXT */),
                                  _createElementVNode("span", _hoisted_134, "(" + _toDisplayString(_ctx.sharePanel.recipient) + ")", 1 /* TEXT */)
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
                            _createElementVNode("span", _hoisted_136, _toDisplayString(_ctx.permLabel), 1 /* TEXT */),
                            _hoisted_137,
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
                                    }, _toDisplayString(o.label), 11 /* TEXT, CLASS, PROPS */, _hoisted_138))
                                  }), 128 /* KEYED_FRAGMENT */))
                                ]))
                              : _createCommentVNode("v-if", true)
                          ], 10 /* CLASS, PROPS */, _hoisted_135),
                          (_ctx.permOpen)
                            ? (_openBlock(), _createElementBlock("div", {
                                key: 2,
                                class: "perm-backdrop",
                                onClick: _cache[26] || (_cache[26] = $event => (_ctx.permOpen = false))
                              }))
                            : _createCommentVNode("v-if", true)
                        ]),
                        (_ctx.sharePanel.err)
                          ? (_openBlock(), _createElementBlock("div", _hoisted_139, _toDisplayString(_ctx.sharePanel.err), 1 /* TEXT */))
                          : _createCommentVNode("v-if", true),
                        _createElementVNode("button", {
                          type: "button",
                          class: "btn sm primary",
                          disabled: !_ctx.sharePanel.recipient || _ctx.sharePanel.busy,
                          onClick: _cache[27] || (_cache[27] = (...args) => (_ctx.addShare && _ctx.addShare(...args)))
                        }, _toDisplayString(_ctx.t('Share')), 9 /* TEXT, PROPS */, _hoisted_140)
                      ])
                    ], 512 /* NEED_PATCH */), [
                      [_vShow, _ctx.shareExpanded]
                    ])
                  ], 2 /* CLASS */))
                : _createCommentVNode("v-if", true),
              (_ctx.collForm.id)
                ? (_openBlock(), _createElementBlock("div", _hoisted_141, [
                    _createElementVNode("label", null, "📤 " + _toDisplayString(_ctx.t('Export')), 1 /* TEXT */),
                    _createElementVNode("div", null, [
                      _createElementVNode("button", {
                        type: "button",
                        class: "btn sm",
                        onClick: _cache[28] || (_cache[28] = (...args) => (_ctx.exportCollectionOds && _ctx.exportCollectionOds(...args)))
                      }, "📄 " + _toDisplayString(_ctx.t('Export to ODS (spreadsheet)')), 1 /* TEXT */)
                    ]),
                    _createElementVNode("div", _hoisted_142, _toDisplayString(_ctx.t('Download this collection as an OpenDocument spreadsheet (.ods).')), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_143, [
              (_ctx.collForm.id)
                ? (_openBlock(), _createElementBlock("button", {
                    key: 0,
                    class: "btn danger",
                    onClick: _cache[29] || (_cache[29] = (...args) => (_ctx.removeCollection && _ctx.removeCollection(...args)))
                  }, _toDisplayString(_ctx.t('Delete')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              _hoisted_144,
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
      ? (_openBlock(), _createElementBlock("div", {
          key: 1,
          class: "modal-mask",
          onClick: _cache[47] || (_cache[47] = _withModifiers($event => (_ctx.modal=null), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_145, [
            _createElementVNode("div", _hoisted_146, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.fForm.id ? _ctx.t('Edit formula') : _ctx.t('New formula')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[33] || (_cache[33] = $event => (_ctx.modal=null))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_147, [
              _createElementVNode("div", _hoisted_148, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Title')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  class: "control",
                  "onUpdate:modelValue": _cache[34] || (_cache[34] = $event => ((_ctx.fForm.name) = $event)),
                  placeholder: _ctx.t('e.g. Selling price')
                }, null, 8 /* PROPS */, _hoisted_149), [
                  [_vModelText, _ctx.fForm.name]
                ])
              ]),
              _createElementVNode("div", _hoisted_150, [
                _createElementVNode("label", null, [
                  _createTextVNode(_toDisplayString(_ctx.t('Description')) + " ", 1 /* TEXT */),
                  _createElementVNode("span", _hoisted_151, [
                    _createElementVNode("button", {
                      type: "button",
                      class: _normalizeClass(["btn xs", {primary: !_ctx.mdPreview}]),
                      onClick: _cache[35] || (_cache[35] = $event => (_ctx.mdPreview=false))
                    }, _toDisplayString(_ctx.t('Write')), 3 /* TEXT, CLASS */),
                    _createElementVNode("button", {
                      type: "button",
                      class: _normalizeClass(["btn xs", {primary: _ctx.mdPreview}]),
                      onClick: _cache[36] || (_cache[36] = $event => (_ctx.mdPreview=true))
                    }, _toDisplayString(_ctx.t('Preview')), 3 /* TEXT, CLASS */)
                  ])
                ]),
                (!_ctx.mdPreview)
                  ? _withDirectives((_openBlock(), _createElementBlock("textarea", {
                      key: 0,
                      class: "control",
                      "onUpdate:modelValue": _cache[37] || (_cache[37] = $event => ((_ctx.fForm.description) = $event)),
                      rows: "4",
                      placeholder: _ctx.t('Supports Markdown: **bold**, *italic*, lists, [links](https://…)')
                    }, null, 8 /* PROPS */, _hoisted_152)), [
                      [_vModelText, _ctx.fForm.description]
                    ])
                  : (_openBlock(), _createElementBlock("div", {
                      key: 1,
                      class: "fb-md-preview fb-md",
                      innerHTML: _ctx.md(_ctx.fForm.description) || '<span class="empty-hint sm">—</span>'
                    }, null, 8 /* PROPS */, _hoisted_153))
              ]),
              _createElementVNode("div", _hoisted_154, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Expression')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  class: "control mono",
                  ref: "exprInput",
                  "onUpdate:modelValue": _cache[38] || (_cache[38] = $event => ((_ctx.fForm.expression) = $event)),
                  onInput: _cache[39] || (_cache[39] = (...args) => (_ctx.onExpr && _ctx.onExpr(...args))),
                  placeholder: "price * (1 + tax / 100)"
                }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                  [_vModelText, _ctx.fForm.expression]
                ]),
                _createElementVNode("p", _hoisted_155, _toDisplayString(_ctx.t('Give each unknown a name, then combine them with the buttons below. Example: price * (1 + tax / 100)')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_156, [
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
                        }, _toDisplayString(it.l), 9 /* TEXT, PROPS */, _hoisted_157))
                      }), 128 /* KEYED_FRAGMENT */))
                    ]))
                  }), 128 /* KEYED_FRAGMENT */)),
                  (_ctx.fForm.variables.some(v => v.key))
                    ? (_openBlock(), _createElementBlock("div", _hoisted_158, [
                        _createElementVNode("span", _hoisted_159, _toDisplayString(_ctx.t('Variables')), 1 /* TEXT */),
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.fForm.variables.filter(x => x.key), (v) => {
                          return (_openBlock(), _createElementBlock("button", {
                            type: "button",
                            class: "btn xs fb-pad-btn var",
                            key: 'pv'+v.key,
                            onClick: $event => (_ctx.insertToken({t:v.key}))
                          }, _toDisplayString(v.key), 9 /* TEXT, PROPS */, _hoisted_160))
                        }), 128 /* KEYED_FRAGMENT */))
                      ]))
                    : _createCommentVNode("v-if", true)
                ]),
                (_ctx.fForm.expression.trim() && !_ctx.fForm.exprError)
                  ? (_openBlock(), _createElementBlock("div", {
                      key: 0,
                      class: "fb-expr-preview",
                      innerHTML: _ctx.mathml(_ctx.fForm.expression)
                    }, null, 8 /* PROPS */, _hoisted_161))
                  : _createCommentVNode("v-if", true)
              ]),
              (_ctx.fForm.exprError)
                ? (_openBlock(), _createElementBlock("div", _hoisted_162, [
                    _createElementVNode("span", _hoisted_163, "⚠ " + _toDisplayString(_ctx.te(_ctx.fForm.exprError)), 1 /* TEXT */)
                  ]))
                : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_164, [
                _createElementVNode("label", null, [
                  _createTextVNode(_toDisplayString(_ctx.t('Variables')) + " ", 1 /* TEXT */),
                  _createElementVNode("button", {
                    class: "btn xs",
                    onClick: _cache[40] || (_cache[40] = (...args) => (_ctx.detectVars && _ctx.detectVars(...args)))
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
                    }, null, 8 /* PROPS */, _hoisted_165), [
                      [_vModelText, v.key]
                    ]),
                    _withDirectives(_createElementVNode("input", {
                      class: "control",
                      "onUpdate:modelValue": $event => ((v.label) = $event),
                      placeholder: _ctx.t('label')
                    }, null, 8 /* PROPS */, _hoisted_166), [
                      [_vModelText, v.label]
                    ]),
                    _withDirectives(_createElementVNode("input", {
                      class: "control",
                      "onUpdate:modelValue": $event => ((v.unit) = $event),
                      placeholder: _ctx.t('unit'),
                      style: {"width":"80px"}
                    }, null, 8 /* PROPS */, _hoisted_167), [
                      [_vModelText, v.unit]
                    ]),
                    _withDirectives(_createElementVNode("input", {
                      class: "control",
                      type: "number",
                      step: "any",
                      "onUpdate:modelValue": $event => ((v.default) = $event),
                      placeholder: _ctx.t('default'),
                      style: {"width":"90px"}
                    }, null, 8 /* PROPS */, _hoisted_168), [
                      [_vModelText, v.default]
                    ]),
                    _createElementVNode("button", {
                      class: "btn xs danger",
                      onClick: $event => (_ctx.fForm.variables.splice(idx,1))
                    }, "✕", 8 /* PROPS */, _hoisted_169)
                  ]))
                }), 128 /* KEYED_FRAGMENT */)),
                _createElementVNode("button", {
                  class: "btn xs",
                  onClick: _cache[41] || (_cache[41] = $event => (_ctx.fForm.variables.push({key:'',label:'',unit:'',default:''})))
                }, "＋ " + _toDisplayString(_ctx.t('Add variable')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_170, [
                _createElementVNode("span", null, [
                  _createElementVNode("label", null, _toDisplayString(_ctx.t('Result unit')), 1 /* TEXT */),
                  _withDirectives(_createElementVNode("input", {
                    class: "control",
                    "onUpdate:modelValue": _cache[42] || (_cache[42] = $event => ((_ctx.fForm.result_unit) = $event)),
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
                    "onUpdate:modelValue": _cache[43] || (_cache[43] = $event => ((_ctx.fForm.decimals) = $event)),
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
              _createElementVNode("div", _hoisted_171, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Notes')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("textarea", {
                  class: "control",
                  "onUpdate:modelValue": _cache[44] || (_cache[44] = $event => ((_ctx.fForm.notes) = $event)),
                  rows: "2"
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelText, _ctx.fForm.notes]
                ])
              ])
            ]),
            _createElementVNode("div", _hoisted_172, [
              _hoisted_173,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[45] || (_cache[45] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[46] || (_cache[46] = (...args) => (_ctx.saveFormula && _ctx.saveFormula(...args)))
              }, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal==='templates')
      ? (_openBlock(), _createElementBlock("div", {
          key: 2,
          class: "modal-mask",
          onClick: _cache[52] || (_cache[52] = _withModifiers($event => (_ctx.modal=null), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_174, [
            _createElementVNode("div", _hoisted_175, [
              _createElementVNode("h3", null, "📐 " + _toDisplayString(_ctx.t('Formula templates')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[48] || (_cache[48] = $event => (_ctx.modal=null))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_176, [
              _createElementVNode("p", _hoisted_177, _toDisplayString(_ctx.t('Add a ready-made formula to the current collection.')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_178, [
                _hoisted_179,
                _withDirectives(_createElementVNode("input", {
                  class: "control",
                  type: "search",
                  "onUpdate:modelValue": _cache[49] || (_cache[49] = $event => ((_ctx.tplSearch) = $event)),
                  placeholder: _ctx.t('Search templates (name, category, formula)…'),
                  autocomplete: "off"
                }, null, 8 /* PROPS */, _hoisted_180), [
                  [_vModelText, _ctx.tplSearch]
                ]),
                (_ctx.tplSearch)
                  ? (_openBlock(), _createElementBlock("button", {
                      key: 0,
                      type: "button",
                      class: "tpl-search-clear",
                      onClick: _cache[50] || (_cache[50] = $event => (_ctx.tplSearch='')),
                      title: _ctx.t('Clear')
                    }, "✕", 8 /* PROPS */, _hoisted_181))
                  : _createCommentVNode("v-if", true),
                _createElementVNode("span", _hoisted_182, _toDisplayString(_ctx.templateMatchCount), 1 /* TEXT */)
              ]),
              (!_ctx.tplIndexLoaded)
                ? (_openBlock(), _createElementBlock("p", _hoisted_183, _toDisplayString(_ctx.t('Loading templates…')), 1 /* TEXT */))
                : (!_ctx.templatesByCat.length)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_184, _toDisplayString(_ctx.t('No templates match your search.')), 1 /* TEXT */))
                  : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_185, [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.templatesByCat, (g) => {
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
                      _hoisted_187,
                      _createElementVNode("span", _hoisted_188, _toDisplayString(_ctx.catIcon(g.cat)), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_189, _toDisplayString(_ctx.t(g.cat)), 1 /* TEXT */),
                      _createElementVNode("span", _hoisted_190, _toDisplayString(g.items.length), 1 /* TEXT */)
                    ], 8 /* PROPS */, _hoisted_186),
                    (_ctx.isGroupOpen(g.cat))
                      ? (_openBlock(), _createElementBlock("div", _hoisted_191, [
                          (!_ctx.tplCache[g.cat])
                            ? (_openBlock(), _createElementBlock("p", _hoisted_192, _toDisplayString(_ctx.t('Loading…')), 1 /* TEXT */))
                            : _createCommentVNode("v-if", true),
                          (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.catItems(g), (tp) => {
                            return (_openBlock(), _createElementBlock("div", {
                              class: "tpl-card",
                              key: tp.name
                            }, [
                              _createElementVNode("div", _hoisted_193, [
                                _createElementVNode("button", {
                                  class: "tpl-add",
                                  onClick: $event => (_ctx.addTemplate(tp)),
                                  title: _ctx.t('Add'),
                                  "aria-label": _ctx.t('Add')
                                }, "＋", 8 /* PROPS */, _hoisted_194),
                                _createElementVNode("div", _hoisted_195, _toDisplayString(_ctx.t(tp.name)), 1 /* TEXT */),
                                (_ctx.isReversible(tp))
                                  ? (_openBlock(), _createElementBlock("span", {
                                      key: 0,
                                      class: "badge-outline",
                                      title: _ctx.t('This formula can be reverse-calculated (solve for a variable from the result).')
                                    }, "⇄ " + _toDisplayString(_ctx.t('Reversible')), 9 /* TEXT, PROPS */, _hoisted_196))
                                  : _createCommentVNode("v-if", true)
                              ]),
                              _createElementVNode("div", {
                                class: "tpl-expr",
                                innerHTML: _ctx.mathml(tp.expression)
                              }, null, 8 /* PROPS */, _hoisted_197),
                              (tp.description)
                                ? (_openBlock(), _createElementBlock("div", {
                                    key: 0,
                                    class: "tpl-desc fb-md",
                                    innerHTML: _ctx.md(_ctx.t(tp.description))
                                  }, null, 8 /* PROPS */, _hoisted_198))
                                : _createCommentVNode("v-if", true)
                            ]))
                          }), 128 /* KEYED_FRAGMENT */))
                        ]))
                      : _createCommentVNode("v-if", true)
                  ], 2 /* CLASS */))
                }), 128 /* KEYED_FRAGMENT */))
              ])
            ]),
            _createElementVNode("div", _hoisted_199, [
              _hoisted_200,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[51] || (_cache[51] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Close')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal==='settings')
      ? (_openBlock(), _createElementBlock("div", {
          key: 3,
          class: "modal-mask",
          onClick: _cache[68] || (_cache[68] = _withModifiers($event => (_ctx.modal=null), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_201, [
            _createElementVNode("div", _hoisted_202, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('⚙️ Settings')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[53] || (_cache[53] = (...args) => (_ctx.cancelSettings && _ctx.cancelSettings(...args)))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_203, [
              _createElementVNode("div", _hoisted_204, [
                _createElementVNode("label", null, "🌗 " + _toDisplayString(_ctx.t('Theme')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_205, [
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "auto",
                      "onUpdate:modelValue": _cache[54] || (_cache[54] = $event => ((_ctx.settingsForm.theme) = $event)),
                      onChange: _cache[55] || (_cache[55] = (...args) => (_ctx.previewTheme && _ctx.previewTheme(...args)))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelRadio, _ctx.settingsForm.theme]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Default (match Nextcloud)')), 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "light",
                      "onUpdate:modelValue": _cache[56] || (_cache[56] = $event => ((_ctx.settingsForm.theme) = $event)),
                      onChange: _cache[57] || (_cache[57] = (...args) => (_ctx.previewTheme && _ctx.previewTheme(...args)))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelRadio, _ctx.settingsForm.theme]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Light')), 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "dark",
                      "onUpdate:modelValue": _cache[58] || (_cache[58] = $event => ((_ctx.settingsForm.theme) = $event)),
                      onChange: _cache[59] || (_cache[59] = (...args) => (_ctx.previewTheme && _ctx.previewTheme(...args)))
                    }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                      [_vModelRadio, _ctx.settingsForm.theme]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Dark')), 1 /* TEXT */)
                  ])
                ])
              ]),
              _createElementVNode("div", _hoisted_206, [
                _createElementVNode("label", null, "🌐 " + _toDisplayString(_ctx.t('Language')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("select", {
                  "onUpdate:modelValue": _cache[60] || (_cache[60] = $event => ((_ctx.settingsForm.language) = $event))
                }, [
                  _createElementVNode("option", _hoisted_207, _toDisplayString(_ctx.t('System default (match Nextcloud)')), 1 /* TEXT */),
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.languages, (lg) => {
                    return (_openBlock(), _createElementBlock("option", {
                      key: lg.code,
                      value: lg.code
                    }, _toDisplayString(lg.name), 9 /* TEXT, PROPS */, _hoisted_208))
                  }), 128 /* KEYED_FRAGMENT */))
                ], 512 /* NEED_PATCH */), [
                  [_vModelSelect, _ctx.settingsForm.language]
                ]),
                _createElementVNode("div", _hoisted_209, _toDisplayString(_ctx.t('The display language switches when you press “Save”.')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_210, [
                _createElementVNode("label", null, "🧭 " + _toDisplayString(_ctx.t('Calculation steps panel width')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_211, _toDisplayString(_ctx.t('How wide the calculation-steps panel opens next to a formula.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_212, [
                  _withDirectives(_createElementVNode("input", {
                    type: "range",
                    min: "20",
                    max: "50",
                    step: "1",
                    "onUpdate:modelValue": _cache[61] || (_cache[61] = $event => ((_ctx.settingsForm.stepsWidthPct) = $event)),
                    onInput: _cache[62] || (_cache[62] = (...args) => (_ctx.previewStepsWidth && _ctx.previewStepsWidth(...args))),
                    style: {"flex":"1"}
                  }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
                    [
                      _vModelText,
                      _ctx.settingsForm.stepsWidthPct,
                      void 0,
                      { number: true }
                    ]
                  ]),
                  _createElementVNode("span", _hoisted_213, _toDisplayString(_ctx.settingsForm.stepsWidthPct) + "%", 1 /* TEXT */)
                ])
              ]),
              _createElementVNode("div", _hoisted_214, [
                _createElementVNode("label", null, "📤 " + _toDisplayString(_ctx.t('Formula save destination')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_215, _toDisplayString(_ctx.t('The folder "Save" opens to when exporting a formula.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_216, [
                  _createElementVNode("span", _hoisted_217, "/" + _toDisplayString(_ctx.exportFolder), 1 /* TEXT */),
                  _createElementVNode("button", {
                    type: "button",
                    class: "btn sm",
                    onClick: _cache[63] || (_cache[63] = (...args) => (_ctx.openDefaultFolderPicker && _ctx.openDefaultFolderPicker(...args)))
                  }, _toDisplayString(_ctx.t('Change')), 1 /* TEXT */)
                ])
              ]),
              _createElementVNode("div", _hoisted_218, [
                _createElementVNode("label", null, "💾 " + _toDisplayString(_ctx.t('Backup / Restore')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_219, _toDisplayString(_ctx.t('Save all your collections and formulas to a ZIP file, or restore them from one.')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_220, [
                  _createElementVNode("button", {
                    type: "button",
                    class: "btn sm",
                    onClick: _cache[64] || (_cache[64] = (...args) => (_ctx.openBackup && _ctx.openBackup(...args)))
                  }, "💾 " + _toDisplayString(_ctx.t('Download all data')), 1 /* TEXT */),
                  _createElementVNode("button", {
                    type: "button",
                    class: "btn sm",
                    onClick: _cache[65] || (_cache[65] = (...args) => (_ctx.openRestore && _ctx.openRestore(...args)))
                  }, "♻ " + _toDisplayString(_ctx.t('Restore from backup')), 1 /* TEXT */)
                ])
              ])
            ]),
            _createElementVNode("div", _hoisted_221, [
              _hoisted_222,
              _createElementVNode("button", {
                class: "btn",
                onClick: _cache[66] || (_cache[66] = (...args) => (_ctx.cancelSettings && _ctx.cancelSettings(...args)))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "btn primary",
                onClick: _cache[67] || (_cache[67] = (...args) => (_ctx.saveSettings && _ctx.saveSettings(...args)))
              }, _toDisplayString(_ctx.t('Save')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal && _ctx.modal.type==='backup')
      ? (_openBlock(), _createElementBlock("div", {
          key: 4,
          class: "modal-mask",
          onClick: _cache[74] || (_cache[74] = _withModifiers($event => (!_ctx.backupForm.busy && (_ctx.modal=null)), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_223, [
            _createElementVNode("div", _hoisted_224, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('💾 Download all data')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                disabled: _ctx.backupForm.busy,
                onClick: _cache[69] || (_cache[69] = $event => (_ctx.modal=null))
              }, "✕", 8 /* PROPS */, _hoisted_225)
            ]),
            _createElementVNode("form", {
              class: "modal-body",
              onSubmit: _cache[71] || (_cache[71] = _withModifiers((...args) => (_ctx.doBackup && _ctx.doBackup(...args)), ["prevent"]))
            }, [
              _createElementVNode("p", _hoisted_226, _toDisplayString(_ctx.t('Optionally set a password to encrypt the ZIP. Leave it blank for a plain (unencrypted) archive.')), 1 /* TEXT */),
              _createElementVNode("div", _hoisted_227, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Password (optional)')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  type: "password",
                  "onUpdate:modelValue": _cache[70] || (_cache[70] = $event => ((_ctx.backupForm.password) = $event)),
                  autocomplete: "new-password",
                  placeholder: _ctx.t('Blank = no encryption')
                }, null, 8 /* PROPS */, _hoisted_228), [
                  [_vModelText, _ctx.backupForm.password]
                ])
              ]),
              (_ctx.backupForm.err)
                ? (_openBlock(), _createElementBlock("div", _hoisted_229, _toDisplayString(_ctx.backupForm.err), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.backupForm.busy)
                ? (_openBlock(), _createElementBlock("div", _hoisted_230, _toDisplayString(_ctx.t('Creating…')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ], 32 /* NEED_HYDRATION */),
            _createElementVNode("div", _hoisted_231, [
              _createElementVNode("button", {
                class: "btn",
                disabled: _ctx.backupForm.busy,
                onClick: _cache[72] || (_cache[72] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Cancel')), 9 /* TEXT, PROPS */, _hoisted_232),
              _createElementVNode("button", {
                class: "btn primary",
                disabled: _ctx.backupForm.busy,
                onClick: _cache[73] || (_cache[73] = (...args) => (_ctx.doBackup && _ctx.doBackup(...args)))
              }, _toDisplayString(_ctx.t('Download')), 9 /* TEXT, PROPS */, _hoisted_233)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.modal && _ctx.modal.type==='restore')
      ? (_openBlock(), _createElementBlock("div", {
          key: 5,
          class: "modal-mask",
          onClick: _cache[84] || (_cache[84] = _withModifiers($event => (!_ctx.restoreForm.busy && (_ctx.modal=null)), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_234, [
            _createElementVNode("div", _hoisted_235, [
              _createElementVNode("h3", null, _toDisplayString(_ctx.t('♻ Restore from backup')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                disabled: _ctx.restoreForm.busy,
                onClick: _cache[75] || (_cache[75] = $event => (_ctx.modal=null))
              }, "✕", 8 /* PROPS */, _hoisted_236)
            ]),
            _createElementVNode("div", _hoisted_237, [
              _createElementVNode("label", _hoisted_238, [
                _createElementVNode("input", {
                  type: "file",
                  accept: ".zip",
                  onChange: _cache[76] || (_cache[76] = (...args) => (_ctx.onRestoreFile && _ctx.onRestoreFile(...args)))
                }, null, 32 /* NEED_HYDRATION */),
                _createElementVNode("span", _hoisted_239, _toDisplayString(_ctx.t('📄 Choose file')), 1 /* TEXT */),
                _createElementVNode("span", _hoisted_240, _toDisplayString(_ctx.restoreForm.fileName || _ctx.t('Backup file (.zip)')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_241, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Password (only if the backup has one)')), 1 /* TEXT */),
                _withDirectives(_createElementVNode("input", {
                  type: "password",
                  "onUpdate:modelValue": _cache[77] || (_cache[77] = $event => ((_ctx.restoreForm.password) = $event)),
                  autocomplete: "new-password"
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelText, _ctx.restoreForm.password]
                ])
              ]),
              _createElementVNode("div", _hoisted_242, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Restore method')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_243, [
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "overwrite",
                      "onUpdate:modelValue": _cache[78] || (_cache[78] = $event => ((_ctx.restoreForm.mode) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.restoreForm.mode]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Overwrite (delete and replace existing data)')), 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "merge",
                      "onUpdate:modelValue": _cache[79] || (_cache[79] = $event => ((_ctx.restoreForm.mode) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.restoreForm.mode]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Merge (import only non-duplicate formulas)')), 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "add",
                      "onUpdate:modelValue": _cache[80] || (_cache[80] = $event => ((_ctx.restoreForm.mode) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.restoreForm.mode]
                    ]),
                    _createTextVNode(" " + _toDisplayString(_ctx.t('Add (as new collections)')), 1 /* TEXT */)
                  ])
                ])
              ]),
              (_ctx.restoreForm.mode==='overwrite')
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("p", _hoisted_244, _toDisplayString(_ctx.t('⚠️ Overwriting replaces ALL existing data (collections and formulas).')), 1 /* TEXT */),
                    _createElementVNode("label", _hoisted_245, [
                      _withDirectives(_createElementVNode("input", {
                        type: "checkbox",
                        "onUpdate:modelValue": _cache[81] || (_cache[81] = $event => ((_ctx.restoreForm.confirm) = $event))
                      }, null, 512 /* NEED_PATCH */), [
                        [_vModelCheckbox, _ctx.restoreForm.confirm]
                      ]),
                      _createTextVNode(" " + _toDisplayString(_ctx.t('I understand the above and confirm the restore')), 1 /* TEXT */)
                    ])
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              (_ctx.restoreForm.err)
                ? (_openBlock(), _createElementBlock("div", _hoisted_246, _toDisplayString(_ctx.restoreForm.err), 1 /* TEXT */))
                : _createCommentVNode("v-if", true),
              (_ctx.restoreForm.busy)
                ? (_openBlock(), _createElementBlock("div", _hoisted_247, _toDisplayString(_ctx.t('Restoring…')), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_248, [
              _createElementVNode("button", {
                class: "btn",
                disabled: _ctx.restoreForm.busy,
                onClick: _cache[82] || (_cache[82] = $event => (_ctx.modal=null))
              }, _toDisplayString(_ctx.t('Cancel')), 9 /* TEXT, PROPS */, _hoisted_249),
              _createElementVNode("button", {
                class: _normalizeClass(["btn", _ctx.restoreForm.mode==='overwrite' ? 'danger' : 'primary']),
                disabled: _ctx.restoreForm.busy || (_ctx.restoreForm.mode==='overwrite' && !_ctx.restoreForm.confirm),
                onClick: _cache[83] || (_cache[83] = (...args) => (_ctx.doRestore && _ctx.doRestore(...args)))
              }, _toDisplayString(_ctx.t('Restore')), 11 /* TEXT, CLASS, PROPS */, _hoisted_250)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.exportDialog.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 6,
          class: "modal-mask",
          onClick: _cache[94] || (_cache[94] = _withModifiers($event => (_ctx.exportDialog.open=false), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_251, [
            _createElementVNode("div", _hoisted_252, [
              _createElementVNode("h3", null, "📤 " + _toDisplayString(_ctx.exportDialog.formula ? _ctx.t(_ctx.exportDialog.formula.name) : ''), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[85] || (_cache[85] = $event => (_ctx.exportDialog.open=false))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_253, [
              _createElementVNode("label", _hoisted_254, [
                _withDirectives(_createElementVNode("input", {
                  type: "checkbox",
                  "onUpdate:modelValue": _cache[86] || (_cache[86] = $event => ((_ctx.exportDialog.includeSteps) = $event))
                }, null, 512 /* NEED_PATCH */), [
                  [_vModelCheckbox, _ctx.exportDialog.includeSteps]
                ]),
                _createTextVNode(" " + _toDisplayString(_ctx.t('Include the calculation steps')), 1 /* TEXT */)
              ]),
              _createElementVNode("div", _hoisted_255, [
                _createElementVNode("label", null, _toDisplayString(_ctx.t('Save format')), 1 /* TEXT */),
                _createElementVNode("div", _hoisted_256, [
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "md",
                      "onUpdate:modelValue": _cache[87] || (_cache[87] = $event => ((_ctx.exportDialog.format) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.exportDialog.format]
                    ]),
                    _createTextVNode(" Markdown (.md)")
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "ods",
                      "onUpdate:modelValue": _cache[88] || (_cache[88] = $event => ((_ctx.exportDialog.format) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.exportDialog.format]
                    ]),
                    _createTextVNode(" ODS — " + _toDisplayString(_ctx.t('calculable spreadsheet')) + " (.ods)", 1 /* TEXT */)
                  ]),
                  _createElementVNode("label", null, [
                    _withDirectives(_createElementVNode("input", {
                      type: "radio",
                      value: "odt",
                      "onUpdate:modelValue": _cache[89] || (_cache[89] = $event => ((_ctx.exportDialog.format) = $event))
                    }, null, 512 /* NEED_PATCH */), [
                      [_vModelRadio, _ctx.exportDialog.format]
                    ]),
                    _createTextVNode(" ODT — " + _toDisplayString(_ctx.t('report')) + " (.odt)", 1 /* TEXT */)
                  ])
                ])
              ])
            ]),
            _createElementVNode("div", _hoisted_257, [
              _createElementVNode("button", {
                type: "button",
                class: "btn",
                onClick: _cache[90] || (_cache[90] = $event => (_ctx.exportDialog.open=false))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              _createElementVNode("button", {
                type: "button",
                class: "btn",
                onClick: _cache[91] || (_cache[91] = $event => (_ctx.doCopyText()))
              }, "📄 " + _toDisplayString(_ctx.t('Copy as text')), 1 /* TEXT */),
              _createElementVNode("button", {
                type: "button",
                class: "btn",
                onClick: _cache[92] || (_cache[92] = $event => (_ctx.doCopyImage()))
              }, "🖼 " + _toDisplayString(_ctx.t('Copy as image')), 1 /* TEXT */),
              _createElementVNode("button", {
                type: "button",
                class: "btn primary",
                onClick: _cache[93] || (_cache[93] = $event => (_ctx.openSaveFolderPicker()))
              }, "💾 " + _toDisplayString(_ctx.t('Save to Nextcloud')), 1 /* TEXT */)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.filePicker.open)
      ? (_openBlock(), _createElementBlock("div", {
          key: 7,
          class: "modal-mask cropper-mask",
          onClick: _cache[101] || (_cache[101] = _withModifiers($event => (_ctx.fpCancel()), ["self"]))
        }, [
          _createElementVNode("div", _hoisted_258, [
            _createElementVNode("div", _hoisted_259, [
              _createElementVNode("h3", null, "📂 " + _toDisplayString(_ctx.t('Choose a folder')), 1 /* TEXT */),
              _createElementVNode("button", {
                class: "icon-btn",
                onClick: _cache[95] || (_cache[95] = $event => (_ctx.fpCancel()))
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_260, [
              _createElementVNode("div", _hoisted_261, [
                _createElementVNode("button", {
                  type: "button",
                  class: "btn sm",
                  disabled: _ctx.filePicker.parent===null || _ctx.filePicker.loading,
                  onClick: _cache[96] || (_cache[96] = $event => (_ctx.fpUp()))
                }, _toDisplayString(_ctx.t('⬆ Up')), 9 /* TEXT, PROPS */, _hoisted_262),
                _createElementVNode("span", _hoisted_263, "/" + _toDisplayString(_ctx.filePicker.path), 1 /* TEXT */)
              ]),
              (_ctx.filePicker.loading)
                ? (_openBlock(), _createElementBlock("p", _hoisted_264, _toDisplayString(_ctx.t('Loading…')), 1 /* TEXT */))
                : (_ctx.filePicker.error)
                  ? (_openBlock(), _createElementBlock("p", _hoisted_265, _toDisplayString(_ctx.filePicker.error), 1 /* TEXT */))
                  : (!_ctx.fpVisibleEntries().length)
                    ? (_openBlock(), _createElementBlock("p", _hoisted_266, _toDisplayString(_ctx.t('This folder is empty.')), 1 /* TEXT */))
                    : (_openBlock(), _createElementBlock("div", _hoisted_267, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.fpVisibleEntries(), (x) => {
                          return (_openBlock(), _createElementBlock("button", {
                            type: "button",
                            key: x.path,
                            class: _normalizeClass(["note-item fp-item", {sel: _ctx.filePicker.selectedFile && _ctx.filePicker.selectedFile.path===x.path}]),
                            onClick: $event => (_ctx.fpClick(x))
                          }, [
                            _createElementVNode("span", _hoisted_269, _toDisplayString(x.is_dir ? '📁' : '📄') + " " + _toDisplayString(x.name), 1 /* TEXT */),
                            _createElementVNode("span", _hoisted_270, _toDisplayString(x.is_dir ? '›' : ''), 1 /* TEXT */)
                          ], 10 /* CLASS, PROPS */, _hoisted_268))
                        }), 128 /* KEYED_FRAGMENT */))
                      ])),
              (_ctx.filePicker.purpose==='export' && _ctx.filePicker.selectedFile)
                ? (_openBlock(), _createElementBlock("p", _hoisted_271, _toDisplayString(_ctx.t('Selected file: {name}', { name: _ctx.filePicker.selectedFile.name })), 1 /* TEXT */))
                : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_272, [
              _createElementVNode("button", {
                type: "button",
                class: "btn",
                onClick: _cache[97] || (_cache[97] = $event => (_ctx.fpCancel()))
              }, _toDisplayString(_ctx.t('Cancel')), 1 /* TEXT */),
              (_ctx.filePicker.purpose==='export' && _ctx.filePicker.selectedFile)
                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                    _createElementVNode("button", {
                      type: "button",
                      class: "btn danger",
                      onClick: _cache[98] || (_cache[98] = $event => (_ctx.fpConfirm('overwrite')))
                    }, _toDisplayString(_ctx.t('Overwrite')), 1 /* TEXT */),
                    _createElementVNode("button", {
                      type: "button",
                      class: "btn",
                      onClick: _cache[99] || (_cache[99] = $event => (_ctx.fpConfirm('append')))
                    }, _toDisplayString(_ctx.t('Append to the end')), 1 /* TEXT */)
                  ], 64 /* STABLE_FRAGMENT */))
                : _createCommentVNode("v-if", true),
              _createElementVNode("button", {
                type: "button",
                class: "btn primary",
                disabled: _ctx.filePicker.loading,
                onClick: _cache[100] || (_cache[100] = $event => (_ctx.fpConfirm('auto')))
              }, _toDisplayString(_ctx.t('Select this folder')), 9 /* TEXT, PROPS */, _hoisted_273)
            ])
          ])
        ]))
      : _createCommentVNode("v-if", true),
    (_ctx.toast)
      ? (_openBlock(), _createElementBlock("div", {
          key: 8,
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
        settingsForm: { theme: 'auto', language: 'auto', stepsWidthPct: SIDE_WIDTH_PCT_DEFAULT },
        pad: PAD,
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
      templatesByCat() {
        const q = (this.tplSearch || '').trim().toLowerCase();
        const match = (tp) => {
          if (!q) return true;
          const hay = [tp.name, T(tp.name), tp.cat, T(tp.cat), tp.expression]
            .concat((tp.variables || []).map((v) => v.label + ' ' + v.key));
          return hay.some((s) => (s || '').toString().toLowerCase().includes(q));
        };
        const groups = []; const idx = {};
        for (const tp of this.tplIndex) {
          if (!match(tp)) continue;
          if (!(tp.cat in idx)) { idx[tp.cat] = groups.length; groups.push({ cat: tp.cat, items: [] }); }
          groups[idx[tp.cat]].items.push(tp);
        }
        return groups;
      },
      templateMatchCount() {
        return this.templatesByCat.reduce((n, g) => n + g.items.length, 0) + ' / ' + this.tplIndex.length;
      },
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
        const lines = ['### ' + this.t(f.name), ''];
        if (image) lines.push('![' + this.t(f.name).replace(/[[\]]/g, '') + '](' + image + ')', '');
        lines.push('**' + this.t('Expression') + ':** `' + f.expression + '`');
        const ins = this.inputs[f.id] || {};
        const varLines = (f.variables || [])
          .filter((v) => ins[v.key] !== undefined && ins[v.key] !== '' && !this.isSolving(f, v.key))
          .map((v) => '- ' + (v.label ? this.t(v.label) : v.key) + ' = ' + ins[v.key] + (v.unit ? ' ' + v.unit : ''));
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
          if (ins[v.key] !== undefined && ins[v.key] !== '' && isFinite(Number(ins[v.key]))) values[v.key] = Number(ins[v.key]);
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
            body: JSON.stringify({ format, folder, filename: this.t(f.name), content, values, image, imageWidth, imageHeight, steps, target }),
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
        const title = this.t(f.name);
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
          this.applyTheme();
          await this.applyLanguage(this.language);
        } catch (e) { this.applyTheme(); }
      },
      openSettings() {
        this._themeBefore = this.theme;
        this._sideWidthPctBefore = this.sideWidthPct;
        this.settingsForm = { theme: this.theme, language: this.language, stepsWidthPct: this.sideWidthPct };
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
            }),
          });
          this.theme = s.theme || 'auto';
          this.language = s.language || 'auto';
          this.languages = s.languages || this.languages;
          this.sideWidthPct = clampSideWidthPct(s.steps_width_pct);
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
          let raw = src[v.key];
          if (raw === '' || raw == null) {
            if (v.default !== '' && v.default != null && !isNaN(Number(v.default))) { scope[v.key] = Number(v.default); continue; }
            return null;
          }
          const num = Number(raw); if (isNaN(num)) return null;
          scope[v.key] = num;
        }
        return scope;
      },
      result(f) {
        const scope = this.scopeFor(f);
        if (!scope) return { ok: false, err: false, text: '—' };
        try {
          const val = evalAST(parseAST(f.expression), scope);
          if (val == null || isNaN(val) || !isFinite(val)) return { ok: false, err: true, text: (val === Infinity || val === -Infinity) ? '∞' : '—' };
          return { ok: true, err: false, text: fmtNum(val, f.decimals), value: val };
        } catch (e) { return { ok: false, err: true, text: '⚠ ' + (e.message || 'error') }; }
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
          const rv = inputs[v.key];
          if (rv === '' || rv == null) {
            if (v.default !== '' && v.default != null && !isNaN(Number(v.default))) { scope[v.key] = Number(v.default); continue; }
            inputs[key] = ''; return;
          }
          const num = Number(rv); if (isNaN(num)) { inputs[key] = ''; return; }
          scope[v.key] = num;
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
        if (this.currentId == null) { this.formulas = []; return; }
        this.formulas = await api('collections/' + this.currentId + '/formulas');
        const inputs = {};
        for (const f of this.formulas) {
          inputs[f.id] = {};
          for (const v of (f.variables || [])) inputs[f.id][v.key] = (v.default !== '' && v.default != null) ? v.default : '';
        }
        this.inputs = inputs;
        this.history = {};
        this.solveFor = {};
        this.solveTarget = {};
        this.solveErr = {};
        this.activeId = this.formulas.length ? this.formulas[0].id : null;
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
        for (const v of f.variables) { const val = (src[v.key] === '' || src[v.key] == null) ? v.default : src[v.key]; snap[v.key] = val; parts.push((v.label ? T(v.label) : v.key) + '=' + val + (v.unit ? v.unit : '')); }
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
        this.restoreForm.fileName = f.name;
        const r = new FileReader();
        r.onload = () => { this.restoreForm.dataUrl = String(r.result || ''); };
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
        this.fForm = f
          ? {
            id: f.id, name: this.t(f.name), expression: f.expression, description: f.description ? this.t(f.description) : '',
            variables: JSON.parse(JSON.stringify(f.variables || [])).map((v) => Object.assign(v, { label: v.label ? this.t(v.label) : v.label })),
            result_unit: f.result_unit, decimals: f.decimals, notes: f.notes ? this.t(f.notes) : '', exprError: '',
          }
          : { id: null, name: '', expression: '', description: '', variables: [], result_unit: '', decimals: 2, notes: '', exprError: '' };
        this.mdPreview = false;
        this.onExpr(); this.modal = 'formula';
      },
      onExpr() {
        const expr = (this.fForm.expression || '').trim();
        if (!expr) { this.fForm.exprError = ''; return; }
        const scope = {};
        for (const v of this.fForm.variables) if (v.key) scope[v.key] = 1;
        for (const k of extractVars(expr)) if (!(k in scope)) scope[k] = 1;
        try { evalAST(parseAST(expr), scope); this.fForm.exprError = ''; } catch (e) { this.fForm.exprError = e.message || 'invalid'; }
      },
      detectVars() {
        const have = {}; for (const v of this.fForm.variables) if (v.key) have[v.key] = 1;
        for (const k of extractVars(this.fForm.expression)) if (!have[k]) { this.fForm.variables.push({ key: k, label: '', unit: '', default: '' }); have[k] = 1; }
        this.onExpr();
      },
      async saveFormula() {
        const name = (this.fForm.name || '').trim();
        if (!name) { this.fForm.exprError = T('Name is required'); return; }
        this.onExpr(); if (this.fForm.exprError) return;
        const vars = this.fForm.variables.filter((v) => (v.key || '').trim()).map((v) => ({ key: v.key.trim(), label: v.label || '', unit: v.unit || '', default: v.default === '' ? '' : v.default }));
        const body = JSON.stringify({ name, expression: this.fForm.expression || '', description: this.fForm.description || '', variables: vars, result_unit: this.fForm.result_unit || '', decimals: this.fForm.decimals == null ? 2 : this.fForm.decimals, notes: this.fForm.notes || '' });
        try {
          if (this.fForm.id) await api('formulas/' + this.fForm.id, { method: 'PUT', body });
          else await api('collections/' + this.currentId + '/formulas', { method: 'POST', body });
          this.modal = null; await this.loadFormulas();
        } catch (e) { this.notify(T('Could not save.'), 'error'); }
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
        if (this.tplIndexLoaded) return;
        try { this.tplIndex = await api('templates/index'); this.tplIndexLoaded = true; }
        catch (e) { this.notify(T('Could not load templates.'), 'error'); }
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
        if (!(this.tplSearch || '').trim()) return cached;
        const names = new Set(g.items.map((it) => it.name));
        return cached.filter((tp) => names.has(tp.name));
      },
      isGroupOpen(cat) { if ((this.tplSearch || '').trim()) return true; return !!this.tplOpen[cat]; },
      catIcon(cat) { return CAT_ICONS[cat] || '🧮'; },
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
