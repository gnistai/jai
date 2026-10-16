/*
 * jai.js — reference implementation of JAI (Just AI Images), edition 1.0-draft.
 *
 * Dependency-free ES module for browsers and Node 18+. Implements the text
 * form (parse, canonical serialise), the JSON form (read, canonical JSON,
 * identity), the file form (gzip decode with a built-in inflater, encode),
 * data: URL and query carriers, HTML discovery, parameter interpretation
 * and model matching, and an advisory validator.
 *
 * Specification: https://jai.gnist.ai/spec/   Repository: github.com/gnistai/jai
 * This file is released under CC0-1.0.
 */

export const EDITION = '1.0-draft';
export const MEDIA_TYPE = 'image/jai';

/* ------------------------------------------------------------------ *
 * Character classes and small helpers
 * ------------------------------------------------------------------ */

/** The 25 code points with the Unicode White_Space property, as a regex class body. */
export const WS_CLASS = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WS_RE = new RegExp(`[${WS_CLASS}]`);
const WS_ONLY_RE = new RegExp(`^[${WS_CLASS}]*$`);
const TRIM_RE = new RegExp(`^[${WS_CLASS}]+|[${WS_CLASS}]+$`, 'g');
const LEADING_WS_RE = new RegExp(`^[${WS_CLASS}]*`);

const KEY_SRC = '[a-z0-9][a-z0-9_-]*(?:\\.[a-z0-9][a-z0-9_-]*)*(?:/[a-z0-9][a-z0-9_-]*)?';
/** Names that take a per-model target (spec §Per-model refinements). */
export const QUALIFIABLE = new Set(['prompt', 'style', 'avoid']);
/** The key grammar (lowercase). */
export const KEY_RE = new RegExp(`^${KEY_SRC}$`);
const ASSIGNMENT_PATTERN_RE = new RegExp(`^[${WS_CLASS}]*${KEY_SRC}[${WS_CLASS}]*=`, 'i');
const ESCAPE_VALUE_RE = new RegExp(`\\\\(?=[;=\\\\]|$)|^;|;(?=[${WS_CLASS}]*(?:$|;|${KEY_SRC}[${WS_CLASS}]*=))`, 'gi');

export const STANDARD_KEYS = ['prompt', 'style', 'avoid', 'model', 'aspect', 'mode', 'strength', 'seed', 'source', 'preview', 'animate'];
export const SINGLE_VALUED = new Set(['aspect', 'mode', 'strength', 'seed', 'source', 'preview', 'animate']);
export const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

/** Trim exactly the JAI whitespace code points. */
export function trim(s) { return s.replace(TRIM_RE, ''); }
/** ASCII lowercase only. */
export function asciiLower(s) { return s.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32)); }
export function isKey(s) { return KEY_RE.test(s); }

function diag(code, key, extra) {
  const d = { code };
  if (key !== undefined && key !== null) d.key = key;
  if (extra) Object.assign(d, extra);
  return d;
}

/** Replace surrogate code points (lone surrogates) with U+FFFD. */
function toScalarValueString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) { out += s[i] + s[i + 1]; i++; continue; }
      out += '�';
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += '�';
    } else {
      out += s[i];
    }
  }
  return out;
}

/**
 * Value normalisation (spec §Values). Returns the value or null when it is
 * empty after normalisation.
 */
export function normalizeValue(s) {
  s = toScalarValueString(s);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\u0000/g, '�');
  s = trim(s);
  return s.length ? s : null;
}

/** Documents are Maps from key to a non-empty array of values. */
export function createDocument() { return new Map(); }

function addValue(doc, key, value) {
  const list = doc.get(key);
  if (list) list.push(value); else doc.set(key, [value]);
}

/** Convert a document to the fixture/object representation {key: [values]}. */
export function toObject(doc) {
  const o = Object.create(null);
  for (const [k, v] of doc) o[k] = v.slice();
  return o;
}

/** Build a document from {key: value | [values]}; keys are lowercased, values normalised. */
export function fromObject(obj) {
  const doc = createDocument();
  for (const k of Object.keys(obj)) {
    const key = asciiLower(k);
    if (!isKey(key) || key === 'jai') continue;
    const items = Array.isArray(obj[k]) ? obj[k] : [obj[k]];
    for (const it of items) {
      const v = normalizeValue(String(it));
      if (v !== null) addValue(doc, key, v);
    }
  }
  return doc;
}

export function documentsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb || vb.length !== va.length) return false;
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Text form
 * ------------------------------------------------------------------ */

/** Unescape \; \= \\ ; any other backslash is literal. */
function unescapeText(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && (s[i + 1] === ';' || s[i + 1] === '=' || s[i + 1] === '\\')) {
      out += s[i + 1]; i++;
    } else out += c;
  }
  return out;
}

/** Index of the first unescaped occurrence of `ch` in s, or -1. */
function indexOfUnescaped(s, ch) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { i++; continue; }
    if (s[i] === ch) return i;
  }
  return -1;
}

/**
 * Text parsing algorithm (spec §Parsing). Returns {document, diagnostics, info}.
 * `info` is implementation detail used by validate(): prefixed, segments.
 */
export function parse(input) {
  const diagnostics = [];
  const doc = createDocument();
  input = toScalarValueString(String(input));
  let i = 0;
  while (input.charCodeAt(i) === 0xfeff) i++;
  input = input.slice(i).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  i = LEADING_WS_RE.exec(input)[0].length;
  let prefixed = false;
  if (/^jai:/i.test(input.slice(i, i + 4))) { i += 4; prefixed = true; }

  // raw segments
  const raws = [];
  let cur = '';
  for (let j = i; j < input.length; j++) {
    const c = input[j];
    if (c === '\\' && j + 1 < input.length) { cur += c + input[j + 1]; j++; continue; }
    if (c === ';') { raws.push(cur); cur = ''; continue; }
    cur += c;
  }
  raws.push(cur);

  const DISCARD = { discarded: true };
  const pending = [];
  let current = null;
  const segments = []; // info for validators
  for (let idx = 0; idx < raws.length; idx++) {
    const raw = raws[idx];
    if (WS_ONLY_RE.test(raw)) {
      if (idx !== raws.length - 1) diagnostics.push(diag('empty-segment'));
      continue;
    }
    const eq = indexOfUnescaped(raw, '=');
    if (eq >= 0) {
      const key = asciiLower(trim(raw.slice(0, eq)));
      if (isKey(key)) {
        if (key === 'jai') {
          diagnostics.push(diag('reserved-key', 'jai'));
          current = DISCARD;
          segments.push({ kind: 'reserved', key });
          continue;
        }
        const p = { key, text: raw.slice(eq + 1), kind: 'assignment', continued: 0 };
        pending.push(p); current = p;
        segments.push({ kind: 'assignment', key, index: pending.length - 1 });
        continue;
      }
    }
    if (current === null) {
      const p = { key: 'prompt', text: raw, kind: 'prose', continued: 0 };
      pending.push(p); current = p;
      segments.push({ kind: 'prompt', key: 'prompt', index: pending.length - 1 });
    } else if (current === DISCARD) {
      segments.push({ kind: 'dropped' });
    } else {
      current.text += ';' + raw; current.continued++;
      segments.push({ kind: 'continuation', key: current.key, index: pending.indexOf(current), raw });
    }
  }
  for (const p of pending) {
    const v = normalizeValue(unescapeText(p.text));
    if (v === null) { diagnostics.push(diag('empty-value', p.key)); p.dropped = true; }
    else { addValue(doc, p.key, v); p.value = v; }
  }
  return { document: doc, diagnostics, info: { prefixed, segments, pending } };
}

const byCP = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Canonical key order after `prompt`: the qualified prompt keys, then every other key, each by code point. */
function orderedKeys(doc) {
  const rest = [...doc.keys()].filter(k => k !== 'prompt');
  return [...rest.filter(k => k.startsWith('prompt/')).sort(byCP), ...rest.filter(k => !k.startsWith('prompt/')).sort(byCP)];
}

/** escape-value (spec §Canonical text serialisation): one left-to-right pass. */
export function escapeValue(v) { return v.replace(ESCAPE_VALUE_RE, m => '\\' + m); }

/** escape-prose (spec §Escaping arbitrary text): escape every \ ; = . */
export function escapeProse(s) { return s.replace(/[\\;=]/g, m => '\\' + m); }

/** Canonical text serialisation; {bare: true} omits the prefix (with its extra protections). */
export function serialize(doc, { bare = false } = {}) {
  const segments = [];
  const prompts = doc.get('prompt') || [];
  prompts.forEach((v, n) => {
    let needsPromptForm = n > 0 || ASSIGNMENT_PATTERN_RE.test(v);
    if (!needsPromptForm && bare && (/^jai:/i.test(v) || v.charCodeAt(0) === 0xfeff || v[0] === '{')) needsPromptForm = true;
    segments.push(needsPromptForm ? 'prompt=' + escapeValue(v) : escapeValue(v));
  });
  for (const k of orderedKeys(doc)) for (const v of doc.get(k)) segments.push(k + '=' + escapeValue(v));
  return (bare ? '' : 'jai:') + segments.join(';');
}

/* ------------------------------------------------------------------ *
 * JSON form
 * ------------------------------------------------------------------ */

/** Number -> string per ECMAScript Number::toString (RFC 8785 §3.2.2.3). */
export function numberToString(n) { return String(n); }

/** True when arrays/objects nest deeper than `max` anywhere (the top-level object has depth 1). */
function jsonDepthExceeds(s, max) {
  let d = 0, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inStr) { if (c === 92) i++; else if (c === 34) inStr = false; continue; }
    if (c === 34) inStr = true;
    else if (c === 123 || c === 91) { if (++d > max) return true; }
    else if (c === 125 || c === 93) d--;
  }
  return false;
}

/**
 * JSON reading algorithm (spec §Reading). `text` is a string or an already
 * parsed object. {inContext} says whether the input is in a JAI context.
 */
export function readJSON(text, { inContext = true } = {}) {
  const diagnostics = [];
  const doc = createDocument();
  const fail = () => { diagnostics.push(diag('invalid-json')); return { document: createDocument(), diagnostics, isJAI: false }; };
  let obj;
  if (typeof text === 'string') {
    if (jsonDepthExceeds(text, 32)) return fail();
    try {
      // A number that rounds to an infinite binary64 value makes the text invalid.
      obj = JSON.parse(text, (k, v) => { if (typeof v === 'number' && !Number.isFinite(v)) throw new RangeError('overflow'); return v; });
    } catch { return fail(); }
  } else obj = text;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return fail();
  // JSON.parse already applied "an exact repeat replaces in place"; readers do not diagnose it.
  if (!Object.prototype.hasOwnProperty.call(obj, 'jai')) {
    if (!inContext) return { document: doc, diagnostics, isJAI: false };
    diagnostics.push(diag('missing-marker'));
  } else {
    const m = obj.jai;
    if (typeof m === 'number' && Number.isInteger(m)) {
      if (m !== 1) diagnostics.push(diag('unsupported-version'));
    } else diagnostics.push(diag('invalid-marker'));
  }
  const seen = new Set();
  for (const name of Object.keys(obj)) {
    if (name === 'jai') continue;
    const key = asciiLower(name);
    if (!isKey(key)) { diagnostics.push(diag('invalid-key', name)); continue; }
    if (key === 'jai') { diagnostics.push(diag('duplicate-member', 'jai')); continue; }
    if (seen.has(key)) diagnostics.push(diag('duplicate-key', key));
    seen.add(key);
    const raw = obj[name];
    const items = Array.isArray(raw) ? raw : [raw];
    for (const it of items) {
      let cand;
      if (typeof it === 'string') cand = it;
      else if (typeof it === 'number') { cand = numberToString(it); diagnostics.push(diag('number-value', key)); }
      else if (typeof it === 'boolean') { cand = it ? 'true' : 'false'; diagnostics.push(diag('number-value', key)); }
      else if (it === null) { diagnostics.push(diag('empty-value', key)); continue; }
      else { diagnostics.push(diag('unsupported-member', key)); continue; }
      const v = normalizeValue(cand);
      if (v === null) { diagnostics.push(diag('empty-value', key)); continue; }
      addValue(doc, key, v);
    }
  }
  return { document: doc, diagnostics, isJAI: true };
}

/** Canonical JSON form (spec §Canonical JSON). */
export function canonicalJSON(doc) {
  const parts = ['"jai":1'];
  const enc = v => (v.length === 1 ? JSON.stringify(v[0]) : JSON.stringify(v));
  if (doc.has('prompt')) parts.push('"prompt":' + enc(doc.get('prompt')));
  for (const k of orderedKeys(doc)) parts.push(JSON.stringify(k) + ':' + enc(doc.get(k)));
  return '{' + parts.join(',') + '}';
}

async function sha256Hex(bytes) {
  let subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    const m = await import('node:crypto');
    subtle = m.webcrypto.subtle;
  }
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Identity: SHA-256 of the canonical JSON form, lowercase hex. */
export async function identity(doc) {
  return sha256Hex(new TextEncoder().encode(canonicalJSON(doc)));
}

/* ------------------------------------------------------------------ *
 * gzip: CRC32, header walk, pure-JS inflate (RFC 1951), encode
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class InflateError extends Error {}

/**
 * Inflate a raw deflate stream (RFC 1951). Returns {output, consumed}. Throws
 * InflateError on exactly the streams zlib's inflate rejects (spec §File form).
 */
export function inflateRaw(input, start = 0, maxOutput = 16 * 1024 * 1024) {
  let pos = start, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.min(maxOutput, Math.max(1024, input.length * 4)));
  let outLen = 0;
  const ensure = n => {
    if (outLen + n > maxOutput) throw new InflateError('bound');
    if (outLen + n > out.length) {
      const bigger = new Uint8Array(Math.min(maxOutput, Math.max(out.length * 2, outLen + n)));
      bigger.set(out.subarray(0, outLen)); out = bigger;
    }
  };
  const bits = n => {
    while (bitCnt < n) {
      if (pos >= input.length) throw new InflateError('truncated');
      bitBuf |= input[pos++] << bitCnt; bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n; bitCnt -= n;
    return v;
  };
  // kind: 'codes' (code-length code), 'lens' (literal/length), 'dists' (distance); checks as zlib's inflate_table.
  const buildTree = (lengths, kind) => {
    const count = new Uint16Array(16), symbol = new Uint16Array(lengths.length);
    let max = 0;
    for (const l of lengths) { count[l]++; if (l > max) max = l; }
    count[0] = 0;
    if (max > 0 && kind !== 'fixed') { // zlib builds the fixed tables without these checks (the fixed distance code is incomplete)
      let left = 1;
      for (let len = 1; len < 16; len++) { left <<= 1; left -= count[len]; if (left < 0) throw new InflateError('over-subscribed'); }
      if (left > 0 && (kind === 'codes' || max !== 1)) throw new InflateError('incomplete');
    }
    const offs = new Uint16Array(16);
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
    return { count, symbol };
  };
  const decodeSym = t => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = t.count[len];
      if (code - c < first) return t.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new InflateError('bad-code');
  };
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  let fixedL, fixedD;
  const fixedTrees = () => {
    if (!fixedL) {
      const l = new Uint8Array(288);
      l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
      fixedL = buildTree(l, 'fixed'); fixedD = buildTree(new Uint8Array(30).fill(5), 'fixed');
    }
    return [fixedL, fixedD];
  };
  const inflateBlock = (lt, dt) => {
    for (;;) {
      const sym = decodeSym(lt);
      if (sym < 256) { ensure(1); out[outLen++] = sym; }
      else if (sym === 256) return;
      else {
        const li = sym - 257;
        if (li >= 29) throw new InflateError('bad-length');
        const len = LBASE[li] + bits(LEXT[li]);
        const di = decodeSym(dt);
        if (di >= 30) throw new InflateError('bad-distance');
        const dist = DBASE[di] + bits(DEXT[di]);
        if (dist > outLen) throw new InflateError('distance-too-far');
        ensure(len);
        for (let k = 0; k < len; k++) { out[outLen] = out[outLen - dist]; outLen++; }
      }
    }
  };
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  let final;
  do {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > input.length) throw new InflateError('truncated');
      const len = input[pos] | (input[pos + 1] << 8), nlen = input[pos + 2] | (input[pos + 3] << 8);
      pos += 4;
      if ((len ^ 0xffff) !== nlen) throw new InflateError('bad-stored');
      if (pos + len > input.length) throw new InflateError('truncated');
      ensure(len); out.set(input.subarray(pos, pos + len), outLen); outLen += len; pos += len;
    } else if (type === 1) {
      const [lt, dt] = fixedTrees(); inflateBlock(lt, dt);
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      if (hlit > 286 || hdist > 30) throw new InflateError('too-many-codes');
      const cl = new Uint8Array(19);
      for (let k = 0; k < hclen; k++) cl[ORDER[k]] = bits(3);
      const ct = buildTree(cl, 'codes');
      const lens = new Uint8Array(hlit + hdist);
      for (let n = 0; n < hlit + hdist;) {
        const sym = decodeSym(ct);
        if (sym < 16) { lens[n++] = sym; continue; }
        let r, val = 0;
        if (sym === 16) { if (n === 0) throw new InflateError('bad-repeat'); val = lens[n - 1]; r = 3 + bits(2); }
        else if (sym === 17) r = 3 + bits(3);
        else r = 11 + bits(7);
        if (n + r > hlit + hdist) throw new InflateError('bad-lengths');
        while (r--) lens[n++] = val;
      }
      if (lens[256] === 0) throw new InflateError('missing-end-of-block');
      inflateBlock(buildTree(lens.subarray(0, hlit), 'lens'), buildTree(lens.subarray(hlit), 'dists'));
    } else throw new InflateError('bad-block-type');
  } while (!final);
  pos -= bitCnt >> 3; // give back whole bytes pulled into the bit buffer but unused
  return { output: out.subarray(0, outLen), consumed: pos - start };
}

/**
 * Decode exactly one gzip member (spec §File form). Returns {content} or
 * throws InflateError with a reason.
 */
export function gunzipOne(bytes, maxOutput = 16 * 1024 * 1024) {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new InflateError('not-gzip');
  if (bytes[2] !== 8) throw new InflateError('bad-method');
  const flg = bytes[3];
  if (flg & 0xe0) throw new InflateError('reserved-flag');
  let p = 10;
  if (flg & 0x04) { if (p + 2 > bytes.length) throw new InflateError('truncated'); const xlen = bytes[p] | (bytes[p + 1] << 8); p += 2 + xlen; }
  if (flg & 0x08) { while (p < bytes.length && bytes[p] !== 0) p++; p++; }
  if (flg & 0x10) { while (p < bytes.length && bytes[p] !== 0) p++; p++; }
  if (flg & 0x02) {
    if (p + 2 > bytes.length) throw new InflateError('truncated');
    const hcrc = bytes[p] | (bytes[p + 1] << 8);
    if ((crc32(bytes.subarray(0, p)) & 0xffff) !== hcrc) throw new InflateError('bad-header-crc');
    p += 2;
  }
  if (p > bytes.length) throw new InflateError('truncated');
  const { output, consumed } = inflateRaw(bytes, p, maxOutput);
  p += consumed;
  if (p + 8 > bytes.length) throw new InflateError('truncated');
  const crc = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
  const isize = (bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24)) >>> 0;
  p += 8;
  if (crc !== crc32(output)) throw new InflateError('bad-crc');
  if (isize !== (output.length >>> 0)) throw new InflateError('bad-isize');
  if (p !== bytes.length) throw new InflateError('trailing-bytes');
  return { content: output };
}

async function deflateRawBytes(bytes) {
  if (typeof CompressionStream === 'function') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter();
      w.write(bytes); w.close();
      const chunks = [];
      const r = cs.readable.getReader();
      for (;;) { const { value, done } = await r.read(); if (done) break; chunks.push(value); }
      const n = chunks.reduce((a, c) => a + c.length, 0);
      const out = new Uint8Array(n); let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      return out;
    } catch { /* fall through */ }
  }
  try {
    const zlib = await import('node:zlib');
    return new Uint8Array(zlib.deflateRawSync(bytes, { level: 9 }));
  } catch { /* fall through */ }
  // Stored blocks: valid deflate without compression.
  const blocks = [];
  for (let i = 0; i < bytes.length || i === 0; i += 65535) {
    const chunk = bytes.subarray(i, Math.min(bytes.length, i + 65535));
    const final = i + 65535 >= bytes.length ? 1 : 0;
    const b = new Uint8Array(5 + chunk.length);
    b[0] = final; b[1] = chunk.length & 0xff; b[2] = chunk.length >> 8; b[3] = ~chunk.length & 0xff; b[4] = (~chunk.length >> 8) & 0xff;
    b.set(chunk, 5); blocks.push(b);
    if (bytes.length === 0) break;
  }
  const n = blocks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(n); let o = 0;
  for (const c of blocks) { out.set(c, o); o += c.length; }
  return out;
}

/** Encode a document as the file form: one gzip member, MTIME 0, no FNAME/FCOMMENT, OS 255. */
export async function encode(doc) {
  const content = new TextEncoder().encode(canonicalJSON(doc));
  const deflated = await deflateRawBytes(content);
  const out = new Uint8Array(10 + deflated.length + 8);
  out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255], 0);
  out.set(deflated, 10);
  let p = 10 + deflated.length;
  const crc = crc32(content), n = content.length >>> 0;
  out[p++] = crc & 0xff; out[p++] = (crc >>> 8) & 0xff; out[p++] = (crc >>> 16) & 0xff; out[p++] = (crc >>> 24) & 0xff;
  out[p++] = n & 0xff; out[p++] = (n >>> 8) & 0xff; out[p++] = (n >>> 16) & 0xff; out[p++] = (n >>> 24) & 0xff;
  return out;
}

/* ------------------------------------------------------------------ *
 * Decoding algorithm
 * ------------------------------------------------------------------ */

const JSON_WS = /^[\t\n\r ]*/;

/**
 * Decoding algorithm (spec §Decoding). `bytes` is a Uint8Array.
 * Returns {document, diagnostics, form} where form is 'gzip', 'json', 'text' or null.
 */
export function decode(bytes, { inContext = true, maxInflate = 16 * 1024 * 1024, maxText = 1024 * 1024 } = {}) {
  const diagnostics = [];
  const empty = form => ({ document: createDocument(), diagnostics, form });
  let fromGzip = false;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try { bytes = gunzipOne(bytes, maxInflate).content; fromGzip = true; }
    catch (e) { diagnostics.push(diag('malformed-container', null, { reason: e.message })); return empty(null); }
  }
  if (bytes.length > maxText && !fromGzip) { diagnostics.push(diag('undecodable', null, { reason: 'bound' })); return empty(null); }
  // Byte input never contains 00 (binary such as headerless UTF-16 must not become a prompt).
  let text = null;
  if (!bytes.includes(0)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = null; }
  }
  if (text === null) { diagnostics.push(diag(fromGzip ? 'malformed-container' : 'undecodable', null, fromGzip ? { reason: 'not-utf8' } : undefined)); return empty(null); }
  let i = 0;
  while (text.charCodeAt(i) === 0xfeff) i++;
  text = text.slice(i);
  const ws = JSON_WS.exec(text)[0].length;
  if (text[ws] === '{') {
    const after = JSON_WS.exec(text.slice(ws + 1))[0].length;
    const next = text[ws + 1 + after];
    if (next === '"' || next === '}') {
      const r = readJSON(text, { inContext });
      diagnostics.push(...r.diagnostics);
      return { document: r.document, diagnostics, form: fromGzip ? 'gzip' : 'json' };
    }
  }
  if (fromGzip) { diagnostics.push(diag('malformed-container', null, { reason: 'not-json' })); return empty(null); }
  const r = parse(text);
  diagnostics.push(...r.diagnostics);
  return { document: r.document, diagnostics, form: 'text', info: r.info };
}

/* ------------------------------------------------------------------ *
 * URLs: data: URLs, query forms
 * ------------------------------------------------------------------ */

/** Lenient byte-level percent-decode (URL Standard). Returns Uint8Array. */
export function percentDecode(s) {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(bytes.length); let o = 0;
  const hex = c => (c >= 48 && c <= 57) ? c - 48 : (c >= 65 && c <= 70) ? c - 55 : (c >= 97 && c <= 102) ? c - 87 : -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x25 && i + 2 < bytes.length) {
      const a = hex(bytes[i + 1]), b = hex(bytes[i + 2]);
      if (a >= 0 && b >= 0) { out[o++] = (a << 4) | b; i += 2; continue; }
    }
    out[o++] = bytes[i];
  }
  return out.subarray(0, o);
}

function forgivingBase64(s) {
  s = s.replace(/[\t\n\f\r ]/g, '');
  if (s.length % 4 === 0) s = s.replace(/={1,2}$/, '');
  if (s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s)) return null;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out = new Uint8Array(Math.floor(s.length * 3 / 4)); let o = 0, buf = 0, n = 0;
  for (const c of s) { buf = (buf << 6) | A.indexOf(c); n += 6; if (n >= 8) { n -= 8; out[o++] = (buf >> n) & 0xff; } }
  return out.subarray(0, o);
}

/** Essence of a MIME type as the Fetch Standard's MIME type parser computes it; text/plain on failure. */
function fetchMimeEssence(mimeType) {
  const t = mimeType.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  const m = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)\/([!#$%&'*+.^_`|~0-9A-Za-z-]+)[\t\n\r ]*(?:;|$)/.exec(t);
  return m ? asciiLower(m[1] + '/' + m[2]) : 'text/plain';
}

/**
 * data: URL processor (Fetch Standard), applied to the URL as the URL parser
 * serialises it. Returns {mime, essence, bytes} or null when the processor fails.
 */
export function parseDataURL(url) {
  let href;
  try { href = new URL(String(url)).href; } catch { return null; }
  if (!/^data:/i.test(href)) return null;
  let s = href.slice(5);
  const hash = s.indexOf('#'); if (hash >= 0) s = s.slice(0, hash);
  const comma = s.indexOf(','); if (comma < 0) return null;
  let mimeType = s.slice(0, comma).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  let bytes = percentDecode(s.slice(comma + 1));
  const m = /;[ ]*base64$/i.exec(mimeType);
  if (m) {
    const b = forgivingBase64(new TextDecoder().decode(bytes));
    if (b === null) return null;
    bytes = b; mimeType = mimeType.slice(0, m.index);
  }
  if (mimeType.startsWith(';')) mimeType = 'text/plain' + mimeType;
  return { mime: mimeType, essence: fetchMimeEssence(mimeType), bytes };
}

/** Decode a data:image/jai URL. Returns null when it is not one. */
export function decodeDataURL(url, opts) {
  const d = parseDataURL(url);
  if (!d || d.essence !== MEDIA_TYPE) return null;
  return decode(d.bytes, { inContext: true, ...opts });
}

/** Percent-encode text for the body of a data:image/jai, URL (spec encoding profile). */
export function encodeURLBody(text) {
  let out = '';
  const cps = Array.from(text);
  cps.forEach((ch, i) => {
    const c = ch.codePointAt(0);
    const last = i === cps.length - 1;
    if (c < 0x21 || c === 0x7f || c === 0x25 || c === 0x23 || c === 0x22 || c === 0x27 || c === 0x3c || c === 0x3e || (last && c === 0x2c) || (i === 0 && c === 0x2f)) {
      out += '%' + c.toString(16).toUpperCase().padStart(2, '0');
    } else out += ch; // everything else, including non-ASCII, stays literal
  });
  return out;
}

/** Canonical URL form: data:image/jai, + encoded bare serialisation. */
export function toDataURL(doc) { return 'data:image/jai,' + encodeURLBody(serialize(doc, { bare: true })); }

/**
 * Query forms (spec §Query forms). kind 'query': the whole query is the
 * document (percent-decoded once, + literal). kind 'param': the first `jai`
 * pair in form encoding. Returns {document, diagnostics} or null when the URL
 * carries no document (no query, or no jai parameter).
 */
export function fromQuery(url, kind = 'query') {
  let href;
  try { href = new URL(String(url)).href; } catch { return null; }
  const hash = href.indexOf('#'); if (hash >= 0) href = href.slice(0, hash);
  const q = href.indexOf('?');
  if (q < 0) return null; // the query is null
  const query = href.slice(q + 1);
  if (kind === 'param') {
    const v = new URLSearchParams(query).get('jai');
    return v === null ? null : parse(v);
  }
  return parse(new TextDecoder().decode(percentDecode(query)));
}

/* ------------------------------------------------------------------ *
 * HTML discovery (needs a DOM)
 * ------------------------------------------------------------------ */

function mimeEssence(type) {
  if (!type) return '';
  return asciiLower(type.split(';')[0].replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ''));
}

/** HTML's "parse a srcset attribute": the candidates that survive, in order. */
export function srcsetCandidates(input) {
  const s = String(input ?? '');
  const isWS = c => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
  const out = [];
  let pos = 0;
  for (;;) {
    while (pos < s.length && (isWS(s[pos]) || s[pos] === ',')) pos++;
    if (pos >= s.length) return out;
    const start = pos;
    while (pos < s.length && !isWS(s[pos])) pos++;
    let url = s.slice(start, pos);
    const descriptors = [];
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {
      while (pos < s.length && isWS(s[pos])) pos++;
      let current = '', state = 'in';
      for (;;) {
        const c = pos < s.length ? s[pos] : undefined;
        if (state === 'in') {
          if (c !== undefined && isWS(c)) { if (current) { descriptors.push(current); current = ''; } state = 'after'; }
          else if (c === ',') { pos++; if (current) descriptors.push(current); break; }
          else if (c === '(') { current += c; state = 'paren'; }
          else if (c === undefined) { if (current) descriptors.push(current); break; }
          else current += c;
        } else if (state === 'paren') {
          if (c === ')') { current += c; state = 'in'; }
          else if (c === undefined) { descriptors.push(current); break; }
          else current += c;
        } else if (c === undefined) break;
        else if (!isWS(c)) { state = 'in'; continue; }
        pos++;
      }
    }
    let error = false, w = null, d = null, h = null;
    for (const desc of descriptors) {
      const last = desc[desc.length - 1], val = desc.slice(0, -1);
      if (last === 'w' && /^[0-9]+$/.test(val)) { if (w !== null || d !== null) error = true; else { w = +val; if (w === 0) error = true; } }
      else if (last === 'x' && /^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(val)) { if (w !== null || d !== null || h !== null) error = true; else { d = parseFloat(val); if (d < 0) error = true; } }
      else if (last === 'h' && /^[0-9]+$/.test(val)) { if (h !== null || d !== null) error = true; else { h = +val; if (h === 0) error = true; } }
      else error = true;
    }
    if (h !== null && w === null) error = true;
    if (!error && url) out.push({ url, width: w, density: d, height: h });
  }
}

/** First candidate URL of a srcset attribute under HTML's parsing, or null. */
export function firstSrcsetURL(srcset) {
  if (srcset == null) return null;
  const c = srcsetCandidates(srcset);
  return c.length ? c[0].url : null;
}

/**
 * Discovery for one <img> element (spec §Discovery). Returns null or
 * {carrier, kind: 'inline'|'url', document?, diagnostics?, url?, source?}.
 * For carrier 1 with a non-data: URL the caller fetches and decodes the bytes.
 */
export function discover(img, { baseURL } = {}) {
  const parent = img.parentElement;
  if (parent && parent.localName === 'picture') {
    for (const child of Array.from(parent.children)) {
      if (child === img) break;
      if (child.localName !== 'source') continue;
      if (mimeEssence(child.getAttribute('type')) !== MEDIA_TYPE) continue;
      const media = child.getAttribute('media');
      if (media && typeof matchMedia === 'function' && !matchMedia(media).matches) continue;
      const url = firstSrcsetURL(child.getAttribute('srcset'));
      if (!url) continue;
      if (/^data:/i.test(url)) {
        const r = decodeDataURL(url);
        if (!r) continue;
        return { carrier: 1, kind: 'inline', document: r.document, diagnostics: r.diagnostics, source: child };
      }
      let abs = url;
      try { abs = new URL(url, baseURL || (img.ownerDocument && img.ownerDocument.baseURI) || undefined).href; } catch { /* keep */ }
      return { carrier: 1, kind: 'url', url: abs, source: child };
    }
  }
  const dj = img.getAttribute('data-jai');
  if (dj !== null) {
    const r = parse(dj);
    return { carrier: 2, kind: 'inline', document: r.document, diagnostics: r.diagnostics, info: r.info };
  }
  const src = img.getAttribute('src');
  if (src !== null) {
    const r = decodeDataURL(src);
    if (r) return { carrier: 3, kind: 'inline', document: r.document, diagnostics: r.diagnostics };
  }
  const alt = img.getAttribute('alt');
  if (alt !== null && /^jai:/i.test(alt.replace(LEADING_WS_RE, ''))) {
    const r = parse(alt);
    return { carrier: 4, kind: 'inline', document: r.document, diagnostics: r.diagnostics, info: r.info };
  }
  return null;
}

/** Discover every carried document under a root (Document, Element or ShadowRoot), in tree order; open shadow trees are visited at their host. */
export function discoverAll(root, opts) {
  const out = [];
  const visit = node => {
    for (const el of Array.from(node.children || [])) {
      if (el.localName === 'img') { const d = discover(el, opts); if (d) out.push({ element: el, ...d }); }
      if (el.shadowRoot) visit(el.shadowRoot);
      visit(el);
    }
  };
  visit(root);
  return out;
}

/* ------------------------------------------------------------------ *
 * Interpretation and model matching
 * ------------------------------------------------------------------ */

const NUM_SRC = '(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)';
const ASPECT_RATIO_RE = new RegExp(`^(${NUM_SRC})[${WS_CLASS}]*(?::|x|X|\\u00d7|/)[${WS_CLASS}]*(${NUM_SRC})$`);
const ASPECT_NUM_RE = new RegExp(`^${NUM_SRC}$`);
const STRENGTH_RE = new RegExp(`^(${NUM_SRC})[${WS_CLASS}]*(%)?$`);
const SEED_RE = /^[0-9]{1,20}$/;

function lexical(key, v) {
  // Single-valued keys only: one surrounding pair of ASCII quotes, then one trailing full stop.
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = trim(v.slice(1, -1));
  if (v.endsWith('.')) v = v.slice(0, -1);
  return v;
}

function reduce(w, h) {
  const g = (a, b) => (b ? g(b, a % b) : a);
  const d = g(w, h);
  return [w / d, h / d];
}

export function parseAspect(v) {
  const lv = asciiLower(v);
  if (lv === 'square') return { kind: 'ratio', width: 1, height: 1, keyword: 'square' };
  if (lv === 'landscape') return { kind: 'keyword', keyword: 'landscape', width: 4, height: 3 };
  if (lv === 'portrait') return { kind: 'keyword', keyword: 'portrait', width: 3, height: 4 };
  let m = ASPECT_RATIO_RE.exec(v);
  let w, h;
  if (m) { w = parseFloat(m[1]); h = parseFloat(m[2]); }
  else if (ASPECT_NUM_RE.test(v)) { w = parseFloat(v); h = 1; }
  else return null;
  if (!(w > 0) || !(h > 0)) return null;
  const r = w / h;
  if (r > 100 || r < 0.01) return null;
  let rw = w, rh = h;
  if (Number.isInteger(w) && Number.isInteger(h)) [rw, rh] = reduce(w, h);
  return { kind: 'ratio', width: rw, height: rh, ratio: r };
}

/**
 * Interpretation (spec §Interpretation) plus model matching.
 * catalog: [{id, aliases: [], family, imageInput|image_input: bool, default: bool}], families: {name: [spellings]}.
 * hasOriginal: whether the carrier offers an original image.
 */
export function interpret(doc, { catalog = [], families = {}, hasOriginal = false, governingRatio = null, selected = null } = {}) {
  const diagnostics = [];
  const out = { prompt: null, description: '', style: [], avoid: [], model: [], aspect: null, mode: 'generate', strength: null, seed: null, source: null, preview: null, animate: false };
  const single = key => {
    const vals = doc.get(key);
    if (!vals) return null;
    if (vals.length > 1) diagnostics.push(diag('repeated-single', key));
    return lexical(key, vals[vals.length - 1]);
  };
  const prompts = doc.get('prompt');
  if (prompts) { out.prompt = prompts.slice(); out.description = prompts.join('\n'); }
  // prompt, style, avoid and model are used exactly as written.
  out.style = (doc.get('style') || []).slice();
  out.avoid = (doc.get('avoid') || []).slice();
  out.model = (doc.get('model') || []).slice();

  let v;
  if ((v = single('aspect')) !== null) {
    const a = parseAspect(v);
    if (a) out.aspect = a; else diagnostics.push(diag('invalid-value', 'aspect'));
  }
  if ((v = single('mode')) !== null) {
    const lv = asciiLower(v);
    if (lv === 'generate' || lv === 'transform' || lv === 'keep') out.mode = lv; else diagnostics.push(diag('invalid-value', 'mode'));
  }
  if ((v = single('strength')) !== null) {
    const m = STRENGTH_RE.exec(v);
    if (m) {
      let n = parseFloat(m[1]); if (m[2]) n /= 100;
      if (n < 0 || n > 1) { n = Math.min(1, Math.max(0, n)); diagnostics.push(diag('adjusted-value', 'strength')); }
      out.strength = n;
    } else diagnostics.push(diag('invalid-value', 'strength'));
  }
  if ((v = single('seed')) !== null) {
    if (SEED_RE.test(v)) out.seed = v; else diagnostics.push(diag('invalid-value', 'seed'));
  }
  if ((v = single('source')) !== null) {
    // Checked without fetching (spec §source).
    let valid;
    if (/^data:/i.test(v)) { const d = parseDataURL(v); valid = !!d && RASTER_TYPES.has(d.essence); }
    else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v)) valid = /^https?:/i.test(v);
    else valid = true; // a relative URL
    if (!valid) diagnostics.push(diag('invalid-image', 'source'));
    else {
      out.source = v;
      if (out.mode !== 'transform') diagnostics.push(diag('ignored-value', 'source'));
    }
  }
  if ((v = single('preview')) !== null) {
    const d = /^data:/i.test(v) ? parseDataURL(v) : null;
    if (d && RASTER_TYPES.has(d.essence)) out.preview = v; else diagnostics.push(diag('unsupported-preview', 'preview'));
  }
  if ((v = single('animate')) !== null) {
    const lv = asciiLower(v);
    if (['true', 'yes', '1', 'on'].includes(lv)) out.animate = true;
    else if (['false', 'no', '0', 'off'].includes(lv)) out.animate = false;
    else diagnostics.push(diag('invalid-value', 'animate'));
  }
  // Ratio to render at (spec §Size and aspect): the governing ratio wins over aspect.
  out.ratio = out.aspect ? out.aspect.width / out.aspect.height : null;
  if (governingRatio !== null && governingRatio > 0) {
    if (out.aspect) {
      const differs = out.aspect.keyword === 'landscape' ? !(governingRatio > 1)
        : out.aspect.keyword === 'portrait' ? !(governingRatio < 1)
        : Math.abs(Math.log(out.ratio / governingRatio)) > 0.01;
      if (differs) diagnostics.push(diag('ignored-value', 'aspect'));
    }
    out.ratio = governingRatio;
  }
  let chosen = null;
  if (catalog.length) {
    const needsImage = out.mode === 'transform' && (hasOriginal || out.source !== null);
    // `selected` lets a viewer impose the model the user picked; otherwise model matching decides.
    const forced = selected ? catalog.find(m => m.id === selected) || null : null;
    const m = forced ? { model: forced, diagnostics: [] } : matchModel(out.model, { catalog, families, needsImage });
    chosen = m.model;
    out.matched = m.model ? m.model.id : null;
    diagnostics.push(...m.diagnostics);
    if (needsImage && m.model && !(m.model.imageInput || m.model.image_input)) diagnostics.push(diag('mode-degraded', 'mode'));
  }
  // Per-model refinements (spec §Per-model refinements): core values, then matching qualified values.
  if (chosen) {
    const names = [chosen.family, chosen.id, ...(chosen.aliases || [])].filter(Boolean).map(asciiLower);
    const qualified = [...doc.keys()].filter(k => k.includes('/')).sort(byCP);
    for (const base of QUALIFIABLE) {
      const extra = qualified.filter(k => k.startsWith(base + '/') && names.includes(k.slice(base.length + 1))).flatMap(k => doc.get(k));
      if (!extra.length) continue;
      if (base === 'prompt') { out.prompt = [...(out.prompt || []), ...extra]; out.description = out.prompt.join('\n'); }
      else out[base] = [...out[base], ...extra];
    }
  }
  return { interpreted: out, diagnostics };
}

const wordsOf = s => (asciiLower(s).match(/[a-z0-9]+/g) || []);

/**
 * Model matching (spec §Model matching): a selector, never a locator. Only
 * catalog models (the user's configuration) can ever be returned.
 */
export function matchModel(values, { catalog = [], families = {}, needsImage = false, pinsVersions = false } = {}) {
  const diagnostics = [];
  const imageOk = m => !!(m.imageInput || m.image_input);
  const eligible = needsImage ? catalog.filter(imageOk) : catalog.slice();
  const userDefault = catalog.find(m => m.default) || catalog[0] || null;
  const exact = v => {
    const lv = asciiLower(v);
    return eligible.find(m => asciiLower(m.id) === lv || (m.aliases || []).some(a => asciiLower(a) === lv)) || null;
  };
  // Known families: the renderer's list in order, then catalog families not listed, in catalog order.
  const known = Object.entries(families).map(([name, sp]) => ({ name, spellings: [name, ...(sp || [])] }));
  for (const m of catalog) if (m.family && !known.some(f => f.name === m.family)) known.push({ name: m.family, spellings: [m.family] });
  const familyDefault = name => (userDefault && eligible.includes(userDefault) && userDefault.family === name ? userDefault : eligible.find(m => m.family === name) || null);
  for (const v of values) {
    let m = exact(v);
    if (m) return { model: m, diagnostics };
    const slash = v.lastIndexOf('/');
    const seg = v.slice(slash + 1);
    if (!pinsVersions) {
      let cut = -1;
      for (let i = seg.length - 1; i >= 1; i--) if (seg[i] === ':' || seg[i] === '@') { cut = i; break; }
      if (cut >= 1) {
        m = exact(v.slice(0, slash + 1 + cut));
        if (m) { diagnostics.push(diag('version-ignored', 'model')); return { model: m, diagnostics }; }
      }
    }
    for (const candidate of [seg, v]) {
      const words = wordsOf(candidate);
      let best = null;
      known.forEach((f, order) => {
        if (!familyDefault(f.name)) return;
        for (const sp of f.spellings) {
          const sw = wordsOf(sp);
          if (!sw.length) continue;
          for (let i = 0; i + sw.length <= words.length; i++) {
            if (sw.every((w, k) => words[i + k] === w)) {
              if (!best || i < best.start || (i === best.start && (sw.length > best.len || (sw.length === best.len && order < best.order)))) best = { name: f.name, start: i, len: sw.length, order };
              break;
            }
          }
        }
      });
      if (best) { diagnostics.push(diag('substituted-model', 'model', { family: best.name })); return { model: familyDefault(best.name), diagnostics }; }
    }
  }
  diagnostics.push(diag('no-matching-model', 'model'));
  return { model: userDefault, diagnostics };
}

/* ------------------------------------------------------------------ *
 * Validator (advisory)
 * ------------------------------------------------------------------ */

const CONFUSABLE_DELIM = new RegExp(`[\\uff1b\\u061b][${WS_CLASS}]*[A-Za-z0-9][A-Za-z0-9_.-]*[${WS_CLASS}]*[=\\uff1d]`);
const CONFUSABLE_EQ = /[A-Za-z0-9][\t ]*\uff1d/;
const KNOWN_FOREIGN = /(^|\s)--(ar|no|seed|niji|style|v|q|chaos|stylize)\b|^Negative prompt:|<lora:/i;

/** Advisory diagnostics for a parsed document; `info` from parse() enables segment-level checks. */
export function validate(doc, info) {
  const d = [];
  const stdset = new Set(STANDARD_KEYS);
  const utf8 = s => new TextEncoder().encode(s).length;
  for (const [k, vals] of doc) {
    const base = k.split('/')[0];
    if (!base.includes('.') && !stdset.has(base)) d.push(diag('unknown-key', k));
    if (k.includes('/') && !QUALIFIABLE.has(base)) d.push(diag('invalid-qualifier', k));
    for (const v of vals) {
      if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/.test(v)) d.push(diag('control-character', k));
      if (/[​-‍⁠]|.﻿/s.test(v)) d.push(diag('invisible-char', k));
      if (/[‪-‮⁦-⁩]/.test(v)) d.push(diag('bidi-control', k));
      if (utf8(v) > 8192) d.push(diag('large-payload', k));
      if (/\n[\t\n\f\r ]*[A-Za-z0-9][A-Za-z0-9_.-]*[\t\n\f\r ]*=/.test(v)) d.push(diag('newline-assignment', k));
      if (k === 'prompt' && /^jai:/i.test(v)) d.push(diag('prefix-in-prompt', k));
      if (k === 'prompt' && KNOWN_FOREIGN.test(v)) d.push(diag('foreign-syntax', k));
      if (CONFUSABLE_DELIM.test(v)) d.push(diag('confusable-delimiter', k));
      else if (CONFUSABLE_EQ.test(v)) d.push(diag('confusable-equals', k));
      if (!['source', 'preview', 'model'].includes(k) && !/^[a-z][a-z0-9+.-]*:/i.test(v) && /%[0-9A-Fa-f]{2}/.test(v) && !/%25/i.test(v)) d.push(diag('percent-encoded-text', k));
      if (k === 'avoid' && /^(no|not|without|never)[\t\n\f\r  ]/i.test(v)) d.push(diag('negated-avoid', k));
    }
    if (SINGLE_VALUED.has(k)) {
      const last = vals[vals.length - 1];
      if (last.length >= 2 && (last[0] === '"' || last[0] === "'") && last[last.length - 1] === last[0]) d.push(diag('quoted-value', k));
    }
  }
  if (utf8(canonicalJSON(doc)) > 65536) d.push(diag('large-payload'));
  const interp = interpret(doc);
  if (!doc.has('prompt') && interp.interpreted.mode === 'generate') d.push(diag('no-prompt'));
  if (doc.has('strength') && interp.interpreted.mode !== 'transform') d.push(diag('strength-without-transform', 'strength'));
  for (const v of doc.get('model') || []) if (/^[a-z][a-z0-9+.-]*:\/\/|^\.?\.?\//i.test(v)) d.push(diag('model-looks-like-locator', 'model'));
  if (info && info.segments) {
    const segs = info.segments;
    if (segs.length && segs[0].kind === 'assignment' && !stdset.has(segs[0].key) && !segs[0].key.includes('.') && !doc.has('prompt')) d.push(diag('first-segment-assignment', segs[0].key));
    for (const s of segs) {
      if (s.kind === 'continuation') {
        if (SINGLE_VALUED.has(s.key) && s.key !== 'source' && s.key !== 'preview') d.push(diag('continuation-into-single-valued-key', s.key));
        const t = trim(s.raw);
        if (stdset.has(asciiLower(t))) d.push(diag('bare-key', asciiLower(t)));
      }
    }
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1], s = segs[i];
      if (s.kind === 'assignment' && ['charset', 'base64', 'name', 'filename'].includes(s.key) && prev.kind === 'assignment' && (prev.key === 'source' || prev.key === 'preview')) d.push(diag('split-data-uri', prev.key));
    }
  }
  for (const x of interp.diagnostics) if (x.code === 'repeated-single' || x.code === 'invalid-value') d.push(x);
  const aspect = doc.get('aspect');
  if (aspect) { const v = aspect[aspect.length - 1]; const a = parseAspect(v); if (a && a.kind === 'ratio' && !/^[0-9]+:[0-9]+$/.test(v) && v.toLowerCase() !== 'square') d.push(diag('nonstandard-value', 'aspect', { suggestion: `${a.width}:${a.height}` })); }
  return d;
}

/** Checks on a data:image/jai URL written in a carrier (validator codes). */
function dataURLAdvisories(url) {
  const d = [];
  const s = String(url).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  if (!/^data:image\/jai(?=[;,]|$)/i.test(s)) return d;
  const comma = s.indexOf(',');
  if (comma < 0) { d.push(diag('data-url-missing-comma')); return d; }
  const params = s.slice(5, comma).split(';').slice(1).map(p => asciiLower(p.trim().split('=')[0]));
  if (params.some(p => p && p !== 'base64' && p !== 'charset')) d.push(diag('data-url-parameter'));
  if (/[\t\n\r ]|#/.test(s.slice(comma + 1)) || /%(?![0-9A-Fa-f]{2})/.test(s.slice(comma + 1))) d.push(diag('unencoded-url-text'));
  return d;
}

/**
 * Advisories about how a document was delivered: a decode() result (bytes from
 * a file or a fetched resource; pass viaDataURL for the body of a data: URL),
 * and/or a discovery carrier with its element.
 */
export function validateDelivery({ decoded, carrier, element, viaDataURL = false } = {}) {
  const d = [];
  if (decoded && !viaDataURL && (decoded.form === 'json' || decoded.form === 'text')) d.push(diag('non-canonical-encoding'));
  const doc = decoded && decoded.document;
  if (carrier === 4) {
    d.push(diag('alt-carrier'));
    if (doc) for (const vals of doc.values()) if (vals.some(v => /data:/i.test(v))) { d.push(diag('alt-carrier-payload')); break; }
  }
  if (carrier === 3 && element && !(element.getAttribute('width') && element.getAttribute('height'))) d.push(diag('missing-size'));
  if (carrier === 1 && doc) { const m = doc.get('mode'); if (m && asciiLower(trim(m[m.length - 1])) === 'keep') d.push(diag('keep-in-source')); }
  if (element) {
    const names = typeof element.getAttributeNames === 'function' ? element.getAttributeNames() : [];
    if (names.some(n => /["';=]/.test(n))) d.push(diag('attribute-split'));
    const src = element.getAttribute('src');
    if (src) d.push(...dataURLAdvisories(src));
    const parent = element.parentElement;
    if (parent && parent.localName === 'picture') {
      let after = false;
      for (const ch of Array.from(parent.children)) {
        if (ch === element) { after = true; continue; }
        if (ch.localName !== 'source') continue;
        const type = ch.getAttribute('type'), ss = ch.getAttribute('srcset') || '';
        const isJai = mimeEssence(type) === MEDIA_TYPE;
        const first = (ss.replace(/^[\t\n\f\r ,]+/, '').split(/[\t\n\f\r ]/)[0] || '').replace(/,+$/, '');
        const looksJai = /^data:image\/jai(?=[;,]|$)/i.test(first) || /\.jai(?:[?#]|$)/i.test(first);
        if (after) { if (isJai || looksJai) d.push(diag('source-after-img')); continue; }
        if (isJai && srcsetCandidates(ss).length === 0) d.push(diag('srcset-unparseable'));
        if (!type && looksJai) d.push(diag('source-missing-type'));
        if (isJai) d.push(...dataURLAdvisories(first));
      }
    }
  }
  return d;
}

export default { EDITION, parse, serialize, readJSON, canonicalJSON, identity, decode, encode, decodeDataURL, toDataURL, fromQuery, discover, discoverAll, interpret, matchModel, validate, toObject, fromObject };
