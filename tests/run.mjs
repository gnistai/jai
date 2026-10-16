#!/usr/bin/env node
// Conformance runner for the JAI fixtures in tests/<class>/<class>.json.
//
//   node tests/run.mjs                 run every class against the reference implementation
//   node tests/run.mjs parse json      run selected classes
//   node tests/run.mjs --impl ./x.mjs  run against another ES module exposing the same API
//   node tests/run.mjs --verbose       print every failure in full
//
// Exit code is non-zero when any fixture fails. A non-normative round-trip fuzz
// test runs after the fixtures (skip with --no-fuzz).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const implIdx = args.indexOf('--impl');
const implPath = implIdx >= 0 ? resolve(args[implIdx + 1]) : join(here, '..', 'docs', 'assets', 'js', 'jai.js');
const J = await import(pathToFileURL(implPath).href);
const selected = args.filter((a, i) => !a.startsWith('--') && (implIdx < 0 || i !== implIdx + 1));
const VERBOSE = flag('--verbose');

const BASE = 'https://example.test/page/';
// Mirrors the diagnostics table rows whose class includes `interpreter`.
const INTERPRETER_CODES = new Set(['repeated-single', 'invalid-value', 'adjusted-value', 'ignored-value', 'invalid-image', 'unsupported-preview', 'no-matching-model', 'substituted-model', 'version-ignored', 'mode-degraded']);

// ---------------------------------------------------------------- comparison helpers

const show = v => JSON.stringify(v, (k, x) => (x instanceof Map ? Object.fromEntries(x) : x));

function docEquals(actualMap, expected) {
  const a = J.toObject(actualMap);
  const ka = Object.keys(a).sort(), ke = Object.keys(expected).sort();
  if (ka.length !== ke.length || ka.some((k, i) => k !== ke[i])) return false;
  for (const k of ka) {
    const x = a[k], y = expected[k];
    if (x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
  }
  return true;
}

/** expected: ["code", "code:key"]; exact multiset on codes; keys checked when given. */
function diagsEqual(actual, expected, { filter = null } = {}) {
  const act = actual.filter(d => !filter || filter.has(d.code));
  const exp = expected;
  if (act.length !== exp.length) return false;
  const pool = act.slice();
  for (const e of exp) {
    const [code, key] = e.split(':');
    const i = pool.findIndex(d => d.code === code && (key === undefined || d.key === key));
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

function hasNone(actual, forbidden) {
  return !forbidden.some(e => { const [code, key] = e.split(':'); return actual.some(d => d.code === code && (key === undefined || d.key === key)); });
}

function hasAll(actual, expected) {
  return expected.every(e => {
    const [code, key] = e.split(':');
    return actual.some(d => d.code === code && (key === undefined || d.key === key));
  });
}

const fmtDiags = ds => ds.map(d => d.code + (d.key ? ':' + d.key : '')).join(', ') || '(none)';
const b64 = s => new Uint8Array(Buffer.from(s, 'base64'));

// ---------------------------------------------------------------- tiny HTML fragment parser (fixtures only)

const ENT = { amp: '&', quot: '"', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0' };
const decodeEntities = s => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});
const VOID = new Set(['img', 'source', 'br', 'hr', 'meta', 'link', 'input']);

class El {
  constructor(name, attrs, parent) { this.localName = name; this.attrs = attrs; this.parentElement = parent; this.children = []; this.ownerDocument = { baseURI: BASE }; this.shadowRoot = null; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  getAttributeNames() { return Object.keys(this.attrs); }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) { const all = [...this.walk()]; return sel === '*' ? all : all.filter(e => e.localName === sel); }
}

function parseHTML(html) {
  const root = new El('#root', {}, null);
  let cur = root, i = 0;
  while (i < html.length) {
    if (html.startsWith('</', i)) {
      const j = html.indexOf('>', i); const name = html.slice(i + 2, j).trim().toLowerCase();
      if (name === 'template' && cur.localName === '#shadow-root') { cur = cur.outer; i = j + 1; continue; }
      let n = cur; while (n && n.localName !== name) n = n.parentElement;
      if (n) cur = n.container || root;
      i = j + 1; continue;
    }
    if (html[i] === '<') {
      const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i));
      if (!m) { i++; continue; }
      const name = m[1].toLowerCase(); i += m[0].length;
      const attrs = {};
      const re = /\s*([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
      for (;;) {
        re.lastIndex = i;
        if (html[i] === '>' || html.startsWith('/>', i)) break;
        const a = re.exec(html); if (!a) break;
        attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
        i = re.lastIndex;
        while (html[i] === ' ' || html[i] === '\n' || html[i] === '\t') i++;
      }
      if (html.startsWith('/>', i)) i += 2; else i += 1;
      if (name === 'template' && attrs.shadowrootmode) {
        // Declarative shadow root: its content becomes the parent's shadow tree (closed ones are inaccessible).
        const sr = new El('#shadow-root', {}, null);
        sr.host = cur;
        if (attrs.shadowrootmode === 'open' && cur !== root) cur.shadowRoot = sr;
        sr.outer = cur;
        cur = sr;
        continue;
      }
      const el = new El(name, attrs, cur === root || cur.localName === '#shadow-root' ? null : cur);
      el.container = cur;
      cur.children.push(el);
      if (!VOID.has(name)) cur = el;
      continue;
    }
    i++;
  }
  return root;
}

// ---------------------------------------------------------------- runners per class

const runners = {
  parse(c) {
    const r = J.parse(c.input);
    const errs = [];
    if (!docEquals(r.document, c.document)) errs.push(`document ${show(r.document)} != ${show(c.document)}`);
    if (!diagsEqual(r.diagnostics, c.diagnostics)) errs.push(`diagnostics [${fmtDiags(r.diagnostics)}] != [${c.diagnostics.join(', ')}]`);
    if (c.advisories || c.no_advisories) {
      const v = J.validate(r.document, r.info);
      if (c.advisories && !hasAll(v, c.advisories)) errs.push(`advisories [${fmtDiags(v)}] missing some of [${c.advisories.join(', ')}]`);
      if (c.no_advisories && !hasNone(v, c.no_advisories)) errs.push(`advisories [${fmtDiags(v)}] include one of [${c.no_advisories.join(', ')}]`);
    }
    return errs;
  },
  async serialize(c) {
    const doc = J.fromObject(c.document);
    const errs = [];
    const text = J.serialize(doc);
    if (text !== c.text) errs.push(`text ${show(text)} != ${show(c.text)}`);
    if (c.bare !== undefined) { const b = J.serialize(doc, { bare: true }); if (b !== c.bare) errs.push(`bare ${show(b)} != ${show(c.bare)}`); }
    const json = J.canonicalJSON(doc);
    if (json !== c.json) errs.push(`json ${show(json)} != ${show(c.json)}`);
    if (c.url !== undefined) { const u = J.toDataURL(doc); if (u !== c.url) errs.push(`url ${show(u)} != ${show(c.url)}`); }
    const id = await J.identity(doc);
    if (id !== c.identity) errs.push(`identity ${id} != ${c.identity}`);
    const back = J.parse(text);
    if (!docEquals(back.document, c.document)) errs.push(`canonical text does not parse back: ${show(back.document)}`);
    return errs;
  },
  async roundtrip(c) {
    const doc = J.fromObject(c.document);
    const errs = [];
    if (!docEquals(doc, c.document)) return [`fixture document is not normalised: ${show(doc)}`];
    for (const bare of [false, true]) {
      const text = J.serialize(doc, { bare });
      const back = J.parse(text);
      if (!docEquals(back.document, c.document)) errs.push(`${bare ? 'bare ' : ''}text ${show(text)} parses to ${show(back.document)}`);
      const again = J.serialize(back.document, { bare });
      if (again !== text) errs.push(`${bare ? 'bare ' : ''}not a fixed point: ${show(again)}`);
      const url = J.toDataURL(doc);
      const fromUrl = J.decodeDataURL(url);
      if (!fromUrl || !docEquals(fromUrl.document, c.document)) errs.push(`data URL ${show(url)} decodes to ${show(fromUrl && fromUrl.document)}`);
    }
    const json = J.canonicalJSON(doc);
    const rj = J.readJSON(json);
    if (!docEquals(rj.document, c.document)) errs.push(`canonical JSON reads back as ${show(rj.document)}`);
    if (J.canonicalJSON(rj.document) !== json) errs.push('canonical JSON is not a fixed point');
    const file = await J.encode(doc);
    const dec = J.decode(file);
    if (!docEquals(dec.document, c.document) || dec.form !== 'gzip') errs.push(`file form decodes to ${show(dec.document)} (${dec.form}) [${fmtDiags(dec.diagnostics)}]`);
    return errs;
  },
  json(c) {
    const r = J.readJSON(c.input, { inContext: c.context !== false });
    const errs = [];
    if (!docEquals(r.document, c.document)) errs.push(`document ${show(r.document)} != ${show(c.document)}`);
    if (!diagsEqual(r.diagnostics, c.diagnostics)) errs.push(`diagnostics [${fmtDiags(r.diagnostics)}] != [${c.diagnostics.join(', ')}]`);
    return errs;
  },
  decode(c) {
    const opts = { inContext: c.context !== false };
    if (c.bound) opts.maxInflate = c.bound;
    const r = J.decode(b64(c.bytes), opts);
    const errs = [];
    if (!docEquals(r.document, c.document)) errs.push(`document ${show(r.document)} != ${show(c.document)}`);
    if (!diagsEqual(r.diagnostics, c.diagnostics)) errs.push(`diagnostics [${fmtDiags(r.diagnostics)}] != [${c.diagnostics.join(', ')}]`);
    if (c.advisories || c.no_advisories) {
      const v = J.validateDelivery({ decoded: r });
      if (c.advisories && !hasAll(v, c.advisories)) errs.push(`advisories [${fmtDiags(v)}] missing some of [${c.advisories.join(', ')}]`);
      if (c.no_advisories && !hasNone(v, c.no_advisories)) errs.push(`advisories [${fmtDiags(v)}] include one of [${c.no_advisories.join(', ')}]`);
    }
    return errs;
  },
  url(c) {
    const r = c.kind === 'data' ? J.decodeDataURL(c.url) : J.fromQuery(c.url, c.kind);
    if (c.discovered === false) return r ? [`expected no document, got ${show(r.document)}`] : [];
    if (!r) return ['no document found'];
    const errs = [];
    if (!docEquals(r.document, c.document)) errs.push(`document ${show(r.document)} != ${show(c.document)}`);
    if (!diagsEqual(r.diagnostics, c.diagnostics)) errs.push(`diagnostics [${fmtDiags(r.diagnostics)}] != [${c.diagnostics.join(', ')}]`);
    return errs;
  },
  html(c) {
    const root = parseHTML(c.html);
    const found = J.discoverAll(root, { baseURL: BASE });
    const errs = [];
    if (found.length !== c.discovered.length) return [`discovered ${found.length} carriers, expected ${c.discovered.length}: ${show(found.map(f => ({ carrier: f.carrier, document: f.document, url: f.url })))}`];
    c.discovered.forEach((e, n) => {
      const f = found[n];
      if (f.carrier !== e.carrier) errs.push(`#${n}: carrier ${f.carrier} != ${e.carrier}`);
      if (e.url !== undefined) {
        const want = new URL(e.url, BASE).href;
        if (f.url !== want) errs.push(`#${n}: url ${f.url} != ${want}`);
      } else {
        if (!f.document || !docEquals(f.document, e.document)) errs.push(`#${n}: document ${show(f.document)} != ${show(e.document)}`);
        if (!diagsEqual(f.diagnostics || [], e.diagnostics || [])) errs.push(`#${n}: diagnostics [${fmtDiags(f.diagnostics || [])}] != [${(e.diagnostics || []).join(', ')}]`);
      }
    });
    if (c.advisories || c.no_advisories) {
      const all = found.flatMap(f => [...J.validateDelivery({ carrier: f.carrier, element: f.element, decoded: f.document ? { document: f.document } : null }), ...(f.document ? J.validate(f.document, f.info) : [])]);
      if (c.advisories && !hasAll(all, c.advisories)) errs.push(`advisories [${fmtDiags(all)}] missing some of [${c.advisories.join(', ')}]`);
      if (c.no_advisories && !hasNone(all, c.no_advisories)) errs.push(`advisories [${fmtDiags(all)}] include one of [${c.no_advisories.join(', ')}]`);
    }
    return errs;
  },
  interpret(c) {
    const doc = J.fromObject(c.document);
    const r = J.interpret(doc, { catalog: c.catalog || [], families: c.families || {}, hasOriginal: !!c.has_original, governingRatio: c.governing_ratio ?? null, selected: c.selected ?? null });
    const it = r.interpreted;
    const errs = [];
    for (const [k, want] of Object.entries(c.interpreted)) {
      let got;
      if (k === 'aspect') got = it.aspect == null ? null : it.aspect.kind === 'keyword' ? it.aspect.keyword : it.aspect.width / it.aspect.height;
      else if (k === 'model') got = it.matched ?? null;
      else got = it[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
      const ok = typeof want === 'number' && typeof got === 'number' ? Math.abs(want - got) < 1e-9 : Array.isArray(want) ? JSON.stringify(want) === JSON.stringify(got) : want === got;
      if (!ok) errs.push(`${k}: ${show(got)} != ${show(want)}`);
    }
    if (!diagsEqual(r.diagnostics, c.diagnostics, { filter: INTERPRETER_CODES })) errs.push(`diagnostics [${fmtDiags(r.diagnostics.filter(d => INTERPRETER_CODES.has(d.code)))}] != [${c.diagnostics.join(', ')}]`);
    return errs;
  },
};

// ---------------------------------------------------------------- main

let total = 0, failed = 0;
const classes = readdirSync(here).filter(d => existsSync(join(here, d, d + '.json')));
for (const cls of classes) {
  if (selected.length && !selected.includes(cls)) continue;
  const suite = JSON.parse(readFileSync(join(here, cls, cls + '.json'), 'utf8'));
  let clsFailed = 0;
  for (const c of suite.cases) {
    total++;
    let errs;
    try { errs = await runners[cls](c); } catch (e) { errs = ['threw: ' + (e && e.stack || e)]; }
    if (errs.length) {
      failed++; clsFailed++;
      console.log(`FAIL ${cls}/${c.id}: ${VERBOSE ? errs.join('\n    ') : errs[0]}`);
    }
  }
  console.log(`${clsFailed ? '✗' : '✓'} ${cls}: ${suite.cases.length - clsFailed}/${suite.cases.length}`);
}

// Non-normative property test: random documents round-trip through every form.
if (!flag('--no-fuzz') && (!selected.length || selected.includes('fuzz'))) {
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const atoms = [';', '=', '\\', ' ', '\t', '\n', 'jai:', 'JAI:', 'prompt=', 'style=', 'k =', '\u00a0', '\u3000', '\u2028', '\ufeff', '{', '%', '#', ',', 'a', 'Z', '0', 'é', '魔', '🏰', 'data:image/png;base64,iVBOR=', 'x;charset=utf-8', 'C:\\Users', '/', 'a/b=', 'Prompt/X =', ' x.y/z='];
  const keys = ['prompt', 'style', 'avoid', 'model', 'k', 'a.b', 'x-y', 'z_1', 'comfy.sampler', 'prompt/flux', 'style/sdxl', 'x.y/z'];
  let fz = 0;
  const N = 20000;
  for (let n = 0; n < N; n++) {
    const obj = {};
    const nk = 1 + rnd(4);
    for (let i = 0; i < nk; i++) {
      const key = keys[rnd(keys.length)];
      const vals = obj[key] || (obj[key] = []);
      let v = '';
      const na = 1 + rnd(6);
      for (let a = 0; a < na; a++) v += atoms[rnd(atoms.length)];
      vals.push(v);
    }
    const doc = J.fromObject(obj);
    for (const bare of [false, true]) {
      const t = J.serialize(doc, { bare });
      const back = J.parse(t).document;
      if (!J.documentsEqual(back, doc) || J.serialize(back, { bare }) !== t) {
        fz++;
        if (fz <= 5) console.log(`FUZZ ${bare ? 'bare ' : ''}${show(doc)} -> ${show(t)} -> ${show(back)}`);
      }
    }
    const url = J.toDataURL(doc);
    const u = J.decodeDataURL(url);
    if (!u || !J.documentsEqual(u.document, doc)) { fz++; if (fz <= 5) console.log(`FUZZ url ${show(doc)} -> ${url}`); }
    const rj = J.readJSON(J.canonicalJSON(doc)).document;
    if (!J.documentsEqual(rj, doc)) { fz++; if (fz <= 5) console.log(`FUZZ json ${show(doc)}`); }
  }
  console.log(`${fz ? '✗' : '✓'} fuzz (non-normative): ${N} random documents, ${fz} failures`);
  if (fz) failed++;
}

console.log(failed ? `\n${failed} failing` : `\nall ${total} fixtures pass`);
process.exit(failed ? 1 : 0);
