# JAI — Just AI Images

JAI compresses an image into words: a natural-language description plus a few
optional settings, from which a generative model reconstructs the picture. A
typical JAI image is 50 to 500 bytes at any resolution. It is designed for a
world where generating images is cheap and local and moving them is not:
links with little bandwidth, local GPUs that draw a picture in under a second,
and renders personalised for an audience of one. Read the
[vision](https://jai.gnist.ai/vision/).

```
jai:A magical castle at dusk;style=storybook illustration;aspect=16:9
```

The simplest JAI document is a sentence. The same document also has a JSON
form and a compressed file form (`.jai`, media type `image/jai`), and can be
embedded in HTML so that browsers without JAI support show ordinary pixels:

```html
<picture>
  <source type="image/jai" srcset="castle.jai">
  <img src="castle.png" alt="A magical castle at dusk">
</picture>
```

- **Specification:** [`spec/index.bs`](spec/index.bs), published at <https://jai.gnist.ai/spec/>
- **Conformance fixtures:** [`tests/`](tests/) (normative)
- **Reference implementation:** [`docs/assets/js/jai.js`](docs/assets/js/jai.js), dependency-free, browsers and Node 18+
- **Agent Skill:** [`skills/jai/SKILL.md`](skills/jai/SKILL.md), published at <https://jai.gnist.ai/SKILL.md>
- **Design record:** [`spec/DESIGN.md`](spec/DESIGN.md) — why the spec says what it says
- **Website and playground:** [`docs/`](docs/), served by GitHub Pages
- **Reference viewer (browser extension):** [gnistai/jai-tools](https://github.com/gnistai/jai-tools)

## Status

Edition **1.0-draft**, a living document. The data model, text grammar,
parsing algorithm, canonical forms and file form are intended to be stable;
the key vocabulary is extensible. Fixtures become append-only at the first
tagged edition. See the specification's stability appendix.

## Working on this repository

```sh
npm test                 # run every conformance fixture against jai.js (plus a round-trip fuzz)
npm run build:spec       # build docs/spec/index.html with Bikeshed (pipx install bikeshed)
npm run check:skill      # verify docs/SKILL.md is identical to skills/jai/SKILL.md
python3 -I tests/src/fixtures.py   # regenerate fixtures from their authoring source
```

To test another implementation, expose the same functions as `jai.js` from an
ES module and run `node tests/run.mjs --impl path/to/module.mjs`, or read the
JSON fixtures directly; their format is described in [`tests/README.md`](tests/README.md).

If you find an ambiguity, it is a specification bug: please open an issue
with the input, what you expected and what the text says. Every resolved
ambiguity gets a fixture.

## Licence

Everything in this repository — specification, fixtures, skill, website and
code — is released under [CC0 1.0 Universal](LICENSE). The editors make no
patent claims on the format and intend that anyone may implement it freely.
Third-party images and models referenced in examples remain under their own
terms.
