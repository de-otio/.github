// Run: node --test dependabot/tests/*.test.mjs
// gate.mjs is the I/O shell around evaluate(): it asks `gh api` for the PR as data.
// A stub `gh` on PATH answers from fixtures, so the shell runs end to end without a
// network. What is pinned here is the one decision the shell makes itself: a decision
// holds only for the commit the run started for ("head moved").
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const GATE = resolve(fileURLToPath(import.meta.url), "../../scripts/dependabot-gate/gate.mjs");
const dir = mkdtempSync(join(tmpdir(), "gate-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const HEAD = "a".repeat(40);
const MOVED = "b".repeat(40);

const fixtures = (headSha) => ({
  pull: {
    user: { login: "dependabot[bot]" },
    commits: 1,
    changed_files: 1,
    labels: [],
    head: { sha: headSha },
  },
  commits: [
    {
      author: { login: "dependabot[bot]" },
      committer: { login: "web-flow" },
      commit: {
        committer: { email: "noreply@github.com" },
        verification: { verified: true, reason: "valid" },
      },
    },
  ],
  files: [{ filename: "package.json", status: "modified" }],
});

// Answers `gh api <endpoint>` and `gh api --paginate --slurp <endpoint>` from FIXTURES.
const stub = `#!/usr/bin/env node
const f = JSON.parse(process.env.FIXTURES);
const endpoint = process.argv[process.argv.length - 1];
if (endpoint.endsWith("/commits")) process.stdout.write(JSON.stringify([f.commits]));
else if (endpoint.endsWith("/files")) process.stdout.write(JSON.stringify([f.files]));
else process.stdout.write(JSON.stringify(f.pull));
`;
writeFileSync(join(dir, "gh"), stub);
chmodSync(join(dir, "gh"), 0o755);
writeFileSync(join(dir, "flags.json"), '{"flags":[]}');

function runGate(prHead, expectedHead) {
  const r = spawnSync(
    process.execPath,
    [
      GATE,
      "--repo", "example/repo",
      "--pr", "1",
      "--expected-head", expectedHead,
      "--update-type", "version-update:semver-minor",
      "--flags-file", join(dir, "flags.json"),
      "--ecosystems", "npm",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURES: JSON.stringify(fixtures(prHead)) },
    },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("the gate passes when the PR head is the commit the run started for", () => {
  assert.deepEqual(runGate(HEAD, HEAD), {
    pass: true,
    reasons: [],
    alreadyLabeled: false,
    updateType: "version-update:semver-minor",
    head: HEAD,
  });
});

test("the gate fails when the head moved since the run started", () => {
  const r = runGate(MOVED, HEAD);
  assert.equal(r.pass, false);
  assert.deepEqual(r.reasons, ["head moved since this run started; a newer run will decide"]);
});

test("the gate fails when no expected head was given", () => {
  const r = spawnSync(process.execPath, [GATE, "--repo", "example/repo", "--pr", "1", "--flags-file", join(dir, "flags.json"), "--ecosystems", "npm", "--update-type", "version-update:semver-minor"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURES: JSON.stringify(fixtures(HEAD)) },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).pass, false);
});
