# Dependabot brakes: reusable workflows and scripts

DRAFT. Generalised from de-otio/trellis (commit `2a9304d`). See the three reusable
workflows in `.github/workflows/`:

| Workflow | Use it in | What it does |
|---|---|---|
| `dependabot-gate.yml` | every repo with a `dependabot.yml` | Deterministic merge gate on `pull_request_target`: labels `needs-human-review` (and `major-bump`) when a rule fails, turns auto-merge off. Merges nothing by default. |
| `dependabot-stall-alarm.yml` | every such repo | Daily ntfy alarm for Dependabot PRs open over 7 days or with auto-merge on for over 48 hours. Needs the `NTFY_TOPIC` secret. |
| `supply-chain-npm.yml` | npm repos only | No tracked `.npmrc`, lockfile resolves only from registry.npmjs.org, `npm audit signatures`, informational flags. |

Scripts live in `dependabot/scripts/` and are checked out by the reusable workflows at
`scripts-ref`, which is REQUIRED to be a full 40-character commit SHA (the first step of each
workflow fails on anything else) equal to the SHA the workflow itself is pinned to. Callers use
`@<SHA>` and `scripts-ref: <SHA>`; the per-repo patches carry the placeholder `__PIN_SHA__`, which
`dependabot/scripts/pin-callers.sh <SHA> <path>...` fills after this repo's PR merges.

Tests (Node 22 and 24; CI runs them on every pull request and push to main; a directory argument
is not accepted by Node 22, so use the glob): `node --test dependabot/tests/*.test.mjs`.

uv: a `uv.lock` change always fails the gate and so labels the PR `needs-human-review`; there is
no uv supply-chain check yet (a flags script for uv would replace that standing failure).

Not generic, so not here: the release automation (`dependabot-release-on-bump.yml`,
published packages only; releases stay human).

Rules every caller follows: top-level `permissions: {}`; the caller job grants what the reusable
workflow needs; `concurrency` only in the caller; labels `needs-human-review` and `major-bump` must
exist in the repo. Runner: `vars.CI_RUNNER` for private repos only, otherwise `ubuntu-latest`.

Runner: `vars.CI_RUNNER` for private repos only, never for a `dependabot/...` head ref (D11).

`supply-chain/registry-host.mjs` accepts a transitive `inBundle` entry only if its path is in the
dependency closure of the bundle root's declared `bundleDependencies` (aws-cdk-lib: minimatch,
brace-expansion, balanced-match); trellis carries the same rule.
