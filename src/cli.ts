#!/usr/bin/env node
// `git-wip` takes no command line arguments: options come from a config file (see README).
import wip from './wip.ts';

wip().then(console.log);
