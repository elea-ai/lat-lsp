'use strict';

/**
 * Purpose: expose the lattice as LSP symbols — the section tree of one
 * `lat.md/` file, and a name search across every section in the lattice.
 *
 * Usage: `documentSymbols(index, { file, text })` returns null for files
 *   outside `lat.md/` so the real language server keeps that file to itself;
 *   `workspaceSymbols(index, query)` matches section ids and headings.
 *
 * Example:
 *   workspaceSymbols(index, 'Code References');
 */

const { SymbolKind } = require('vscode-languageserver');

const { sectionLocation } = require('./locations.js');

const workspaceSymbolLimit = 500;

function headingRange(section) {
  const line = section.startLine - 1;
  const endLine = Math.max(section.endLine - 1, line);
  return {
    full: {
      end: { character: 0, line: endLine },
      start: { character: 0, line },
    },
    selection: {
      end: { character: section.depth + 1 + section.heading.length, line },
      start: { character: 0, line },
    },
  };
}

function toDocumentSymbol(section) {
  const ranges = headingRange(section);
  return {
    children: section.children.map(toDocumentSymbol),
    detail: section.firstParagraph.slice(0, 120),
    kind: SymbolKind.Namespace,
    name: section.heading,
    range: ranges.full,
    selectionRange: ranges.selection,
  };
}

function documentSymbols(index, { file, text }) {
  if (!index.isLatticeFile(file)) return null;
  const roots = index.lat.lattice.parseSections(file, text, index.projectRoot);
  return roots.map(toDocumentSymbol);
}

function workspaceSymbols(index, query) {
  const needle = query.trim().toLowerCase();
  const matched =
    needle === ''
      ? index.sections
      : index.sections.filter(
          (section) =>
            section.id.toLowerCase().includes(needle) ||
            section.heading.toLowerCase().includes(needle),
        );
  return matched.slice(0, workspaceSymbolLimit).map((section) => ({
    containerName: section.file,
    kind: SymbolKind.Namespace,
    location: sectionLocation(index, section),
    name: section.heading,
  }));
}

module.exports = { documentSymbols, workspaceSymbols };
