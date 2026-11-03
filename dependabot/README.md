# Dependabot brakes: reusable workflows and scripts

DRAFT. Generalised from de-otio/trellis (commit `2a9304d`). See the three reusable
workflows in `.github/workflows/`:

| Workflow | Use it in | What it does |
|---|---|---|
| `dependabot-gate.yml` | every repo with a `dependabot.yml` | Deterministic merge gate on `pull_request_target`: labels `needs-human-review` (and `major-bump`) when a rule fails, turns auto-merge off. Merges nothing by default. |
| `dependabot-stall-alarm.yml` | every such repo | Daily ntfy alarm for Dependabot PRs open over 7 days or with auto-merge on for over 48 hours. Needs the `NTFY_TOPIC` secret. |
| `supply-chain-npm.yml` | npm repos only | No tracked `.npmrc`, lockfile resolves only from registry.npmjs.org, `npm audit signatures`, informational flags. |

Scripts live in `dependabot/scripts/` and are checked out by the reusable workflows at
`scripts-ref` (keep it equal to the ref the workflow is pinned to). Tests:
`node --test dependabot/tests/`.

Not generic, so not here: the release automation (`dependabot-release-on-bump.yml`,
published packages only; releases stay human).

Rules every caller follows: top-level `permissions: {}`; the caller job grants what the reusable
workflow needs; `concurrency` only in the caller; labels `needs-human-review` and `major-bump` must
exist in the repo. Runner: `vars.CI_RUNNER` for private repos only, otherwise `ubuntu-latest`.

Divergence from trellis: `supply-chain/registry-host.mjs` accepts `inBundle` entries whose bundle
root declares bundled dependencies (aws-cdk-lib); trellis still rejects them.
