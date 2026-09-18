'use strict';

/**
 * Purpose: drive the real server over stdio against the fixture lattice and
 * assert the locations it returns for definition, references, hover and the
 * symbol requests.
 *
 * Usage: driven by `node --test`. A fixture lattice rather than this repo's own
 *   `lat.md/`, so the expectations do not move when documentation does.
 *
 * Example:
 *   mise run lat-lsp:test
 *   node --test scripts/lat-lsp/test/server.test.js
 */

const assert = require('node:assert/strict');
const { join } = require('node:path');
const { after, before, describe, test } = require('node:test');

const { TestClient, describeLocation } = require('./helpers/client.js');

const fixtureRoot = join(__dirname, 'fixture');

describe('lat.md language server', () => {
  let client;

  before(async () => {
    client = new TestClient(fixtureRoot);
    await client.initialize();
    client.open('lat.md/guide.md', 'markdown');
    client.open('lat.md/widget.md', 'markdown');
    client.open('src/widget.ts', 'typescript');
  });

  after(async () => {
    await client.stop();
  });

  const at = (relativePath, needle, offset) => ({
    position: client.positionOf(relativePath, needle, offset),
    textDocument: { uri: client.uriFor(relativePath) },
  });

  const atLine = (relativePath, line, character = 0) => ({
    position: { character, line },
    textDocument: { uri: client.uriFor(relativePath) },
  });

  const places = (locations) =>
    locations.map((location) => describeLocation(client, location));

  const definition = (params) =>
    client.request('textDocument/definition', params);

  const references = (params, context = { includeDeclaration: false }) =>
    client.request('textDocument/references', { ...params, context });

  test('advertises the ref navigation capabilities', async () => {
    const other = new TestClient(fixtureRoot);
    const result = await other.initialize();
    await other.stop();

    assert.equal(result.capabilities.definitionProvider, true);
    assert.equal(result.capabilities.referencesProvider, true);
    assert.equal(result.capabilities.documentSymbolProvider, true);
    assert.equal(result.capabilities.workspaceSymbolProvider, true);
    assert.equal(result.capabilities.hoverProvider, true);
  });

  describe('go to definition', () => {
    test('jumps from a wiki link to the section heading', async () => {
      const locations = await definition(
        at('lat.md/guide.md', '[[widget#Rendering]]'),
      );

      assert.deepEqual(places(locations), ['lat.md/widget.md:5']);
    });

    test('jumps from an @lat code annotation to the section it documents', async () => {
      const locations = await definition(
        at('src/widget.ts', '[[widget#Rendering]]'),
      );

      assert.deepEqual(places(locations), ['lat.md/widget.md:5']);
    });

    test('resolves a ref in a file the editor never opened', async () => {
      const locations = await definition(
        at('lat.md/notes.md', '[[widget#Rendering|the rendering pass]]'),
      );

      assert.deepEqual(places(locations), ['lat.md/widget.md:5']);
    });

    test('ignores the alias half of a ref', async () => {
      const aliased = await definition(
        at('lat.md/notes.md', '[[widget#Rendering|the rendering pass]]', 25),
      );

      assert.deepEqual(places(aliased), ['lat.md/widget.md:5']);
    });

    test('resolves a ref whose case differs from the heading', async () => {
      const locations = await definition(
        at('lat.md/notes.md', '[[Widget#Rendering]]'),
      );

      assert.deepEqual(places(locations), ['lat.md/widget.md:5']);
    });

    test('returns every candidate when a file stem is ambiguous', async () => {
      const locations = await definition(at('lat.md/lat.md', '[[guide]]'));

      assert.deepEqual(places(locations).sort(), [
        'lat.md/guide.md:1',
        'lat.md/ui/guide.md:1',
      ]);
    });

    test('jumps from a wiki link to a top-level source symbol', async () => {
      const locations = await definition(
        at('lat.md/guide.md', '[[src/widget.ts#createWidget]]'),
      );

      assert.deepEqual(places(locations), ['src/widget.ts:3']);
    });

    test('tells a method apart from a top-level function of the same name', async () => {
      const method = await definition(
        at('lat.md/notes.md', '[[src/widget.ts#Panel#render]]'),
      );
      const standalone = await definition(
        at('lat.md/notes.md', '[[src/widget.ts#render]]'),
      );

      assert.deepEqual(places(method), ['src/widget.ts:12']);
      assert.deepEqual(places(standalone), ['src/widget.ts:7']);
    });

    test('opens the entry file of a directory ref', async () => {
      const locations = await definition(at('lat.md/notes.md', '[[tool]]'));

      assert.deepEqual(places(locations), ['tool/README.md:1']);
    });

    test('returns nothing for a directory without an entry file', async () => {
      const locations = await definition(at('lat.md/notes.md', '[[src]]'));

      assert.deepEqual(locations, []);
    });

    test('returns nothing for a ref that resolves to neither section nor file', async () => {
      const locations = await definition(
        at('lat.md/notes.md', '[[does-not-exist]]'),
      );

      assert.deepEqual(locations, []);
    });

    test('returns no definition when the cursor is not on a ref', async () => {
      const locations = await definition(
        at('lat.md/guide.md', 'The wiring step', 0),
      );

      assert.equal(locations, null);
    });
  });

  describe('find references', () => {
    const renderingRefs = [
      'lat.md/guide.md:7',
      'lat.md/notes.md:7',
      'lat.md/notes.md:9',
      'src/widget.ts:1',
    ];

    test('lists markdown and code references from a section heading', async () => {
      const locations = await references(
        at('lat.md/widget.md', '## Rendering', 3),
      );

      assert.deepEqual(places(locations).sort(), renderingRefs);
    });

    test('lists the same references from a wiki link to that section', async () => {
      const locations = await references(
        at('src/widget.ts', '[[widget#Rendering]]'),
      );

      assert.deepEqual(places(locations).sort(), renderingRefs);
    });

    test('points a reference at the column its link starts on', async () => {
      const locations = await references(
        at('lat.md/widget.md', '## Rendering', 3),
      );
      const codeRef = locations.find((location) =>
        location.uri.endsWith('src/widget.ts'),
      );

      assert.equal(codeRef.range.start.character, 9);
      assert.equal(codeRef.range.start.line, 0);
    });

    test('includes the heading itself only when the client asks for it', async () => {
      const included = await references(
        at('lat.md/widget.md', '## Rendering', 3),
        {
          includeDeclaration: true,
        },
      );

      assert.ok(places(included).includes('lat.md/widget.md:5'));
    });

    test('leaves the declaration out when the client sends no context', async () => {
      const locations = await client.request('textDocument/references', {
        ...at('lat.md/widget.md', '## Rendering', 3),
        context: undefined,
      });

      assert.deepEqual(places(locations).sort(), renderingRefs);
    });

    test('lists the docs that reference the symbol under the cursor', async () => {
      const locations = await references(
        at('src/widget.ts', 'export function createWidget', 20),
      );

      assert.deepEqual(places(locations), ['lat.md/guide.md:7']);
    });

    test('recognises the symbol on its first and last line', async () => {
      const firstLine = await references(atLine('src/widget.ts', 2));
      const lastLine = await references(atLine('src/widget.ts', 4));

      assert.deepEqual(places(firstLine), ['lat.md/guide.md:7']);
      assert.deepEqual(places(lastLine), ['lat.md/guide.md:7']);
    });

    test('falls back to file-level refs for a symbol nothing references', async () => {
      const locations = await references(atLine('src/widget.ts', 10));

      assert.deepEqual(places(locations).sort(), [
        'lat.md/guide.md:7',
        'lat.md/notes.md:11',
        'lat.md/notes.md:11',
      ]);
    });

    test('falls back to file-level refs outside any symbol', async () => {
      const locations = await references(atLine('src/widget.ts', 5));

      assert.deepEqual(places(locations).sort(), [
        'lat.md/guide.md:7',
        'lat.md/notes.md:11',
        'lat.md/notes.md:11',
      ]);
    });

    test('returns nothing from a lat.md line that is neither heading nor ref', async () => {
      const locations = await references(
        at('lat.md/widget.md', 'The widget renders', 0),
      );

      assert.deepEqual(locations, []);
    });
  });

  describe('listing sections', () => {
    test('returns the section tree of a lat.md file', async () => {
      const symbols = await client.request('textDocument/documentSymbol', {
        textDocument: { uri: client.uriFor('lat.md/widget.md') },
      });

      assert.deepEqual(
        symbols.map((symbol) => symbol.name),
        ['Widget'],
      );
      assert.deepEqual(
        symbols[0].children.map((child) => child.name),
        ['Rendering'],
      );
      assert.equal(symbols[0].children[0].range.start.line, 4);
      assert.equal(
        symbols[0].detail,
        'The widget renders a label into a canvas frame.',
      );
      assert.equal(
        symbols[0].children[0].detail,
        'Rendering happens in two passes: measure, then paint.',
      );
    });

    test('returns no document symbols for a source file', async () => {
      const symbols = await client.request('textDocument/documentSymbol', {
        textDocument: { uri: client.uriFor('src/widget.ts') },
      });

      assert.equal(symbols, null);
    });

    test('finds sections across the lattice by query', async () => {
      const symbols = await client.request('workspace/symbol', {
        query: 'Rendering',
      });

      assert.deepEqual(
        symbols.map((symbol) => symbol.name),
        ['Rendering'],
      );
      assert.equal(
        describeLocation(client, symbols[0].location),
        'lat.md/widget.md:5',
      );
    });

    test('returns the whole lattice for an empty query', async () => {
      const symbols = await client.request('workspace/symbol', { query: '' });
      const names = symbols.map((symbol) => symbol.name);

      assert.ok(names.includes('Widget'));
      assert.ok(names.includes('UI Guide'));
      assert.ok(names.includes('Dangling'));
    });

    test('returns nothing for a query that matches no section', async () => {
      const symbols = await client.request('workspace/symbol', {
        query: 'no section is called this',
      });

      assert.deepEqual(symbols, []);
    });
  });

  describe('hover', () => {
    test('shows the section a ref resolves to', async () => {
      const hover = await client.request(
        'textDocument/hover',
        at('lat.md/guide.md', '[[widget#Rendering]]'),
      );

      assert.match(hover.contents.value, /lat\.md\/widget#Widget#Rendering/);
      assert.match(hover.contents.value, /measure, then paint/);
    });

    test('shows the signature a source ref resolves to', async () => {
      const hover = await client.request(
        'textDocument/hover',
        at('lat.md/notes.md', '[[src/widget.ts#Panel#render]]'),
      );

      assert.match(hover.contents.value, /render/);
      assert.match(hover.contents.value, /src\/widget\.ts:12-14/);
    });

    test('returns nothing when the cursor is not on a ref', async () => {
      const hover = await client.request(
        'textDocument/hover',
        at('lat.md/guide.md', 'The wiring step', 0),
      );

      assert.equal(hover, null);
    });
  });
});
