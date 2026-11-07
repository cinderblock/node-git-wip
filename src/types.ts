import type { SignatureInput } from './signature.ts';

export type { SignatureInput };

/**
 * How the wip branch's history is shaped.
 *
 * - `'merge'` (default): each wip commit has two parents, the previous wip commit and the current HEAD.
 * - `'parallel'` / `'manual'`: each wip commit has one parent, the previous wip commit.
 * - `'clear'` / `'reset'`: the wip branch is reset to HEAD and the new commit's only parent is HEAD.
 *
 * The first commit on a new wip branch always has HEAD as its only parent.
 */
export type HistoryStrategy = 'merge' | 'parallel' | 'manual' | 'clear' | 'reset';

/** Flags controlling how files are added to the index. */
export interface AddFlags {
  /** Also add ignored files. */
  force?: boolean;
  /** Match `pathspec` entries as literal paths instead of globs. */
  disablePathspecMatch?: boolean;
  /** Fail if a `pathspec` entry names an untracked, ignored file (and `force` is not set). */
  checkPathspec?: boolean;
}

export type DebugFunction = (...args: unknown[]) => void;

export interface WipOptions {
  /** Author of the wip commit. A `"Name <email> [unix-time [+hhmm]]"` string or `{ name, email[, time, offset] }`. */
  author?: string | SignatureInput;
  /** Directories at which to stop searching for a repository (`GIT_CEILING_DIRECTORIES` format). Default `''`. */
  ceilingDirs?: string;
  /** Committer of the wip commit. Default: same as `author`. */
  committer?: string | SignatureInput;
  /** Where debug output goes: falsy or `'off'` disables, `'stderr'`, a function, or any other truthy value for stdout. */
  debug?: boolean | 'off' | 'stderr' | DebugFunction | string | number | null;
  /** Also log each step as it starts. */
  debugSteps?: boolean;
  /** Let repository discovery cross filesystem boundaries. Default `false`. */
  discoverAcrossFs?: boolean;
  /** Flags for adding files: a 0-7 bit field (1 force, 2 disablePathspecMatch, 4 checkPathspec) or an object. */
  flags?: number | AddFlags;
  /** Shape of the wip branch history. Default `'merge'`. */
  historyStrategy?: HistoryStrategy;
  /** Commit message. Default `'WIP'`. */
  message?: string;
  /** Which files to add. Default: everything. */
  pathspec?: string | string[];
  /** Use this suffix instead of a prefix. If set, `prefix` is ignored. */
  postfix?: string;
  /** Prefix for the wip branch name, or a function mapping the HEAD branch name to the wip branch name. */
  prefix?: string | ((headNameShort: string) => string);
  /** Where to start looking for the repository. Default: current working directory. */
  repoPath?: string;
  /** Separator between prefix and branch name. Default `'/'`. */
  separator?: string;
  /** `feature/foo` → `feature/wip/foo` when `true` (default), `wip/feature/foo` when `false`. */
  useNestedPrefix?: boolean | null;
}

export interface WipResult {
  /** Hash of the new wip commit. */
  latestHash: string;
  /** Hash of the new commit's tree. */
  treeHash: string;
  /** Full ref name of the wip branch, e.g. `refs/heads/wip/master`. */
  branchName: string;
  /** Short name of the wip branch, e.g. `wip/master`. */
  branchNameShort: string;
  /** Full ref name of HEAD, e.g. `refs/heads/master`. */
  headName: string;
  /** Short name of HEAD, e.g. `master`. */
  headNameShort: string;
}

/** Returned (not thrown) when any step fails. */
export interface WipFailure {
  /** Name of the step that failed, e.g. `'get head'` or `'create prefixed commit'`. */
  step: string;
  error: unknown;
}
