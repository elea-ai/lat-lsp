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

const wikiLinkPattern = /\[\[([^\]\n]+)\]\]/g;

function stripAlias(rawTarget) {
  const pipeIndex = rawTarget.indexOf('|');
  const target = pipeIndex === -1 ? rawTarget : rawTarget.slice(0, pipeIndex);
  return target.trim();
}

function scanWikiLinks(text) {
  const links = [];
  const lines = text.split('\n');
  for (let line = 0; line < lines.length; line++) {
    const pattern = new RegExp(wikiLinkPattern.source, 'g');
    let match = pattern.exec(lines[line]);
    while (match !== null) {
      const target = stripAlias(match[1]);
      if (target.length > 0) {
        links.push({
          range: {
            end: { character: match.index + match[0].length, line },
            start: { character: match.index, line },
          },
          target,
        });
      }
      match = pattern.exec(lines[line]);
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
