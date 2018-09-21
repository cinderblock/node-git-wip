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
