import { spawn } from 'node:child_process';

/**
 * Environment variables that make git look somewhere other than the repository we discovered (or change how it
 * interprets pathspecs). The previous libgit2-based implementation ignored all of these, so we scrub them to keep
 * behavior the same, notably when `git-wip` is run from inside a git hook where git sets `GIT_DIR`/`GIT_INDEX_FILE`.
 *
 * This is `git rev-parse --local-env-vars` plus the discovery and pathspec knobs.
 */
const SCRUBBED_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_LITERAL_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
];

export class GitError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;

  constructor(args: readonly string[], exitCode: number | null, stdout: string, stderr: string) {
    super(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`);
    this.name = 'GitError';
    this.args = args;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export interface GitRunOptions {
  /** Working directory for the git process. */
  cwd: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Data written to the process' stdin. */
  input?: string | Buffer;
  /** Exit codes that are not treated as failure. Default: `[0]`. */
  okCodes?: number[];
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run `git` with a structured argument list. Rejects with a {@link GitError} on an unexpected exit code. */
export function git(args: readonly string[], options: GitRunOptions): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of SCRUBBED_ENV) delete env[name];
  Object.assign(env, options.env);

  const okCodes = options.okCodes ?? [0];

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => stdout.push(d));
    child.stderr.on('data', (d: Buffer) => stderr.push(d));

    child.on('error', reject);
    child.on('close', code => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== null && okCodes.includes(code)) resolve({ stdout: out, stderr: err, exitCode: code });
      else reject(new GitError(args, code, out, err));
    });

    // Ignore EPIPE if git exits before reading all of stdin; the exit code tells the real story.
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
  });
}

/** Run git and return stdout without the trailing newline. */
export async function gitOut(args: readonly string[], options: GitRunOptions): Promise<string> {
  const { stdout } = await git(args, options);
  return stdout.replace(/\r?\n$/, '');
}
