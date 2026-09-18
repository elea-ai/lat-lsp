'use strict';

/**
 * Purpose: the LSP server itself. Wires the connection, keeps the lattice index
 * in sync with the client's buffers and the filesystem, and answers definition,
 * references, hover, document-symbol and workspace-symbol requests.
 *
 * Usage: required by `bin/lat-lsp.js`; never imported by other modules. Reading
 *   this file as a module starts a server on the transport named in `process.argv`.
 *
 * Example:
 *   node -e "process.argv.push('--stdio'); require('./scripts/lat-lsp/src/server.js')"
 */

const { readFile, stat } = require('node:fs/promises');
const { dirname } = require('node:path');
const { fileURLToPath } = require('node:url');

const {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} = require('vscode-languageserver/node');
const { TextDocument } = require('vscode-languageserver-textdocument');

const { hoverForTarget } = require('./hover.js');
const { LatticeIndex } = require('./index_store.js');
const { loadLatModules } = require('./lat_modules.js');
const { definitionLocations } = require('./locations.js');
const { referencesAtPosition } = require('./references.js');
const { documentSymbols, workspaceSymbols } = require('./symbols.js');
const { linkAtPosition, scanWikiLinks } = require('./wiki_links.js');

const latticeReloadDelayMs = 250;
const transportFlags = ['--stdio', '--node-ipc', '--socket'];

if (!process.argv.some((argument) => transportFlags.includes(argument))) {
  process.argv.push('--stdio');
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

/** @type {InstanceType<typeof LatticeIndex> | null} */
let index = null;
/** @type {Promise<unknown> | null} */
let indexReady = null;
/** @type {NodeJS.Timeout | null} */
let latticeReloadTimer = null;
/** @type {Map<string, number>} */
const bufferSyncedAt = new Map();
/** @type {Map<string, number>} */
const ingestedMtime = new Map();

function workspaceRoot(params) {
  const folders = params.workspaceFolders ?? [];
  if (folders.length > 0) return fileURLToPath(folders[0].uri);
  if (params.rootUri) return fileURLToPath(params.rootUri);
  return params.rootPath ?? process.cwd();
}

async function readFromDisk(uri) {
  try {
    return await readFile(fileURLToPath(uri), 'utf-8');
  } catch (error) {
    connection.console.error(`lat-lsp: cannot read ${uri}: ${String(error)}`);
    return null;
  }
}

async function diskMtime(uri) {
  try {
    const stats = await stat(fileURLToPath(uri));
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

async function documentText(uri) {
  const open = documents.get(uri);
  const mtime = await diskMtime(uri);
  const syncedAt = bufferSyncedAt.get(uri);
  const bufferIsCurrent =
    open !== undefined &&
    mtime !== null &&
    syncedAt !== undefined &&
    mtime <= syncedAt;
  if (bufferIsCurrent) return { staleBuffer: false, text: open.getText() };

  const text = await readFromDisk(uri);
  if (text === null) {
    if (open === undefined) return null;
    return { staleBuffer: false, text: open.getText() };
  }

  const staleBuffer =
    open !== undefined && mtime !== null && ingestedMtime.get(uri) !== mtime;
  if (mtime !== null) ingestedMtime.set(uri, mtime);
  return { staleBuffer, text };
}

async function readyIndex() {
  if (index === null) return null;
  if (indexReady !== null) await indexReady;
  return index;
}

async function requestContext(params) {
  const ready = await readyIndex();
  if (ready === null) return null;
  const document = await documentText(params.textDocument.uri);
  if (document === null) return null;
  const file = fileURLToPath(params.textDocument.uri);
  const { staleBuffer, text } = document;
  if (staleBuffer) await reindexWrittenFile(ready, { file, text });
  const links = scanWikiLinks(text);
  return {
    file,
    index: ready,
    link: params.position ? linkAtPosition(links, params.position) : null,
    text,
  };
}

function scheduleLatticeReload(store) {
  if (latticeReloadTimer !== null) clearTimeout(latticeReloadTimer);
  latticeReloadTimer = setTimeout(() => {
    latticeReloadTimer = null;
    indexReady = store
      .reloadLattice()
      .catch((error) =>
        connection.console.error(
          `lat-lsp: lattice reload failed: ${String(error)}`,
        ),
      );
  }, latticeReloadDelayMs);
}

async function reindexWrittenFile(store, { file, text }) {
  try {
    if (store.isLatticeFile(file)) {
      if (latticeReloadTimer !== null) clearTimeout(latticeReloadTimer);
      latticeReloadTimer = null;
      await store.reloadLattice();
      return;
    }
    await store.updateCodeRefsForFile({ file, text });
  } catch (error) {
    connection.console.error(
      `lat-lsp: reindex of ${file} failed: ${String(error)}`,
    );
  }
}

connection.onInitialize(async (params) => {
  const root = workspaceRoot(params);
  try {
    const { lattice } = await loadLatModules();
    const latDir = lattice.findLatticeDir(root);
    if (latDir === null) {
      connection.console.warn(`lat-lsp: no lat.md directory above ${root}`);
    } else {
      const store = await LatticeIndex.create({
        latDir,
        projectRoot: dirname(latDir),
      });
      index = store;
      indexReady = store
        .build()
        .catch((error) =>
          connection.console.error(
            `lat-lsp: index build failed: ${String(error)}`,
          ),
        );
    }
  } catch (error) {
    connection.console.error(
      `lat-lsp: initialization failed: ${String(error)}`,
    );
  }

  return {
    capabilities: {
      definitionProvider: true,
      documentSymbolProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      textDocumentSync: {
        change: TextDocumentSyncKind.Incremental,
        openClose: true,
        save: { includeText: false },
      },
      workspaceSymbolProvider: true,
    },
  };
});

connection.onDefinition(async (params) => {
  try {
    const context = await requestContext(params);
    if (context === null || context.link === null) return null;
    return await definitionLocations(context.index, context.link.target);
  } catch (error) {
    connection.console.error(`lat-lsp: definition failed: ${String(error)}`);
    return null;
  }
});

connection.onReferences(async (params) => {
  try {
    const context = await requestContext(params);
    if (context === null) return null;
    return await referencesAtPosition(context.index, {
      file: context.file,
      includeDeclaration: params.context?.includeDeclaration ?? false,
      link: context.link,
      position: params.position,
      text: context.text,
    });
  } catch (error) {
    connection.console.error(`lat-lsp: references failed: ${String(error)}`);
    return null;
  }
});

connection.onHover(async (params) => {
  try {
    const context = await requestContext(params);
    if (context === null || context.link === null) return null;
    const contents = await hoverForTarget(context.index, context.link.target);
    if (contents === null) return null;
    return {
      contents: { kind: 'markdown', value: contents },
      range: context.link.range,
    };
  } catch (error) {
    connection.console.error(`lat-lsp: hover failed: ${String(error)}`);
    return null;
  }
});

connection.onDocumentSymbol(async (params) => {
  try {
    const context = await requestContext(params);
    if (context === null) return null;
    return documentSymbols(context.index, {
      file: context.file,
      text: context.text,
    });
  } catch (error) {
    connection.console.error(
      `lat-lsp: document symbols failed: ${String(error)}`,
    );
    return null;
  }
});

connection.onWorkspaceSymbol(async (params) => {
  try {
    const ready = await readyIndex();
    if (ready === null) return null;
    return workspaceSymbols(ready, params.query);
  } catch (error) {
    connection.console.error(
      `lat-lsp: workspace symbols failed: ${String(error)}`,
    );
    return null;
  }
});

connection.onDidChangeWatchedFiles(async (params) => {
  const ready = await readyIndex();
  if (ready === null) return;
  const files = params.changes.map((change) => fileURLToPath(change.uri));
  if (files.some((file) => ready.isLatticeFile(file))) {
    scheduleLatticeReload(ready);
  }
  for (const file of files.filter((file) => !ready.isLatticeFile(file))) {
    try {
      await ready.refreshCodeRefsFromDisk(file);
    } catch (error) {
      connection.console.error(
        `lat-lsp: cannot re-read ${file}: ${String(error)}`,
      );
    }
  }
});

documents.onDidChangeContent((event) => {
  bufferSyncedAt.set(event.document.uri, Date.now());
});

documents.onDidClose((event) => {
  bufferSyncedAt.delete(event.document.uri);
  ingestedMtime.delete(event.document.uri);
});

documents.onDidSave(async (event) => {
  const ready = await readyIndex();
  if (ready === null) return;
  const file = fileURLToPath(event.document.uri);
  try {
    if (ready.isLatticeFile(file)) {
      scheduleLatticeReload(ready);
      return;
    }
    await ready.updateCodeRefsForFile({ file, text: event.document.getText() });
  } catch (error) {
    connection.console.error(`lat-lsp: index update failed: ${String(error)}`);
  }
});

process.on('unhandledRejection', (reason) => {
  connection.console.error(`lat-lsp: unhandled rejection: ${String(reason)}`);
});

documents.listen(connection);
connection.listen();
