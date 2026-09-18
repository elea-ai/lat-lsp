"use strict";

/**
 * Purpose: assert the containment rule that keeps source targets inside the
 * project root — the one check standing between a `[[ref]]` and an arbitrary
 * file on the machine.
 *
 * Usage: driven by `node --test`. Each case builds a throwaway root under the
 *   OS temp directory, which on macOS is itself reached through a symlink, so
 *   these also cover canonicalising the root.
 *
 * Example:
 *   node --test test/locations.test.js
 */

const assert = require("node:assert/strict");
const {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { describe, test } = require("node:test");

const { resolveWithinRoot } = require("../src/locations.js");

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "lat-lsp-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "widget.ts"), "export const widget = 1;\n");
  return root;
}

describe("resolveWithinRoot", () => {
  test("resolves a file inside the root", () => {
    const root = workspace();
    assert.equal(
      resolveWithinRoot(root, "src/widget.ts"),
      join(root, "src", "widget.ts"),
    );
  });

  test("rejects a parent-directory traversal", () => {
    const root = workspace();
    assert.equal(resolveWithinRoot(root, "../outside.ts"), null);
  });

  test("keeps an in-root name that begins with two dots", () => {
    const root = workspace();
    writeFileSync(
      join(root, "..generated.ts"),
      "export const generated = 1;\n",
    );
    assert.equal(
      resolveWithinRoot(root, "..generated.ts"),
      join(root, "..generated.ts"),
    );
  });

  test("rejects a symlink pointing outside the root", () => {
    const root = workspace();
    const secret = join(
      mkdtempSync(join(tmpdir(), "lat-lsp-outside-")),
      "secret.ts",
    );
    writeFileSync(secret, "export const secret = 1;\n");
    symlinkSync(secret, join(root, "src", "link.ts"));
    assert.equal(resolveWithinRoot(root, "src/link.ts"), null);
  });

  test("keeps a symlink pointing back inside the root", () => {
    const root = workspace();
    symlinkSync(join(root, "src", "widget.ts"), join(root, "src", "alias.ts"));
    assert.equal(
      resolveWithinRoot(root, "src/alias.ts"),
      join(root, "src", "alias.ts"),
    );
  });

  test("rejects a path that does not exist", () => {
    const root = workspace();
    assert.equal(resolveWithinRoot(root, "src/missing.ts"), null);
  });
});
