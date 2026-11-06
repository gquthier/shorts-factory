import { spawn } from 'node:child_process';

export interface RunResult { stdout: string; stderr: string }

/** Runs a command with argv (never a shell string) so filenames and URLs cannot inject anything. */
export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: [opts.input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout!.on('data', (d: Buffer) => out.push(d));
    child.stderr!.on('data', (d: Buffer) => err.push(d));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(out).toString();
      const stderr = Buffer.concat(err).toString();
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${cmd} ${args[0] ?? ''} failed (${signal ?? code}): ${(stderr || stdout).slice(-800)}`));
    });
    if (opts.input != null) child.stdin!.end(opts.input);
  });
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

export async function probeSize(file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = stdout.trim().split(',').map(Number);
  return { w: w!, h: h! };
}
