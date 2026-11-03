// Run: node --test dependabot/tests/*.test.mjs
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
// `minimatch`, plus minimatch's own dependencies (brace-expansion nested, balanced-match
// hoisted next to the bundler's list), all inBundle with no resolved, linked by `dependencies`.
const lock = (over = {}) => ({
  lockfileVersion: 3,
  packages: {
    "": { name: "app", version: "1.0.0" },
    "node_modules/aws-cdk-lib": pinned("aws-cdk-lib", "2.0.0", { bundleDependencies: ["minimatch"] }),
    "node_modules/aws-cdk-lib/node_modules/minimatch": {
      version: "9.0.0",
      inBundle: true,
      dependencies: { "brace-expansion": "^2.0.0" },
    },
    "node_modules/aws-cdk-lib/node_modules/balanced-match": { version: "4.0.4", inBundle: true },
    "node_modules/aws-cdk-lib/node_modules/minimatch/node_modules/brace-expansion": {
      version: "2.0.0",
      inBundle: true,
      dependencies: { "balanced-match": "^4.0.0" },
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

const reasons = (l) => findRegistryOffenders(l).map((o) => o.reason);

// F1 (review of brakes/reusable-dependabot): an inBundle entry is accepted only if its
// path is in the dependency closure of the bundle root's declared list.
test("must fail: an undeclared inBundle child with a foreign resolved, no integrity and an install script", () => {
  const l = {
    lockfileVersion: 3,
    packages: {
      "": { name: "app", version: "1.0.0" },
      "node_modules/b": pinned("b", "1.0.0", { bundleDependencies: ["minimatch"] }),
      "node_modules/b/node_modules/minimatch": { version: "9.0.0", inBundle: true },
      "node_modules/b/node_modules/notdeclared": {
        version: "1.0.0",
        inBundle: true,
        resolved: reg("some-other-package", "6.6.6"),
        hasInstallScript: true,
      },
    },
  };
  assert.deepEqual(reasons(l), ["unbundled-inbundle"]);
});

test("must fail: a sibling under the bundler that no declared dependency reaches", () => {
  const l = lock({
    "node_modules/aws-cdk-lib/node_modules/sibling": { version: "1.0.0", inBundle: true },
  });
  assert.deepEqual(reasons(l), ["unbundled-inbundle"]);
});

test("must fail: a nested entry that a bundled package does not depend on", () => {
  const l = lock({
    "node_modules/aws-cdk-lib/node_modules/minimatch/node_modules/extra": {
      version: "1.0.0",
      inBundle: true,
    },
  });
  assert.deepEqual(reasons(l), ["unbundled-inbundle"]);
});

test("must fail: an entry under another bundler is not reached by this bundler's closure", () => {
  // b's minimatch depends on foo, but the only foo is under a different bundler c,
  // which declares an unrelated list. Resolution from b never leaves b's subtree.
  const l = {
    lockfileVersion: 3,
    packages: {
      "": { name: "app", version: "1.0.0" },
      "node_modules/b": pinned("b", "1.0.0", { bundleDependencies: ["minimatch"] }),
      "node_modules/b/node_modules/minimatch": {
        version: "9.0.0",
        inBundle: true,
        dependencies: { foo: "^1.0.0" },
      },
      "node_modules/c": pinned("c", "1.0.0", { bundleDependencies: ["y"] }),
      "node_modules/c/node_modules/y": { version: "1.0.0", inBundle: true },
      "node_modules/c/node_modules/foo": { version: "1.0.0", inBundle: true },
    },
  };
  assert.deepEqual(reasons(l), ["unbundled-inbundle"]);
});

test("must fail: a dependency name that climbs out of the bundler's subtree", () => {
  const l = lock({
    "node_modules/aws-cdk-lib/node_modules/minimatch": {
      version: "9.0.0",
      inBundle: true,
      dependencies: { "brace-expansion": "^2.0.0", "../../escapee": "1.0.0" },
    },
    "node_modules/aws-cdk-lib/node_modules/minimatch/node_modules/../../escapee": {
      version: "1.0.0",
      inBundle: true,
    },
  });
  assert.deepEqual(reasons(l), ["unbundled-inbundle"]);
});

test("the closure follows optionalDependencies and scoped names, and bundleDependencies: true", () => {
  const l = {
    lockfileVersion: 3,
    packages: {
      "": { name: "app", version: "1.0.0" },
      "node_modules/b": pinned("b", "1.0.0", {
        bundleDependencies: true,
        dependencies: { m: "^1.0.0" },
      }),
      "node_modules/b/node_modules/m": {
        version: "1.0.0",
        inBundle: true,
        optionalDependencies: { "@s/opt": "^1.0.0" },
      },
      "node_modules/b/node_modules/@s/opt": { version: "1.0.0", inBundle: true },
    },
  };
  assert.deepEqual(reasons(l), []);
});
