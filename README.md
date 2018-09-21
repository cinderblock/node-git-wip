# node-git-wip

git-wip implementation entirely in node.

Targeted for use alongside other git [gui] tools and use with automatic deployment scripts.

## How this `git-wip` works

When called, this `git-wip` will create a new commit on a branch with the name `wip/$branch`, creating it if required.
It also leaves the index in the same state as the latest wip commit, with everything staged.
Once complete, `git-wip` will report the hash and/or the WIP branch name of the new commit.
This is targeted at usage by other automatic testing systems.

When subsequent calls to `git-wip` are made, it simply continues the previously created branch.

By default, this `git-wip` will mark the current head as a _parent_ if the latest wip.

## Options

There are a couple options that more dramatically change the behavior than others.

- `historyStrategy`
- `message`
- `pathspec`
- `prefix`
- `repo`

All options are passed as an object to the exported function.
Options are also loaded from any configuration file according to [cosmiconfig](https://www.npmjs.com/package/cosmiconfig)'s search pattern.
Options from config files are merged with options passed to the function with the latter taking precedence.

#### All options

Any option left undefined will default to something sensible.

##### `author`

Author of wip commit.

_Default:_ Default author from repository

##### `ceilingDirs`

How high up the directory tree should we search for a `.git` folder indicating a repository?

_Default:_ `''`

##### `committer`

Committer of wip commit.

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

- An integer number from 0-7 where each bit corresponds to a flag
- An `object` with properties controlling the flags and the following shape:
  ```
  {
    force: false,
    disablePathspecMatch: false,
    checkPathspec: false,
  }
  ```

##### `historyStrategy`

Controls how history will look

_Default:_ `'merge'`

- `'merge'` marks HEAD branch as a parent of current branch
- `'parallel'` or `'manual'` does not connect the wip branch to the HEAD branch past the first commit
- `'clear'` or `'reset'` creates a new branch when HEAD branch has moved forward

##### `message`

Controls the commit message

_Default:_ `'WIP'`

##### `pathspec`

Controls which files are added to the WIP commit.

_Default:_ `['*']`
This option is an array of git [`pathspec`](https://git-scm.com/docs/gitglossary#gitglossary-aiddefpathspecapathspec) strings.

##### `postfix`

Use a postfix string instead of a prefix.

_Default:_ `undefined`
If defined, `prefix` option is ignored.

##### `prefix`

Controls the prefix added to the current HEAD branch name.

_Default:_ `'wip'`

- Any sensible non-empty `string` of valid git branch name characters can be used
- A `function` that takes in the name of the current HEAD branch (_ie_ `'master'`) and returns the new branch name.

##### `repo`

If you already have an instance of `NodeGit.Repository` open, pass it in to reuse it.

_Default:_ `undefined`

If `repo` is defined and the correct type, `repoPath` and related options are ignored.

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
