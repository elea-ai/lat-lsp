'use strict';

/**
 * Purpose: a minimal LSP client for the tests — spawns the real server over
 * stdio, frames JSON-RPC messages and resolves requests against a temporary
 * workspace.
 *
 * Usage: `new TestClient(projectRoot)`, `await client.initialize()`, then
 *   `client.request(method, params)` / `client.notify(method, params)`, and
 *   `await client.stop()`. Requests the server sends are answered with `null`
 *   and kept in `serverRequests`. `describeLocation` renders a Location as
 *   `relative/path.ts:line` for readable assertions.
 *
 * Example:
 *   const client = new TestClient(workspace);
 *   await client.initialize();
 *   await client.request('workspace/symbol', { query: 'Rendering' });
 */

const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const serverPath = join(__dirname, '..', '..', 'bin', 'lat-lsp.js');

class TestClient {
  constructor(projectRoot) {
    this.buffer = Buffer.alloc(0);
    this.child = spawn('node', [serverPath, '--stdio'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.logs = [];
    this.nextId = 1;
    this.pending = new Map();
    this.projectRoot = projectRoot;
    this.serverRequests = [];
    this.child.stdout.on('data', (chunk) => this.consume(chunk));
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString();
      const length = Number(/Content-Length: (\d+)/.exec(header)[1]);
      if (this.buffer.length < headerEnd + 4 + length) return;
      const body = JSON.parse(
        this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString(),
      );
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      this.dispatch(body);
    }
  }

  dispatch(body) {
    if (body.method !== undefined && body.id !== undefined) {
      this.serverRequests.push(body);
      this.send({ id: body.id, jsonrpc: '2.0', result: null });
      return;
    }
    if (body.id !== undefined && this.pending.has(body.id)) {
      const resolve = this.pending.get(body.id);
      this.pending.delete(body.id);
      resolve(body.result);
      return;
    }
    if (body.method === 'window/logMessage')
      this.logs.push(body.params.message);
  }

  send(message) {
    const json = JSON.stringify(message);
    this.child.stdin.write(
      `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`,
    );
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ id, jsonrpc: '2.0', method, params });
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  uriFor(relativePath) {
    return pathToFileURL(join(this.projectRoot, relativePath)).toString();
  }

  async initialize(capabilities = {}) {
    const rootUri = pathToFileURL(this.projectRoot).toString();
    const result = await this.request('initialize', {
      capabilities,
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ name: 'fixture', uri: rootUri }],
    });
    this.notify('initialized', {});
    return result;
  }

  open(relativePath, languageId) {
    this.notify('textDocument/didOpen', {
      textDocument: {
        languageId,
        text: readFileSync(join(this.projectRoot, relativePath), 'utf-8'),
        uri: this.uriFor(relativePath),
        version: 1,
      },
    });
  }

  positionOf(relativePath, needle, offset = 2) {
    const lines = readFileSync(
      join(this.projectRoot, relativePath),
      'utf-8',
    ).split('\n');
    for (let line = 0; line < lines.length; line++) {
      const character = lines[line].indexOf(needle);
      if (character !== -1) return { character: character + offset, line };
    }
    throw new Error(`"${needle}" not found in ${relativePath}`);
  }

  async stop() {
    await this.request('shutdown', null);
    this.notify('exit', null);
    this.child.kill();
  }
}

function describeLocation(client, location) {
  const prefix = pathToFileURL(client.projectRoot).toString() + '/';
  return `${location.uri.replace(prefix, '')}:${location.range.start.line + 1}`;
}

module.exports = { TestClient, describeLocation };
