import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

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

const babylonOutput = join(output, 'babylon');
const babylonPackage = join(root, 'node_modules', '@babylonjs', 'core');
await mkdir(babylonOutput);
await Promise.all([
  cp(join(root, 'babylon', 'index.html'), join(babylonOutput, 'index.html')),
  cp(join(root, 'babylon', 'styles.css'), join(babylonOutput, 'styles.css')),
  cp(join(babylonPackage, 'license.md'), join(babylonOutput, 'babylon-license.md')),
  cp(join(babylonPackage, 'NOTICE.md'), join(babylonOutput, 'babylon-notice.md')),
]);
await build({
  entryPoints: [join(root, 'babylon', 'src', 'main.ts')],
  outfile: join(babylonOutput, 'scene.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022', 'safari16'],
});

console.log(`Built static site in ${output}`);
