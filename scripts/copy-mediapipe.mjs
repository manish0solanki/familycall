// Copies MediaPipe's WebAssembly runtime into public/ so the app serves it itself
// (no third-party CDN at call time). Runs before `dev` and `build`.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join(root, 'public', 'mediapipe');

if (!existsSync(from)) {
  console.error(`[copy-mediapipe] ${from} not found. Run npm install first.`);
  process.exit(1);
}
mkdirSync(to, { recursive: true });
// The *_module_* variant is for ES-module workers, which we don't use.
const files = readdirSync(from).filter((f) => !f.includes('_module_'));
for (const file of files) cpSync(join(from, file), join(to, file));
console.log(`[copy-mediapipe] copied ${files.join(', ')}`);
