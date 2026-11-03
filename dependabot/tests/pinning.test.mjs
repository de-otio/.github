// Run: node --test dependabot/tests/*.test.mjs
// F2: scripts-ref must be a full commit SHA, the callers carry a placeholder that
// pin-callers.sh fills, and the vendored scripts that are meant to be byte-identical
// to trellis 2a9304d stay that way.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const tmp = mkdtempSync(join(tmpdir(), "pinning-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// The text of the "Require scripts-ref ..." step's `run:` block, found without a YAML parser.
function requireShaScript(workflow) {
  const lines = readFileSync(join(ROOT, ".github/workflows", workflow), "utf8").split("\n");
  const at = lines.findIndex((l) => l.includes("name: Require scripts-ref to be a full commit SHA"));
  assert.notEqual(at, -1, `${workflow}: no scripts-ref SHA step`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  assert.notEqual(runAt, -1, `${workflow}: step has no run block`);
  const indent = lines[runAt + 1].match(/^\s*/)[0].length;
  const body = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() !== "" && l.match(/^\s*/)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join("\n");
}

const sha = "0123456789abcdef0123456789abcdef01234567";
const WORKFLOWS = ["dependabot-gate.yml", "dependabot-stall-alarm.yml", "supply-chain-npm.yml"];

for (const wf of WORKFLOWS) {
  test(`${wf}: scripts-ref must be a 40-character lowercase SHA`, () => {
    const script = requireShaScript(wf);
    const run = (ref) =>
      spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, SCRIPTS_REF: ref } });
    assert.equal(run(sha).status, 0);
    for (const bad of [
      "main",
      "",
      "v1",
      sha.slice(0, 39),
      `${sha}0`,
      sha.toUpperCase(),
      sha.slice(0, 7),
      `main\n${sha}`,
      `${sha}\nmain`,
      `refs/heads/${sha}`,
    ]) {
      const r = run(bad);
      assert.notEqual(r.status, 0, JSON.stringify(bad));
      assert.match(r.stdout + r.stderr, /full commit SHA|40-character/);
    }
  });

  test(`${wf}: scripts-ref is required and has no default`, () => {
    const text = readFileSync(join(ROOT, ".github/workflows", wf), "utf8");
    const own = /\n {6}scripts-ref:\n((?: {8}.*\n)+)/.exec(text)?.[1] ?? "";
    assert.notEqual(own, "", "no scripts-ref input");
    assert.match(own, /required: true/);
    assert.doesNotMatch(own, /default:/);
  });
}

const pinScript = join(ROOT, "dependabot/scripts/pin-callers.sh");
const pin = (...args) => spawnSync("bash", [pinScript, ...args], { encoding: "utf8" });

test("pin-callers.sh fills every placeholder in files and directories", () => {
  const d = join(tmp, "patches");
  mkdirSync(join(d, "repo/files"), { recursive: true });
  const a = join(d, "repo/brakes.patch");
  const b = join(d, "repo/files/gate.yml");
  const untouched = join(d, "repo/files/other.yml");
  writeFileSync(a, "+    uses: de-otio/.github/.github/workflows/dependabot-gate.yml@__PIN_SHA__\n+      scripts-ref: __PIN_SHA__\n");
  writeFileSync(b, "uses: x@__PIN_SHA__ # __PIN_SHA__\n");
  writeFileSync(untouched, "nothing here\n");
  const r = pin(sha, d);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(a, "utf8"),
    `+    uses: de-otio/.github/.github/workflows/dependabot-gate.yml@${sha}\n+      scripts-ref: ${sha}\n`,
  );
  assert.equal(readFileSync(b, "utf8"), `uses: x@${sha} # ${sha}\n`);
  assert.equal(readFileSync(untouched, "utf8"), "nothing here\n");
});

test("pin-callers.sh refuses anything but a 40-character lowercase SHA and changes nothing", () => {
  const f = join(tmp, "caller.yml");
  for (const bad of ["main", sha.slice(0, 39), `${sha}0`, sha.toUpperCase(), "", "a/b"]) {
    writeFileSync(f, "scripts-ref: __PIN_SHA__\n");
    const r = pin(bad, f);
    assert.notEqual(r.status, 0, JSON.stringify(bad));
    assert.equal(readFileSync(f, "utf8"), "scripts-ref: __PIN_SHA__\n");
  }
});

test("pin-callers.sh needs a SHA and a path", () => {
  assert.equal(pin(sha).status, 2);
  assert.equal(pin(sha, join(tmp, "does-not-exist")).status, 2);
});

// Byte-identical to de-otio/trellis 2a9304d (shasum -a 256). Edit a file on purpose
// and the new hash goes here, with the reason, in the same change. Not listed
// (path strings differ from trellis): flags.mjs, npm-config.mjs, select-stalled.mjs,
// run.mjs. registry-host.mjs carries the same closure rule as trellis ead9036 and
// is covered by registry-host.test.mjs.
const VENDORED = {
  "dependabot/scripts/supply-chain/fetch-registry.mjs": "8fb2dcbcc3675603dd7f0818ed7c00c8d51e0b05738ef16d6e92e450b087551d",
  "dependabot/scripts/supply-chain/install-scripts.mjs": "395cc266771f7d03893c550574fde58ca149468de0531969316a5e1ab6400a9a",
  "dependabot/scripts/supply-chain/lockfile.mjs": "d04bc19d98e2ad28b205ae43f13efb57710e924f36da546199b1469326df68be",
  "dependabot/scripts/supply-chain/new-packages.mjs": "964d6359a54a01b7d43b23d994d61ee84c67a0030c9d9f7752c9eb20e9c91ed1",
  "dependabot/scripts/supply-chain/provenance.mjs": "c6a379af708370acdc8fb6000491dac9f642cf17bba8198f879c321bfb760af8",
};
test("vendored supply-chain scripts match trellis 2a9304d byte for byte", () => {
  for (const [file, want] of Object.entries(VENDORED)) {
    const got = createHash("sha256").update(readFileSync(join(ROOT, file))).digest("hex");
    assert.equal(got, want, `${file} diverged from trellis 2a9304d`);
  }
});
