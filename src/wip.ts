import { statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { git, gitOut } from './git.ts';
import {
  createSignature,
  formatSignature,
  parseSignature,
  signatureNow,
  signatureToString,
  type Signature,
  type SignatureInput,
} from './signature.ts';
import type { DebugFunction, WipFailure, WipOptions, WipResult } from './types.ts';

const ADD_FORCE = 1;
const ADD_DISABLE_PATHSPEC_MATCH = 2;
const ADD_CHECK_PATHSPEC = 4;

function branchShortName(long: string): string {
  const res = long.match(/^refs\/heads\/(.+)$/);

  if (!res) throw Error('Unexpected branch name: ' + long);
  return res[1]!;
}

function resolveDebug(debug: WipOptions['debug']): DebugFunction {
  if (typeof debug == 'function') return debug;
  if (debug == 'stderr') return console.error;
  if (!debug || debug == 'off') return () => {};
  return console.log;
}

/** Turn an `author`/`committer` option into a signature, or `undefined` to mean "use the default". */
function toSignature(input: string | SignatureInput | undefined | null): Signature | undefined {
  if (!input) return undefined;
  if (typeof input == 'string') return parseSignature(input);
  if (input.name && input.email) {
    if (input.time && input.offset !== undefined) {
      return createSignature(input.name, input.email, input.time, input.offset);
    }
    return signatureNow(input.name, input.email);
  }
  throw Error('what the heck? How did we get here...');
}

/** nodegit's `Repository#defaultSignature()`: `user.name`/`user.email` from git config, or `unknown`. */
async function defaultSignature(cwd: string): Promise<Signature> {
  const get = async (key: string) =>
    (await git(['config', '--get', key], { cwd, okCodes: [0, 1] })).stdout.replace(/\r?\n$/, '');
  try {
    return signatureNow(await get('user.name'), await get('user.email'));
  } catch {
    return signatureNow('unknown', 'unknown@example.com');
  }
}

function addFlags(flags: WipOptions['flags']): number {
  if (typeof flags == 'number') {
    if (!Number.isInteger(flags) || flags < 0 || flags > 7) throw Error('Bad flags');
    return flags;
  }
  if (!flags) return 0;
  let res = 0;
  if (flags.force) res += ADD_FORCE;
  if (flags.disablePathspecMatch) res += ADD_DISABLE_PATHSPEC_MATCH;
  if (flags.checkPathspec) res += ADD_CHECK_PATHSPEC;
  return res;
}

/** First paragraph of the message on one line, like `git_commit_summary`. Used for the reflog. */
function summary(message: string): string {
  return (message.trimStart().split(/\n[ \t\r]*\n/)[0] ?? '').replace(/\s*\n\s*/g, ' ').trimEnd();
}

/**
 * Stage files like libgit2's `git_index_add_all`: add new and modified files and remove deleted ones, limited to
 * `pathspec` when given. Unlike `git add`, pathspecs that match nothing (or only ignored files) are not an error.
 */
async function addAll(cwd: string, pathspec: string[], flags: number, debug: DebugFunction): Promise<void> {
  const force = (flags & ADD_FORCE) != 0;
  const literal = (flags & ADD_DISABLE_PATHSPEC_MATCH) != 0;
  const literalArgs = literal ? ['--literal-pathspecs'] : [];

  if (!pathspec.length) {
    const { stdout } = await git(['add', '--all', '--verbose', ...(force ? ['--force'] : [])], { cwd });
    for (const line of stdout.split('\n')) if (line.trim()) debug('index add:', line.trim());
    return;
  }

  if (!force && flags & ADD_CHECK_PATHSPEC) {
    // libgit2 rejects pathspecs that exactly name an untracked file that is ignored.
    for (const spec of pathspec) {
      if (!literal && /[*?[]/.test(spec)) continue;
      const tracked = await gitOut(['--literal-pathspecs', 'ls-files', '-z', '--cached', '--', spec], { cwd });
      if (tracked.split('\0').includes(spec)) continue;
      let isFile = false;
      try {
        isFile = statSync(path.join(cwd, spec)).isFile();
      } catch {}
      if (!isFile) continue;
      const ignored = await git(['check-ignore', '-q', '--no-index', '--', spec], { cwd, okCodes: [0, 1] });
      if (ignored.exitCode == 0) throw Error(`pathspec contains ignored file '${spec}'`);
    }
  }

  // Resolve the pathspec to concrete paths ourselves so that non-matching entries are silently skipped.
  const listed = await gitOut(
    [
      ...literalArgs,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      ...(force ? [] : ['--exclude-standard']),
      '--',
      ...pathspec,
    ],
    { cwd }
  );
  const paths = [...new Set(listed.split('\0').filter(Boolean))];
  if (!paths.length) {
    debug('index add: no paths matched pathspec');
    return;
  }

  const { stdout } = await git(
    [
      '--literal-pathspecs',
      'add',
      '--all',
      '--verbose',
      ...(force ? ['--force'] : []),
      '--pathspec-from-file=-',
      '--pathspec-file-nul',
    ],
    { cwd, input: paths.join('\0') }
  );
  for (const line of stdout.split('\n')) if (line.trim()) debug('index add:', line.trim());
}

/**
 * Commit the current working tree to a wip branch (`wip/<branch>` by default), creating it if needed.
 *
 * Never throws: on failure, resolves to `{ step, error }`.
 */
export async function wip(options: WipOptions = {}): Promise<WipResult | WipFailure> {
  let debug: DebugFunction = () => {};
  let debugSteps = false;
  let step = 'read config';
  function debugStep(s: string) {
    step = s;
    if (debugSteps) debug('step:', step);
  }

  try {
    const config = await loadConfig();

    debugSteps = !!(options.debugSteps === undefined ? config.debugSteps : options.debugSteps);
    debug = resolveDebug(options.debug === undefined ? config.debug : options.debug);

    const repoPath = path.resolve(options.repoPath || config.repoPath || '.');
    const discoverAcrossFs = !!(options.discoverAcrossFs === undefined
      ? config.discoverAcrossFs
      : options.discoverAcrossFs);
    const ceilingDirs = options.ceilingDirs || config.ceilingDirs || '';
    const prefix = options.prefix || config.prefix || 'wip';
    const message = options.message || config.message || 'WIP';
    const postfix = options.postfix || config.postfix;

    const pathspec = options.pathspec === undefined ? config.pathspec : options.pathspec;
    if (pathspec === undefined) debug('pathspec default');
    else debug('pathspec:', pathspec);
    const pathspecs = pathspec === undefined || pathspec === null ? [] : ([] as string[]).concat(pathspec);

    const flagsOption = options.flags === undefined ? config.flags : options.flags;
    const flags = addFlags(flagsOption);
    if (flagsOption === undefined) debug('flags default');
    else debug('flags:', flags);

    let useNestedPrefix = options.useNestedPrefix === undefined ? config.useNestedPrefix : options.useNestedPrefix;
    if (useNestedPrefix === undefined || useNestedPrefix === null) useNestedPrefix = true;

    debug('ceiling dirs:', ceilingDirs);

    const discoverEnv: Record<string, string> = {};
    if (ceilingDirs) discoverEnv.GIT_CEILING_DIRECTORIES = ceilingDirs;
    if (discoverAcrossFs) discoverEnv.GIT_DISCOVERY_ACROSS_FILESYSTEM = '1';

    debugStep('find');
    const gitDir = await gitOut(['rev-parse', '--absolute-git-dir'], { cwd: repoPath, env: discoverEnv });
    debug('git dir:', gitDir);

    debugStep('open');
    const cwd = await gitOut(['rev-parse', '--show-toplevel'], { cwd: repoPath, env: discoverEnv });
    debug('work tree:', cwd);

    let author: Signature;
    const authorOption = options.author === undefined ? config.author : options.author;
    if (!authorOption) {
      debugStep('get default signature');
      author = await defaultSignature(cwd);
    } else {
      if (typeof authorOption == 'string') debugStep('get string signature');
      author = toSignature(authorOption)!;
    }
    debug('author:', signatureToString(author));

    const committerOption = options.committer === undefined ? config.committer : options.committer;
    if (committerOption && typeof committerOption == 'string') debugStep('get string signature');
    const committer = toSignature(committerOption) ?? author;
    debug('committer:', signatureToString(committer));

    debugStep('get head');
    const symbolic = await git(['symbolic-ref', '-q', 'HEAD'], { cwd, okCodes: [0, 1] });
    // A detached HEAD is reported as "HEAD", which is then rejected below, like nodegit did.
    const headName = symbolic.exitCode == 0 ? symbolic.stdout.trim() : 'HEAD';
    // Fails on an unborn branch (no commits yet).
    const headTarget = await gitOut(['rev-parse', '--verify', 'HEAD^{commit}'], { cwd });

    debugStep('get head short name');
    const headNameShort = branchShortName(headName);

    debug('headNameShort:', headNameShort);

    const separator = options.separator || config.separator || '/';

    let prefixedShortName: string;
    if (typeof prefix == 'function') {
      prefixedShortName = prefix(headNameShort);
    } else if (postfix) {
      prefixedShortName = headNameShort + postfix;
    } else {
      prefixedShortName = useNestedPrefix
        ? headNameShort.replace(/^(.*\/)?([^/]+)$/, `$1${prefix}${separator}$2`)
        : prefix + separator + headNameShort;
    }

    debug('prefixedShortName:', prefixedShortName);

    const branchName = 'refs/heads/' + prefixedShortName;

    let branchTarget: string;
    let newBranch = false;
    try {
      debugStep('create branch');
      if (prefixedShortName == 'HEAD') throw Error("'HEAD' is not a valid branch name");
      // Empty old value: only create, never move an existing branch.
      await git(['update-ref', '-m', `branch: Created from ${headTarget}`, branchName, headTarget, ''], { cwd });
      branchTarget = headTarget;
      debug('new branch created:', branchName);
      newBranch = true;
    } catch {
      debugStep('get branch');
      branchTarget = await gitOut(['rev-parse', '--verify', branchName], { cwd });
      debug('use existing branch:', branchName);
    }

    let parents: string[];
    const historyStrategy = options.historyStrategy === undefined ? config.historyStrategy : options.historyStrategy;
    if (newBranch || historyStrategy == 'parallel' || historyStrategy == 'manual') {
      parents = [branchTarget];
    } else if (historyStrategy === undefined || historyStrategy == 'merge') {
      parents = [branchTarget, headTarget];
    } else if (historyStrategy == 'clear' || historyStrategy == 'reset') {
      debugStep('create branch force');
      if (headName == branchName) {
        throw Error(`cannot force update branch '${prefixedShortName}' as it is the current HEAD of the repository.`);
      }
      await git(['update-ref', '-m', `branch: Created from ${headTarget}`, branchName, headTarget], { cwd });
      branchTarget = headTarget;
      debug('new branch created:', branchName);
      parents = [headTarget];
    } else {
      throw Error('Unknown parent strategy: ' + historyStrategy);
    }

    debug('branch:', branchTarget);

    // The git CLI always reads the index fresh from disk.
    debugStep('refresh index');

    debugStep('index add all');
    await addAll(cwd, pathspecs, flags, debug);

    // `git add` has already written the index.
    debugStep('index write');

    debugStep('index write tree');
    const treeHash = await gitOut(['write-tree'], { cwd });

    debugStep('get branch short name');
    const branchNameShort = branchShortName(branchName);

    debugStep('create prefixed commit');
    // Build the commit object byte-for-byte like libgit2 did: no trailing newline is added to the message and no
    // commit hooks or signing config apply.
    const commitObject =
      `tree ${treeHash}\n` +
      parents.map(p => `parent ${p}\n`).join('') +
      `author ${formatSignature(author)}\n` +
      `committer ${formatSignature(committer)}\n` +
      `\n` +
      message;
    const latestHash = await gitOut(['hash-object', '-t', 'commit', '-w', '--no-filters', '--stdin'], {
      cwd,
      input: Buffer.from(commitObject, 'utf8'),
    });
    const kind = parents.length > 1 ? ' (merge)' : parents.length == 0 ? ' (initial)' : '';
    // Old value = first parent: fail rather than clobber if the branch moved underneath us, like libgit2.
    await git(['update-ref', '-m', `commit${kind}: ${summary(message)}`, branchName, latestHash, parents[0]!], {
      cwd,
      env: { GIT_COMMITTER_NAME: committer.name, GIT_COMMITTER_EMAIL: committer.email },
    });

    const res: WipResult = {
      latestHash,
      treeHash,
      branchName,
      branchNameShort,
      headName,
      headNameShort,
    };
    debug('result:', res);
    return res;
  } catch (e) {
    const res: WipFailure = {
      step,
      error: e,
    };
    debug('result:', res);
    return res;
  }
}

export default wip;
