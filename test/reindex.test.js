'use strict';

/**
 * Purpose: prove the index keeps up with writes — a saved wiki link, a saved
 * `@lat:` annotation, an annotation a save removed, and a file the client
 * reports through `workspace/didChangeWatchedFiles`.
 *
 * Usage: driven by `node --test`; each test mutates a throwaway copy of
 *   `test/fixture/` and polls find-references until the index catches up.
 *
 * Example:
 *   mise run lat-lsp:test
 *   node --test scripts/lat-lsp/test/reindex.test.js
 */

const assert = require('node:assert/strict');
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { after, before, describe, test } = require('node:test');

const { TestClient, describeLocation } = require('./helpers/client.js');

const fixtureRoot = join(__dirname, 'fixture');
const annotatedSource = readFileSync(
  join(fixtureRoot, 'src/widget.ts'),
  'utf-8',
);

async function waitFor(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await condition();
    if (value !== null) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('index refresh', () => {
  let client;
  let workspace;

  before(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'lat-lsp-'));
    cpSync(fixtureRoot, workspace, { recursive: true });
    client = new TestClient(workspace);
    await client.initialize();
  });

  after(async () => {
    await client.stop();
    rmSync(workspace, { force: true, recursive: true });
  });

  const write = (relativePath, text) => {
    writeFileSync(join(workspace, relativePath), text);
  };

  const read = (relativePath) =>
    readFileSync(join(workspace, relativePath), 'utf-8');

  const openWith = (relativePath, languageId, text) => {
    client.notify('textDocument/didOpen', {
      textDocument: {
        languageId,
        text,
        uri: client.uriFor(relativePath),
        version: 1,
      },
    });
  };

  const save = (relativePath, text) => {
    client.notify('textDocument/didSave', {
      text,
      textDocument: { uri: client.uriFor(relativePath) },
    });
  };

  const watchedChange = (relativePath, type) => {
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ type, uri: client.uriFor(relativePath) }],
    });
  };

  const change = (relativePath, text, version) => {
    client.notify('textDocument/didChange', {
      contentChanges: [{ text }],
      textDocument: { uri: client.uriFor(relativePath), version },
    });
  };

  const renderingRefs = async () => {
    const locations = await client.request('textDocument/references', {
      context: { includeDeclaration: false },
      position: { character: 3, line: 4 },
      textDocument: { uri: client.uriFor('lat.md/widget.md') },
    });
    return locations
      .map((location) => describeLocation(client, location))
      .sort();
  };

  test('picks up a new wiki link when its lat.md file is saved', async () => {
    const before = await renderingRefs();
    assert.ok(!before.includes('lat.md/guide.md:9'));

    const text =
      read('lat.md/guide.md') + '\nAnd again [[widget#Rendering]].\n';
    write('lat.md/guide.md', text);
    openWith('lat.md/guide.md', 'markdown', text);
    save('lat.md/guide.md', text);

    const updated = await waitFor(async () => {
      const refs = await renderingRefs();
      return refs.includes('lat.md/guide.md:9') ? refs : null;
    });

    assert.ok(updated, 'the saved wiki link never reached the index');
  });

  test('picks up a new @lat annotation when its source file is saved', async () => {
    write('src/extra.ts', annotatedSource);
    openWith('src/extra.ts', 'typescript', annotatedSource);
    save('src/extra.ts', annotatedSource);

    const updated = await waitFor(async () => {
      const refs = await renderingRefs();
      return refs.includes('src/extra.ts:1') ? refs : null;
    });

    assert.ok(updated, 'the saved annotation never reached the index');
  });

  test('drops an annotation that a save removed', async () => {
    write('src/removed.ts', annotatedSource);
    openWith('src/removed.ts', 'typescript', annotatedSource);
    save('src/removed.ts', annotatedSource);

    const seeded = await waitFor(async () => {
      const refs = await renderingRefs();
      return refs.includes('src/removed.ts:1') ? refs : null;
    });
    assert.ok(seeded, 'the annotation to remove never reached the index');

    const text = 'export const removed = 1;\n';
    write('src/removed.ts', text);
    change('src/removed.ts', text, 2);
    save('src/removed.ts', text);

    const updated = await waitFor(async () => {
      const refs = await renderingRefs();
      return refs.includes('src/removed.ts:1') ? null : refs;
    });

    assert.ok(updated, 'the removed annotation is still indexed');
  });

  test('re-reads a file the client reports as changed on disk', async () => {
    write('src/watched.ts', annotatedSource);
    watchedChange('src/watched.ts', 1);

    const added = await waitFor(async () => {
      const refs = await renderingRefs();
      return refs.includes('src/watched.ts:1') ? refs : null;
    });
    assert.ok(added, 'the watched annotation never reached the index');

    rmSync(join(workspace, 'src/watched.ts'));
    watchedChange('src/watched.ts', 3);

    const removed = await waitFor(async () => {
      const refs = await renderingRefs();
      return refs.includes('src/watched.ts:1') ? null : refs;
    });
    assert.ok(removed, 'the deleted file is still indexed');
  });

  test('reloads the lattice when a watched lat.md file changes on disk', async () => {
    write(
      'lat.md/watched.md',
      '# Watched\n\nA section written outside the editor.\n',
    );
    watchedChange('lat.md/watched.md', 1);

    const found = await waitFor(async () => {
      const symbols = await client.request('workspace/symbol', {
        query: 'Watched',
      });
      return symbols.length > 0 ? symbols : null;
    });

    assert.ok(found, 'the section written on disk never reached the index');
  });

  test('resolves a ref typed into a buffer before it is saved', async () => {
    const text = read('lat.md/guide.md') + '\nUnsaved [[widget#Rendering]].\n';
    change('lat.md/guide.md', text, 2);

    const locations = await client.request('textDocument/definition', {
      position: { character: 12, line: 10 },
      textDocument: { uri: client.uriFor('lat.md/guide.md') },
    });

    assert.deepEqual(
      locations.map((location) => describeLocation(client, location)),
      ['lat.md/widget.md:5'],
    );
    assert.ok(!(await renderingRefs()).includes('lat.md/guide.md:11'));
  });

  test('offers both candidates when a new file makes a stem ambiguous', async () => {
    const before = await client.request('textDocument/definition', {
      position: { character: 4, line: 8 },
      textDocument: { uri: client.uriFor('lat.md/lat.md') },
    });
    assert.deepEqual(
      before.map((location) => describeLocation(client, location)),
      ['lat.md/widget.md:1'],
    );

    mkdirSync(join(workspace, 'lat.md/deep'), { recursive: true });
    write('lat.md/deep/widget.md', '## Deep Widget\n\nA deeper widget.\n');
    watchedChange('lat.md/deep/widget.md', 1);

    const both = await waitFor(async () => {
      const locations = await client.request('textDocument/definition', {
        position: { character: 4, line: 8 },
        textDocument: { uri: client.uriFor('lat.md/lat.md') },
      });
      const places = locations.map((location) =>
        describeLocation(client, location),
      );
      return places.length > 1 ? places.sort() : null;
    });

    assert.deepEqual(both, ['lat.md/deep/widget.md:1', 'lat.md/widget.md:1']);
  });

  test('returns no document symbols for a lat.md file without headings', async () => {
    const text = 'Just a paragraph, no headings at all.\n';
    write('lat.md/plain.md', text);
    openWith('lat.md/plain.md', 'markdown', text);

    const symbols = await client.request('textDocument/documentSymbol', {
      textDocument: { uri: client.uriFor('lat.md/plain.md') },
    });

    assert.deepEqual(symbols, []);
  });
});

describe('occurrence tables', () => {
  let store;
  let workspace;

  before(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'lat-lsp-'));
    cpSync(fixtureRoot, workspace, { recursive: true });
    const { LatticeIndex } = require('../src/index_store.js');
    store = await LatticeIndex.create({
      latDir: join(workspace, 'lat.md'),
      projectRoot: workspace,
    });
    await store.build();
  });

  after(() => {
    rmSync(workspace, { force: true, recursive: true });
  });

  test('stay unbuilt until something asks for references', async () => {
    assert.equal(store.occurrencesReady, null);
    assert.deepEqual(store.codeOccurrences, []);
    assert.ok(store.sections.length > 0);

    await store.occurrences();

    assert.notEqual(store.occurrencesReady, null);
    assert.ok(store.codeOccurrences.length > 0);
    assert.ok(store.mdOccurrences.length > 0);
  });

  test('are dropped when the lattice reloads', async () => {
    await store.occurrences();
    await store.reloadLattice();

    assert.equal(store.occurrencesReady, null);
    assert.deepEqual(store.mdOccurrences, []);
  });
});

describe('writes the client never reports', () => {
  let client;
  let workspace;

  before(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'lat-lsp-'));
    cpSync(fixtureRoot, workspace, { recursive: true });
    client = new TestClient(workspace);
    await client.initialize();
  });

  after(async () => {
    await client.stop();
    rmSync(workspace, { force: true, recursive: true });
  });

  const write = (relativePath, text) => {
    writeFileSync(join(workspace, relativePath), text);
  };

  const read = (relativePath) =>
    readFileSync(join(workspace, relativePath), 'utf-8');

  const openWith = (relativePath, languageId, text) => {
    client.notify('textDocument/didOpen', {
      textDocument: {
        languageId,
        text,
        uri: client.uriFor(relativePath),
        version: 1,
      },
    });
  };

  const change = (relativePath, text, version) => {
    client.notify('textDocument/didChange', {
      contentChanges: [{ text }],
      textDocument: { uri: client.uriFor(relativePath), version },
    });
  };

  const renderingRefs = async () => {
    const locations = await client.request('textDocument/references', {
      context: { includeDeclaration: false },
      position: { character: 3, line: 4 },
      textDocument: { uri: client.uriFor('lat.md/widget.md') },
    });
    return locations
      .map((location) => describeLocation(client, location))
      .sort();
  };

  test('prefers disk when a client writes without reporting the change', async () => {
    const placeholder = 'export const silent = 1;\n';
    write('src/silent.ts', placeholder);
    openWith('src/silent.ts', 'typescript', placeholder);
    await client.request('workspace/symbol', { query: 'Rendering' });
    assert.ok(!(await renderingRefs()).includes('src/silent.ts:1'));

    await new Promise((resolve) => setTimeout(resolve, 20));
    write('src/silent.ts', annotatedSource);

    const locations = await client.request('textDocument/definition', {
      position: { character: 12, line: 0 },
      textDocument: { uri: client.uriFor('src/silent.ts') },
    });

    assert.deepEqual(
      locations.map((location) => describeLocation(client, location)),
      ['lat.md/widget.md:5'],
      'the frozen buffer was used instead of the newer file on disk',
    );
    assert.ok(
      (await renderingRefs()).includes('src/silent.ts:1'),
      'the annotation written on disk never reached the index',
    );
  });

  test('keeps the buffer when it is newer than the file on disk', async () => {
    const onDisk = read('lat.md/guide.md');
    const text = onDisk + '\nBuffer only [[widget#Rendering]].\n';
    const line = text.trimEnd().split('\n').length - 1;
    openWith('lat.md/guide.md', 'markdown', onDisk);
    change('lat.md/guide.md', text, 2);

    const locations = await client.request('textDocument/definition', {
      position: { character: 15, line },
      textDocument: { uri: client.uriFor('lat.md/guide.md') },
    });

    assert.deepEqual(
      locations.map((location) => describeLocation(client, location)),
      ['lat.md/widget.md:5'],
      'an unsaved editor buffer was discarded in favour of disk',
    );
  });
});
