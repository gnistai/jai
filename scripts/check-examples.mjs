#!/usr/bin/env node
// Checks every example table inside div.example in spec/index.bs against the
// reference implementation, so that spec examples cannot silently drift.
// (Adapted from the round-2 review tooling.) Exit code 1 on any mismatch.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = await import(join(ROOT, 'docs', 'assets', 'js', 'jai.js'));
const src = readFileSync(ROOT + '/spec/index.bs', 'utf8');
const examples = {};
for (const m of src.matchAll(/<div class=example id=([\w-]+)>([\s\S]*?)<\/div>/g)) examples[m[1]] = m[2];

const unescape = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function rows(body) {
  // HTML tables: one <tr> per line; cells start with <td>; <code>x</code> becomes `x`.
  return body.split('\n').filter(l => l.startsWith('<tr><td>')).map(l =>
    l.slice('<tr><td>'.length).split('<td>').map(c => unescape(c.replace(/<code>([\s\S]*?)<\/code>/g, (m, x) => '`' + x + '`')).trim()));
}
const code = s => { const m = /^`([^`]*)`/.exec(s); return m ? m[1] : null; };
// parse "key = `a`, `b`; key2 = `c`" -> {key:[...]}; "empty" -> {}
function docOf(cell) {
  if (/^empty/.test(cell)) return {};
  const out = {}; let rest = cell;
  const re = /^\s*([a-z0-9][a-z0-9_.-]*) = /;
  while (true) {
    const m = re.exec(rest); if (!m) break;
    rest = rest.slice(m[0].length);
    const vals = [];
    for (;;) {
      const vm = /^`([^`]*)`((?: U\+[0-9A-F]{4} `[^`]*`)*)/.exec(rest);
      if (!vm) break;
      let v = vm[1];
      for (const j of vm[2].matchAll(/ U\+([0-9A-F]{4}) `([^`]*)`/g)) v += String.fromCodePoint(parseInt(j[1], 16)) + j[2];
      vals.push(v); rest = rest.slice(vm[0].length);
      if (rest.startsWith(', `')) { rest = rest.slice(2); continue; }
      break;
    }
    out[m[1]] = vals;
    if (rest.startsWith('; ')) rest = rest.slice(2); else break;
  }
  return out;
}
const show = o => JSON.stringify(o);
const eq = (a, b) => show(Object.fromEntries(Object.entries(a).sort())) === show(Object.fromEntries(Object.entries(b).sort()));
const codesOf = cell => (cell.match(/`([a-z-]+)`(?: ×(\d))?/g) || []).flatMap(t => { const m = /`([a-z-]+)`(?: ×(\d))?/.exec(t); return Array(+(m[2] || 1)).fill(m[1]); });
const fmt = ds => ds.map(d => d.code + (d.key ? ':' + d.key : '')).join(',');
let bad = 0;
const report = (id, ok, msg) => { console.log(`${ok ? 'OK  ' : 'BAD '} ${id}: ${msg}`); if (!ok) bad++; };

for (const r of rows(examples['ex-text-structure'])) {
  const input = code(r[0]); const want = docOf(r[1]); const got = J.toObject(J.parse(input).document);
  if (r[1].startsWith('prose')) { report('ex-text-structure', true, `${show(input)} -> ${show(got)} [prose row, no doc given: ${r[1]}]`); continue; }
  report('ex-text-structure', eq(got, want), `${show(input)} -> ${show(got)} want ${show(want)}`);
}
for (const r of rows(examples['ex-parse-edge'])) {
  const input = code(r[0]); const want = docOf(r[1]); const p = J.parse(input); const got = J.toObject(p.document);
  const wc = codesOf(r[2]).sort().join(','); const gc = p.diagnostics.map(d => d.code).sort().join(',');
  report('ex-parse-edge', eq(got, want) && wc === gc, `${show(input)} -> ${show(got)} [${gc}] want ${show(want)} [${wc}]`);
}
for (const r of rows(examples['ex-canonical'])) {
  const doc = docOf(r[0]); const want = code(r[1]); const got = J.serialize(J.fromObject(doc));
  const back = J.toObject(J.parse(want).document);
  report('ex-canonical', got === want, `${show(doc)} -> ${show(got)} want ${show(want)}; parsing the spec's text gives ${show(back)}`);
}
for (const r of rows(examples['ex-json-reading'])) {
  const input = code(r[0]); const want = docOf(r[1]); const inCtx = true;
  const p = J.readJSON(input, { inContext: inCtx }); const got = J.toObject(p.document);
  const wc = codesOf(r[2]).sort().join(','); const gc = p.diagnostics.map(d => d.code).sort().join(',');
  report('ex-json-reading', eq(got, want) && wc === gc, `${input} -> ${show(got)} [${fmt(p.diagnostics)}] want ${show(want)} [${wc}]`);
}
// decode table: construct bytes by hand
const enc = s => new TextEncoder().encode(s);
const gz = s => new Uint8Array(gzipSync(enc(s)));
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
const decodeRows = [
  ['gzip {"jai":1,"prompt":"A castle"}', gz('{"jai":1,"prompt":"A castle"}'), { prompt: ['A castle'] }, ''],
  ['two gzip members', cat(gz('{"jai":1,"prompt":"A castle"}'), gz('{"jai":1,"prompt":"A castle"}')), {}, 'malformed-container'],
  ['gzip jai:A castle', gz('jai:A castle'), {}, 'malformed-container'],
  ['uncompressed JSON', enc('{"jai":1,"prompt":"A castle"}'), { prompt: ['A castle'] }, ''],
  ['{masterpiece}, a castle', enc('{masterpiece}, a castle'), { prompt: ['{masterpiece}, a castle'] }, ''],
  ['{"quoted"} prose', enc('{"quoted"} prose'), {}, 'invalid-json'],
  ['UTF-16LE BOM jai', new Uint8Array([0xff, 0xfe, 0x6a, 0x00, 0x61, 0x00]), {}, 'undecodable'],
  ['PNG bytes', png, {}, 'undecodable'],
  ['jai:A castle', enc('jai:A castle'), { prompt: ['A castle'] }, ''],
];
for (const [label, bytes, want, wc] of decodeRows) {
  const r = J.decode(bytes); const got = J.toObject(r.document); const gc = r.diagnostics.map(d => d.code).join(',');
  report('ex-decode', eq(got, want) && gc === wc, `${label} -> ${show(got)} [${gc}] form=${r.form} want ${show(want)} [${wc}]` + (label.startsWith('uncompressed') ? ` validateDelivery=[${fmt(J.validateDelivery({ decoded: r }))}]` : ''));
}
console.log(`\n${bad} bad`);
process.exitCode = bad ? 1 : 0;
