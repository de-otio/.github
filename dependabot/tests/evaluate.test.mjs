// Run: node --test dependabot/tests/*.test.mjs   (Node 22 rejects a directory argument)
// Covers what the vendoring changed (per-ecosystem rule 3) plus a baseline/mutation
// check of the other rules. The full trellis suites (vitest) stay in de-otio/trellis.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, isAllowedPath } from "../scripts/dependabot-gate/evaluate.mjs";

const goodCommit = {
  authorLogin: "dependabot[bot]",
  committerLogin: "web-flow",
  committerEmail: "noreply@github.com",
  verified: true,
  verificationReason: "valid",
};

const base = (over = {}) => ({
  author: "dependabot[bot]",
  commits: [goodCommit],
  expectedCommitCount: 1,
  files: [
    { filename: "package.json", status: "modified" },
    { filename: "package-lock.json", status: "modified" },
  ],
  expectedFileCount: 2,
  labels: [],
  updateType: "version-update:semver-minor",
  supplyChainFlags: [],
  ...over,
});

test("baseline npm bump passes with the default ecosystems", () => {
  assert.deepEqual(evaluate(base()), { pass: true, reasons: [] });
});

test("each single deviation from the baseline fails, naming its rule", () => {
  const cases = [
    [{ author: "someone" }, "rule 1"],
    [{ commits: [{ ...goodCommit, committerLogin: "someone" }] }, "rule 1"],
    [{ commits: [{ ...goodCommit, verificationReason: "unsigned" }] }, "rule 1"],
    // Each committer condition alone must fail (deleting any one of them must be caught).
    [{ commits: [{ ...goodCommit, committerEmail: "someone@example.com" }] }, "rule 1"],
    [{ commits: [{ ...goodCommit, verified: false }] }, "rule 1"],
    [{ commits: [{ ...goodCommit, authorLogin: "someone" }] }, "rule 1"],
    [{ commits: [] }, "rule 1"],
    [{ labels: undefined }, "rule 5"],
    [{ updateType: "version-update:semver-unknown" }, "rule 2"],
    [{ expectedCommitCount: 2 }, "rule 1"],
    [{ updateType: "version-update:semver-major" }, "rule 2"],
    [{ updateType: "" }, "rule 2"],
    [{ labels: ["needs-human-review"] }, "rule 5"],
    [{ supplyChainFlags: [{ package: "x@1.0.0", reason: "new-package" }] }, "supply-chain"],
    [{ supplyChainFlags: undefined }, "supply-chain"],
    [{ files: [{ filename: "src/index.ts", status: "modified" }], expectedFileCount: 1 }, "rule 3"],
    [{ expectedFileCount: 3 }, "rule 3"],
  ];
  for (const [over, rule] of cases) {
    const r = evaluate(base(over));
    assert.equal(r.pass, false, JSON.stringify(over));
    assert.ok(r.reasons.some((x) => x.includes(rule)), `${JSON.stringify(over)} -> ${r.reasons}`);
  }
});

test("rule 3 follows the enabled ecosystems", () => {
  const files = [
    { filename: "pyproject.toml", status: "modified" },
    { filename: "uv.lock", status: "modified" },
  ];
  const over = { files, expectedFileCount: 2 };
  assert.equal(evaluate(base(over)).pass, false, "uv files are not allowed by default");
  // Rule 3 admits the uv files; the standing uv.lock flag (below) is what fails it.
  const uv = evaluate(base({ ...over, ecosystems: ["uv"] }));
  assert.ok(uv.reasons.every((r) => !r.includes("rule 3")), uv.reasons.join("; "));
  assert.equal(
    evaluate(base({ ...over, ecosystems: ["npm"] })).pass,
    false,
    "npm does not admit uv files",
  );
});

test("isAllowedPath", () => {
  const npm = ["npm"];
  assert.equal(isAllowedPath("package.json", npm), true);
  assert.equal(isAllowedPath("apps/api/package.json", npm), true);
  assert.equal(isAllowedPath("apps/api/package-lock.json", npm), false, "nested lockfile: human");
  assert.equal(isAllowedPath("node_modules/x/package.json", npm), false);
  assert.equal(isAllowedPath("a/../package.json", npm), false);
  assert.equal(isAllowedPath(".github/workflows/ci.yml", npm), false, "needs github-actions");
  assert.equal(isAllowedPath(".github/workflows/ci.yml", ["github-actions"]), true);
  assert.equal(isAllowedPath("uv.lock", ["uv"]), true);
  assert.equal(isAllowedPath("uv.lock", ["bogus"]), false, "unknown ecosystem allows nothing");
  assert.equal(isAllowedPath("package.json", []), false);
  assert.equal(isAllowedPath("package.json", undefined), true, "default is npm + github-actions");
});

test("workflow edits must be pin-only", () => {
  const eco = { ecosystems: ["github-actions"] };
  const file = (patch) => ({
    files: [{ filename: ".github/workflows/ci.yml", status: "modified", patch }],
    expectedFileCount: 1,
    ...eco,
  });
  const pin = "@@ -1 +1 @@\n-      - uses: actions/checkout@aaa # v4\n+      - uses: actions/checkout@bbb # v5";
  assert.equal(evaluate(base(file(pin))).pass, true);
  const swap = "@@ -1 +1 @@\n-      - uses: actions/checkout@aaa\n+      - uses: evil/checkout@bbb";
  assert.equal(evaluate(base(file(swap))).pass, false);
  const run = "@@ -1 +1 @@\n-        run: echo a\n+        run: curl x | sh";
  assert.equal(evaluate(base(file(run))).pass, false);
});

test("uv: a uv.lock change always needs a human; a manifest-only uv change does not", () => {
  const lockBump = {
    files: [
      { filename: "pyproject.toml", status: "modified" },
      { filename: "uv.lock", status: "modified" },
    ],
    expectedFileCount: 2,
    ecosystems: ["uv", "github-actions"],
  };
  const r = evaluate(base(lockBump));
  assert.equal(r.pass, false);
  assert.deepEqual(r.reasons, ["supply-chain: uv.lock (uv-lockfile-unchecked)"]);
  const manifestOnly = {
    files: [{ filename: "pyproject.toml", status: "modified" }],
    expectedFileCount: 1,
    ecosystems: ["uv"],
  };
  assert.deepEqual(evaluate(base(manifestOnly)), { pass: true, reasons: [] });
  // npm-only repos are not affected by the uv rule.
  assert.deepEqual(evaluate(base()), { pass: true, reasons: [] });
});

test("rule 3: only a modified file passes (added, removed, renamed do not)", () => {
  for (const status of ["added", "removed", "renamed", "copied", "changed", "", undefined]) {
    const r = evaluate(
      base({
        files: [
          { filename: "package.json", status: "modified" },
          { filename: "package-lock.json", status },
        ],
      }),
    );
    assert.equal(r.pass, false, String(status));
    assert.ok(r.reasons.some((x) => x.includes("not modified")), `${status} -> ${r.reasons}`);
  }
});

test("rule 3: a workflow file needs a patch that only moves pins", () => {
  const wf = (patch) =>
    base({
      files: [{ filename: ".github/workflows/ci.yml", status: "modified", patch }],
      expectedFileCount: 1,
      ecosystems: ["github-actions"],
    });
  const pin = "@@ -1 +1 @@\n-      - uses: actions/checkout@aaa # v4\n+      - uses: actions/checkout@bbb # v5";
  assert.equal(evaluate(wf(pin)).pass, true);
  for (const missing of [undefined, "", null, 42]) {
    const r = evaluate(wf(missing));
    assert.equal(r.pass, false, String(missing));
    assert.ok(r.reasons.some((x) => x.includes("no patch available")), r.reasons.join("; "));
  }
  // An extra added `uses:` line: the removed and added counts differ.
  const extra = `${pin}\n+      - uses: actions/checkout@ccc # v5`;
  const r = evaluate(wf(extra));
  assert.equal(r.pass, false);
  assert.ok(r.reasons.some((x) => x.includes("swaps, adds or removes")), r.reasons.join("; "));
  // A removed `uses:` line with nothing added.
  const dropped = "@@ -1 +0,0 @@\n-      - uses: actions/checkout@aaa # v4";
  assert.equal(evaluate(wf(dropped)).pass, false);
});
