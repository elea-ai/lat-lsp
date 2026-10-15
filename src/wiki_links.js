'use strict';

/**
 * Purpose: find `[[target]]` wiki links in a line of text and map an LSP
 * position onto the link under it. Aliases (`[[target|Label]]`) are stripped to
 * the target.
 *
 * Usage: `scanWikiLinks(text)` returns every link with its LSP range (end
 *   exclusive); `linkAtPosition(links, position)` picks the one a cursor is in,
 *   or null.
 *
 * Example:
 *   const links = scanWikiLinks('see [[guidelines#Diagrams]] for the rule');
 *   linkAtPosition(links, { character: 8, line: 0 }).target;
 */

function stripAlias(rawTarget) {
  const pipeIndex = rawTarget.indexOf('|');
  const target = pipeIndex === -1 ? rawTarget : rawTarget.slice(0, pipeIndex);
  return target.trim();
}

// Mirrors `consumeTarget` / `consumeAlias` in @lat.md/core's wiki-link syntax:
// brackets in the target nest (dynamic route segments such as `[region]` or
// `[[...slug]]` belong to it), the alias after `|` does not, and only a `]]`
// outside every nested segment closes the link. Returns the index of that
// `]]`, or -1 when the link never closes on this line.
function closingIndex(lineText, start) {
  let depth = 0;
  let inAlias = false;
  for (let index = start + 2; index < lineText.length; index++) {
    const char = lineText[index];
    if (!inAlias && char === '|') {
      inAlias = true;
    } else if (!inAlias && char === '[') {
      depth++;
    } else if (!inAlias && char === ']' && depth > 0) {
      depth--;
    } else if (char === ']') {
      return lineText[index + 1] === ']' ? index : -1;
    }
  }
  return -1;
}

function linkData(data) {
  const pipeIndex = data.indexOf('|');
  const target = stripAlias(data);
  if (target.length === 0) return null;
  if (pipeIndex !== -1 && data.slice(pipeIndex + 1).trim().length === 0) {
    return null;
  }
  return target;
}

function scanWikiLinks(text) {
  const links = [];
  const lines = text.split('\n');
  for (let line = 0; line < lines.length; line++) {
    const lineText = lines[line];
    let start = lineText.indexOf('[[');
    while (start !== -1) {
      const close = closingIndex(lineText, start);
      const target =
        close === -1 ? null : linkData(lineText.slice(start + 2, close));
      if (target === null) {
        start = lineText.indexOf('[[', start + 1);
        continue;
      }
      links.push({
        range: {
          end: { character: close + 2, line },
          start: { character: start, line },
        },
        target,
      });
      start = lineText.indexOf('[[', close + 2);
    }
  }
  return links;
}

function linkAtPosition(links, position) {
  const hit = links.find(
    (link) =>
      link.range.start.line === position.line &&
      position.character >= link.range.start.character &&
      position.character < link.range.end.character,
  );
  return hit ?? null;
}

function wikiLinkColumn(lineText, target) {
  const column = lineText.indexOf('[[' + target);
  return column === -1 ? 0 : column;
}

module.exports = { linkAtPosition, scanWikiLinks, stripAlias, wikiLinkColumn };
