// Run: node --test dependabot/tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { findRegistryOffenders } from "../scripts/supply-chain/registry-host.mjs";

const reg = (name, version) => `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
const pinned = (name, version, extra = {}) => ({
  version,
  resolved: reg(name, version),
  integrity: "sha512-x",
  ...extra,
});

// The shape npm writes for aws-cdk-lib: a registry-pinned bundler whose list names
// `minimatch`, plus minimatch's own dependency hoisted next to it, inBundle, no resolved.
const lock = (over = {}) => ({
  lockfileVersion: 3,
  packages: {
    "": { name: "app", version: "1.0.0" },
    "node_modules/aws-cdk-lib": pinned("aws-cdk-lib", "2.0.0", { bundleDependencies: ["minimatch"] }),
    "node_modules/aws-cdk-lib/node_modules/minimatch": { version: "9.0.0", inBundle: true },
    "node_modules/aws-cdk-lib/node_modules/balanced-match": { version: "4.0.4", inBundle: true },
    "node_modules/aws-cdk-lib/node_modules/minimatch/node_modules/brace-expansion": {
      version: "2.0.0",
      inBundle: true,
    },
    ...over,
  },
});

test("baseline: a bundler's transitive bundled entries are accepted", () => {
  assert.deepEqual(findRegistryOffenders(lock()), []);
});

test("inBundle under a package that declares no bundled dependencies is rejected", () => {
  const l = lock({
    "node_modules/aws-cdk-lib": pinned("aws-cdk-lib", "2.0.0"),
  });
  const reasons = findRegistryOffenders(l).map((o) => o.reason);
  assert.ok(reasons.length > 0);
  assert.ok(reasons.every((r) => r === "unbundled-inbundle"));
});

test("inBundle at the top level (root as parent) still gets the full rule", () => {
  const l = lock({ "node_modules/sneaky": { version: "1.0.0", inBundle: true } });
  assert.deepEqual(
    findRegistryOffenders(l).map((o) => o.reason),
    ["missing-resolved"],
  );
});

test("a bundler that is itself not on the public registry is rejected", () => {
  const l = lock({
    "node_modules/aws-cdk-lib": {
      ...pinned("aws-cdk-lib", "2.0.0", { bundleDependencies: ["minimatch"] }),
      resolved: "https://internal.example.com/aws-cdk-lib/-/aws-cdk-lib-2.0.0.tgz",
    },
  });
  assert.ok(findRegistryOffenders(l).some((o) => o.reason === "resolved-not-public-registry"));
});

test("a non-bundled entry without resolved is still rejected", () => {
  const l = lock({ "node_modules/plain": { version: "1.0.0", integrity: "sha512-x" } });
  assert.ok(findRegistryOffenders(l).some((o) => o.reason === "missing-resolved"));
});
