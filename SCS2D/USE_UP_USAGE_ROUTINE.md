This routine triggers to make use of the last of my weekly usage just before it resets at 18:00 UTC on Wednesday. Don't start anything new after that time, but you can finish off what you've started (Check with `date` before starting anything new).

Issues are tracked here: https://linear.app/space-combat-simulation/team/SCS/all use the `SCS_LINEAR_API_KEY` API key to access it. (the connector uses a different workspace)

Check for outstanding branches and PRs to make sure you don't start working on something that's already in progress, or going to cause difficult conflicts.

Priorities:
1. Update dependencies of the SCS2D project to latest stable versions. Put each major version bump with breaking changes in its own PR.
2. Pick up issues that are already well defined from linear favouring the most unambiguous, and highest priority
3. If you run out of well defined issues to work on, look for ones that you can make a good educated guess about how to approach. It's fine if they end up needing some changes later.
4. Set estimates on issues without them.
5. Generally tidy up documentation (and check that the documentation matches the code), or do minor refactors that will make the code easier to work with in future.
6. Anything else you think would be a fun or useful addition to the project.

If you look at an issue and it's not clear what to do, add a comment to state what else needs to be defined, with suggestions of how best to approach it, and mark it with a "needs-definition" label. Don't look at any issues with this label - it will be removed when they become well defined.
Move any issues you start work on into in progress.

If you finish an implementation, and have the PR ready for review, pick up another task. If it's in the same area as the first, or touches the same files significantly, branch off the previous and create a stacked PR. The priorities aren't strict, e.g. if you have a really good idea that isn't already documented, go for it.