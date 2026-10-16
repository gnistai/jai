#!/usr/bin/env node
// Fails when the canonical skill (skills/jai/SKILL.md) and the published copy
// (docs/SKILL.md) differ. Run `npm run sync:skill` to copy canonical -> docs.
import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = join(root, 'skills', 'jai', 'SKILL.md');
const published = join(root, 'docs', 'SKILL.md');

if (process.argv.includes('--write')) {
  copyFileSync(canonical, published);
  console.log(`copied ${canonical} -> ${published}`);
  process.exit(0);
}

for (const p of [canonical, published]) {
  if (!existsSync(p)) {
    console.error(`missing: ${p}`);
    process.exit(1);
  }
}

const a = readFileSync(canonical);
const b = readFileSync(published);
if (!a.equals(b)) {
  console.error('skills/jai/SKILL.md and docs/SKILL.md differ. Run: npm run sync:skill');
  process.exit(1);
}
console.log('skill in sync');
