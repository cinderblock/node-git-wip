#!/usr/bin/env node

const path = require('path');

const NodeGit = require('nodegit');
const cosmiconfig = require('cosmiconfig');

function branchShortName(long) {
  let res = long.match(/^refs\/heads\/(.+)$/);

  if (!res) throw Error('Unexpected branch name: ' + long);
  return res[1];
}

async function wip(options) {
  let step = 'read config';
  function debugStep(s) {
    step = s;
    if (options.debugSteps) {
      options.debug('step:', step);
    }
  }

  try {
    let config = (await cosmiconfig('node-git-wip').search()) || {};

    options = options || {};

    if (options.debugSteps === undefined) options.debugSteps = config.debugSteps;

    if (options.debug === undefined) options.debug = config.debug;

    if (typeof options.debug == 'function') {
      // all set
    } else if (options.debug == 'stderr') {
      options.debug = console.error;
    } else if (!options.debug || options.debug == 'off') {
      options.debug = () => {};
    } else {
      options.debug = console.log;
    }

    options.repoPath = options.repoPath || config.repoPath || path.resolve();

    if (options.discoverAcrossFs === undefined) options.discoverAcrossFs = config.discoverAcrossFs;
    options.discoverAcrossFs = options.discoverAcrossFs ? 1 : 0;

    options.ceilingDirs = options.ceilingDirs || config.ceilingDirs || '';
    options.prefix = options.prefix || config.prefix || 'wip';
    options.message = options.message || config.message || 'WIP';
    options.postfix = options.postfix || config.postfix;

    if (options.pathspec === undefined) options.pathspec = config.pathspec;
    if (options.pathspec === undefined) {
      options.debug('pathspec default');
    } else {
      options.debug('pathspec:', options.pathspec);
    }

    // TODO: Get fancy and merge these objects
    if (options.flags === undefined) options.flags = config.flags;
    if (typeof options.flags == 'number') {
      if (!Number.isInteger(options.flags) || options.flags < 0 || options.flags > 7) {
        throw Error('Bad flags');
      }
      options.debug('user flags:', flags);
    } else if (options.flags === undefined) {
      options.debug('flags default');
    } else {
      let flags = options.flags;

      flags = NodeGit.Index.ADD_OPTION.ADD_DEFAULT;
      if (options.flags.force) flags += NodeGit.Index.ADD_OPTION.ADD_FORCE;
      if (options.flags.disablePathspecMatch) flags += NodeGit.Index.ADD_OPTION.ADD_DISABLE_PATHSPEC_MATCH;
      if (options.flags.checkPathspec) flags += NodeGit.Index.ADD_OPTION.ADD_CHECK_PATHSPEC;

      options.flags = flags;
      options.debug('flags:', options.flags);
    }

    if (options.useNestedPrefix === undefined) options.useNestedPrefix = config.useNestedPrefix;
    if (options.useNestedPrefix === undefined || options.useNestedPrefix === null) {
      options.useNestedPrefix = true;
    }

    options.debug('ceilingceiling dirs:', options.ceilingDirs);

    let repo;
    if (options.repo instanceof NodeGit.Repository) {
      options.debug('Using passed repository object');
      repo = options.repo;
    } else {
      debugStep('find');
      options.repoPath = await NodeGit.Repository.discover(
        options.repoPath,
        options.discoverAcrossFs,
        options.ceilingDirs
      );
      
      debugStep('open');
      repo = await NodeGit.Repository.open(options.repoPath);
    }

    if (options.author === undefined) options.author = config.author;
    if (!options.author) {
      debugStep('get default signature');
      options.author = repo.defaultSignature();
    } else if (typeof options.author == 'string') {
      debugStep('get string signature');
      options.author = await NodeGit.Signature.fromBuffer(options.author);
    } else if (options.author.name && options.author.email) {
      if (options.author.time && options.author.offset !== undefined) {
        options.author = NodeGit.Signature.create(
          options.author.name,
          options.author.email,
          options.author.time,
          options.author.offset
        );
      } else {
        options.author = NodeGit.Signature.now(options.author.name, options.author.email);
      }
    } else {
      throw Error('what the heck? How did we get here...');
    }
    options.debug('author:', options.author.toString());

    if (options.committer === undefined) options.committer = config.committer;
    if (!options.committer) {
      options.committer = options.author;
    } else if (typeof options.committer == 'string') {
      debugStep('get string signature');
      options.committer = await NodeGit.Signature.fromBuffer(options.committer);
    } else if (options.committer.name && options.committer.email) {
      if (options.committer.time && options.committer.offset !== undefined) {
        options.committer = NodeGit.Signature.create(
          options.committer.name,
          options.committer.email,
          options.committer.time,
          options.committer.offset
        );
      } else {
        options.committer = NodeGit.Signature.now(options.committer.name, options.committer.email);
      }
    } else {
      throw Error('what the heck? How did we get here...');
    }
    options.debug('committer:', options.committer.toString());

    debugStep('get head');
    let head = await repo.head();

    debugStep('get head short name');
    let headNameShort = branchShortName(head.name());

    options.debug('headNameShort:', headNameShort);

    options.separator = options.separator || config.separator || '/';

    let prefixedShortName;
    if (typeof options.prefix == 'function') {
      prefixedShortName = options.prefix(headNameShort);
    } else {
      if (options.postfix) {
        prefixedShortName = headNameShort + options.postfix;
      } else {
        prefixedShortName = options.useNestedPrefix
          ? headNameShort.replace(/^(.*\/)?([^/]+)$/, `$1${options.prefix}${options.separator}$2`)
          : options.prefix + options.separator + headNameShort;
      }
    }

    options.debug('prefixedShortName:', prefixedShortName);

    let branch;
    let newBranch = false;
    try {
      debugStep('create branch');
      branch = await repo.createBranch(prefixedShortName, head.target(), false);
      options.debug('new branch created:', branch.name());
      newBranch = true;
    } catch (e) {
      debugStep('get branch');
      branch = await repo.getBranch(prefixedShortName);
      options.debug('use existing branch:', branch.name());
    }

    let parents;
    if (options.historyStrategy === undefined) options.historyStrategy = config.historyStrategy;
    if (newBranch || options.historyStrategy == 'parallel' || options.historyStrategy == 'manual') {
      parents = [branch.target()];
    } else if (options.historyStrategy === undefined || options.historyStrategy == 'merge') {
      parents = [branch.target(), head.target()];
    } else if (options.historyStrategy == 'clear' || options.historyStrategy == 'reset') {
      debugStep('create branch force');
      branch = await repo.createBranch(prefixedShortName, head.target(), true);
      options.debug('new branch created:', branch.name());
      parents = [head.target()];
      newBranch = 'forced';
    } else {
      throw Error('Unknown parent strategy: ' + options.historyStrategy);
    }

    options.debug('branch:', branch.target());

    debugStep('refresh index');
    let index = await repo.refreshIndex();

    debugStep('index add all');
    let indexAddRes = await index.addAll(options.pathspec, options.flags, (path, patternMatch) => {
      options.debug('index add:', { path, patternMatch });
      return 0;
    });

    options.debug('index add result:', indexAddRes);

    debugStep('index write');
    await index.write();

    debugStep('index write tree');
    let tree = await index.writeTree();

    let branchName = branch.name();

    debugStep('get branch short name');
    let branchNameShort = branchShortName(branchName);

    debugStep('create prefixed commit');
    let commit = await repo.createCommit(
      branchName,
      options.author,
      options.committer,
      options.message,
      tree,
      parents
    );

    let res = {
      latestHash: commit.tostrS(),
      treeHash: tree.tostrS(),
      branchName,
      branchNameShort,
    };
    options.debug('result:', res);
    return res;
  } catch (e) {
    let res = {
      step,
      error: e,
    };
    options.debug('result:', res);
    return res;
  }
}

module.exports = wip;

if (require.main === module) wip().then(console.log);
