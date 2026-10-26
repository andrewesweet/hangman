# Issue tracker: external task tracker (tasks-axi)

Work items and specs for this repo live outside the repository, in a task tracker managed with the `tasks-axi` CLI. The repo's GitHub issues are not the work queue: they exist for outward-facing discussion only — bug reports, questions and feedback about the published game.

## Conventions

- One work item per task in the tracker; the tracker holds the spec, the status and the history.
- Do not create GitHub issues to track internal work. GitHub issues stay a discussion surface for people who play the game.
- When a task touches this repository's GitHub presence (a pull request, an issue reply, a release), note the forge link in the task text as `gh:<owner>/<repo>#<n>`, for example `gh:andrewesweet/hangman#17`.
- Triage roles (see `triage-labels.md`) apply to tracker items, using the label strings from that file.

## When a skill says "publish to the issue tracker"

Add a task to the tracker with `tasks-axi`, with the spec as its text.

## When a skill says "fetch the relevant ticket"

Read the task by its id from `tasks-axi`.
