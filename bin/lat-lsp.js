#!/usr/bin/env node
'use strict';

/**
 * Purpose: entry point of the lat.md language server. Verifies the package's
 * dependencies resolve, then hands control to `src/server.js`, which owns the
 * LSP connection.
 *
 * Usage: lat-lsp [--stdio | --node-ipc | --socket]
 *   The transport flag is chosen by the LSP client; `--stdio` is assumed when
 *   none is given. Editors invoke this file — it is not meant to be run by hand
 *   except when debugging a client.
 *
 * Example:
 *   npm install -g @elea.health/lat-lsp
 *   lat-lsp --stdio
 */

const { join } = require('node:path');

try {
  require.resolve('vscode-languageserver');
} catch {
  process.stderr.write(
    'lat-lsp: dependencies are not installed — run `npm install` in the ' +
      'package, or reinstall @elea.health/lat-lsp\n',
  );
  process.exit(1);
}

require(join(__dirname, '..', 'src', 'server.js'));
