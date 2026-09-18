'use strict';

/**
 * Purpose: the in-memory index every request is answered from — the parsed
 * lattice (sections, file index, resolved ids) plus, built lazily on the first
 * find-references query, the occurrence tables of wiki links and `@lat:`
 * annotations.
 *
 * Usage: `LatticeIndex.create({ latDir, projectRoot })` then `await index.build()`.
 *   Call `occurrences()` before reading `mdOccurrences` / `codeOccurrences`,
 *   `reloadLattice()` after a `lat.md/` file changes, and
 *   `updateCodeRefsForFile()` / `refreshCodeRefsFromDisk()` after any other write.
 *
 * Example:
 *   const index = await LatticeIndex.create({ latDir, projectRoot });
 *   await index.build();
 *   const section = index.sectionForTarget('guidelines#Code References');
 */

const { existsSync, statSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { join, relative } = require('node:path');

const { loadLatModules } = require('./lat_modules.js');
const { scanWikiLinks } = require('./wiki_links.js');

class LatticeIndex {
  static async create({ latDir, projectRoot }) {
    return new LatticeIndex({
      lat: await loadLatModules(),
      latDir,
      projectRoot,
    });
  }

  constructor({ lat, latDir, projectRoot }) {
    this.codeOccurrences = [];
    this.occurrencesReady = null;
    this.fileIndex = new Map();
    this.lat = lat;
    this.latDir = latDir;
    this.mdOccurrences = [];
    this.projectRoot = projectRoot;
    this.rootSections = [];
    this.sectionById = new Map();
    this.sectionIds = new Set();
    this.sections = [];
  }

  async build() {
    await this.reloadLattice();
  }

  occurrences() {
    if (this.occurrencesReady === null) {
      const loading = (async () => {
        await this.reloadMdOccurrences();
        await this.reloadCodeRefs();
      })().catch((error) => {
        if (this.occurrencesReady === loading) this.occurrencesReady = null;
        throw error;
      });
      this.occurrencesReady = loading;
    }

    return this.occurrencesReady;
  }

  dropOccurrences() {
    this.codeOccurrences = [];
    this.mdOccurrences = [];
    this.occurrencesReady = null;
  }

  async reloadLattice() {
    const { lattice } = this.lat;
    this.rootSections = await lattice.loadAllSections(this.latDir);
    this.sections = lattice.flattenSections(this.rootSections);
    this.sectionById = new Map(
      this.sections.map((section) => [section.id.toLowerCase(), section]),
    );
    this.sectionIds = new Set(this.sectionById.keys());
    this.fileIndex = lattice.buildFileIndex(this.rootSections);
    this.dropOccurrences();
  }

  async reloadMdOccurrences() {
    const files = await this.lat.lattice.listLatticeFiles(this.latDir);
    const occurrences = [];
    for (const file of files) {
      const text = await readFile(file, 'utf-8');
      occurrences.push(...this.mdOccurrencesFromText({ file, text }));
    }
    this.mdOccurrences = occurrences;
  }

  mdOccurrencesFromText({ file, text }) {
    return scanWikiLinks(text).map((link) =>
      this.withResolvedTarget({ file, range: link.range, target: link.target }),
    );
  }

  async reloadCodeRefs() {
    const { refs } = await this.lat.codeRefs.scanCodeRefs(this.projectRoot);
    this.codeOccurrences = refs.map((ref) =>
      this.withResolvedTarget({
        file: join(this.projectRoot, ref.file),
        line: ref.line - 1,
        target: ref.target,
      }),
    );
  }

  async updateCodeRefsForFile({ file, text }) {
    if (this.occurrencesReady === null) return;

    await this.occurrencesReady;
    const kept = this.codeOccurrences.filter(
      (occurrence) => occurrence.file !== file,
    );
    const lines = text.split('\n');
    const found = [];
    for (let line = 0; line < lines.length; line++) {
      const pattern = new RegExp(this.lat.codeRefs.LAT_REF_RE.source, 'gv');
      let match = pattern.exec(lines[line]);
      while (match !== null) {
        found.push(this.withResolvedTarget({ file, line, target: match[1] }));
        match = pattern.exec(lines[line]);
      }
    }
    this.codeOccurrences = [...kept, ...found];
  }

  async refreshCodeRefsFromDisk(file) {
    if (this.occurrencesReady === null) return;

    await this.occurrencesReady;

    if (!existsSync(file) || !statSync(file).isFile()) {
      this.codeOccurrences = this.codeOccurrences.filter(
        (occurrence) => occurrence.file !== file,
      );
      return;
    }
    await this.updateCodeRefsForFile({
      file,
      text: await readFile(file, 'utf-8'),
    });
  }

  withResolvedTarget(occurrence) {
    return {
      ...occurrence,
      resolvedLower: this.resolveTarget(occurrence.target).toLowerCase(),
    };
  }

  resolveTarget(target) {
    return this.resolveTargetFull(target).resolved;
  }

  resolveTargetFull(target) {
    return this.lat.lattice.resolveRef(target, this.sectionIds, this.fileIndex);
  }

  sectionForTarget(target) {
    return (
      this.sectionById.get(this.resolveTarget(target).toLowerCase()) ?? null
    );
  }

  sectionAtLine({ line, relativePath }) {
    return (
      this.sections.find(
        (section) =>
          section.filePath === relativePath && section.startLine - 1 === line,
      ) ?? null
    );
  }

  isLatticeFile(file) {
    return file.startsWith(this.latDir + '/') && file.endsWith('.md');
  }

  relativeTo(file) {
    return relative(this.projectRoot, file);
  }
}

module.exports = { LatticeIndex };
