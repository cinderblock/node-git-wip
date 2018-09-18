const path = require('path');

const NodeGit = require('nodegit');

async function wip(options) {
    options = options || {};

    options.debug = options.debug || console.log;
    
    options.repoPath = options.repoPath || path.resolve();

    options.discoverAcrossFs = options.discoverAcrossFs ? 1 : 0;
    options.ceilingDirs = options.ceilingDirs || '';
    options.prefix = options.prefix || 'wip';
    options.message = options.message || 'WIP';

    if (options.pathspec === undefined) {
        options.debug('pathspec default');
    } else {
        options.debug('pathspec:', options.pathspec);
    }
    
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


    if (options.useNestedPrefix === undefined || options.useNestedPrefix === null) {
        options.useNestedPrefix = true;
    }

    console.log('ceiling dirs:', options.ceilingDirs);
    
    
    let step;
    function debugStep(s) {
        step = s;
        if (options.debugSteps) {
            options.debug('step:', step);
        }
    }
    
    try {
        debugStep('find');
        options.repoPath = await NodeGit.Repository.discover(options.repoPath, options.discoverAcrossFs, options.ceilingDirs);
        
        debugStep('open');
        let repo = await NodeGit.Repository.open(options.repoPath);

        if (!options.author) {
            debugStep('get default signature');
            options.author = repo.defaultSignature();
        } else if (typeof options.author == 'string') {
            debugStep('get string signature');
            options.author = await NodeGit.Signature.fromBuffer(options.author);
        } else if (options.author.name && options.author.email) {

            if (options.author.time && (options.author.offset !== undefined)) {
                options.author = NodeGit.Signature.create(
                    options.author.name,
                    options.author.email,
                    options.author.time,
                    options.author.offset
                );
            } else {
                options.author = NodeGit.Signature.now(
                    options.author.name,
                    options.author.email
                );
            }

        } else {
            throw Error('what the heck? How did we get here...');
        }
        options.debug('author:', options.author.toString());

        if (!options.committer) {
            options.committer = options.author;
        } else if (typeof options.committer == 'string') {
            debugStep('get string signature');
            options.committer = await NodeGit.Signature.fromBuffer(options.committer);
        } else if (options.committer.name && options.committer.email) {

            if (options.committer.time && (options.committer.offset !== undefined)) {
                options.committer = NodeGit.Signature.create(
                    options.committer.name,
                    options.committer.email,
                    options.committer.time,
                    options.committer.offset
                );
            } else {
                options.committer = NodeGit.Signature.now(
                    options.committer.name,
                    options.committer.email
                );
            }

        } else {
            throw Error('what the heck? How did we get here...');
        }
        options.debug('committer:', options.committer.toString());

        debugStep('get head');
        let head = await repo.head();

        debugStep('get head short name');
        let headShortName = head.name().match(/^refs\/heads\/(.+)$/);

        if (!headShortName) throw Error('Unexpected branch name: ' + head.name());
        headShortName = headShortName[1];

        options.debug('headShortName:', headShortName);

        let prefixedShortName = options.useNestedPrefix ? headShortName.replace(/^(.*\/)?([^/]+)$/, `$1${options.prefix}/$2`) : (options.prefix + '/' + headShortName);
        
        options.debug('prefixedShortName:', prefixedShortName);

        let branch;
        try {
            debugStep('create branch');
            branch = await repo.createBranch(prefixedShortName, head.target(), false);
            options.debug('new branch created:', branch.name());
        } catch (e) {
            debugStep('get branch');
            branch = await repo.getBranch(prefixedShortName);
            options.debug('use existing branch:', branch.name());
        }

        options.debug('branch:', branch.target());

        debugStep('refresh index');
        let index = await repo.refreshIndex();

        debugStep('index add all');
        let indexAddRes = await index.addAll(
            options.pathspec,
            options.flags,
            (path, patternMatch) => {options.debug('index add:', {path, patternMatch}); return 0;}
        );

        options.debug('index add result:', indexAddRes);

        debugStep('index write');
        await index.write();

        debugStep('index write tree');
        let tree = await index.writeTree();

        debugStep('create prefixed commit');
        let commit = await repo.createCommit(
            branch.name(),
            options.author,
            options.committer,
            options.message,
            tree,
            [branch.target()]
        );

        let res = {
            latestHash: branch.target().tostrS(),
            branchName: branch.name(),
        };
        options.debug('result:', res);
        return res;


    } catch (e) {
        options.debug(step, 'error:', e);
    }
    

}

module.exports = wip;

if (require.main === module) wip();
    