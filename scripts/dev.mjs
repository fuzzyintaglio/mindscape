// `npm run dev`: runs the server (auto-restarting on change) and the Vite UI
// dev server together. Open http://127.0.0.1:5317.
import { spawn } from 'node:child_process';

const procs = [
  spawn('node_modules/.bin/tsx', ['watch', 'server/index.ts'], {
    stdio: 'inherit',
    env: { ...process.env, MINDSCAPE_DEV: '1' },
  }),
  spawn('node_modules/.bin/vite', [], { stdio: 'inherit' }),
];

const stopAll = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
procs.forEach((p) => p.on('exit', (code) => { if (code) stopAll(); }));
