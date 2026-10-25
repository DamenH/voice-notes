// Fails if an OpenRouter key appears in the build output or tracked source.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const pattern = /sk-or-v1-[0-9a-f]{16,}/;
const bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (pattern.test(readFileSync(p, 'latin1'))) bad.push(p);
  }
}
if (existsSync('dist')) walk('dist');
const tracked = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const f of tracked) if (existsSync(f) && statSync(f).isFile() && pattern.test(readFileSync(f, 'latin1'))) bad.push(f);
if (bad.length) {
  console.error('Possible OpenRouter key found in:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('No secrets found.');
