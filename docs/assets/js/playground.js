// JAI playground. All output is written with textContent; HTML input is parsed
// with DOMParser into an inert document (no scripts run, no images load).
// CC0-1.0.
import * as J from './jai.js';
import { classOf, describe } from './messages.js';
import { highlightInto, copyText, toast } from './site.js';

const $ = id => document.getElementById(id);
const input = $('input');
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

const EXAMPLES = [
  ['A sentence is enough', 'A red bicycle leaning against a whitewashed wall, afternoon sun'],
  ['Settings after the description', 'jai:A lighthouse on a cliff in a storm;style=watercolor;aspect=3:2;avoid=text'],
  ['Semicolons inside the description', 'jai:A wizard stands in a doorway; behind him, a dragon sleeps;model=flux'],
  ['Restyle the page image', 'jai:The same harbour scene as a pencil sketch on cream paper;mode=transform;strength=70%'],
  ['Core prompt plus per-model tweaks', 'jai:A girl holding a red balloon in a park at dusk;prompt/flux=The balloon floats high above her;style/sdxl=35mm film photo;model=flux;model=sdxl'],
  ['Sharp edge: starts with word=', 'E=mc2 written on a chalkboard'],
  ['Sharp edge: text after a setting', 'jai:A castle;style=anime;with a moat and a drawbridge'],
  ['Habits from other tools', 'a cyberpunk city at night, neon rain --ar 16:9 --no people --v 6'],
  ['Full-width delimiters', '魔法の城；style＝anime'],
  ['Template text, escaped', 'prompt=Red mug\\; model\\=XZ-200\\; colour\\=red;style=product photo;aspect=1:1'],
  ['JSON form', '{"jai":1,"prompt":["A magical castle on a hill at dusk","Mist in the valley below"],"aspect":"16:9","style":"storybook illustration","strength":0.6}'],
  ['data: URL', 'data:image/jai,A%20magical%20castle;style=anime'],
  ['HTML with carriers', '<picture>\n  <source type="image/jai" srcset="data:image/jai,A%20magical%20castle;style=anime">\n  <img src="castle.png" alt="A magical castle">\n</picture>\n<img src="team.jpg" alt="The team" data-jai="Four people in front of a brick office;mode=keep">\n<img src="lighthouse.png" alt="jai:A lighthouse at night">'],
];

const sel = $('examples');
sel.append(new Option('Choose…', ''));
EXAMPLES.forEach(([label], i) => sel.append(new Option(label, String(i))));
sel.addEventListener('change', () => { if (sel.value !== '') { input.value = EXAMPLES[+sel.value][1]; update(); sel.value = ''; } });

let current = null; // { document, ... }
let htmlMode = 'picture';

function detect(text) {
  const t = text.replace(/^[\s﻿]+/, '');
  if (t.startsWith('<')) return 'html';
  if (/^data:/i.test(t)) return 'data';
  if (/^\{\s*["}]/.test(t)) return 'json';
  return 'text';
}

function analyse(text) {
  const kind = detect(text);
  let r, info = null, carriers = null, delivery = [];
  if (kind === 'html') {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    carriers = J.discoverAll(doc.body, { baseURL: location.href });
    const first = carriers.find(c => c.document);
    r = first ? { document: first.document, diagnostics: first.diagnostics || [] } : { document: J.createDocument(), diagnostics: [] };
    info = first?.info || null;
    for (const c of carriers) delivery.push(...J.validateDelivery({ carrier: c.carrier, element: c.element, decoded: c.document ? { document: c.document } : null }));
  } else if (kind === 'data') {
    r = J.decodeDataURL(text.trim()) || { document: J.createDocument(), diagnostics: [], notJai: true };
    info = r.info || null;
    if (/[\s#]/.test(text.trim().replace(/#.*$/, '')) || /%(?![0-9a-f]{2})/i.test(text)) delivery.push({ code: 'unencoded-url-text' });
  } else if (kind === 'json') {
    r = J.readJSON(text, { inContext: true });
  } else {
    r = J.parse(text); info = r.info;
  }
  const interp = J.interpret(r.document);
  const advisories = J.validate(r.document, info);
  return { kind, ...r, info, carriers, interp, advisories, delivery };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(d => { const k = d.code + '|' + (d.key || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

function renderDiagnostics(a) {
  const ul = $('diags'); ul.textContent = '';
  const all = dedupe([...a.diagnostics, ...a.delivery, ...a.advisories, ...a.interp.diagnostics]);
  if (a.notJai) all.unshift({ code: 'not-jai' });
  if (!all.length) { const li = document.createElement('li'); li.className = 'empty-ok'; li.style.border = '0'; li.style.background = 'none'; li.textContent = 'No problems found.'; ul.append(li); return; }
  for (const d of all) {
    const li = document.createElement('li');
    if (d.code === 'not-jai') { li.className = 'parser'; li.textContent = 'This is a data: URL, but not of type image/jai.'; ul.append(li); continue; }
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
  if (a.document.has('animate')) row('Animated', it.animate ? 'yes' : 'no');
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
function altText(doc) {
  const p = (doc.get('prompt') || [])[0];
  if (!p) return 'Image';
  // The description is the alt text, in full: JAI sets no length limit on it.
  return p.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function boxSize(it) {
  const r = it.aspect ? it.aspect.width / it.aspect.height : 1;
  return r >= 1 ? [1024, Math.round(1024 / r)] : [Math.round(1024 * r), 1024];
}

function renderHTML() {
  if (!current) return;
  const doc = current.document, url = J.toDataURL(doc), alt = escAttr(altText(doc));
  const bare = J.serialize(doc, { bare: true });
  const [w, h] = boxSize(current.interp.interpreted);
  let code = '', note = '';
  if (htmlMode === 'picture') {
    code = `<picture>\n  <source type="image/jai" srcset="${escAttr(url)}">\n  <img src="your-image.png" alt="${alt}" width="${w}" height="${h}">\n</picture>`;
    note = 'Recommended. Browsers without JAI support show your-image.png and never fetch the JAI source. Replace the alt text with your own description if it differs.';
  } else if (htmlMode === 'datajai') {
    // The first prompt value goes in alt (spoken by screen readers, first line for the model); the rest in data-jai.
    const prompts = doc.get('prompt') || [];
    const rest = new Map(doc);
    if (prompts.length > 1) rest.set('prompt', prompts.slice(1)); else rest.delete('prompt');
    const altExact = prompts.length ? escAttr(prompts[0]) : '';
    code = `<img src="your-image.png" alt="${altExact}"\n     data-jai="${escAttr(J.serialize(rest, { bare: true }))}">`;
    note = prompts.length
      ? 'The alt text is the description: screen readers speak it, and it is the first line the model receives. data-jai holds the rest and is not read aloud. Survives most HTML sanitisers.'
      : 'No description: the image needs an alt that describes it, which becomes the first prompt line.';
  } else if (htmlMode === 'src') {
    code = `<img src="${escAttr(url)}"\n     alt="${alt}" width="${w}" height="${h}">`;
    note = 'The pure form: no fallback pixels. Without a JAI viewer readers see only the alt text, so it must be real prose, and the size must be set.';
  } else {
    const altMd = altText(doc).replace(/\s+/g, ' ').replace(/[[\]\\*_]/g, '');
    code = `![${altMd}](<${url}>)`;
    note = 'Carrier 3 in Markdown image syntax, for hosts that keep data: URLs. The alt text stays plain prose for screen readers; JAI never goes in alt. Prefer raw HTML <picture> where the host allows it.';
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

async function update() {
  const text = input.value;
  store.set('jai-playground', text);
  const a = analyse(text);
  current = a;
  const labels = { text: 'text form', json: 'JSON form', data: 'data: URL', html: 'HTML' };
  $('detected').textContent = 'Read as ' + labels[a.kind] + (a.kind === 'html' ? ` · ${a.carriers.length} carrier${a.carriers.length === 1 ? '' : 's'}` : '');
  renderPlain(a);
  renderDiagnostics(a);
  highlightInto($('out-text'), J.serialize(a.document));
  $('out-json').textContent = J.canonicalJSON(a.document);
  $('out-url').textContent = J.toDataURL(a.document);
  renderHTML();
  const cw = $('carriers-wrap'), ol = $('carriers');
  ol.textContent = '';
  cw.hidden = a.kind !== 'html';
  if (a.kind === 'html') {
    const names = { 1: '<picture><source type="image/jai">', 2: 'data-jai attribute', 3: 'data:image/jai in src' };
    if (!a.carriers.length) { const li = document.createElement('li'); li.textContent = 'No JAI carrier found. alt is never JAI, even when it begins with jai:.'; ol.append(li); }
    for (const c of a.carriers) {
      const li = document.createElement('li');
      li.textContent = `Carrier ${c.carrier}: ${names[c.carrier]} — ` + (c.document ? J.serialize(c.document) : `fetches ${c.url} when the reader chooses to render`);
      ol.append(li);
    }
  }
  const textBytes = new TextEncoder().encode(J.serialize(a.document, { bare: true })).length;
  const jsonBytes = new TextEncoder().encode(J.canonicalJSON(a.document)).length;
  const file = await J.encode(a.document);
  if (current !== a) return;
  $('sizes').textContent = `${textBytes} bytes as text · ${jsonBytes} bytes as JSON · ${file.length} bytes as a .jai file`;
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

function encodeQuery(s) {
  return Array.from(s).map(ch => { const c = ch.codePointAt(0); return c < 0x21 || c === 0x7f || ch === '%' || ch === '#' ? '%' + c.toString(16).toUpperCase().padStart(2, '0') : ch; }).join('');
}
$('share').addEventListener('click', () => {
  if (!current) return;
  copyText(location.origin + location.pathname + '?' + encodeQuery(J.serialize(current.document, { bare: true })));
});

async function loadFile(f) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const r = J.decode(bytes, { inContext: true });
  input.value = r.document.size ? J.serialize(r.document) : '';
  await update();
  const extra = r.diagnostics.map(d => d.code).join(', ');
  $('detected').textContent = `Read ${f.name} as ${r.form === 'gzip' ? 'a .jai file (gzip JSON)' : r.form || 'unreadable bytes'}${extra ? ' · ' + extra : ''}`;
  if (r.form && r.form !== 'gzip') toast('Not gzip: accepted, but not a canonical .jai file');
}
$('file').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

// Initial content: the whole-query form (?A%20castle;style=anime), else the last session, else an example.
const q = location.search.slice(1);
if (q) input.value = new TextDecoder().decode(J.percentDecode(q));
else input.value = store.get('jai-playground') || EXAMPLES[1][1];
update();
