# node-git-wip

git-wip implementation entirely in node.

Targeted for use alongside other git [gui] tools and use with automatic deployment scripts.

## How this `git-wip` works

When called, this `git-wip` will create a branch with the name `wip/$branch`, add all unignored files in the working tree, commit, and return the index to a normal state with all changes still unstaged.
Once complete, `git-wip` will report the hash and/or the WIP branch name of the new commit.
This is targeted at usage by other automatic testing systems.

When subsequent calls to `git-wip` are made, it simply continues the previously created branch.

If a commit is made on the current branch, `git-wip` creates a new `wip/$branch` from the latest commit.

