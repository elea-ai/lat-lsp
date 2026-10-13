'use strict';

/**
 * Purpose: load the ESM internals of `@lat.md/core` from this CommonJS
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
 *   codeRefs: typeof import('@lat.md/core/code-refs'),
 *   lattice: typeof import('@lat.md/core/lattice'),
 *   sourceFormats: typeof import('@lat.md/core/source-formats'),
 *   sourceParser: typeof import('@lat.md/core/source-parser'),
 * }} LatModules
 */

/** @type {Promise<LatModules> | null} */
let loading = null;

async function importLatModules() {
  const [codeRefs, lattice, sourceFormats, sourceParser] = await Promise.all([
    import('@lat.md/core/code-refs'),
    import('@lat.md/core/lattice'),
    import('@lat.md/core/source-formats'),
    import('@lat.md/core/source-parser'),
  ]);
  return { codeRefs, lattice, sourceFormats, sourceParser };
}

function loadLatModules() {
  if (loading === null) loading = importLatModules();
  return loading;
}

module.exports = { loadLatModules };
