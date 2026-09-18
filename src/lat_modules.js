'use strict';

/**
 * Purpose: load the ESM internals of `@elea.health/lat.md` from this CommonJS
 * package exactly once, so ref resolution here matches what `lat check` enforces.
 *
 * Usage: `await loadLatModules()` — the dynamic imports are shared across every
 *   caller, so repeated calls cost nothing after the first.
 *
 * Example:
 *   const { lattice } = await loadLatModules();
 *   const latDir = lattice.findLatticeDir(process.cwd());
 */

/**
 * @typedef {{
 *   codeRefs: typeof import('@elea.health/lat.md/dist/src/code-refs.js'),
 *   lattice: typeof import('@elea.health/lat.md/dist/src/lattice.js'),
 *   sourceParser: typeof import('@elea.health/lat.md/dist/src/source-parser.js'),
 * }} LatModules
 */

/** @type {Promise<LatModules> | null} */
let loading = null;

async function importLatModules() {
  const [codeRefs, lattice, sourceParser] = await Promise.all([
    import('@elea.health/lat.md/dist/src/code-refs.js'),
    import('@elea.health/lat.md/dist/src/lattice.js'),
    import('@elea.health/lat.md/dist/src/source-parser.js'),
  ]);
  return { codeRefs, lattice, sourceParser };
}

function loadLatModules() {
  if (loading === null) loading = importLatModules();
  return loading;
}

module.exports = { loadLatModules };
