'use strict';

/**
 * Purpose: unit-test the wiki-link scanner — ranges, alias stripping, the
 * exclusive range end and the column `wikiLinkColumn` reports.
 *
 * Usage: driven by `node --test`; needs no server and no fixture workspace.
 *
 * Example:
 *   mise run lat-lsp:test
 *   node --test scripts/lat-lsp/test/wiki_links.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  linkAtPosition,
  scanWikiLinks,
  stripAlias,
  wikiLinkColumn,
} = require('../src/wiki_links.js');

test('scans every link on a line with its own range', () => {
  const links = scanWikiLinks('see [[alpha]] and [[beta#Gamma]] today');

  assert.deepEqual(
    links.map((link) => link.target),
    ['alpha', 'beta#Gamma'],
  );
  assert.deepEqual(links[0].range, {
    end: { character: 13, line: 0 },
    start: { character: 4, line: 0 },
  });
  assert.deepEqual(links[1].range, {
    end: { character: 32, line: 0 },
    start: { character: 18, line: 0 },
  });
});

test('reports the line each link sits on', () => {
  const links = scanWikiLinks('first\n\nthen [[alpha]]\n');

  assert.equal(links.length, 1);
  assert.equal(links[0].range.start.line, 2);
});

test('keeps the target and drops the alias', () => {
  const links = scanWikiLinks('[[docs/adr/adr-032.md|ADR-032]]');

  assert.equal(links[0].target, 'docs/adr/adr-032.md');
  assert.equal(links[0].range.end.character, 31);
});

test('ignores empty and unterminated links', () => {
  assert.deepEqual(scanWikiLinks('[[]] and [[ | ]]'), []);
  assert.deepEqual(scanWikiLinks('[[alpha\nbeta]]'), []);
});

test('ignores a link whose alias is only whitespace', () => {
  assert.deepEqual(scanWikiLinks('[[alpha| ]]'), []);
});

test('keeps a dynamic route segment in the target', () => {
  const links = scanWikiLinks('see [[pages/[region]/reset-password.astro]] now');

  assert.equal(links.length, 1);
  assert.equal(links[0].target, 'pages/[region]/reset-password.astro');
  assert.deepEqual(links[0].range, {
    end: { character: 43, line: 0 },
    start: { character: 4, line: 0 },
  });
});

test('keeps a catch-all segment in double brackets in the target', () => {
  const links = scanWikiLinks('[[pages/[[...slug]]/index.astro]]');

  assert.equal(links[0].target, 'pages/[[...slug]]/index.astro');
  assert.equal(links[0].range.end.character, 33);
});

test('drops the alias of a link with a dynamic route segment', () => {
  const links = scanWikiLinks('[[pages/[region]/a.astro|Reset page]]');

  assert.equal(links[0].target, 'pages/[region]/a.astro');
  assert.equal(links[0].range.end.character, 37);
});

test('scans two bracketed links on one line with their own ranges', () => {
  const links = scanWikiLinks('[[a/[x]/b.astro]] and [[c/[[...y]]/d.astro#Z]]');

  assert.deepEqual(
    links.map((link) => [
      link.target,
      link.range.start.character,
      link.range.end.character,
    ]),
    [
      ['a/[x]/b.astro', 0, 17],
      ['c/[[...y]]/d.astro#Z', 22, 46],
    ],
  );
});

test('ignores a link whose brackets never close outside a segment', () => {
  assert.deepEqual(scanWikiLinks('[[pages/[region/a.astro]]'), []);
  assert.deepEqual(scanWikiLinks('[[pages/[region]\n/a.astro]]'), []);
});

test('stripAlias trims surrounding whitespace', () => {
  assert.equal(stripAlias(' alpha | Alpha '), 'alpha');
});

test('linkAtPosition covers the link and nothing beyond its exclusive end', () => {
  const links = scanWikiLinks('see [[alpha]] now');
  const at = (character) => linkAtPosition(links, { character, line: 0 });

  assert.equal(at(3), null);
  assert.equal(at(4).target, 'alpha');
  assert.equal(at(8).target, 'alpha');
  assert.equal(at(12).target, 'alpha');
  assert.equal(at(13), null);
});

test('linkAtPosition does not match a link on another line', () => {
  const links = scanWikiLinks('[[alpha]]\n[[beta]]');

  assert.equal(linkAtPosition(links, { character: 2, line: 1 }).target, 'beta');
  assert.equal(linkAtPosition(links, { character: 2, line: 2 }), null);
});

test('adjacent links each keep their own range', () => {
  const links = scanWikiLinks('[[alpha]][[beta]]');

  assert.deepEqual(
    links.map((link) => [link.range.start.character, link.range.end.character]),
    [
      [0, 9],
      [9, 17],
    ],
  );
});

test('linkAtPosition resolves the shared boundary to the right link', () => {
  const links = scanWikiLinks('[[alpha]][[beta]]');

  assert.equal(
    linkAtPosition(links, { character: 8, line: 0 }).target,
    'alpha',
  );
  assert.equal(
    linkAtPosition(links, { character: 9, line: 0 }).target,
    'beta',
  );
});

test('wikiLinkColumn points at the opening brackets', () => {
  assert.equal(wikiLinkColumn('  // see [[alpha#Beta]]', 'alpha#Beta'), 9);
  assert.equal(wikiLinkColumn('no link here', 'alpha'), 0);
  assert.equal(
    wikiLinkColumn('// @lat: [[pages/[region]/a.astro]]', 'pages/[region]/a.astro'),
    9,
  );
});
