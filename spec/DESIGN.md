# JAI design record

This file records *why* the specification says what it says. The normative
text is `spec/index.bs` (built to `docs/spec/index.html`); the conformance
fixtures in `tests/` are authoritative where they and prose disagree.

History: a first draft of this record (round 0) was reviewed by ten
independent reviewers (grammar/fuzzing, author ergonomics, web platform,
security, renderer implementability, file format, AI-agent encoder,
accessibility/i18n, concept/strategy, prior art), each followed by a skeptic
who tried to refute every finding, and a synthesis. 178 findings were filed,
of which 150 held at least in part. The decisions below are the result. The
owner's direction that overrides the original brief: `.jai` is gzipped JSON;
JAI should be embeddable in `src` like a `data:` URI; the format is an image
on the extreme end of lossy.

Each decision has an id. "Rejected" lists alternatives considered and the
reason they lost.

## 0. Framing

- **D0.1 A description is compression.** JAI is image compression taken to the
  far low-rate end of the rate–distortion curve: distortion is measured in
  meaning and appearance, and the decoder carries a learned prior (as a
  vocoder carries a model of the voice). Encoding is analysis by synthesis,
  as in CELP. Revised on the owner's direction (2026-10-16): round 1 had
  demoted the codec framing to a "design principle, not a claim" and used a
  MIDI analogy; the owner's view is information-theoretic, and the spec now
  argues the use cases (little bandwidth with local compute, cheap local
  generation, audience-of-one personalisation, longevity, text-native images,
  honest provenance), with hosted APIs described as today's stage. The honest
  limits stay: a decoder produces an image, not the image.
- **D0.2 Priorities.** Easier to write, then easier to implement correctly,
  then more compact. Readability of the *canonical* form is not a goal above
  those.
- **D0.3 Small standard.** Eleven standard keys, one delimiter, three escapes,
  one media type. Additions need a clear semantic a renderer can act on.
  Rejected keys: `text` (literal text; quoted strings in prose are what every
  text-capable model documents), `lang` (`dc.language` covers it), `size`,
  `steps`, `guidance`, `title`/`author`/`license` (`dc.*`).

## 1. Data model

- **D1.1** A document is a map from *key* to an ordered list of one or more
  *values*. Order within a key is significant; order across keys is not.
  `prompt` is an ordinary key, special only in the text syntax.
- **D1.2** Keys are ASCII, `[a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)*`,
  compared after ASCII lowercasing. Every case operation in the spec is ASCII
  only; locale-sensitive mapping and Unicode case folding are forbidden
  (Turkish `I`, U+212A Kelvin, U+0130).
- **D1.3** Values are scalar value strings. Every reader applies one *value
  normalisation* at the data-model boundary: lone surrogates → U+FFFD,
  CRLF/CR → LF, U+0000 → U+FFFD, trim JAI whitespace, drop if empty. Values
  therefore never start or end with whitespace and never contain CR.
- **D1.4 JAI whitespace** is exactly the 25 code points with the Unicode
  `White_Space` property, listed in the spec. `String.prototype.trim`,
  `str.strip()` and `\s` each remove a different set and must not be used.
  Chosen over Infra's 5 ASCII code points because NBSP (rich-text editors)
  and U+3000 (CJK IMEs) after `;` would otherwise silently defeat assignment.
  The JSON sniff uses JSON whitespace separately.
- **D1.5** The key `jai` is reserved: in JSON it is the format marker
  (`"jai": 1`), in text an assignment to it is dropped (`reserved-key`).
- **D1.6** The marker is identification first, version second. The spec does
  not expect to assign another value: changes are additive. Readers always
  parse best-effort; viewers never auto-render a document with an unknown
  value (`unsupported-version`).
- **D1.7** One document describes one image. Members whose value is an object
  or an array containing non-strings are reserved for future versions and are
  dropped with `unsupported-member`.
- **D1.8** Maps keyed by document keys must be real maps (`constructor`,
  `__proto__`).

## 2. Text form

- **D2.1** `[OWS][jai:][segment(;segment)*][;]`. A segment is an assignment
  when the text before its first unescaped `=` is, after trimming, a key;
  otherwise it is prose. The first prose segment is the prompt; later prose
  continues the most recent value with the `;` restored. Empty and
  whitespace-only segments are dropped. Values are unescaped and normalised
  once, at the end.
- **D2.2** Escapes: `\;`, `\=`, `\\`. Any other backslash is literal.
  *escape-prose(s)* (escape all three) is the author/template recipe;
  `prompt=escape-prose(s)` always yields exactly `s` as one prompt value.
  Rejected: doubling, quoting, LF as a delimiter before `key=` (turns
  chalkboards and recipes into assignments; diagnostics cover the case).
- **D2.3** Known sharp edges, accepted and diagnosed: `E=mc2` first segment is
  parameter `e` (`first-segment-assignment`); prose after an assignment joins
  that value (`continuation-into-single-valued-key`, `no-prompt`); OWS is
  allowed around `=`.
- **D2.4** Leading JAI whitespace is skipped before the prefix test; the
  prefix is removed once; every U+FEFF is removed at the start only.
- **D2.5 Canonical serialisation.** `jai:` + prompt values (first bare unless
  it would mis-parse, then `prompt=`), then keys in code point order,
  repeated keys adjacent. Value escaping is one left-to-right pass:
  `\` before `;` `=` `\` or at the end → `\\`; `;` at the start, or followed
  by OWS then end / `;` / `key OWS =` → `\;`. `=` never escaped. Two-pass
  implementations escape backslashes first. Fuzzed: 0 failures in 300k
  documents with these rules (round-0 rules failed on a trailing `\` and a
  leading `;`). Rejected: escape-all (hole-free in one sentence, but it
  teaches authors that prose semicolons need escaping).
- **D2.6** Bare form (no prefix) protects a first prompt beginning with
  `jai:`, U+FEFF or `{` with `prompt=`.

## 3. JSON, canonical JSON, identity, file

- **D3.1** `{"jai":1, key: string | string[] ...}`. Readers: numbers →
  ECMAScript `Number::toString` (RFC 8785 §3.2.2.3), booleans → `true`/
  `false`, `null`/empty → dropped, object or nested array → `unsupported-
  member`, invalid key → `invalid-key`, members read into an insertion-ordered
  map keyed by exact name (an exact repeat replaces in place), names that
  collide after lowercasing are concatenated in that order (`duplicate-key`).
  Rejected: dropping all non-string scalars (simpler, but `"strength": 0.6`
  is what hand-written JSON looks like).
- **D3.2** Canonical JSON: UTF-8, no whitespace, members `jai`, `prompt`,
  then code point order; strings escaped exactly as RFC 8785 §3.2.2.2; no
  Unicode normalisation anywhere. Deviation from pure JCS: `jai`/`prompt`
  first, so every file starts with `{"jai":1` followed by `,` or `}` after
  inflation.
- **D3.3** Identity = SHA-256 of canonical JSON; syntactic; names the
  document, never a render. A render cache key adds renderer configuration,
  every image input, and (for cross-site privacy) the top-level site.
- **D3.4** `.jai` = exactly one RFC 1952 member, CM=8, nothing after it,
  content canonical JSON. Decoders reject reserved FLG bits, CRC/ISIZE
  mismatch, trailing bytes, nested gzip, and bound output during inflation
  (RECOMMENDED 16 MiB). Encoders SHOULD write MTIME=0 and no FNAME/FCOMMENT.
  Rejected: FEXTRA signature subfield (optional features nobody implements),
  fixed 16-byte header as MUST (`gzip -c` would be non-conforming), brotli/
  zstd/CBOR (not universally decodable in browsers).
- **D3.5 Decoding is layered and total.** `1F 8B` → gunzip → must be JSON;
  else strict UTF-8 (ill-formed, or containing the byte 00 → `undecodable`;
  the 00 rule keeps headerless UTF-16 and other binary from becoming a
  prompt), skip JSON whitespace; `{`
  followed by `"` or `}` → JSON (failure → `invalid-json`, never a fallback);
  otherwise text. Rejected: falling back from JSON to text (renders garbage,
  splits decoders), text branch accepting any bytes.
- **D3.6** One media type, `image/jai`, for all three serialisations, matched
  by essence. Unregistered for now (as `image/webp` was until RFC 9649); the
  spec carries an RFC 6838 registration template. Owner question: the
  registrable alternative `image/vnd.gnist.jai` was rejected by default
  because it brands a CC0 standard. Name collisions (JPEG AI `image/jaii`,
  JAI A/S cameras, the Jai language's `.jai`) are recorded, not resolved.

## 4. Standard keys

`prompt`, `style`, `avoid`, `model` (many); `aspect`, `mode`, `strength`,
`seed`, `source`, `preview`, `animate` (one; last wins at interpretation,
`repeated-single`; the parser keeps every value).

- **D4.1** Value interpretation is a normative procedure so renderers agree:
  strip one pair of ASCII quotes and one trailing `.`, match ASCII
  case-insensitively; `aspect` accepts `W:H`, `WxH`, `W×H`, `W/H`, decimal
  numbers, `square`/`landscape`/`portrait`; `strength` accepts `0.6` and
  `60%`, clamped; `seed` 1–20 digits; `animate` true/yes/1/on and the
  negatives. Decimal comma rejected with a suggestion (no web format accepts
  it). Interpreters must not use lenient or locale-aware number parsers.
- **D4.2** `model` is a selector, never a locator (see D8). Matching: exact
  id/alias, then family by contiguous runs of ASCII-alphanumeric words,
  last path segment first. Rejected: "first component" (picks `black`,
  `https`).
- **D4.3** `avoid`: positive statements, one item per value; negative prompt
  where the model has one; otherwise fold or omit, but report. Rejected:
  mandatory folding (negation benchmarks: folding can produce what it names).
- **D4.4** `preview`: raster `data:` URI, ≤ 64 px, ~1 KiB; never an input.
  `source`: raster `data:` URI or URL; `transform` only; explicit `source`
  wins over the element's image. BlurHash/ThumbHash may come later as
  prefixed values.
- **D4.5** `animate`: kept (owner default). Requests a looping animated
  *image*; still frame with `unsupported-parameter` otherwise; viewer motion
  rules apply.
- **D4.6** `aspect` in HTML: the element's *governing ratio* (the original's
  ratio, else an author-sized layout box) governs the render (`ignored-value`
  if `aspect` differs by more than 1%); otherwise `aspect`, then `preview`, then
  the renderer default. Renders are never stretched: the page's `object-fit`
  applies, else a centred cover crop. Changed after the owner asked how
  `aspect` meets custom dimensions: the earlier order let `aspect` beat a sized
  box, which stretched renders under the default `object-fit: fill`.
- **D4.7** Not document intent, ever: output format, candidate count,
  quality/speed tier, safety settings. Vendor keys for these are refused.

## 5. Modes

`generate` (default), `transform` (original or `source` is an input, with
`strength`; model selection considers only image-capable models; degrades to
`generate` with `mode-degraded`), `keep` (render only on request; a request
is `generate` unless the user asks for a transformation). Failure = any
outcome without a usable image; restore the original, never retry with an
altered description. The viewer always wins over `mode`.

## 6. HTML and URLs

- **D6.1 Carriers**, discovery order: (1) `<picture><source
  type="image/jai" srcset>` — HTML's own negotiation, preferred; (2)
  `data-jai` attribute — inline, survives most sanitisers, kept with a note
  that HTML intends `data-*` for the page's scripts; (3) `src` that is a
  `data:image/jai` URL — the pure form, requires prose `alt` and a sized box,
  labelled "for JAI-aware surfaces"; (4) `alt` beginning with `jai:` —
  deprecated, recognised, never rendered automatically, no `data:` payloads,
  kept only because it is the sole Markdown/strict-sanitiser carrier.
- **D6.2 No `jai:` URL scheme.** `jai:` is a text prefix. Rejected after
  five lenses: no media type, stripped by DOMPurify, OS handler in links,
  unregistrable, redundant with `data:image/jai`.
- **D6.3 One transport decoding per carrier.** `data:` URLs: the Fetch data:
  URL processor (fragment excluded, lenient percent-decode); http(s): the
  response body regardless of `Content-Type`; attributes: none. Never a second
  percent-decoding; never `decodeURIComponent`.
- **D6.4 URL encoding profile.** In a `data:image/jai,` body encode C0,
  U+007F, ASCII whitespace, `%`, `#`, and a trailing `,`; everything else may
  stay literal. Rejected: encoding `,` `"` `'` `<` `>` and non-ASCII (not
  needed, +17 % size).
- **D6.5 Query forms.** Whole-query form (`?prompt=…;style=…`): raw query,
  percent-decoded once, `+` literal, `&` prose, no other parameters.
  Parameter form (`?jai=…`): read by any form parser (`+` is space), coexists
  with other parameters; the informative gateway convention.
- **D6.6 Replacement** must be effective under HTML source selection (insert
  a viewer `<source>` or set `srcset`; never rely on `src` alone), verified by
  `load`/`currentSrc`, CSP-aware (fall back to a canvas painted from local
  bytes), reversible, once per identity per page load, lazy-loading aware,
  and accessible (keep human `alt`; name from the prompt only when `alt` was
  the JAI string or absent; expose the AI-rendered state; no hover-only
  controls; no transitions under reduced motion).

## 6b. Personalisation

A viewer MAY, at the user's request, render with user-chosen transformations
(style, sensitivity or accessibility adjustments, translated in-image text,
mood). The render is marked as personalised, the document is unchanged, an
unpersonalised render stays available, and neither documents nor pages can
trigger it. It may never be used to get past a refusal.

## 6c. Per-model refinements

`prompt/<target>`, `style/<target>` and `avoid/<target>` refine the core for
one model, like a font stack: `model=` stays the ordered preference, the core
is the fallback every model receives, and the selected model's matching
qualified values are appended after the core. Decisions, with the owner:

- The target is one family name, identifier or alias token, matched ASCII
  case-insensitively. Rejected: lists or wildcards in the target, and
  qualifiers that select a model (two mechanisms for one choice).
- Only `prompt`, `style` and `avoid` take a target. Single-valued keys such
  as `aspect` or `seed` would need override rather than append semantics and
  would let one document carry different images per model. Other keys with a
  target parse and round-trip but draw `invalid-qualifier`.
- Append, not replace: the core never disappears from the model input. A
  refinement can still change the picture for one model (an `avoid/<target>`
  can even remove the core subject), which is why review round 3 made viewers
  show refinements wherever they show the core, and split *description*
  (core, for readers) from *model description* (what one model receives).
- Targets should be family names: identifiers rarely fit one key segment and
  aliases are local configuration (review round 3).
- Cost: `; a/b=c` in prose now parses as an assignment (sharp edge 5). The
  same edge already existed for `; a=c`, and the escape is the same.

## 6d. Encoding images

The image encoder is a tool, not a conformance class: the existing class named
*encoder* produces the file form, so the new section uses *image encoder*.
Nothing about the algorithm is normative; output conventions are
recommendations so that encoded documents stay hand-editable and portable.
Lessons from the reference encoder's first runs, recorded because they shaped
the text:

- CLIP image similarity saturates (0.95 and up for any render of the right
  subject), so it cannot rank layout. A coarse thumbnail colour distance and a
  vision model's rating carry the selection.
- Vision-model ratings drift between calls, so the current best is re-rated
  in every call with the new candidates.
- A plain mean lets the core sacrifice one model; fitness blends the mean with
  the worst model's score.
- Models with a 77-token text encoder never see refinements appended after a
  long core, hence the note in *Per-model refinements*.

## 7. Extensibility

Undotted keys are reserved for the spec; vendors use `vendor.name`; `dc.`
is reserved for Dublin Core terms. Renderers forward vendor keys only through
a validated mapping with a deny-list (see D8). Rejected: `x-` prefixes
(BCP 178), a registry.

## 8. Security

Stated as testable invariants: decoding has side effects (disclosure);
every input is bounded; a viewer uses as render input only image data the
embedding document could itself read (no cross-origin laundering via
`transform`); `model` and every artefact-naming key is a selector; nothing in
a document may cause fetching, loading or executing artefacts, or change
endpoint, credentials, safety, count or billing; automatic rendering is
per-site opt-in with budgets, bounded concurrency and cancellation; renders
are attributable to the user and the viewer says so; what leaves the browser
is the mapped parameters and locally re-encoded image bytes only; caches are
partitioned; viewer UI renders document text as text with bidi isolation.

## 9. Conformance and governance

Classes: document, parser, JSON reader, decoder, serialiser, encoder,
validator, interpreter, renderer, viewer, authoring tool. Fixtures are
normative; diagnostics are codes; parser codes are exact, validator codes
advisory, renderer codes mandatory when the condition occurs. Reference
implementation: `jai.js` + `tests/` in this repository; reference viewer: the
extension in `jai-tools`. Living document with a pinned date and an
edition stamp (`1.0-draft`); keys are never removed; fixtures are append-only
after the first tag. Everything in this repository is CC0-1.0.

## 9b. Review round 2 (spec-only implementation)

An independent Python implementation was written from the specification
alone, before its author saw the fixtures or `jai.js`. It passed 303 of the
then 361 fixtures on spec-only choices and all of them after reading the
fixtures; on 4,000 random inputs it agreed with `jai.js` every time. Its 31
recorded guesses and 33 behavioural divergences became 76 fixes and 93 new or
replaced fixtures (454 in total). Decisions taken:

- Diagnostics carry a defined key (a Key column in the table); interpreter
  codes are a normative class of their own; the fixture format is defined
  normatively in the spec.
- Quotes and a trailing full stop are stripped only from single-valued keys;
  `prompt`, `style`, `avoid` and `model` are used as written.
- `data-jai` is always the text form; "JAI context" is defined once (files,
  `image/jai` resources, `data:` bodies).
- Carrier 1 follows HTML's srcset parsing exactly (an unencoded space drops
  the candidate). Rejected: a private first-URL rule, which would overlay a
  render of the wrong text on the picture the browser shows.
- Invalid deflate is defined as exactly what zlib rejects, so platform
  decoders conform; FHCRC is verified; JSON nesting is limited to depth 32
  (Python's standard library recurses); numbers that overflow binary64 make
  the JSON invalid.
- Model matching: try the value as written, then without a trailing
  `:version`/`@version` of the last segment (reporting `version-ignored` only
  when that matched), then families by earliest, longest, first-listed run;
  the step-2 default may be ineligible, giving `mode-degraded` in transform.
- The query forms parse the URL first (null query = no document, empty query =
  empty document, UTF-8 with replacement).
- Security prohibitions use BCP 14 keywords. Transform documents describe the
  result, not the edit, because they are rendered as `generate` when the
  original is unreadable.
- `jai:  ;A castle` emits `empty-segment` like `;A castle` (D2.4; fixture
  `parse-semicolon-ws-prefix`).
- Informative one-liners proposed in round 1 for S-16, S-17, S-30, S-43, S-49,
  S-64, S-65 and S-66 that are not in the spec were dropped deliberately to
  keep it short; the website and the skill carry the author-facing parts.

## 10. Open questions for the owner

1. Media type: unregistered `image/jai` (default) or `image/vnd.gnist.jai`.
2. `animate`: keep with the output contract (default) or reserve.
3. The name JAI and `.jai`: keep (default) knowing the collisions above; a
   trademark opinion is advisable before launch.
4. A `title` carrier for Markdown (`![alt](img "jai:…")`): not in v1
   (default).
5. Patent non-assert for the spec text beyond CC0: W3C Document Licence or
   OWFa (default: add a short non-assert statement in the README).
