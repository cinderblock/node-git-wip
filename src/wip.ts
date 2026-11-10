import path from 'node:path';
import NodeGit from 'nodegit';
import { loadConfig } from './config.ts';
import type { DebugFunction, SignatureInput, WipFailure, WipOptions, WipResult } from './types.ts';

const { Index, Repository, Signature } = NodeGit;
type Signature = NodeGit.Signature;

// @types/nodegit declares this as an ambient const enum, which can't be read under verbatimModuleSyntax. Read the
// runtime object instead.
const ADD_OPTION = (
  Index as unknown as {
    ADD_OPTION: Record<'ADD_DEFAULT' | 'ADD_FORCE' | 'ADD_DISABLE_PATHSPEC_MATCH' | 'ADD_CHECK_PATHSPEC', number>;
  }
).ADD_OPTION;

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
async function toSignature(input: string | SignatureInput | undefined | null): Promise<Signature | undefined> {
  if (!input) return undefined;
  if (typeof input == 'string') return Signature.fromBuffer(input);
  if (input.name && input.email) {
    if (input.time && input.offset !== undefined) {
      return Signature.create(input.name, input.email, input.time, input.offset);
    }
    return Signature.now(input.name, input.email);
  }
  throw Error('what the heck? How did we get here...');
}

function addFlags(flags: WipOptions['flags']): number {
  if (typeof flags == 'number') {
    if (!Number.isInteger(flags) || flags < 0 || flags > 7) throw Error('Bad flags');
    return flags;
  }
  let res = ADD_OPTION.ADD_DEFAULT;
  if (!flags) return res;
  if (flags.force) res += ADD_OPTION.ADD_FORCE;
  if (flags.disablePathspecMatch) res += ADD_OPTION.ADD_DISABLE_PATHSPEC_MATCH;
  if (flags.checkPathspec) res += ADD_OPTION.ADD_CHECK_PATHSPEC;
  return res;
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

    let repo: NodeGit.Repository;
    if (options.repo instanceof Repository) {
      debug('Using passed repository object');
      repo = options.repo;
    } else {
      debugStep('find');
      const start = path.resolve(options.repoPath || config.repoPath || '.');
      const found = await Repository.discover(start, discoverAcrossFs ? 1 : 0, ceilingDirs);
      debug('git dir:', found);

      debugStep('open');
      repo = await Repository.open(found);
    }

    let author: Signature;
    const authorOption = options.author === undefined ? config.author : options.author;
    if (!authorOption) {
      debugStep('get default signature');
      author = await repo.defaultSignature();
    } else {
      if (typeof authorOption == 'string') debugStep('get string signature');
      author = (await toSignature(authorOption))!;
    }
    debug('author:', author.toString());

    const committerOption = options.committer === undefined ? config.committer : options.committer;
    if (committerOption && typeof committerOption == 'string') debugStep('get string signature');
    const committer = (await toSignature(committerOption)) ?? author;
    debug('committer:', committer.toString());

    debugStep('get head');
    const head = await repo.head();
    const headName = head.name();

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

    let branch: NodeGit.Reference;
    let newBranch = false;
    try {
      debugStep('create branch');
      branch = await repo.createBranch(prefixedShortName, head.target(), false);
      debug('new branch created:', branch.name());
      newBranch = true;
    } catch {
      debugStep('get branch');
      branch = await repo.getBranch(prefixedShortName);
      debug('use existing branch:', branch.name());
    }

    let parents: NodeGit.Oid[];
    const historyStrategy = options.historyStrategy === undefined ? config.historyStrategy : options.historyStrategy;
    if (newBranch || historyStrategy == 'parallel' || historyStrategy == 'manual') {
      parents = [branch.target()];
    } else if (historyStrategy === undefined || historyStrategy == 'merge') {
      parents = [branch.target(), head.target()];
    } else if (historyStrategy == 'clear' || historyStrategy == 'reset') {
      debugStep('create branch force');
      branch = await repo.createBranch(prefixedShortName, head.target(), true);
      debug('new branch created:', branch.name());
      parents = [head.target()];
    } else {
      throw Error('Unknown parent strategy: ' + historyStrategy);
    }

    debug('branch:', branch.target().tostrS());

    debugStep('refresh index');
    const index = await repo.refreshIndex();

    debugStep('index add all');
    // No per-file callback: nodegit 0.28 segfaults when `addAll` is given a JS callback (seen on Node 24 and 26).
    await index.addAll(pathspecs, flags);

    debugStep('index write');
    await index.write();

    debugStep('index write tree');
    const tree = await index.writeTree();

    const branchName = branch.name();

    debugStep('get branch short name');
    const branchNameShort = branchShortName(branchName);

    debugStep('create prefixed commit');
    const commit = await repo.createCommit(branchName, author, committer, message, tree, parents);

    const res: WipResult = {
      latestHash: commit.tostrS(),
      treeHash: tree.tostrS(),
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
