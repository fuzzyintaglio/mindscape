// `npm run release`: builds the self-contained bundle in release/ that the work
// Mac runs with plain `node` — no `npm install` there, ever.
//
//   release/server.mjs   server + all its dependencies
//   release/cli.mjs      mindscape CLI + all its dependencies
//   release/ui/          built web UI
//   release/BUILD.json   version, source fingerprint, build time
//
// release/ is committed to git. Rebuild and commit it whenever the code changes;
// tests/release.test.ts fails if you forget.
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { sourceHash } from './source-hash.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

execSync('node_modules/.bin/vite build', { stdio: 'inherit' });

rmSync('release', { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
  // Some dependencies use require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: {
    'process.env.MINDSCAPE_BUNDLED': '"1"',
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
};

await build({ ...common, entryPoints: ['server/index.ts'], outfile: 'release/server.mjs' });
await build({ ...common, entryPoints: ['cli/mindscape.ts'], outfile: 'release/cli.mjs' });
cpSync('dist/ui', 'release/ui', { recursive: true });

const source = sourceHash();
writeFileSync(
  'release/BUILD.json',
  JSON.stringify({ version: pkg.version, source, builtAt: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`release/ built — v${pkg.version}, source ${source}`);
