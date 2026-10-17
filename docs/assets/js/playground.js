// JAI playground. All output is written with textContent; HTML input is parsed
// with DOMParser into an inert document (no scripts run, no images load).
// CC0-1.0.
import * as J from './jai.js';
import { classOf, describe } from './messages.js';
import { highlightInto, copyText, toast } from './site.js';

const $ = id => document.getElementById(id);
const input = $('input');
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

// [label, how to read the input, input]
const EXAMPLES = [
  ['A sentence is enough', 'text', 'A red bicycle leaning against a whitewashed wall, afternoon sun'],
  ['Settings after the description', 'text', 'A lighthouse on a cliff in a storm;style=watercolor;aspect=3:2;avoid=text'],
  ['Semicolons inside the description', 'text', 'A wizard stands in a doorway; behind him, a dragon sleeps;model=flux'],
  ['Restyle the page image', 'text', 'Fishing boats in a small harbour at dawn, mist on the water, as a pencil sketch on cream paper;mode=transform;strength=70%'],
  ['Core prompt plus per-model tweaks', 'text', 'A girl holding a red balloon in a park at dusk;prompt/flux=The balloon floats high above her;style/sdxl=35mm film photo;model=flux;model=sdxl'],
  ['Sharp edge: starts with word=', 'text', 'E=mc2 written on a chalkboard'],
  ['Sharp edge: text after a setting', 'text', 'A castle;style=anime;with a moat and a drawbridge'],
  ['Full-width delimiters', 'text', '魔法の城；style＝anime'],
  ['Template text, escaped', 'text', 'prompt=Red mug\\; model\\=XZ-200\\; colour\\=red;style=product photo;aspect=1:1'],
  ['data: URL', 'data', 'data:image/jai,A%20magical%20castle;style=anime'],
  ['HTML: alt is the description', 'html', '<img src="castle.png" alt="A magical castle at dusk, seen from below"\n     data-jai="style=anime;prompt/flux=Lit windows glow warm">'],
  ['HTML: every carrier', 'html', '<img src="castle.png" alt="A magical castle at dusk, seen from below" data-jai="style=anime">\n<img src="team.jpg" alt="The team" data-jai="Four people in front of a brick office;mode=keep">\n<picture>\n  <source type="image/jai" srcset="data:image/jai,A%20lighthouse%20at%20night;style=oil%20painting">\n  <img src="lighthouse.png" alt="A lighthouse at night">\n</picture>\n<img src="harbour.jai" alt="A harbour at dawn" width="800" height="600">'],
];

const MODE_NOTES = {
  text: 'The text form, exactly as it goes in a data-jai attribute: the description first, then ;key=value settings.',
  data: 'A data:image/jai, URL, as it goes in src or in the srcset of a <source type="image/jai">. Its body is the percent-encoded text form.',
  html: 'A piece of HTML. Every JAI carrier in it is found without loading images or running scripts.',
};
const MODE_LABELS = { data: 'a data: URL', html: 'HTML' };

const sel = $('examples');
sel.append(new Option('Choose…', ''));
EXAMPLES.forEach(([label], i) => sel.append(new Option(label, String(i))));
sel.addEventListener('change', () => {
  if (sel.value === '') return;
  const [, mode, text] = EXAMPLES[+sel.value];
  fileNote = null; setMode(mode); input.value = text; update(); sel.value = '';
});

let current = null; // the latest analysis
let mode = 'text';
let htmlMode = 'alt';
let fileNote = null; // { name, diagnostics, text } after opening a .jai file, until the input changes

function setMode(m) {
  mode = m;
  for (const r of document.querySelectorAll('input[name=read-as]')) r.checked = r.value === m;
  $('mode-note').textContent = MODE_NOTES[m];
  store.set('jai-playground-mode', m);
}
for (const r of document.querySelectorAll('input[name=read-as]')) r.addEventListener('change', () => { fileNote = null; setMode(r.value); update(); });

/** An <img> in an inert document, for checks on how a data: URL is written. */
function inertImage(src) {
  const img = new DOMParser().parseFromString('<img width="1" height="1">', 'text/html').body.firstElementChild;
  img.setAttribute('src', src);
  return img;
}

function analyse(text) {
  let r, info = null, carriers = null, noDocument = null;
  const delivery = [];
  if (mode === 'html') {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    carriers = J.discoverAll(doc.body, { baseURL: location.href });
    const first = carriers.find(c => c.document);
    r = first ? { document: first.document, diagnostics: first.diagnostics || [] } : { document: J.createDocument(), diagnostics: [] };
    info = first?.info || null;
    for (const c of carriers) delivery.push(...J.validateDelivery({ carrier: c.carrier, element: c.element, decoded: c.document ? { document: c.document } : null }));
    // Images that carry nothing still get the delivery advisories (a JAI src that HTML never uses, a <source> without a type).
    for (const el of doc.body.querySelectorAll('img')) if (!carriers.some(c => c.element === el)) delivery.push(...J.validateDelivery({ element: el }));
  } else if (mode === 'data') {
    const url = text.trim();
    r = J.decodeDataURL(url);
    delivery.push(...J.validateDelivery({ carrier: 'src', element: inertImage(url), decoded: r }));
    if (!r) {
      r = { document: J.createDocument(), diagnostics: [] };
      // A data:image/jai URL whose data: URL processor failed is still one (data-url-missing-comma says so when the comma is missing).
      if (!/^data:image\/jai(?=[;,#]|$)/i.test(url)) noDocument = 'This is not a data:image/jai URL, so it carries no JAI document.';
      else if (!delivery.some(d => d.code === 'data-url-missing-comma')) noDocument = 'This data:image/jai URL carries no JAI document.';
    }
    info = r.info || null;
  } else {
    r = J.parse(text); info = r.info;
  }
  const interp = J.interpret(r.document);
  const advisories = J.validate(r.document, info);
  return { mode, document: r.document, diagnostics: r.diagnostics, info, carriers, interp, advisories, delivery, noDocument };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(d => { const k = d.code + '|' + (d.key || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

function renderDiagnostics(a) {
  const ul = $('diags'); ul.textContent = '';
  const fromFile = fileNote ? fileNote.diagnostics : [];
  const all = dedupe([...fromFile, ...a.diagnostics, ...a.delivery, ...a.advisories, ...a.interp.diagnostics]);
  if (a.noDocument) all.unshift({ code: 'no-document' });
  if (!all.length) { const li = document.createElement('li'); li.className = 'empty-ok'; li.style.border = '0'; li.style.background = 'none'; li.textContent = 'No problems found.'; ul.append(li); return; }
  for (const d of all) {
    const li = document.createElement('li');
    if (d.code === 'no-document') { li.className = 'parser'; li.textContent = a.noDocument; ul.append(li); continue; }
    li.className = classOf(d.code);
    const { message, fix } = describe(d);
    const p = document.createElement('div'); p.textContent = message;
    const c = document.createElement('code'); c.textContent = d.code + (d.key ? ':' + d.key : '');
    li.append(p);
    if (fix) { const f = document.createElement('div'); f.className = 'muted'; f.style.fontSize = '.85rem'; f.textContent = fix; li.append(f); }
    li.append(c);
    if (d.suggestion) { const s = document.createElement('div'); s.className = 'muted'; s.textContent = 'Suggested: ' + d.suggestion; li.append(s); }
    ul.append(li);
  }
}

function renderPlain(a) {
  const dl = $('plain'); dl.textContent = '';
  const it = a.interp.interpreted;
  const row = (label, values, opts = {}) => {
    if (!values || (Array.isArray(values) && !values.length)) return;
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd');
    if (opts.node) dd.append(opts.node);
    else if (Array.isArray(values)) { const w = document.createElement('div'); w.className = 'vals'; for (const v of values) { const s = document.createElement('span'); s.textContent = v; s.dir = 'auto'; w.append(s); } dd.append(w); }
    else { dd.textContent = values; dd.dir = 'auto'; }
    dl.append(dt, dd);
  };
  if (!a.document.size) { const p = document.createElement('dd'); p.className = 'muted'; p.textContent = 'An empty document.'; dl.append(p); return; }
  if (it.description) {
    const pre = document.createElement('div'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = it.description; pre.dir = 'auto';
    row('Shows', it.description, { node: pre });
  } else row('Shows', '(no description)');
  row('Style', it.style);
  row('Avoid', it.avoid);
  if (it.aspect) row('Shape', it.aspect.kind === 'keyword' ? it.aspect.keyword : `${it.aspect.width}:${it.aspect.height}`);
  if (a.document.has('mode')) row('Mode', it.mode);
  if (it.strength !== null) row('Strength', String(it.strength));
  if (it.seed) row('Seed', it.seed);
  row('Model preferences (advisory)', it.model);
  if (it.source) row('Source image', it.source.length > 80 ? it.source.slice(0, 80) + '…' : it.source);
  if (it.preview) {
    const img = document.createElement('img');
    img.src = it.preview; img.alt = 'Preview placeholder'; img.width = 96; img.style.cssText = 'image-rendering:auto;filter:blur(3px);border-radius:6px;border:1px solid var(--border)';
    row('Preview', '', { node: img });
  }
  // Per-model refinements: grouped by target; a renderer adds them only for a matching model.
  const isRefinement = k => k.includes('/') && J.QUALIFIABLE.has(k.split('/')[0]);
  const byTarget = new Map();
  for (const [k, v] of a.document) if (isRefinement(k)) {
    const [base, target] = k.split('/');
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(`${base} + ${v.join(' | ')}`);
  }
  for (const [target, parts] of byTarget) row(`Only for models matching "${target}"`, parts);
  const std = new Set(J.STANDARD_KEYS);
  const other = [...a.document].filter(([k]) => !std.has(k) && !isRefinement(k)).map(([k, v]) => `${k} = ${v.join(' | ')}`);
  row('Other settings (kept, not standard)', other);
}

function escAttr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
/** data-jai with a value, or the valueless attribute when the value is empty. */
function dataJai(text) { return text ? `data-jai="${escAttr(text)}"` : 'data-jai'; }
function oneLine(s) { return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }
/**
 * A placeholder alt for the forms where alt is the page's own text: the description's
 * first sentence or clause, to show that this alt need not repeat the description.
 */
function shortAlt(doc) {
  const p = (doc.get('prompt') || [])[0];
  if (!p) return 'Describe the image here';
  let s = oneLine(p).split(/(?<=[.!?])\s/)[0];
  if (s.length > 90 && s.includes(',')) s = s.slice(0, s.indexOf(','));
  if (s.length > 120) s = s.slice(0, 120).replace(/\s+\S*$/, '') + '…';
  return s.replace(/[.,;:]+$/, '');
}
function boxSize(it) {
  const r = it.aspect ? it.aspect.width / it.aspect.height : 1;
  return r >= 1 ? [1024, Math.round(1024 / r)] : [Math.round(1024 * r), 1024];
}

function renderHTML() {
  if (!current) return;
  const doc = current.document, url = J.toDataURL(doc), alt = escAttr(shortAlt(doc));
  const prompts = doc.get('prompt') || [];
  const [w, h] = boxSize(current.interp.interpreted);
  let code = '', note = '';
  if (htmlMode === 'alt') {
    if (prompts.length === 1) {
      // The description goes in alt; data-jai holds everything else and gives no description of its own.
      const rest = new Map(doc); rest.delete('prompt');
      code = `<img src="your-image.png" alt="${escAttr(prompts[0])}"\n     ${dataJai(J.serialize(rest))}>`;
      note = 'The convenient default when you have an image. data-jai marks the image and holds the settings; it gives no description, so the alt is the description: written once, spoken by screen readers exactly as written, and drawn by the model. Per-model refinements stay in data-jai, where screen readers do not hear them.';
    } else if (prompts.length > 1) {
      code = `<img src="your-image.png" alt="${alt}"\n     ${dataJai(J.serialize(doc))}>`;
      note = 'This description has several paragraphs and an alt holds one, so the whole document goes in data-jai and the alt is your page\'s own text. Join the paragraphs into one to write the description in alt.';
    } else {
      code = `<img src="your-image.png" alt="${alt}"\n     ${dataJai(J.serialize(doc))}>`;
      note = 'This document has no description, so the alt you write becomes the description.';
    }
  } else if (htmlMode === 'inside') {
    code = `<img src="your-image.png" alt="${alt}"\n     ${dataJai(J.serialize(doc))}>`;
    note = prompts.length
      ? 'data-jai starts with the description, so the alt plays no part in the document. It stays your page\'s own text for screen readers and can be shorter.'
      : 'This document has no description, so the alt you write becomes the description.';
  } else if (htmlMode === 'picture') {
    code = `<picture>\n  <source type="image/jai" srcset="${escAttr(url)}">\n  <img src="your-image.png" alt="${alt}" width="${w}" height="${h}">\n</picture>`;
    note = 'The path a browser with built-in JAI support takes, and the form for hosts that strip data-* attributes. Browsers without JAI show your-image.png. The alt is your page\'s own text and need not repeat the description. A .jai file works in srcset too.';
  } else if (htmlMode === 'srcfile') {
    code = `<img src="castle.jai"\n     alt="${alt}" width="${w}" height="${h}">`;
    note = 'For images with no pixels: save this document with Download .jai below and serve it as castle.jai, as it is (ideally with the media type image/jai). Without a JAI viewer readers see only the alt text, so it must be real prose; it need not repeat the description. Set the size.';
  } else if (htmlMode === 'src') {
    code = `<img src="${escAttr(url)}"\n     alt="${alt}" width="${w}" height="${h}">`;
    note = 'The same image with no pixels, with the document inline: no file to serve. The alt is your own text. Set the size.';
  } else {
    const altMd = shortAlt(doc).replace(/[[\]\\*_]/g, '');
    code = `![${altMd}](castle.jai)`;
    note = `Markdown's image syntax renders to an <img> with the file in src and no size, so the document's aspect sets the shape: save the document as castle.jai next to the page. Where the host keeps data: URLs, ![${altMd}](<${url}>) works the same way.`;
  }
  $('out-html').textContent = code;
  $('html-note').textContent = note;
}

for (const tab of document.querySelectorAll('[data-html]')) {
  tab.addEventListener('click', () => {
    htmlMode = tab.dataset.html;
    for (const t of document.querySelectorAll('[data-html]')) t.setAttribute('aria-selected', String(t === tab));
    renderHTML();
  });
}

function carrierLabel(c) {
  if (c.carrier === 'picture') return 'picture: <source type="image/jai">';
  if (c.carrier === 'src') return 'src: the image itself is JAI';
  if (J.parse(c.element.getAttribute('data-jai')).document.has('prompt')) return 'attribute: data-jai gives the description; the alt is page text';
  return c.document && c.document.has('prompt') ? 'attribute: the alt is the description; data-jai marks the image' : 'attribute: no description in data-jai or alt';
}

/** A hint when the input looks like something other than what it is read as. */
function renderHint(text) {
  const t = text.trimStart();
  const other = mode !== 'data' && /^data:/i.test(t) ? 'data' : mode !== 'html' && t.startsWith('<') ? 'html' : null;
  $('mode-hint').hidden = !other;
  if (other) { $('mode-switch').textContent = `Read it as ${MODE_LABELS[other]}`; $('mode-switch').dataset.mode = other; }
}
$('mode-switch').addEventListener('click', e => { fileNote = null; setMode(e.currentTarget.dataset.mode); update(); });

async function update() {
  const text = input.value;
  store.set('jai-playground', text);
  if (fileNote && fileNote.text !== text) fileNote = null;
  const a = analyse(text);
  current = a;
  renderHint(text);
  const found = a.mode === 'html' ? `${a.carriers.length} carrier${a.carriers.length === 1 ? '' : 's'} found` : '';
  $('detected').textContent = fileNote ? `Read ${fileNote.name} as a .jai file` : found;
  renderPlain(a);
  renderDiagnostics(a);
  const textForm = J.serialize(a.document), url = J.toDataURL(a.document), json = J.canonicalJSON(a.document);
  highlightInto($('out-text'), textForm);
  $('out-url').textContent = url;
  $('out-json').textContent = json;
  renderHTML();
  const cw = $('carriers-wrap'), ol = $('carriers');
  ol.textContent = '';
  cw.hidden = a.mode !== 'html';
  if (a.mode === 'html') {
    if (!a.carriers.length) { const li = document.createElement('li'); li.textContent = 'No JAI carrier found. An image carries JAI through a data-jai attribute, a <source type="image/jai">, or a .jai file or data:image/jai URL in its src.'; ol.append(li); }
    for (const c of a.carriers) {
      const li = document.createElement('li');
      li.textContent = `${carrierLabel(c)} — ` + (c.document ? J.serialize(c.document) : `reads ${c.url} when the reader chooses to render`);
      ol.append(li);
    }
  }
  const enc = new TextEncoder();
  const file = await J.encode(a.document);
  if (current !== a) return;
  $('sizes').textContent = `${enc.encode(textForm).length} bytes as text · ${enc.encode(url).length} bytes as a data: URL · ${file.length} bytes as a .jai file`;
  $('out-id').textContent = await J.identity(a.document);
}

let t;
input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(update, 120); });

$('download').addEventListener('click', async () => {
  if (!current) return;
  const bytes = await J.encode(current.document);
  const name = ((current.document.get('prompt') || ['image'])[0].toLowerCase().match(/[a-z0-9]+/g) || ['image']).slice(0, 5).join('-') + '.jai';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'image/jai' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Saved ' + name);
});

// A link to this page with the canonical text in the fragment: a convenience of the playground.
$('share').addEventListener('click', () => {
  if (!current) return;
  copyText(location.origin + location.pathname + '#' + encodeURIComponent(J.serialize(current.document)));
});

async function loadFile(f) {
  const r = J.decode(new Uint8Array(await f.arrayBuffer()));
  setMode('text');
  input.value = J.serialize(r.document);
  fileNote = { name: f.name, diagnostics: r.diagnostics, text: input.value };
  await update();
  if (r.diagnostics.some(d => d.code === 'malformed-container' || d.code === 'invalid-json')) toast('Not a .jai file: a .jai file is gzip-compressed canonical JSON');
}
$('file').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

// Initial content: a playground link (#<percent-encoded text>), else the last session, else an example.
function fromFragment() {
  if (location.hash.length < 2) return null;
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return null; }
}
const linked = fromFragment();
if (linked !== null) { setMode('text'); input.value = linked; }
else {
  const saved = store.get('jai-playground');
  const savedMode = store.get('jai-playground-mode');
  if (saved !== null) { setMode(MODE_NOTES[savedMode] ? savedMode : 'text'); input.value = saved; }
  else { setMode(EXAMPLES[1][1]); input.value = EXAMPLES[1][2]; }
}
window.addEventListener('hashchange', () => { const v = fromFragment(); if (v !== null) { fileNote = null; setMode('text'); input.value = v; update(); } });
update();
