# Changelog

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
