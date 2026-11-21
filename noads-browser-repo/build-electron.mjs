// Bundles the Electron main + preload processes to dist-electron (CJS).
// Uses esbuild, which ships as a transitive dependency of Vite — no extra
// dependency is added to package.json for this.
import * as esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/pagePreload.ts'],
  outdir: 'dist-electron',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Keep the Electron wrapper external: its CommonJS entrypoint resolves its
  // own preload package with require.resolve. Bundling its ESM helper into
  // this CommonJS output would leave import.meta.url undefined.
  external: ['electron', '@ghostery/adblocker-electron'],
  sourcemap: false,
  logLevel: 'warning',
});

if (result.errors.length > 0) {
  console.error('Electron bundle failed:', result.errors);
  process.exit(1);
}
console.log('dist-electron/ built (main.js, preload.js, pagePreload.js)');
