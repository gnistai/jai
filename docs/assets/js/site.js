// Shared behaviour for the JAI website: theme toggle, copy buttons, JAI syntax
// colouring, and filling render details from the image manifest. CC0-1.0.
import { parse } from './jai.js';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---- theme
const root = document.documentElement;
const saved = store.get('jai-theme');
if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
for (const btn of document.querySelectorAll('.theme-toggle')) {
  const label = () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    btn.textContent = dark ? 'Light' : 'Dark';
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  label();
  btn.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('jai-theme', root.dataset.theme);
    label();
  });
}

// ---- toast
let toastEl;
export function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch { toast('Copy failed'); }
    ta.remove();
  }
}

// ---- JAI syntax colouring, built from DOM nodes (never innerHTML)
export function highlightInto(el, text) {
  el.textContent = '';
  const add = (cls, s) => { if (!s) return; const span = document.createElement('span'); if (cls) span.className = cls; span.textContent = s; el.append(span); };
  const m = /^(\s*)(jai:)?/i.exec(text);
  let i = m[0].length;
  add('', m[1]); add('tok-prefix', m[2] || '');
  const { info } = parse(text);
  // Re-split the raw text the same way the parser does, to colour keys.
  const segs = []; let cur = '';
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\\' && j + 1 < text.length) { cur += c + text[j + 1]; j++; continue; }
    if (c === ';') { segs.push(cur); cur = ''; continue; }
    cur += c;
  }
  segs.push(cur);
  let si = 0;
  const kinds = info.segments.slice();
  segs.forEach((raw, n) => {
    if (n > 0) add('tok-delim', ';');
    const isWs = /^[\s\u00a0\u3000]*$/.test(raw);
    const kind = isWs ? null : kinds[si++];
    if (kind && (kind.kind === 'assignment' || kind.kind === 'reserved')) {
      const eq = raw.search(/(?<!\\)=/);
      add('tok-key', raw.slice(0, eq)); add('tok-delim', '='); colourValue(raw.slice(eq + 1));
    } else colourValue(raw);
  });
  function colourValue(v) {
    const parts = v.split(/(\\[;=\\])/);
    for (const p of parts) add(/^\\[;=\\]$/.test(p) ? 'tok-escape' : 'tok-value', p);
  }
}

for (const code of document.querySelectorAll('code[data-jai-highlight]')) highlightInto(code, code.textContent);

// ---- copy buttons: <button data-copy="#id"> or data-copy-text="..."
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy], [data-copy-text]');
  if (!b) return;
  const text = b.dataset.copyText ?? document.querySelector(b.dataset.copy)?.textContent ?? '';
  copyText(text);
});

// ---- render details from the manifest: <details class="sent" data-image="id">
const sentEls = document.querySelectorAll('[data-image]');
if (sentEls.length) {
  const base = new URL('../images/', import.meta.url);
  fetch(new URL('manifest.json', base)).then(r => r.json()).then(m => {
    for (const el of sentEls) {
      const rec = m.images[el.dataset.image];
      if (!rec) continue;
      if (el.matches('details.sent')) {
        const pre = document.createElement('pre');
        pre.textContent = `renderer   ${rec.renderer}\nsize       ${rec.width}×${rec.height}\nidentity   ${rec.identity.slice(0, 16)}… (SHA-256 of the document text; contains nothing else)\nsent       ${JSON.stringify(rec.sent, null, 2)}`;
        el.append(pre);
      }
      if (el.matches('[data-image-meta]')) el.textContent = `${rec.renderer.split('/')[1]} · ${rec.width}×${rec.height}`;
    }
  }).catch(() => {});
}
