'use strict';

/**
 * Purpose: the VS Code extension entry point. Starts the `@elea.health/lat-lsp`
 * server over IPC for every file in the workspace and watches `lat.md/` for
 * changes made outside the editor.
 *
 * Usage: activated by VS Code, never called directly. The server is resolved
 *   from the bundled `@elea.health/lat-lsp` dependency, so the extension needs
 *   no configuration and no separate install step.
 *
 * Example:
 *   code --install-extension elea-health.lat-lsp
 */

const { workspace } = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

/** @type {LanguageClient | null} */
let client = null;

function activate(context) {
  const module = require.resolve('@elea.health/lat-lsp/bin/lat-lsp.js');
  const serverOptions = {
    debug: {
      module,
      options: { execArgv: ['--nolazy', '--inspect=6019'] },
      transport: TransportKind.ipc,
    },
    run: { module, transport: TransportKind.ipc },
  };
  const clientOptions = {
    documentSelector: [{ scheme: 'file' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/lat.md/**/*.md'),
    },
  };
  client = new LanguageClient(
    'latLsp',
    'lat.md Language Server',
    serverOptions,
    clientOptions,
  );
  context.subscriptions.push(client);
  return client.start();
}

function deactivate() {
  return client === null ? undefined : client.stop();
}

module.exports = { activate, deactivate };
