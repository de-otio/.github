# de-otio org workflows

Shared, reusable GitHub Actions workflows for the de-otio organisation.

## Workflows

### `dependabot-claude-review.yml`

Reviews each Dependabot PR for **supply-chain attack signals** (not API
compatibility — that's what tests are for). Claude inspects the diff,
the upstream package metadata, install scripts, and release patterns,
then posts a verdict label:

- `claude-approved` → enables GitHub auto-merge (squash by default)
- `claude-rejected` / `needs-human-review` → labelled, no auto-merge

Major version bumps (`semver-major`) short-circuit to `needs-human-review`
regardless of Claude's opinion.

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

Auto-merging Dependabot patches is normally a tradeoff: low effort vs. the
chance of merging a compromised dep. Claude's review tightens the bound
materially — it actually inspects the upstream package each time, which
no human at de-otio's scale would do. But it's not infallible:

- Claude can be fooled by sufficiently-stealthy malicious code.
- The npm signature audit only attests *who* published, not *what* they
  intended.
- A maintainer takeover with carefully-crafted patch bumps may pass.

Defences in depth: required CI checks, branch protection on `main`, the
existing security-review workflow on every PR, and the npm audit step in
the publish workflow. The Claude review is one layer, not the layer.

For high-stakes repos (crypto, anything that touches user keys), prefer
`needs-human-review` as the default and let Claude promote to
`claude-approved` only on dead-routine bumps.
