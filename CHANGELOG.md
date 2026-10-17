# Changelog

## 1.0-draft, HTML and files — 2026-10-17

JAI now does two things, HTML and files, and every place that holds a document
says so itself and holds exactly one serialisation.

- **Attribute carrier:** `alt` is the prompt unless `data-jai` gives one. Write
  the description once in `alt` and the settings in `data-jai`, or start
  `data-jai` with the description and `alt` stays the page's own text.
- **No `jai:` prefix.** The text form appears only in `data-jai` and in
  `data:image/jai` URLs, which both mark it already. The canonical text is
  the old bare form without its `jai:` and `{` rules (a first prompt that
  begins with U+FEFF is still written as `prompt=`).
- **No sniffing.** A `.jai` file or resource is always the file form (one gzip
  member of canonical JSON); a `data:image/jai` body is always the text form.
  The JSON reader has no context flag.
- **Removed:** the query forms and gateways, the other-host-formats list and
  the carriers-by-context matrix, the appendix on existing formats (prompt
  import, raster embedding, dialects), the `animate` key, and the codes
  `alt-repeated`, `prefix-in-prompt`, `jai-scheme-url`,
  `non-canonical-encoding` and `foreign-syntax`, plus `stray-wrapper`,
  `url-split` and `colon-assignment`, which nothing emitted.
- The reference libraries export `validateDataURL`, the validator checks for
  a `data:image/jai` URL on its own, and judge `keep-in-source` by the
  interpreted mode.
- Ten standard keys remain.

## 1.0-draft, reference implementation fix — 2026-10-17

- The reference implementation no longer takes quadratic time on long runs of
  whitespace or commas. The `newline-assignment` check and every trim (values,
  media types, URLs, `srcset` candidates) now run in linear time: a value of
  200,000 newlines validates in under a tenth of a second instead of minutes.
  Results are unchanged. Found by the JAI Studio code review.

## 1.0-draft, an encoder that measures — 2026-10-16

- *Encoding images* now describes the loop that works: measure the original
  (subjects' boxes, horizon height and shape, palette, lightness), render each
  candidate with a few seeds, measure every render the same way, compute the
  fitness from the differences, and let an optimiser write new candidates from
  the best earlier ones and their measured differences, largest first.
  Holistic similarity scores are named as poor guides.
- Examples: Earthrise (449 bytes) and Buzz Aldrin on the Moon (585 bytes),
  each from a single automatic run of the reference encoder for FLUX.1
  schnell, with full reports in `examples/encoding/`.

## 1.0-draft, named carriers and `.jai` files in `src` — 2026-10-16

- Carriers have names instead of numbers: the **picture**, **attribute** and
  **src** carriers. Their order is precedence when one element carries
  several, not a recommendation; a new "Choosing a carrier" section makes the
  attribute carrier (`alt` as the description plus `data-jai`) the everyday
  default, the picture carrier the native path, and the src carrier the form
  for images without pixels. Fixtures use the names.
- The src carrier accepts a `.jai` file: an http(s) `src` whose path ends in
  `.jai`. `alt` is not used for it, and Markdown's `![…](castle.jai)` is now a
  JAI image. A JAI `src` that HTML would never use (own `srcset`, preceding
  `<source>`) is not a carrier (`src-shadowed`). A viewer stands down when the
  address delivers pixels, and treats `text/html` responses as no document.
- `.jai` resources are fetched only when the user opens an image's controls or
  a render starts, never during discovery. A privileged context may fetch only
  `.jai` paths over http(s), without redirects, never private-network hosts
  from public pages, and within a per-page limit.
- Examples show an `alt` that differs from the description for the picture and
  src carriers: `alt` is the page's own text there, not a duplicate.
- Fixtures: 537.

## 1.0-draft, alt is the description — 2026-10-16

- The `alt` carrier (`alt` beginning with `jai:`) is removed. `alt` is the
  image's text for people who cannot see it, and screen readers would read
  JAI syntax in it aloud; an `alt` that begins with `jai:` is ordinary text.
- For `data-jai`, the element's `alt` is now the first prompt value, taken
  literally and never parsed: `<img alt="A magical castle at dusk"
  data-jai="style=anime">`. The description is written once and serves both
  screen readers and models; `data-jai` holds extra detail, settings and
  refinements that are not read aloud. New validator code `alt-repeated`.
- The accessible name generated from a description is no longer truncated.
  Authoring guidance: describe what can be seen, essentials first, visible
  facts over mood words; a content image's `alt` says what it shows.
- Readable without seeing (vision-impaired readers and text-only AI agents) is
  now the first use case on the Vision page, the homepage and in Motivation.
- Fixtures: 520.

## 1.0-draft, review round 3 — 2026-10-16

An independent Go implementation written from the specification alone
(492/492 fixtures), an adversarial review of the newest sections, and a
security and accessibility review of the tools. Fixes:

- *Description* is the core text readers see; the new *model description* is
  what one model receives after per-model refinements. Interpret fixtures gain
  `model_description`, `model_style` and `model_avoid`; `description`,
  `style` and `avoid` stay the core.
- Consent and UI hygiene cover refinements; renderers forward qualified keys
  only through per-model refinements; targets SHOULD be family names.
- Refusals: no retry with altered model input (refinements, model or
  personalisation) unless the user asks in viewer UI. Personalisation is off
  by default, never triggered by a document or page, marked generically in the
  page, and cached separately; render cache keys include the selected model
  and any personalisation. Marking renders as generated is now a MUST.
- The governing ratio is the author-sized layout box first, then the
  original's ratio, matching the replacement rules.
- The canonical URL form encodes `&`; the canonical JSON note includes the
  `prompt/…` members; a leading U+FEFF is not JSON; the gzip rejection list
  names CM and truncation; `animate` defaults to false; binary64 arithmetic is
  stated; an interpreter with no models does no matching; a user-selected
  model suppresses matching codes; a valid `source` is an input image for
  eligibility; shadow-root discovery order is defined; validator definitions
  for qualified keys are precise; shared codes count once.
- Motivation: corrected the JPEG comparison, the rate–distortion framing, the
  CELP analogy, the provenance claim and the bandwidth claims.
- Fixtures: 23 new cases (515 total), including escaping before qualified keys
  that a mutant serialiser got wrong while passing the old suite; the fuzz
  alphabet now includes qualified keys.

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
