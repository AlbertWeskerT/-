import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npmCommand, ['run', 'dev:server'], { stdio: 'inherit' }),
  spawn(npmCommand, ['run', 'dev:web'], { stdio: 'inherit' }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('[dev] Could not start a child process.', error);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping && code && code !== 0) stop(code);
  });
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
