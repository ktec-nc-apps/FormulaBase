/* FormulaBase — Nextcloud native SPA (buildless Vue 3).
 * Collections of reusable formulas; type numbers in and read the result live,
 * with a step-by-step calculation trace and a per-formula history log.
 * The math engine is a small recursive-descent parser + AST evaluator —
 * no eval / no new Function (App Store: no unsafe-eval). */
(function () {
  'use strict';
  const { createApp } = Vue;

  const BASE = ((window.OC && OC.generateUrl) ? OC.generateUrl('/apps/formulabase') : '/apps/formulabase') + '/';
  let TOKEN = (window.OC && OC.requestToken) ? OC.requestToken : '';
  let rootProxy = null;
  // In-app language override map (fetched from /api/i18n/<lang>); null → follow Nextcloud's own locale.
  let i18nOverride = null;

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
  const ICONS = [
    { key: 'Calculation', emojis: '🧮 📐 📏 🔢 ➕ ➖ ✖️ ➗ 🟰 📊 📈 📉 💹 💲 💱 🔟'.split(' ') },
    { key: 'Faces & emotion', emojis: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🫢 🤫 😴 😷 🤒 🤕 🤢 🤮 🥴 😵 🤠'.split(' ') },
    { key: 'Hands', emojis: '👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 ✍️ 💪 👏 🙌 👐 🤲 🫶'.split(' ') },
    { key: 'People', emojis: '👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 👮 🕵️ 💂 👷 🤴 👸 👰 🤵 🧕 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 👤 👥 🚶 🏃'.split(' ') },
    { key: 'Animals & nature', emojis: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦖 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🐋 🦈 🌸 🌷 🌹 🌻 🌼 🌵 🌲 🌳 🍀 🍁 🍂 🌾 ⭐ 🌙 ☀️ ⛅ ☁️ 🌈 ⚡ ❄️ 🔥 💧 🌊'.split(' ') },
    { key: 'Food & drink', emojis: '🍎 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥝 🍅 🥑 🥦 🌽 🥕 🥔 🍞 🥐 🥯 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍜 🍝 🍣 🍱 🍚 🍙 🍘 🍢 🍡 🍧 🍨 🍦 🍰 🎂 🧁 🍩 🍪 🍫 🍬 🍭 ☕ 🍵 🍶 🍺 🍻 🍷 🥂 🍸 🍹 🥤'.split(' ') },
    { key: 'Travel & places', emojis: '🚗 🚕 🚙 🚌 🚑 🚒 🚓 🏎️ 🚄 🚅 🚆 🚇 🚉 ✈️ 🚀 🛸 🚁 ⛵ 🚤 🚢 🏠 🏡 🏢 🏥 🏦 🏨 🏫 🏪 🗼 🗽 ⛩️ 🏰 🎡 🎢 🗻 🏔️ 🌋 🏖️ 🏝️'.split(' ') },
    { key: 'Objects', emojis: '📱 💻 ⌨️ 🖥️ 🖨️ 📷 📸 🎥 📺 ⏰ ⌚ 📚 📖 ✏️ 📝 📌 📎 🔒 🔑 💡 🔦 🔧 🔨 ⚙️ 🎁 🎈 🎉 🎊 🎀 💰 💳 💎 🔔 🎵 🎶 ⚽ 🏀 ⚾ 🎾 🏐 🏈 🎯 🎮 🎲 ♠️ ♥️ ♦️ ♣️'.split(' ') },
    { key: 'Symbols', emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 ✅ ❌ ⭕ ❗ ❓ ⚠️ 💯 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ✨ ⭐ 🌟'.split(' ') },
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

  const TEMPLATE = `
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><span class="logo">🧮</span><span>FormulaBase</span><span class="tag" v-if="version">v{{ version }}</span></div>
      <nav class="coll-list">
        <button v-for="c in collections" :key="c.id" class="coll-item" :class="{active: c.id===currentId}" @click="selectCollection(c.id)">
          <span class="ci-bar" :style="{background: c.color || 'var(--primary)'}"></span>
          <span v-if="shareBadge(c)" class="share-badge" :title="shareBadgeTitle(c)">{{ shareBadge(c) }}</span>
          <span class="ic">{{ c.icon }}</span>
          <span class="nm">{{ c.name }}</span>
          <span class="ct" v-if="c.id===currentId">{{ formulas.length }}</span>
        </button>
        <div v-if="!collections.length" class="empty" style="padding:24px 8px"><div>{{ t('No collections yet.') }}</div></div>
      </nav>
      <div class="sidebar-foot">
        <button class="btn primary block" @click="openCollectionModal()">{{ t('＋ New collection') }}</button>
        <button class="btn sm block" @click="openSettings" :title="t('Theme, language, etc.')">{{ t('⚙️ Settings') }}</button>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div class="title" v-if="current"><span v-if="shareBadge(current)" class="share-badge" :title="shareBadgeTitle(current)">{{ shareBadge(current) }}</span><span class="ic">{{ current.icon }}</span><span class="nm">{{ current.name }}</span><span class="desc" v-if="current.description">{{ current.description }}</span></div>
        <div class="title" v-else><span class="nm">FormulaBase</span></div>
        <div class="spacer"></div>
        <div class="topbar-actions" v-if="current">
          <button class="btn sm" v-if="canSettings" @click="openCollectionModal(current)">{{ t('⚙️ Collection settings') }}</button>
          <button class="btn sm" v-if="canEdit" @click="openTemplates">＋ {{ t('Templates') }}</button>
          <button class="btn accent sm" v-if="canEdit" @click="openFormulaModal()">＋ {{ t('New formula') }}</button>
        </div>
      </div>

      <div class="content fb-content">
        <div class="fb-listcol">
          <div v-if="loading" class="empty-hint">{{ t('Loading…') }}</div>
          <div v-else-if="!current" class="fb-welcome">
            <div class="fb-welcome-card">
              <div class="logo big">🧮</div>
              <h2>{{ t('Welcome to FormulaBase') }}</h2>
              <p>{{ t('Create a collection, add formulas (or start from a template), then type in numbers to calculate instantly.') }}</p>
              <div class="fb-welcome-btns">
                <button class="btn" @click="openTemplates">📐 {{ t('Browse templates') }}</button>
                <button class="btn primary" @click="openCollectionModal()">{{ t('＋ New collection') }}</button>
              </div>
            </div>
          </div>
          <template v-else>
            <p v-if="!formulas.length" class="empty-hint">{{ t('No formulas yet. Add one or pick a template to start calculating.') }}</p>
            <div v-for="f in formulas" :key="f.id" class="card fb-card" :class="{active: f.id===activeId}" @focusin="activeId=f.id" @click="activeId=f.id">
              <div class="fb-head">
                <div class="fb-name">{{ t(f.name) }}</div>
                <span class="badge-outline" v-if="isReversible(f)" :title="t('This formula can be reverse-calculated (solve for a variable from the result).')">⇄ {{ t('Reversible') }}</span>
                <div class="fb-actions">
                  <button class="btn sm" @click.stop="copyExpr(f)" :title="t('Copy expression')">{{ copiedKey==='ex'+f.id ? '✓' : '⧉' }}</button>
                  <button class="btn sm" v-if="canEdit" @click.stop="openFormulaModal(f)">{{ t('Edit') }}</button>
                  <button class="btn sm danger" v-if="canDelete" @click.stop="removeFormula(f)">{{ t('Delete') }}</button>
                </div>
              </div>
              <div class="fb-desc fb-md" v-if="f.description" v-html="md(t(f.description))"></div>
              <div class="fb-expr" v-html="mathml(f.expression)"></div>
              <div class="fb-vars" v-if="f.variables.length">
                <label class="fb-var" v-for="v in f.variables" :key="v.key" :class="{ solving: isSolving(f, v.key) }">
                  <span class="fb-vlabel">
                    {{ v.label ? t(v.label) : v.key }}
                    <button v-if="isReversible(f)" type="button" class="fb-solve-btn" :class="{ active: isSolving(f, v.key) }" @click.stop="toggleSolve(f, v.key)" :title="t('Solve this variable from the result')">🎯</button>
                  </span>
                  <span class="fb-vinput">
                    <input type="number" step="any" inputmode="decimal" :value="inputs[f.id][v.key]" @input="setVar(f, v.key, $event.target.value)" :disabled="isSolving(f, v.key)" :placeholder="ph(v)">
                    <span class="fb-vunit" v-if="v.unit">{{ v.unit }}</span>
                  </span>
                </label>
              </div>
              <div class="fb-solve" v-if="solveFor[f.id]">
                <span class="fb-req">{{ t('Target result') }} =</span>
                <input type="number" step="any" inputmode="decimal" class="fb-solve-input" :value="solveTarget[f.id]" @input="setTarget(f, $event.target.value)" :placeholder="t('Enter the desired result')">
                <span class="fb-runit" v-if="f.result_unit">{{ f.result_unit }}</span>
                <span class="spacer"></span>
                <span class="err-msg" v-if="solveErr[f.id]">⚠ {{ t('No solution found for this value.') }}</span>
                <button class="btn xs" @click.stop="toggleSolve(f, solveFor[f.id])">{{ t('Cancel') }}</button>
              </div>
              <div class="fb-result" :class="{err: result(f).err, ok: result(f).ok}">
                <span class="fb-req">=</span>
                <span class="fb-rvalue">{{ te(result(f).text) }}</span>
                <span class="fb-runit" v-if="f.result_unit && result(f).ok">{{ f.result_unit }}</span>
                <span class="spacer"></span>
                <button class="btn xs" v-if="result(f).ok" @click.stop="copyResult(f)" :title="t('Copy result')">{{ copiedKey==='res'+f.id ? '✓' : '📋' }}</button>
                <button class="btn xs" v-if="result(f).ok" @click.stop="record(f)">✔ {{ t('Record') }}</button>
              </div>
              <div class="fb-notes" v-if="f.notes">{{ t(f.notes) }}</div>
            </div>
          </template>
        </div>

        <aside class="fb-side" v-if="current && activeFormula">
          <div class="fb-side-sec">
            <div class="fb-side-h">🧭 {{ t('Calculation steps') }}</div>
            <div class="fb-side-sub">{{ t(activeFormula.name) }}</div>
            <template v-if="stepData">
              <ol class="fb-steps">
                <li v-for="(nd,i) in stepData.nodes" :key="i" :class="{first:i===0, last:i===stepData.nodes.length-1}">
                  <span class="fb-step-op" v-if="i>0">↓</span><span class="fb-math" v-html="mathmlNode(nd)"></span>
                </li>
              </ol>
              <div class="fb-step-final" v-if="stepData.value!=null">= {{ fmt(stepData.value, activeFormula.decimals) }}<span v-if="activeFormula.result_unit"> {{ activeFormula.result_unit }}</span></div>
            </template>
            <p v-else-if="stepError" class="err-msg">⚠ {{ te(stepError) }}</p>
            <p v-else class="empty-hint sm">{{ t('Enter all values to see the steps.') }}</p>
          </div>

          <div class="fb-side-sec">
            <div class="fb-side-h">🕘 {{ t('History') }} <button class="btn xs" v-if="(history[activeFormula.id]||[]).length" @click="clearHistory(activeFormula)">{{ t('Clear') }}</button></div>
            <p v-if="!(history[activeFormula.id]||[]).length" class="empty-hint sm">{{ t('Press “Record” to log a calculation.') }}</p>
            <ul class="fb-hist">
              <li v-for="(h,i) in (history[activeFormula.id]||[])" :key="h.id">
                <button class="fb-hist-restore" @click="restore(activeFormula, h)" :title="t('Restore these values')">
                  <span class="fb-hist-in">{{ h.label }}</span>
                  <span class="fb-hist-out">= {{ h.result }}<span v-if="h.unit"> {{ h.unit }}</span></span>
                  <span class="fb-hist-time">{{ fmtTime(h.created_at) }}</span>
                </button>
                <button class="fb-hist-copy" @click.stop="copyHistory(h,'value')" :title="t('Copy result')">{{ copiedKey==='h'+h.id+'-value' ? '✓' : '📋' }}</button>
                <button class="fb-hist-copy" @click.stop="copyHistory(h,'line')" :title="t('Copy line')">{{ copiedKey==='h'+h.id+'-line' ? '✓' : '📄' }}</button>
                <button class="fb-hist-del" @click="deleteHistory(activeFormula, i)">✕</button>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </main>

    <div class="modal-mask" v-if="modal==='collection'" @click.self="modal=null">
      <div class="modal">
        <div class="modal-head"><h3>{{ collForm.id ? t('⚙️ Collection settings') : t('＋ New collection') }}</h3><button class="icon-btn" @click="modal=null">✕</button></div>
        <div class="modal-body settings-body">
        <div class="field"><label>🏷️ {{ t('Name') }}</label><input class="control" v-model="collForm.name" @keyup.enter="saveCollection"></div>
        <div class="field"><label>📝 {{ t('Description') }}</label><textarea class="control" v-model="collForm.description" :placeholder="t('Description of this collection')"></textarea></div>
        <div class="field-row">
          <div class="field"><label>🎨 {{ t('Color') }}</label><input type="color" class="control" v-model="collForm.color" style="height:44px;padding:4px"></div>
          <div class="field">
            <label>😀 {{ t('Icon') }}</label>
            <div class="iconpick-head">
              <button type="button" class="iconpick-cur" :class="{open: iconPickerOpen}" @click.stop="iconPickerOpen = !iconPickerOpen" :title="t('Click to choose an icon')">{{ collForm.icon || '🧮' }}</button>
              <input v-model="collForm.icon" maxlength="8" :placeholder="t('Emoji')" />
              <div v-if="iconPickerOpen" class="emoji-popup" @click.stop>
                <div class="emoji-palette">
                  <div class="emoji-group" v-for="g in iconGroups" :key="g.key">
                    <div class="emoji-cat">{{ t(g.key) }}</div>
                    <div class="emoji-grid">
                      <button type="button" class="emoji-btn" v-for="em in g.emojis" :key="em"
                              :class="{sel: collForm.icon===em}" @click="collForm.icon = em; iconPickerOpen = false" :title="em">{{ em }}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="iconPickerOpen" class="perm-backdrop" @click="iconPickerOpen = false"></div>
          </div>
        </div>
        <div v-if="collForm.id && isOwner" class="field share-section" :class="{open: shareExpanded}">
          <button type="button" class="share-toggle" :aria-expanded="shareExpanded ? 'true' : 'false'" @click="shareExpanded = !shareExpanded">
            <span class="share-toggle-label">👥 {{ t('Share settings') }}</span>
            <span class="share-hint"><span class="share-caret">{{ shareExpanded ? '▼' : '▶' }}</span><span v-if="!shareExpanded" class="share-hint-text">{{ t('Click to expand') }}</span></span>
            <span v-if="sharePanel.shares.length" class="share-count">{{ sharePanel.shares.length }}</span>
          </button>
          <div v-show="shareExpanded" class="share-body">
            <div v-if="sharePanel.shares.length" class="share-list">
              <div v-for="s in sharePanel.shares" :key="s.recipient_uid" class="share-row">
                <span class="share-user">{{ s.recipient_name || s.recipient_uid }}</span>
                <select class="share-perm" :value="s.perm" @change="changeSharePerm(s, $event.target.value)">
                  <option value="view">{{ t('View') }}</option>
                  <option value="edit">{{ t('Edit') }}</option>
                  <option value="delete">{{ t('Delete') }}</option>
                </select>
                <button type="button" class="icon-btn" @click="removeShare(s)" :title="t('Remove share')">🗑</button>
              </div>
            </div>
            <div class="share-add">
              <div class="share-top">
                <div v-if="!sharePanel.recipient" class="share-search">
                  <input v-model="sharePanel.q" @input="searchShareUsers" :placeholder="t('Search users to share with…')" autocomplete="off" />
                  <div v-if="sharePanel.results.length" class="share-results">
                    <button type="button" v-for="u in sharePanel.results" :key="u.uid" class="share-result" @click="pickShareUser(u)">{{ u.name }} <span class="muted">({{ u.uid }})</span></button>
                  </div>
                </div>
                <div v-else class="share-picked">
                  <span class="share-user">{{ sharePanel.recipientName }} <span class="muted">({{ sharePanel.recipient }})</span></span>
                  <button type="button" class="icon-btn" @click="clearShareRecipient">✕</button>
                </div>
                <div class="perm-wrap" :class="{open: permOpen}" :title="t('Permission')" @click.stop="permOpen = !permOpen">
                  <span class="perm-label">{{ permLabel }}</span>
                  <span class="perm-arrow" aria-hidden="true">⌄</span>
                  <div v-if="permOpen" class="perm-menu" @click.stop>
                    <button type="button" v-for="o in permOptions" :key="o.v" class="perm-opt" :class="{sel: sharePanel.perm === o.v}" @click="sharePanel.perm = o.v; permOpen = false">{{ o.label }}</button>
                  </div>
                </div>
                <div v-if="permOpen" class="perm-backdrop" @click="permOpen = false"></div>
              </div>
              <div v-if="sharePanel.err" class="share-err">{{ sharePanel.err }}</div>
              <button type="button" class="btn sm primary" :disabled="!sharePanel.recipient || sharePanel.busy" @click="addShare">{{ t('Share') }}</button>
            </div>
          </div>
        </div>
        <div class="field" v-if="collForm.id">
          <label>📤 {{ t('Export') }}</label>
          <div><button type="button" class="btn sm" @click="exportCollectionOds">📄 {{ t('Export to ODS (spreadsheet)') }}</button></div>
          <div class="field-hint">{{ t('Download this collection as an OpenDocument spreadsheet (.ods).') }}</div>
        </div>
        </div>
        <div class="modal-foot">
          <button class="btn danger" v-if="collForm.id" @click="removeCollection">{{ t('Delete') }}</button>
          <span class="spacer"></span>
          <button class="btn" @click="modal=null">{{ t('Cancel') }}</button>
          <button class="btn primary" @click="saveCollection">{{ t('Save') }}</button>
        </div>
      </div>
    </div>

    <div class="modal-mask" v-if="modal==='formula'" @click.self="modal=null">
      <div class="modal wide">
        <div class="modal-head"><h3>{{ fForm.id ? t('Edit formula') : t('New formula') }}</h3><button class="icon-btn" @click="modal=null">✕</button></div>
        <div class="modal-body">
        <div class="field"><label>{{ t('Title') }}</label><input class="control" v-model="fForm.name" :placeholder="t('e.g. Selling price')"></div>
        <div class="field">
          <label>{{ t('Description') }}
            <span class="fb-md-tabs">
              <button type="button" class="btn xs" :class="{primary: !mdPreview}" @click="mdPreview=false">{{ t('Write') }}</button>
              <button type="button" class="btn xs" :class="{primary: mdPreview}" @click="mdPreview=true">{{ t('Preview') }}</button>
            </span>
          </label>
          <textarea v-if="!mdPreview" class="control" v-model="fForm.description" rows="4" :placeholder="t('Supports Markdown: **bold**, *italic*, lists, [links](https://…)')"></textarea>
          <div v-else class="fb-md-preview fb-md" v-html="md(fForm.description) || '<span class=&quot;empty-hint sm&quot;>—</span>'"></div>
        </div>
        <div class="field">
          <label>{{ t('Expression') }}</label>
          <input class="control mono" ref="exprInput" v-model="fForm.expression" @input="onExpr" placeholder="price * (1 + tax / 100)">
          <p class="fb-expr-hint">{{ t('Give each unknown a name, then combine them with the buttons below. Example: price * (1 + tax / 100)') }}</p>
          <div class="fb-pad">
            <div class="fb-pad-row" v-for="grp in pad" :key="grp.g">
              <button type="button" class="btn xs fb-pad-btn" v-for="it in grp.items" :key="it.l" @click="insertToken(it)">{{ it.l }}</button>
            </div>
            <div class="fb-pad-row fb-pad-vars" v-if="fForm.variables.some(v => v.key)">
              <span class="fb-pad-tag">{{ t('Variables') }}</span>
              <button type="button" class="btn xs fb-pad-btn var" v-for="v in fForm.variables.filter(x => x.key)" :key="'pv'+v.key" @click="insertToken({t:v.key})">{{ v.key }}</button>
            </div>
          </div>
          <div class="fb-expr-preview" v-if="fForm.expression.trim() && !fForm.exprError" v-html="mathml(fForm.expression)"></div>
        </div>
        <div class="field" v-if="fForm.exprError"><span class="err-msg">⚠ {{ te(fForm.exprError) }}</span></div>
        <div class="field">
          <label>{{ t('Variables') }} <button class="btn xs" @click="detectVars">{{ t('Detect from expression') }}</button></label>
          <div class="schema-row" v-for="(v,idx) in fForm.variables" :key="idx">
            <input class="control mono" v-model="v.key" :placeholder="t('key')" style="width:110px">
            <input class="control" v-model="v.label" :placeholder="t('label')">
            <input class="control" v-model="v.unit" :placeholder="t('unit')" style="width:80px">
            <input class="control" type="number" step="any" v-model="v.default" :placeholder="t('default')" style="width:90px">
            <button class="btn xs danger" @click="fForm.variables.splice(idx,1)">✕</button>
          </div>
          <button class="btn xs" @click="fForm.variables.push({key:'',label:'',unit:'',default:''})">＋ {{ t('Add variable') }}</button>
        </div>
        <div class="field frow">
          <span><label>{{ t('Result unit') }}</label><input class="control" v-model="fForm.result_unit" style="width:120px"></span>
          <span><label>{{ t('Decimals') }}</label><input class="control" type="number" min="0" max="10" v-model.number="fForm.decimals" style="width:90px"></span>
        </div>
        <div class="field"><label>{{ t('Notes') }}</label><textarea class="control" v-model="fForm.notes" rows="2"></textarea></div>
        </div>
        <div class="modal-foot">
          <span class="spacer"></span>
          <button class="btn" @click="modal=null">{{ t('Cancel') }}</button>
          <button class="btn primary" @click="saveFormula">{{ t('Save') }}</button>
        </div>
      </div>
    </div>

    <div class="modal-mask" v-if="modal==='templates'" @click.self="modal=null">
      <div class="modal wide">
        <div class="modal-head"><h3>📐 {{ t('Formula templates') }}</h3><button class="icon-btn" @click="modal=null">✕</button></div>
        <div class="modal-body">
        <p class="empty-hint sm">{{ t('Add a ready-made formula to the current collection.') }}</p>
        <div class="tpl-search">
          <span class="tpl-search-ic">🔍</span>
          <input class="control" type="search" v-model="tplSearch" :placeholder="t('Search templates (name, category, formula)…')" autocomplete="off">
          <button v-if="tplSearch" type="button" class="tpl-search-clear" @click="tplSearch=''" :title="t('Clear')">✕</button>
          <span class="tpl-search-count">{{ templateMatchCount }}</span>
        </div>
        <p v-if="!tplIndexLoaded" class="empty-hint sm">{{ t('Loading templates…') }}</p>
        <p v-else-if="!templatesByCat.length" class="empty-hint sm">{{ t('No templates match your search.') }}</p>
        <div class="tpl-groups">
          <div class="tpl-group" v-for="g in templatesByCat" :key="g.cat" :class="{ open: isGroupOpen(g.cat) }">
            <button type="button" class="tpl-group-h" @click="toggleGroup(g.cat)" :aria-expanded="isGroupOpen(g.cat) ? 'true' : 'false'">
              <span class="tpl-group-caret">▶</span>
              <span class="tpl-group-ic">{{ catIcon(g.cat) }}</span>
              <span class="tpl-group-title">{{ t(g.cat) }}</span>
              <span class="tpl-group-n">{{ g.items.length }}</span>
            </button>
            <div class="tpl-grid" v-if="isGroupOpen(g.cat)">
              <p v-if="!tplCache[g.cat]" class="empty-hint sm">{{ t('Loading…') }}</p>
              <div class="tpl-card" v-for="tp in catItems(g)" :key="tp.name">
                <div class="tpl-card-h">
                  <button class="tpl-add" @click="addTemplate(tp)" :title="t('Add')" :aria-label="t('Add')">＋</button>
                  <div class="tpl-name">{{ t(tp.name) }}</div>
                  <span class="badge-outline" v-if="isReversible(tp)" :title="t('This formula can be reverse-calculated (solve for a variable from the result).')">⇄ {{ t('Reversible') }}</span>
                </div>
                <div class="tpl-expr" v-html="mathml(tp.expression)"></div>
                <div class="tpl-desc fb-md" v-if="tp.description" v-html="md(t(tp.description))"></div>
              </div>
            </div>
          </div>
        </div>
        </div>
        <div class="modal-foot">
          <span class="spacer"></span>
          <button class="btn" @click="modal=null">{{ t('Close') }}</button>
        </div>
      </div>
    </div>

    <div class="modal-mask" v-if="modal==='settings'" @click.self="modal=null">
      <div class="modal">
        <div class="modal-head"><h3>{{ t('⚙️ Settings') }}</h3><button class="icon-btn" @click="cancelSettings">✕</button></div>
        <div class="modal-body settings-body">
          <div class="field">
            <label>🌗 {{ t('Theme') }}</label>
            <div class="radios">
              <label><input type="radio" value="auto" v-model="settingsForm.theme" @change="previewTheme"> {{ t('Default (match Nextcloud)') }}</label>
              <label><input type="radio" value="light" v-model="settingsForm.theme" @change="previewTheme"> {{ t('Light') }}</label>
              <label><input type="radio" value="dark" v-model="settingsForm.theme" @change="previewTheme"> {{ t('Dark') }}</label>
            </div>
          </div>
          <div class="field" style="margin-top:16px">
            <label>🌐 {{ t('Language') }}</label>
            <select v-model="settingsForm.language">
              <option value="auto">{{ t('System default (match Nextcloud)') }}</option>
              <option v-for="lg in languages" :key="lg.code" :value="lg.code">{{ lg.name }}</option>
            </select>
            <div class="field-hint">{{ t('The display language switches when you press “Save”.') }}</div>
          </div>
          <div class="field" style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
            <label>💾 {{ t('Backup / Restore') }}</label>
            <div class="field-hint" style="margin-bottom:8px">{{ t('Save all your collections and formulas to a ZIP file, or restore them from one.') }}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" class="btn sm" @click="openBackup">💾 {{ t('Download all data') }}</button>
              <button type="button" class="btn sm" @click="openRestore">♻ {{ t('Restore from backup') }}</button>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <span class="spacer"></span>
          <button class="btn" @click="cancelSettings">{{ t('Cancel') }}</button>
          <button class="btn primary" @click="saveSettings">{{ t('Save') }}</button>
        </div>
      </div>
    </div>

    <div class="modal-mask" v-if="modal && modal.type==='backup'" @click.self="!backupForm.busy && (modal=null)">
      <div class="modal">
        <div class="modal-head"><h3>{{ t('💾 Download all data') }}</h3><button class="icon-btn" :disabled="backupForm.busy" @click="modal=null">✕</button></div>
        <form class="modal-body" @submit.prevent="doBackup">
          <p style="margin-top:0;font-size:13px;color:var(--muted)">{{ t('Optionally set a password to encrypt the ZIP. Leave it blank for a plain (unencrypted) archive.') }}</p>
          <div class="field"><label>{{ t('Password (optional)') }}</label><input type="password" v-model="backupForm.password" autocomplete="new-password" :placeholder="t('Blank = no encryption')"></div>
          <div v-if="backupForm.err" style="color:var(--danger);font-size:13px">{{ backupForm.err }}</div>
          <div v-if="backupForm.busy" style="font-size:13px;color:var(--muted)">{{ t('Creating…') }}</div>
        </form>
        <div class="modal-foot">
          <button class="btn" :disabled="backupForm.busy" @click="modal=null">{{ t('Cancel') }}</button>
          <button class="btn primary" :disabled="backupForm.busy" @click="doBackup">{{ t('Download') }}</button>
        </div>
      </div>
    </div>

    <div class="modal-mask" v-if="modal && modal.type==='restore'" @click.self="!restoreForm.busy && (modal=null)">
      <div class="modal">
        <div class="modal-head"><h3>{{ t('♻ Restore from backup') }}</h3><button class="icon-btn" :disabled="restoreForm.busy" @click="modal=null">✕</button></div>
        <div class="modal-body">
          <label class="filepick">
            <input type="file" accept=".zip" @change="onRestoreFile">
            <span class="btn sm">{{ t('📄 Choose file') }}</span>
            <span class="filepick-name">{{ restoreForm.fileName || t('Backup file (.zip)') }}</span>
          </label>
          <div class="field" style="margin-top:12px"><label>{{ t('Password (only if the backup has one)') }}</label><input type="password" v-model="restoreForm.password" autocomplete="new-password"></div>
          <div class="field">
            <label>{{ t('Restore method') }}</label>
            <div class="radios">
              <label><input type="radio" value="overwrite" v-model="restoreForm.mode"> {{ t('Overwrite (delete and replace existing data)') }}</label>
              <label><input type="radio" value="merge" v-model="restoreForm.mode"> {{ t('Merge (import only non-duplicate formulas)') }}</label>
              <label><input type="radio" value="add" v-model="restoreForm.mode"> {{ t('Add (as new collections)') }}</label>
            </div>
          </div>
          <template v-if="restoreForm.mode==='overwrite'">
            <p style="color:var(--danger);font-size:13px;background:color-mix(in srgb,var(--danger) 12%,transparent);padding:8px 10px;border-radius:8px">{{ t('⚠️ Overwriting replaces ALL existing data (collections and formulas).') }}</p>
            <label class="confirm-check"><input type="checkbox" v-model="restoreForm.confirm"> {{ t('I understand the above and confirm the restore') }}</label>
          </template>
          <div v-if="restoreForm.err" style="color:var(--danger);font-size:13px;margin-top:8px">{{ restoreForm.err }}</div>
          <div v-if="restoreForm.busy" style="font-size:13px;color:var(--muted);margin-top:8px">{{ t('Restoring…') }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn" :disabled="restoreForm.busy" @click="modal=null">{{ t('Cancel') }}</button>
          <button class="btn" :class="restoreForm.mode==='overwrite' ? 'danger' : 'primary'" :disabled="restoreForm.busy || (restoreForm.mode==='overwrite' && !restoreForm.confirm)" @click="doRestore">{{ t('Restore') }}</button>
        </div>
      </div>
    </div>

    <div class="fb-toast" :class="'fb-toast-'+toast.kind" v-if="toast" role="status">{{ toast.msg }}</div>
  </div>`;

  createApp({
    template: TEMPLATE,
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
        toast: null,
        copiedKey: null,
        modal: null,
        collForm: { id: null, name: '', icon: '🧮', color: '#2563eb', description: '' },
        fForm: { id: null, name: '', expression: '', description: '', variables: [], result_unit: '', decimals: 2, notes: '', exprError: '' },
        mdPreview: false,
        // settings (theme mode + UI language), mirrors RegiBase
        locale: 0,
        theme: 'auto',
        language: 'auto',
        languages: [{ code: 'auto', name: 'Nextcloud' }],
        settingsForm: { theme: 'auto', language: 'auto' },
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
      stepData() {
        const f = this.activeFormula; if (!f) return null;
        const scope = this.scopeFor(f); if (!scope) return null;
        let ast; try { ast = parseAST(f.expression); } catch (e) { return null; }
        const nodes = [ast];
        let cur = subst(ast, scope);
        nodes.push(cur);
        let last = pr(cur); let guard = 0;
        while (cur.type !== 'num' && guard < 200) { const [nx, ch] = reduceStep(cur); if (!ch) break; cur = nx; const s = pr(cur); if (s !== last) { nodes.push(cur); last = s; } guard++; }
        return { nodes, value: cur.type === 'num' ? cur.v : null };
      },
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
      },
      async loadSettings() {
        try {
          const s = await api('settings');
          this.theme = s.theme || 'auto';
          this.language = s.language || 'auto';
          this.languages = s.languages || this.languages;
          this.applyTheme();
          await this.applyLanguage(this.language);
        } catch (e) { this.applyTheme(); }
      },
      openSettings() { this._themeBefore = this.theme; this.settingsForm = { theme: this.theme, language: this.language }; this.modal = 'settings'; },
      cancelSettings() { this.theme = this._themeBefore || 'auto'; this.applyTheme(); this.modal = null; },
      async saveSettings() {
        try {
          const s = await api('settings', { method: 'PUT', body: JSON.stringify({ theme: this.settingsForm.theme, language: this.settingsForm.language }) });
          this.theme = s.theme || 'auto';
          this.language = s.language || 'auto';
          this.languages = s.languages || this.languages;
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
        this.fForm = f
          ? { id: f.id, name: f.name, expression: f.expression, description: f.description || '', variables: JSON.parse(JSON.stringify(f.variables || [])), result_unit: f.result_unit, decimals: f.decimals, notes: f.notes, exprError: '' }
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
          const body = JSON.stringify({ name: tp.name, expression: tp.expression, description: tp.description || '', variables: tp.variables, result_unit: tp.result_unit || '', decimals: tp.decimals == null ? 2 : tp.decimals, notes: tp.notes || '' });
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
