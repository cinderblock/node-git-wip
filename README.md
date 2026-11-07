# node-git-wip

git-wip implementation in node.

Targeted for use alongside other git [gui] tools and use with automatic deployment scripts.

Since v1 it drives the `git` command line (plumbing commands only) instead of the native `nodegit` module,
so there is nothing to compile on install.

## How this `git-wip` works

When called, this `git-wip` will create a new commit on a branch with the name `wip/$branch`, creating it if required.
It also leaves the index in the same state as the latest wip commit, with everything staged.
HEAD, the current branch and the working tree are not touched.
Once complete, `git-wip` will report the hash and/or the WIP branch name of the new commit.
This is targeted at usage by other automatic testing systems.

When subsequent calls to `git-wip` are made, it simply continues the previously created branch.

By default, this `git-wip` will mark the current head as a _parent_ of the latest wip commit.

## Requirements

- Node.js 22 or newer
- `git` 2.25 or newer on the `PATH`

## Install

```
$ bun add --dev @cinderblock/node-git-wip
```

or

```
$ npm install --save-dev @cinderblock/node-git-wip
```

My use cases are usually only needed on development machines and I prefer not to install packages globally.
All the features should work just fine if installed globally.

## Usage

#### Module

The package is ESM with TypeScript types.

```ts
import wip from '@cinderblock/node-git-wip';

const result = await wip({
  historyStrategy: 'manual',
  // ...
});

if ('error' in result) {
  console.error('git-wip failed at step', result.step, result.error);
} else {
  console.log(result.branchNameShort, result.latestHash);
}
```

`require('@cinderblock/node-git-wip')` still returns the function on Node versions with `require(esm)` support.

`wip()` never throws. It resolves to either:

- `{ latestHash, treeHash, branchName, branchNameShort, headName, headNameShort }` on success, for example
  `branchName: 'refs/heads/wip/master'`, `branchNameShort: 'wip/master'`, `headName: 'refs/heads/master'`,
  `headNameShort: 'master'`
- `{ step, error }` when a step fails, where `step` names what was happening (`'find'`, `'get head'`, ...)

#### cli

```
$ git-wip
```

There are currently no command line options.
To control features, use a configuration file.
The result (or `{ step, error }`) is printed to stdout.

## Options

There are a couple options that more dramatically change the behavior than others.

- `historyStrategy`
- `message`
- `pathspec`
- `prefix`

All options are passed as an object to the exported function.
Options are also loaded from any configuration file according to [cosmiconfig](https://www.npmjs.com/package/cosmiconfig)'s search pattern,
searching from the current working directory up to your home directory:
a `"node-git-wip"` key in `package.json`, `.node-git-wiprc`, `.node-git-wiprc.json`, `.node-git-wiprc.yaml`,
`node-git-wip.config.js`, and the other names cosmiconfig supports.
Options from config files are merged with options passed to the function with the latter taking precedence.

#### All options

Any option left undefined will default to something sensible.

##### `author`

Author of wip commit.

_Default:_ `user.name` and `user.email` from git config (`unknown <unknown@example.com>` if they are not set)

- An `object` `{ name, email }` uses the current time. Add `time` (seconds since the epoch) and `offset` (minutes from UTC) to pin it.
- A `string` in git's raw signature format: `'Name <email> 1234567890 -0800'`.
  The time and timezone are optional and default to `0` (the Unix epoch) and `+0000`, as they did in earlier versions.

##### `ceilingDirs`

How high up the directory tree should we search for a `.git` folder indicating a repository?
Same format as `GIT_CEILING_DIRECTORIES`.

_Default:_ `''`

##### `committer`

Committer of wip commit. Same forms as `author`.

_Default:_ `author`

##### `debug`

Control where debug data is sent.

_Default:_ `false`

- `false`_-ish_ or `'off'` disables logging.
- `true`_-ish_ logs to `stdout`.
- `'stderr'` will send to `stderr`.
- A function can also be passed.

##### `debugSteps`

Extra debugging information.

_Default:_ `undefined`

##### `discoverAcrossFs`

When searching parent directories for which git repository to open, controls if we stop when we cross a filesystem boundary.

_Default:_ `false`

##### `flags`

Controls the git flags when adding files to the index before committing.

_Default:_ `none`

- An integer number from 0-7 where each bit corresponds to a flag (`1` force, `2` disablePathspecMatch, `4` checkPathspec)
- An `object` with properties controlling the flags and the following shape:
  ```
  {
    force: false, // also add ignored files
    disablePathspecMatch: false, // treat pathspec entries as literal paths, not globs
    checkPathspec: false, // fail if a pathspec entry exactly names an untracked, ignored file
  }
  ```

##### `historyStrategy`

Controls how history will look

_Default:_ `'merge'`

- `'merge'` marks HEAD branch as a parent of current branch
- `'parallel'` or `'manual'` does not connect the wip branch to the HEAD branch past the first commit
- `'clear'` or `'reset'` resets the wip branch to HEAD on every call, so each wip commit's only parent is HEAD

##### `message`

Controls the commit message

_Default:_ `'WIP'`

##### `pathspec`

Controls which files are added to the WIP commit.

_Default:_ everything
This option is a `string` or an array of git [`pathspec`](https://git-scm.com/docs/gitglossary#gitglossary-aiddefpathspecapathspec) strings.
Entries that match nothing are ignored.

##### `postfix`

Use a postfix string instead of a prefix.

_Default:_ `undefined`
If defined, `prefix` option is ignored.

##### `prefix`

Controls the prefix added to the current HEAD branch name.

_Default:_ `'wip'`

- Any sensible non-empty `string` of valid git branch name characters can be used
- A `function` that takes in the name of the current HEAD branch (_ie_ `'master'`) and returns the new branch name.

##### `repoPath`

Controls where we start looking for the git repository.

_Default:_ `'.'`

##### `separator`

Controls the separator used when constructing the wip branch name from the HEAD branch name.

_Default:_ `'/'`

##### `useNestedPrefix`

Controls if, when using branches in "folders", to put all the different wip branches together in one directory at the top level,
or to put them near each branch.

For instance, if you are working on a branch called `feature/foobar`:

- `true` creates a branch `feature/wip/foobar`
- `false` creates a branch `wip/feature/foobar`

_Default:_ `true`

## Upgrading from 0.x

- `nodegit` is gone; `git` must be on the `PATH` instead.
- The package is ESM. `import wip from '@cinderblock/node-git-wip'`, or `require()` on a Node with `require(esm)`.
- The `repo` option (an open `NodeGit.Repository`) no longer exists. Use `repoPath`.
- Options from config files are now actually applied, and commits without an explicit `author` work again.
  Both were broken in 0.6.x.
- Environment variables like `GIT_DIR` and `GIT_INDEX_FILE` are ignored, as before, so running inside a git hook
  still targets the repository found from `repoPath` and its real index.

## Development

```
bun install
bun run lint    # tsc + prettier
bun run test    # integration tests, run on Node against temporary git repositories
bun run build   # dist/
```
