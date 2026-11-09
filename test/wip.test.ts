import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import wip, { type WipFailure, type WipOptions, type WipResult } from '../src/index.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tempRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'node-git-wip-test-')));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

let repoCount = 0;

/** Run git in `cwd` and return trimmed stdout. Isolated from the user's global config. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: gitEnv() }).trim();
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  // Ignore the developer's global/system config (signing, hooks, autocrlf, default branch...).
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = path.join(tempRoot, 'gitconfig-global');
  return env;
}
writeFileSync(path.join(tempRoot, 'gitconfig-global'), '');

function write(repo: string, file: string, content: string) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
}

/** New repo on `master` with one commit containing `tracked.txt` and a `.gitignore` for `*.log`. */
function makeRepo(): string {
  const repo = path.join(tempRoot, `repo${++repoCount}`);
  mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/master');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  write(repo, 'tracked.txt', 'one\n');
  write(repo, 'doomed.txt', 'delete me\n');
  write(repo, '.gitignore', '*.log\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'initial');
  return repo;
}

function commit(repo: string, message: string) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function parents(repo: string, rev: string): string[] {
  return git(repo, 'rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
}

function files(repo: string, tree: string): string[] {
  return git(repo, 'ls-tree', '-r', '--name-only', tree).split('\n').filter(Boolean).sort();
}

function isFailure(r: WipResult | WipFailure): r is WipFailure {
  return 'step' in r;
}

async function ok(options: WipOptions): Promise<WipResult> {
  const r = await wip(options);
  if (isFailure(r)) assert.fail(`wip failed at step '${r.step}': ${r.error}`);
  return r;
}

async function fails(options: WipOptions): Promise<WipFailure> {
  const r = await wip(options);
  assert.ok(isFailure(r), `expected failure, got ${JSON.stringify(r)}`);
  return r;
}

describe('historyStrategy', () => {
  for (const strategy of [undefined, 'merge', 'parallel', 'manual', 'clear', 'reset'] as const) {
    test(String(strategy ?? 'default (merge)'), async () => {
      const repo = makeRepo();
      const head1 = git(repo, 'rev-parse', 'HEAD');

      // Working tree changes: modified, new untracked, deleted, ignored.
      write(repo, 'tracked.txt', 'two\n');
      write(repo, 'new/untracked.txt', 'new\n');
      unlinkSync(path.join(repo, 'doomed.txt'));
      write(repo, 'debug.log', 'ignored\n');

      const r1 = await ok({ repoPath: repo, historyStrategy: strategy });
      assert.deepEqual(
        { ...r1, latestHash: undefined, treeHash: undefined },
        {
          latestHash: undefined,
          treeHash: undefined,
          branchName: 'refs/heads/wip/master',
          branchNameShort: 'wip/master',
          headName: 'refs/heads/master',
          headNameShort: 'master',
        }
      );
      assert.equal(git(repo, 'rev-parse', 'refs/heads/wip/master'), r1.latestHash);
      assert.equal(git(repo, 'rev-parse', `${r1.latestHash}^{tree}`), r1.treeHash);
      // First wip commit on a new branch: HEAD is the only parent, whatever the strategy.
      assert.deepEqual(parents(repo, r1.latestHash), [head1]);
      assert.deepEqual(files(repo, r1.treeHash), ['.gitignore', 'new/untracked.txt', 'tracked.txt']);
      assert.equal(git(repo, 'show', `${r1.latestHash}:tracked.txt`), 'two');
      // The real index is left matching the wip commit, everything staged. HEAD and its branch are untouched.
      assert.equal(git(repo, 'write-tree'), r1.treeHash);
      assert.equal(git(repo, 'rev-parse', 'HEAD'), head1);
      assert.equal(git(repo, 'symbolic-ref', 'HEAD'), 'refs/heads/master');

      // Second call, HEAD unchanged.
      write(repo, 'tracked.txt', 'three\n');
      const r2 = await ok({ repoPath: repo, historyStrategy: strategy });
      assert.equal(git(repo, 'rev-parse', 'refs/heads/wip/master'), r2.latestHash);
      assert.equal(git(repo, 'show', `${r2.latestHash}:tracked.txt`), 'three');

      // Third call after HEAD moved forward.
      const head2 = commit(repo, 'second');
      write(repo, 'tracked.txt', 'four\n');
      const r3 = await ok({ repoPath: repo, historyStrategy: strategy });
      assert.equal(git(repo, 'show', `${r3.latestHash}:tracked.txt`), 'four');

      switch (strategy) {
        case undefined:
        case 'merge':
          assert.deepEqual(parents(repo, r2.latestHash), [r1.latestHash, head1]);
          assert.deepEqual(parents(repo, r3.latestHash), [r2.latestHash, head2]);
          break;
        case 'parallel':
        case 'manual':
          assert.deepEqual(parents(repo, r2.latestHash), [r1.latestHash]);
          assert.deepEqual(parents(repo, r3.latestHash), [r2.latestHash]);
          break;
        case 'clear':
        case 'reset':
          assert.deepEqual(parents(repo, r2.latestHash), [head1]);
          assert.deepEqual(parents(repo, r3.latestHash), [head2]);
          break;
      }
    });
  }

  test('unknown strategy fails once the branch exists', async () => {
    const repo = makeRepo();
    // A new branch never consults the strategy.
    await ok({ repoPath: repo, historyStrategy: 'bogus' as never });
    const f = await fails({ repoPath: repo, historyStrategy: 'bogus' as never });
    assert.equal(f.step, 'get branch');
    assert.match(String(f.error), /Unknown parent strategy: bogus/);
  });
});

describe('commit object', () => {
  test('is byte-identical to what libgit2 wrote for a pinned author', async () => {
    const repo = makeRepo();
    const head = git(repo, 'rev-parse', 'HEAD');
    const r = await ok({
      repoPath: repo,
      message: 'custom message',
      author: { name: 'A U Thor', email: 'author@example.com', time: 1234567890, offset: -480 },
      committer: 'C O Mitter <committer@example.com> 1300000000 +0530',
    });
    const body =
      `tree ${r.treeHash}\n` +
      `parent ${head}\n` +
      `author A U Thor <author@example.com> 1234567890 -0800\n` +
      `committer C O Mitter <committer@example.com> 1300000000 +0530\n` +
      `\n` +
      `custom message`;
    assert.equal(git(repo, 'cat-file', 'commit', r.latestHash), body);
    // Hash it ourselves to prove there are no hidden bytes (e.g. a trailing newline or encoding header).
    const expected = createHash('sha1')
      .update(`commit ${Buffer.byteLength(body)}\0${body}`)
      .digest('hex');
    assert.equal(r.latestHash, expected);
    assert.match(git(repo, 'reflog', '-1', '--format=%gs', 'refs/heads/wip/master'), /^commit: custom message$/);
  });

  test('defaults: repo user, committer = author, message WIP', async () => {
    const repo = makeRepo();
    const before = Math.floor(Date.now() / 1000);
    const r = await ok({ repoPath: repo });
    const raw = git(repo, 'cat-file', 'commit', r.latestHash);
    const author = /^author (.*)$/m.exec(raw)![1]!;
    const committer = /^committer (.*)$/m.exec(raw)![1]!;
    assert.equal(author, committer);
    assert.match(author, /^Test User <test@example\.com> \d+ [+-]\d{4}$/);
    assert.ok(Number(author.split(' ').at(-2)) >= before);
    assert.ok(raw.endsWith('\n\nWIP'));
  });

  test('falls back to unknown <unknown@example.com> without user config', () => {
    const repo = makeRepo();
    git(repo, 'config', '--unset', 'user.name');
    git(repo, 'config', '--unset', 'user.email');
    // libgit2 ignores GIT_CONFIG_GLOBAL and reads the home directory once, from the C runtime's copy of the
    // environment (which, on Windows, later process.env changes don't reach). So run it in a child process whose
    // home is an empty directory, to keep the developer's own ~/.gitconfig out.
    const home = path.join(tempRoot, `home${++repoCount}`);
    mkdirSync(home);
    const res = spawnSync(process.execPath, [path.join(root, 'src', 'cli.ts')], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...gitEnv(), HOME: home, USERPROFILE: home, HOMEDRIVE: '', HOMEPATH: '', XDG_CONFIG_HOME: home },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /latestHash/, res.stdout);
    assert.match(
      git(repo, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', 'wip/master'),
      /^unknown <unknown@example\.com>\|unknown <unknown@example\.com>$/
    );
  });

  test('object author without time uses now', async () => {
    const repo = makeRepo();
    const r = await ok({ repoPath: repo, author: { name: 'Obj', email: 'obj@example.com' } });
    const at = Number(git(repo, 'log', '-1', '--format=%at', r.latestHash));
    assert.ok(Math.abs(at - Date.now() / 1000) < 600);
    assert.equal(
      git(repo, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', r.latestHash),
      'Obj <obj@example.com>|Obj <obj@example.com>'
    );
  });

  test('bad author object fails', async () => {
    const repo = makeRepo();
    const f = await fails({ repoPath: repo, author: { name: 'no email' } as never });
    assert.match(String(f.error), /what the heck/);
  });
});

describe('author strings (libgit2 git_signature_from_buffer)', () => {
  async function authorLine(author: string): Promise<string> {
    const repo = makeRepo();
    const r = await ok({ repoPath: repo, author });
    return /^author (.*)$/m.exec(git(repo, 'cat-file', 'commit', r.latestHash))![1]!;
  }

  test('full', async () => {
    assert.equal(await authorLine('  Name  <a@b.c> 1234 -0130'), 'Name <a@b.c> 1234 -0130');
  });
  test('missing time is the epoch, missing timezone is +0000', async () => {
    assert.equal(await authorLine('Name <a@b.c>'), 'Name <a@b.c> 0 +0000');
    assert.equal(await authorLine('Name <a@b.c> 99'), 'Name <a@b.c> 99 +0000');
  });
  test('-0000 is preserved', async () => {
    assert.equal(await authorLine('Name <a@b.c> 99 -0000'), 'Name <a@b.c> 99 -0000');
  });
  test('malformed email', async () => {
    const f = await fails({ repoPath: makeRepo(), author: 'Name a@b.c' });
    assert.equal(f.step, 'get string signature');
    assert.match(String(f.error), /malformed e-mail/);
  });
});

describe('branch naming', () => {
  async function branchFor(head: string, options: WipOptions = {}) {
    const repo = makeRepo();
    git(repo, 'checkout', '-q', '-b', head);
    return (await ok({ repoPath: repo, ...options })).branchNameShort;
  }

  test('nested prefix (default)', async () => {
    assert.equal(await branchFor('feature/foo'), 'feature/wip/foo');
  });
  test('useNestedPrefix: false', async () => {
    assert.equal(await branchFor('feature/foo', { useNestedPrefix: false }), 'wip/feature/foo');
  });
  test('prefix and separator', async () => {
    assert.equal(await branchFor('feature/foo', { prefix: 'snap', separator: '-' }), 'feature/snap-foo');
  });
  test('postfix overrides prefix', async () => {
    assert.equal(await branchFor('feature/foo', { prefix: 'ignored', postfix: '-wip' }), 'feature/foo-wip');
  });
  test('prefix function', async () => {
    assert.equal(await branchFor('dev', { prefix: name => `auto/${name}/snapshot` }), 'auto/dev/snapshot');
  });
});

describe('pathspec and flags', () => {
  function dirtyRepo() {
    const repo = makeRepo();
    write(repo, 'tracked.txt', 'changed\n');
    write(repo, 'a.md', 'a\n');
    write(repo, 'sub/b.md', 'b\n');
    write(repo, 'c.txt', 'c\n');
    write(repo, 'keep.log', 'ignored\n');
    return repo;
  }

  test('glob pathspec only adds matches', async () => {
    const repo = dirtyRepo();
    const r = await ok({ repoPath: repo, pathspec: ['*.md'] });
    assert.deepEqual(files(repo, r.treeHash), ['.gitignore', 'a.md', 'doomed.txt', 'sub/b.md', 'tracked.txt']);
    assert.equal(git(repo, 'show', `${r.latestHash}:tracked.txt`), 'one');
  });

  test('string pathspec and non-matching entries are fine', async () => {
    const repo = dirtyRepo();
    const r = await ok({ repoPath: repo, pathspec: 'c.txt' });
    assert.ok(files(repo, r.treeHash).includes('c.txt'));
    const r2 = await ok({ repoPath: repo, pathspec: ['does-not-exist', 'keep.log'] });
    assert.equal(r2.treeHash, r.treeHash);
  });

  test('deletions inside pathspec are staged', async () => {
    const repo = dirtyRepo();
    unlinkSync(path.join(repo, 'doomed.txt'));
    const r = await ok({ repoPath: repo, pathspec: ['doomed.txt'] });
    assert.ok(!files(repo, r.treeHash).includes('doomed.txt'));
  });

  test('disablePathspecMatch is passed to libgit2, which still expands globs in addAll', async () => {
    const repo = dirtyRepo();
    const r = await ok({ repoPath: repo, pathspec: ['*.md', 'sub'], flags: { disablePathspecMatch: true } });
    assert.deepEqual(files(repo, r.treeHash), ['.gitignore', 'a.md', 'doomed.txt', 'sub/b.md', 'tracked.txt']);
  });

  test('force adds ignored files', async () => {
    const repo = dirtyRepo();
    const r = await ok({ repoPath: repo, flags: { force: true } });
    assert.ok(files(repo, r.treeHash).includes('keep.log'));
    const repo2 = dirtyRepo();
    const r2 = await ok({ repoPath: repo2, pathspec: ['*.log'], flags: 1 });
    assert.ok(files(repo2, r2.treeHash).includes('keep.log'));
  });

  test('checkPathspec rejects an exactly named ignored file', async () => {
    const repo = dirtyRepo();
    const f = await fails({ repoPath: repo, pathspec: ['keep.log'], flags: { checkPathspec: true } });
    assert.equal(f.step, 'index add all');
    assert.match(String(f.error), /pathspec contains ignored file 'keep\.log'/);
    // Globs are not checked.
    await ok({ repoPath: repo, pathspec: ['*.log'], flags: 4 });
  });

  test('bad numeric flags', async () => {
    const repo = dirtyRepo();
    const f = await fails({ repoPath: repo, flags: 8 });
    assert.equal(f.step, 'read config');
    assert.match(String(f.error), /Bad flags/);
  });
});

describe('repository discovery and errors', () => {
  test('finds the repository from a subdirectory', async () => {
    const repo = makeRepo();
    write(repo, 'deep/dir/file.txt', 'x\n');
    const r = await ok({ repoPath: path.join(repo, 'deep', 'dir') });
    assert.ok(files(repo, r.treeHash).includes('deep/dir/file.txt'));
  });

  test('not a repository', async () => {
    const dir = path.join(tempRoot, 'not-a-repo');
    mkdirSync(dir);
    // Stop discovery from walking up into whatever repository the temp dir might live in.
    const f = await fails({ repoPath: dir, ceilingDirs: tempRoot });
    assert.equal(f.step, 'find');
  });

  test('detached HEAD', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '-q', '--detach');
    const f = await fails({ repoPath: repo });
    assert.equal(f.step, 'get head short name');
    assert.match(String(f.error), /Unexpected branch name: HEAD/);
  });

  test('unborn branch', async () => {
    const repo = path.join(tempRoot, `unborn${++repoCount}`);
    mkdirSync(repo);
    git(repo, 'init', '-q');
    const f = await fails({ repoPath: repo });
    assert.equal(f.step, 'get head');
  });

  test('ignores GIT_DIR / GIT_INDEX_FILE from the environment (e.g. inside a hook)', async () => {
    const repo = makeRepo();
    const other = makeRepo();
    write(repo, 'tracked.txt', 'hook\n');
    process.env.GIT_DIR = path.join(other, '.git');
    process.env.GIT_INDEX_FILE = path.join(tempRoot, 'bogus-index');
    try {
      const r = await ok({ repoPath: repo });
      assert.equal(git(repo, 'show', `${r.latestHash}:tracked.txt`), 'hook');
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_INDEX_FILE;
    }
    assert.throws(() => git(other, 'rev-parse', '--verify', '-q', 'refs/heads/wip/master'));
  });

  test('debug option receives log lines', async () => {
    const repo = makeRepo();
    const lines: unknown[][] = [];
    await ok({ repoPath: repo, debug: (...args: unknown[]) => lines.push(args), debugSteps: true });
    assert.ok(lines.some(l => l[0] == 'step:' && l[1] == 'create prefixed commit'));
    assert.ok(lines.some(l => l[0] == 'result:'));
  });
});

describe('packaging', () => {
  test('require() returns the wip function (CommonJS consumers)', () => {
    const required = createRequire(import.meta.url)('../src/index.ts');
    assert.equal(typeof required, 'function');
    assert.equal(required, wip);
  });

  test('git-wip CLI reads config from a cosmiconfig file in the cwd and prints the result', () => {
    const repo = makeRepo();
    write(repo, '.node-git-wiprc.json', JSON.stringify({ prefix: 'cfg', message: 'from config' }));
    const res = spawnSync(process.execPath, [path.join(root, 'src', 'cli.ts'), '--ignored-argument'], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /branchNameShort: 'cfg\/master'/);
    assert.equal(git(repo, 'log', '-1', '--format=%B', 'cfg/master'), 'from config');
  });

  test('git-wip CLI prints failures and still exits 0 (unchanged from 0.x)', () => {
    const repo = makeRepo();
    git(repo, 'checkout', '-q', '--detach');
    const res = spawnSync(process.execPath, [path.join(root, 'src', 'cli.ts')], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /step: 'get head short name'/);
  });
});
