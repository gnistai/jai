# Changelog

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
