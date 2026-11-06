// Evaluate cases with FormulaBase's own JS engine (js/formulabase.js, or FORMULABASE_JS), read from disk, unchanged.
// node js_engine.cjs cases.json out.json   (cases: [{id, expr, vars}] -> {id: number | 'NaN' | 'INF' | '-INF' | 'ERR:..'})
const fs = require('fs'), vm = require('vm');
let src = fs.readFileSync(process.env.FORMULABASE_JS || require('path').join(__dirname, '..', 'js', 'formulabase.js'), 'utf8');
const end = src.lastIndexOf('})();');
src = src.slice(0, end) + 'globalThis.__fb = { parseAST, evalTop, parseValue };\n' + src.slice(end);
const chain = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : chain, apply: () => chain });
const win = { __FormulaBaseVue: { createApp: () => chain, reactive: (x) => x, ref: (x) => ({ value: x }), computed: (f) => ({ value: undefined }), watch: () => {}, nextTick: (f) => f && f(), h: () => null }, OC: null, t: undefined, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
const ctx = { window: win, document: { getElementsByTagName: () => [], addEventListener() {}, documentElement: { setAttribute() {}, style: {} }, querySelector: () => null, createElement: () => chain, body: chain }, navigator: { language: 'en' }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} }, console, setTimeout, clearTimeout, setInterval: () => 0, fetch: async () => ({ ok: false, headers: { get: () => '' } }), Date, Math, JSON, Number, String, Array, Object, Error, Map, Set, Symbol, Proxy, RegExp, isFinite, isNaN, parseFloat, parseInt, BigInt, Intl, Promise };
ctx.globalThis = ctx; ctx.self = win;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const fb = ctx.__fb;
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
const enc = (v) => {
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : v === Infinity ? 'INF' : v === -Infinity ? '-INF' : v;
  if (Array.isArray(v)) return 'LIST';
  if (v && typeof v === 'object' && 're' in v) return 'CX';
  if (typeof v === 'boolean') return v ? 1 : 0;
  return 'OTHER:' + String(v);
};
for (const c of cases) {
  try {
    const scope = {};
    for (const [k, v] of Object.entries(c.vars || {})) scope[k] = typeof v === 'number' ? v : fb.parseValue(String(v));
    out[c.id] = enc(fb.evalTop(fb.parseAST(c.expr), scope));
  } catch (e) { out[c.id] = 'ERR:' + String(e.message || e).slice(0, 60); }
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
