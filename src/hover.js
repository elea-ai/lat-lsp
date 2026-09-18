'use strict';

/**
 * Purpose: answer `textDocument/hover` — the heading, id, location and opening
 * paragraph of a section, or the signature of the source symbol a ref points at.
 *
 * Usage: `hoverForTarget(index, target)` with the ref under the cursor. Source
 *   targets are kept inside `projectRoot` by `resolveWithinRoot`; anything
 *   outside it, or missing on disk, hovers as null.
 *
 * Example:
 *   await hoverForTarget(index, 'src/widget.ts#createWidget');
 */

const { existsSync } = require('node:fs');
const { extname } = require('node:path');

const {
  resolveWithinRoot,
  splitTarget,
  symbolMatching,
} = require('./locations.js');

function sectionHover(section) {
  const lines = [
    `**${section.heading}**`,
    '',
    '`' + section.id + '`',
    '',
    `${section.filePath}:${section.startLine}-${section.endLine}`,
  ];
  if (section.firstParagraph) lines.push('', section.firstParagraph);
  return lines.join('\n');
}

async function sourceHover(index, target) {
  const { filePart, symbolPart } = splitTarget(target);
  const absolute = resolveWithinRoot(index.projectRoot, filePart);
  if (absolute === null || !existsSync(absolute)) return null;
  if (symbolPart === '') return '`' + filePart + '`';

  const { sourceParser } = index.lat;
  if (!sourceParser.SOURCE_EXTENSIONS.has(extname(filePart))) {
    return '`' + target + '`';
  }
  const { found, symbols } = await sourceParser.resolveSourceSymbol(
    filePart,
    symbolPart,
    index.projectRoot,
  );
  const symbol = found ? symbolMatching(symbols, symbolPart) : null;
  if (symbol === null) return '`' + target + '`';
  return [
    '`' + symbol.signature + '`',
    '',
    `${filePart}:${symbol.startLine}-${symbol.endLine}`,
  ].join('\n');
}

async function hoverForTarget(index, target) {
  const section = index.sectionForTarget(target);
  if (section !== null) return sectionHover(section);
  return sourceHover(index, target);
}

module.exports = { hoverForTarget };
