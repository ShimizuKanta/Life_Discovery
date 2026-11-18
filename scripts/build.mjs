import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
await cp('public', 'dist', { recursive: true });
await writeFile('dist/.nojekyll', '');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(name));
    else if (entry.name !== 'sw.js') result.push(name);
  }
  return result;
}
const assets = (await files('dist')).sort();
const hash = createHash('sha256');
for (const path of assets) { hash.update(path); hash.update(await readFile(path)); }
hash.update(await readFile('public/sw.js'));
const version = hash.digest('hex').slice(0, 16);
const template = await readFile('public/sw.js', 'utf8');
const worker = template.replace("'__CACHE_NAME__'", '`life-discovery:${self.registration.scope}:' + version + '`')
  .replace('__ASSETS__', JSON.stringify(['./', ...assets.map(path => './' + path.slice(5))]));
await writeFile('dist/sw.js', worker);
console.log(`Built ${assets.length} assets. Offline cache: ${version}`);
