'use strict';

/**
 * Purpose: answer `textDocument/references` — every wiki link and `@lat:`
 * annotation pointing at the section, the ref or the source symbol under the
 * cursor.
 *
 * Usage: `referencesAtPosition(index, { file, includeDeclaration, link, position, text })`.
 *   `link` is the wiki link under the cursor, or null to resolve from the
 *   position: a heading in a `lat.md/` file, otherwise the enclosing source symbol.
 *
 * Example:
 *   await referencesAtPosition(index, {
 *     file, includeDeclaration: true, link: null, position, text,
 *   });
 */

const { extname } = require('node:path');

const {
  occurrenceLocations,
  sectionLocation,
  sourceLocations,
  splitTarget,
} = require('./locations.js');

function occurrencesForSection(index, sectionIdLower) {
  return [...index.mdOccurrences, ...index.codeOccurrences].filter(
    (occurrence) => occurrence.resolvedLower === sectionIdLower,
  );
}

function occurrencesForSourceQuery(index, query) {
  const { filePart, symbolPart } = splitTarget(query);
  const fileLower = filePart.toLowerCase();
  const isFileLevel = symbolPart === '';
  return [...index.mdOccurrences, ...index.codeOccurrences].filter(
    (occurrence) => {
      const target = splitTarget(occurrence.target);
      if (target.filePart.toLowerCase() !== fileLower) return false;
      return isFileLevel || target.symbolPart === symbolPart;
    },
  );
}

function referencesForTarget(index, target) {
  const section = index.sectionForTarget(target);
  if (section !== null) {
    return {
      occurrences: occurrencesForSection(index, section.id.toLowerCase()),
      section,
    };
  }
  return {
    occurrences: occurrencesForSourceQuery(index, target),
    section: null,
  };
}

async function enclosingSourceQuery(index, { file, line, text }) {
  const relativePath = index.relativeTo(file);
  const { sourceParser } = index.lat;
  if (!sourceParser.SOURCE_EXTENSIONS.has(extname(relativePath))) {
    return relativePath;
  }
  const symbols = await sourceParser.parseSourceSymbols(relativePath, text);
  const containing = symbols.filter(
    (symbol) => symbol.startLine - 1 <= line && line <= symbol.endLine - 1,
  );
  if (containing.length === 0) return relativePath;
  const innermost = containing.reduce((deepest, symbol) =>
    symbol.startLine >= deepest.startLine ? symbol : deepest,
  );
  const suffix = innermost.parent
    ? `${innermost.parent}#${innermost.name}`
    : innermost.name;
  return `${relativePath}#${suffix}`;
}

async function referencesAtPosition(
  index,
  { file, includeDeclaration, link, position, text },
) {
  await index.occurrences();

  if (link !== null) {
    const { occurrences, section } = referencesForTarget(index, link.target);
    const locations = await occurrenceLocations(occurrences);
    if (includeDeclaration && section !== null) {
      locations.push(sectionLocation(index, section));
    }
    return locations;
  }

  if (index.isLatticeFile(file)) {
    const section = index.sectionAtLine({
      line: position.line,
      relativePath: index.relativeTo(file),
    });
    if (section === null) return [];
    const locations = await occurrenceLocations(
      occurrencesForSection(index, section.id.toLowerCase()),
    );
    if (includeDeclaration) locations.push(sectionLocation(index, section));
    return locations;
  }

  const symbolQuery = await enclosingSourceQuery(index, {
    file,
    line: position.line,
    text,
  });
  const symbolOccurrences = occurrencesForSourceQuery(index, symbolQuery);
  const matched = symbolOccurrences.length > 0;
  const query = matched ? symbolQuery : index.relativeTo(file);
  const locations = await occurrenceLocations(
    matched ? symbolOccurrences : occurrencesForSourceQuery(index, query),
  );
  if (includeDeclaration) {
    locations.push(...(await sourceLocations(index, query)));
  }
  return locations;
}

module.exports = { referencesAtPosition };
