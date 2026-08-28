import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, '_site');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of ['index.html', 'styles.css', 'LICENSE']) {
  await cp(join(root, file), join(output, file));
}

for (const directory of ['src', 'assets']) {
  await cp(join(root, directory), join(output, directory), { recursive: true });
}

console.log(`Built static site in ${output}`);
