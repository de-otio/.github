# de-otio org workflows

Shared, reusable GitHub Actions workflows for the de-otio organisation.

## Workflows

### `dependabot-claude-review.yml`

Auto-merges Dependabot PRs for **semver-minor / semver-patch** bumps once
the calling repo's required status checks are green (a best-effort,
non-blocking `npm audit signatures` check runs first for npm/yarn deps).
**Semver-major bumps are always left for a human** — no automated review
is attempted for them at all.

> **Changed 2026-07-03** (was: a per-PR Claude supply-chain review on AWS
> Bedrock). That review step's `anthropics/claude-code-action` call
> started failing its own internal OIDC token exchange (401, unrelated to
> the Bedrock credentials), which silently blocked auto-merge for every
> consuming repo — including routine, safe patch/minor bumps. dot-ops had
> independently retired the same pattern for cost/value reasons
> (`docs/deploy-health.md`, 2026-07-01: "too costly per PR for its
> value"). This workflow now matches dot-ops's own
> `dependabot-automerge.yml`: plain semver-based auto-merge, no AWS, no
> OIDC, no third-party model-invoking action — see "Threat model" below
> for the trade-off.

**Calling repo:**

```yaml
# .github/workflows/dependabot-handler.yml
name: Dependabot review
on:
  pull_request_target:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write
  id-token: write

jobs:
  review:
    if: github.actor == 'dependabot[bot]'
    uses: de-otio/.github/.github/workflows/dependabot-claude-review.yml@main
```

### `dependabot-release-on-bump.yml`

After a Dependabot PR merges to main, bumps the package version
(prerelease suffix for alpha/beta/rc, patch for stable), commits the
bump, tags, and creates a GitHub Release. The release event then fires
each repo's existing `publish.yml`.

**Library repos only.** Don't call this from app / CDK / MCP repos —
those don't publish to a registry.

**Calling repo:**

```yaml
# .github/workflows/dependabot-release.yml
name: Auto-release on Dependabot merge
on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  release:
    if: contains(github.event.head_commit.message, 'dependabot[bot]')
    uses: de-otio/.github/.github/workflows/dependabot-release-on-bump.yml@main
```

## Threat model

Auto-merging Dependabot patches is a tradeoff: low effort vs. the chance of
merging a compromised dep. This workflow no longer runs a per-PR Claude
supply-chain review (see the change note above) — the previous version's
review step tightened that bound materially by actually inspecting the
upstream package each time, but it depended on a third-party action's own
OIDC auth path that broke and silently disabled auto-merge entirely for
every consuming repo. A review layer that's usually down provides less
real protection than a simpler layer that reliably runs, so the tradeoff
was made explicitly in favor of reliability.

What's left: required CI checks, branch protection on `main`, the
existing security-review workflow on every PR, the npm audit-signatures
step here (best-effort, attests *who* published, not *what* they
intended), and — the one that still matters most — **major version bumps
always wait for a human**, since that's where a maintainer takeover or a
genuinely breaking change is most likely to land.

For high-stakes repos (crypto, anything that touches user keys), don't
rely on this workflow's default at all — require human review on every
Dependabot PR regardless of semver bump size (skip calling this workflow,
or add a repo-specific required-reviewers rule on the Dependabot branch
pattern).
