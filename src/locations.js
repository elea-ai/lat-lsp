'use strict';

/**
 * Purpose: turn a resolved ref into the LSP `Location`s a client jumps to —
 * section headings, source symbols, directory entry files and the occurrences
 * find-references reports.
 *
 * Usage: `definitionLocations(index, target)` for go-to-definition,
 *   `occurrenceLocations(occurrences)` for find-references. Every path is kept
 *   inside `projectRoot` by `resolveWithinRoot`.
 *
 * Example:
 *   await definitionLocations(index, 'src/widget.ts#createWidget');
 */

const { existsSync, statSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const {
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} = require('node:path');
const { pathToFileURL } = require('node:url');

const { wikiLinkColumn } = require('./wiki_links.js');

const directoryEntryFiles = [
  'README.md',
  'package.json',
  'pubspec.yaml',
  'index.ts',
  'main.tf',
  'terragrunt.hcl',
];

/** @param {{ character?: number, endCharacter?: number | null, file: string, line: number }} target */
function locationAt({ character = 0, endCharacter = null, file, line }) {
  return {
    range: {
      end: {
        character: endCharacter === null ? character : endCharacter,
        line,
      },
      start: { character, line },
    },
    uri: pathToFileURL(file).toString(),
  };
}

function sectionLocation(index, section) {
  return locationAt({
    endCharacter: section.depth + 1 + section.heading.length,
    file: join(index.projectRoot, section.filePath),
    line: section.startLine - 1,
  });
}

function resolveWithinRoot(projectRoot, filePart) {
  const absolute = resolve(projectRoot, filePart);
  const inside = relative(projectRoot, absolute);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return null;
  }
  return absolute;
}

function splitTarget(target) {
  const hashIndex = target.indexOf('#');
  return {
    filePart: hashIndex === -1 ? target : target.slice(0, hashIndex),
    symbolPart: hashIndex === -1 ? '' : target.slice(hashIndex + 1),
  };
}

function symbolMatching(symbols, symbolPart) {
  const parts = symbolPart.split('#');
  const name = parts[parts.length - 1];
  const parent = parts.length > 1 ? parts[parts.length - 2] : null;
  return (
    symbols.find((symbol) =>
      parent === null
        ? symbol.name === name && !symbol.parent
        : symbol.name === name && symbol.parent === parent,
    ) ?? null
  );
}

function directoryEntryLocation(directory) {
  const entry = directoryEntryFiles
    .map((name) => join(directory, name))
    .find((candidate) => existsSync(candidate));
  return entry === undefined ? [] : [locationAt({ file: entry, line: 0 })];
}

async function sourceLocations(index, target) {
  const { filePart, symbolPart } = splitTarget(target);
  const absolute = resolveWithinRoot(index.projectRoot, filePart);
  if (absolute === null || !existsSync(absolute)) return [];
  if (statSync(absolute).isDirectory()) return directoryEntryLocation(absolute);
  if (symbolPart === '') return [locationAt({ file: absolute, line: 0 })];

  const { sourceParser } = index.lat;
  if (!sourceParser.SOURCE_EXTENSIONS.has(extname(filePart))) {
    return [locationAt({ file: absolute, line: 0 })];
  }
  const { found, symbols } = await sourceParser.resolveSourceSymbol(
    filePart,
    symbolPart,
    index.projectRoot,
  );
  const symbol = found ? symbolMatching(symbols, symbolPart) : null;
  return [
    locationAt({
      file: absolute,
      line: symbol === null ? 0 : symbol.startLine - 1,
    }),
  ];
}

function candidateSections(index, candidate) {
  const exact = index.sectionById.get(candidate.toLowerCase());
  if (exact) return [exact];

  const { filePart, symbolPart } = splitTarget(candidate);
  const rest = symbolPart === '' ? '' : '#' + symbolPart;
  return index.rootSections
    .filter((section) => section.file === filePart)
    .map((root) => index.sectionById.get((root.id + rest).toLowerCase()))
    .filter((section) => section !== undefined);
}

async function definitionLocations(index, target) {
  const { ambiguous, resolved, suggested } = index.resolveTargetFull(target);
  const direct = index.sectionById.get(resolved.toLowerCase());
  if (direct) return [sectionLocation(index, direct)];

  const candidates = suggested ? [suggested] : (ambiguous ?? []);
  const sections = candidates.flatMap((candidate) =>
    candidateSections(index, candidate),
  );
  if (sections.length > 0) {
    return sections.map((section) => sectionLocation(index, section));
  }
  return sourceLocations(index, target);
}

async function codeOccurrenceLocation(occurrence, lineCache) {
  let lines = lineCache.get(occurrence.file);
  if (lines === undefined) {
    const text = await readFile(occurrence.file, 'utf-8').catch(() => '');
    lines = text.split('\n');
    lineCache.set(occurrence.file, lines);
  }
  const lineText = lines[occurrence.line] ?? '';
  const character = wikiLinkColumn(lineText, occurrence.target);
  return locationAt({
    character,
    endCharacter: Math.max(character, lineText.trimEnd().length),
    file: occurrence.file,
    line: occurrence.line,
  });
}

async function occurrenceLocations(occurrences) {
  const lineCache = new Map();
  const locations = [];
  for (const occurrence of occurrences) {
    locations.push(
      occurrence.range === undefined
        ? await codeOccurrenceLocation(occurrence, lineCache)
        : locationAt({
            character: occurrence.range.start.character,
            endCharacter: occurrence.range.end.character,
            file: occurrence.file,
            line: occurrence.range.start.line,
          }),
    );
  }
  return locations;
}

module.exports = {
  definitionLocations,
  locationAt,
  occurrenceLocations,
  resolveWithinRoot,
  sectionLocation,
  sourceLocations,
  splitTarget,
  symbolMatching,
};
