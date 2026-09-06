/**
 * Generate public/sw.js from committed public/sw.template.js.
 *
 * Source of truth is the TEMPLATE (always carries __CACHE_VERSION__). This
 * script writes the concrete public/sw.js that Vercel serves, so the deployed
 * /sw.js carries a per-build stamp — enabling SW update detection and the
 * versioned-CACHE_NAME purge. public/sw.js is gitignored; only the template is
 * committed, so the marker can never be lost to a stray commit.
 *
 * Build is run separately by package.json (`node scripts/stamp-sw.mjs && next
 * build`) so PATH includes the project's local binaries on every platform.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const tplPath = path.join(root, 'public', 'sw.template.js');
const outPath = path.join(root, 'public', 'sw.js');
const tpl = fs.readFileSync(tplPath, 'utf8');

if (!tpl.includes('__CACHE_VERSION__')) {
  console.error('[stamp-sw] ABORT: public/sw.template.js has no __CACHE_VERSION__ marker.');
  process.exit(1);
}

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return null;
  }
}

const buildId = gitSha() || Date.now().toString(36);
const stamped = tpl.replace('__CACHE_VERSION__', buildId);
fs.writeFileSync(outPath, stamped);
console.log(`[stamp-sw] generated public/sw.js (cache version ${buildId})`);
