# Changelog

## 1.0-draft, encoding images — 2026-10-16

- New informative section *Encoding images*: analysis by synthesis (describe,
  render with fixed seeds, compare, revise, refine per model, stop on budget or
  plateau), its limits, and output conventions for image encoders (`model`
  ordered by fidelity, `aspect` from the original's pixels, no `seed`, scores
  only in the tool's vendor keys, never the original image).
- *Per-model refinements* notes that models with a short prompt window may
  never see refinements appended after a long core.
- Examples page: NASA's *Earthrise* encoded for FLUX.1 schnell and SDXL with
  the reference encoder in jai-tools (465 bytes against 64,374 for the JPEG),
  with the document and the full report in `examples/encoding/`.

## 1.0-draft, per-model refinements — 2026-10-16

- Qualified keys `prompt/<target>`, `style/<target>` and `avoid/<target>`
  carry refinements for one model family, identifier or alias. Interpreters
  append the matching values to the core values after model matching;
  qualifiers never select a model. Other keys with a target draw the new
  validator code `invalid-qualifier`.
- Canonical order: `prompt`, then `prompt/<target>` keys by code point, then
  the other keys by code point.
- New sharp edge: `a/b=c` after a semicolon is an assignment.
- Fixtures: 27 new cases (492 total); `interpret` fixtures gain `selected`,
  `style` and `avoid`.

## 1.0-draft, vision and layout — 2026-10-16

- The introduction now frames JAI as compression (rate–distortion, a
  generative prior, analysis-by-synthesis encoding) and argues its use cases
  in a new Motivation section; new informative section on personalisation for
  an audience of one, with normative marking rules.
- `aspect` versus layout: the governing ratio (original image, else an
  author-sized box) wins; renders are never stretched.
- Website: new Vision page; the homepage leads with the vision.

## 1.0-draft, review round 2 — 2026-10-16

An independent implementation written from the specification alone exposed
the gaps below; all are fixed, with 93 new or replaced fixtures (454 total).

- Diagnostics: a Key column says which key each code carries; interpreter
  codes are their own normative class; new validator codes `attribute-split`,
  `data-url-missing-comma`, `data-url-parameter`.
- The fixture format is defined normatively, with a map from conformance
  classes to fixture classes.
- Interpretation strips quotes and a trailing full stop only from
  single-valued keys. `source` is validated without fetching.
- `data-jai` is always text; "JAI context" is defined once.
- Carrier 1 follows HTML's srcset parsing exactly.
- Decoding: invalid deflate is defined as what zlib rejects; FHCRC is checked;
  the byte 00 is rejected in byte input; JSON nesting is limited to depth 32;
  numbers that overflow binary64 make JSON invalid; `duplicate-key` and
  `duplicate-member` are defined precisely.
- Model matching: version suffixes, family selection and the transform
  fallback (`mode-degraded`) are specified.
- Query forms: null versus empty queries and byte decoding are specified.
- The canonical URL form percent-encodes `"`, `'`, `<` and `>`.
- Security and viewer prohibitions use BCP 14 keywords; `keep` is never
  rendered automatically; no bandwidth claims.
- Transform documents describe the result, not the edit.
- Corrected example rows that had lost backslashes; tables now render in the
  published spec; CI checks examples against `jai.js`, regenerates fixtures
  and builds the spec.
- Agent Skill: attribute quoting, the full assignment rule, `mode=keep` for
  real photos, carrier by destination, a `.jai` recipe, more dialect rows.

## 1.0-draft — 2026-10-16

First public draft.

- Data model, text form with normative parsing algorithm and canonical
  serialisation, JSON form with RFC 8785 string rules, gzip file form,
  layered total decoding, `image/jai`, `data:` URL encoding profile.
- Eleven standard keys with normative value interpretation; model matching
  by selector, never locator.
- HTML carriers (`<picture><source type="image/jai">`, `data-jai`,
  `data:image/jai` in `src`, deprecated `jai:` in `alt`), transport decoding,
  query forms, viewer replacement and accessibility requirements.
- Security and privacy requirements as testable invariants.
- 361 conformance fixtures; dependency-free reference implementation.
- Design reviewed by ten adversarial lenses before drafting; see
  `spec/DESIGN.md`.
