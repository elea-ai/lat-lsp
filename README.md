# lat.md Language Server

An LSP server that makes [`lat.md`](https://github.com/elea-ai/lat.md) refs navigable from the
editor: jump from a `[[ref]]` or a `// @lat:` annotation to the section or symbol it names, and list
everything that references a section — markdown wiki links and `@lat:` code annotations alike.

It is the editor half of the CLI: `lat locate`, `lat section` and `lat refs` without leaving the
buffer. Resolution is not reimplemented — the server imports `@elea.health/lat.md` internals
(`loadAllSections`, `resolveRef`, `scanCodeRefs`, `resolveSourceSymbol`), so a ref that jumps in the
editor is a ref `lat check` accepts, and a ref that does not resolve fails both.

## Install

```bash
npm install -g @elea.health/lat-lsp
```

### VS Code

Install the **lat.md** extension (`elea-health.lat-lsp`) from the Marketplace. It bundles the server
— no separate install, no configuration.

To recommend it to everyone working in a repository, add it to `.vscode/extensions.json`:

```json
{ "recommendations": ["elea-health.lat-lsp"] }
```

### Neovim

`nvim/lat-lsp.lua` registers the server with `vim.lsp.config` (Neovim 0.11+) and locates the server
next to itself, so `setup()` needs no arguments:

```lua
local root = vim.trim(vim.fn.system('npm root -g'))
dofile(root .. '/@elea.health/lat-lsp/nvim/lat-lsp.lua').setup()
```

`setup()` accepts `filetypes`, `node` and `server` to override the defaults. `root_markers = { 'lat.md' }`
keeps it attached only inside a lattice project.

### Any other LSP client

Run the server over stdio:

```bash
lat-lsp --stdio
```

## What it provides

Five requests, all served from one in-memory index of the lattice.

- `textDocument/definition` — on a `[[target]]` in a `lat.md/` file or in a `// @lat: [[target]]`
  comment, jumps to the section heading. Source targets (`path/to/file.ts#Symbol`) jump to the symbol
  via the tree-sitter parser, directory targets open the directory's entry file (`README.md`,
  `package.json`, `pubspec.yaml`, `index.ts`, `main.tf`, `terragrunt.hcl`), ambiguous stems return
  every candidate.
- `textDocument/references` — on a section heading or on any `[[target]]`: every incoming wiki link
  plus every `@lat:` annotation, at the exact column of each link. In a source file it resolves the
  symbol under the cursor and lists the lat.md sections that document it, falling back to file-level
  refs.
- `textDocument/documentSymbol` — the section tree of a `lat.md/` file, and deliberately nothing for
  other files so it never competes with the real language server.
- `workspace/symbol` — every section in the lattice, for jumping to a heading by name.
- `textDocument/hover` — the resolved section id, its location and leading paragraph.

Broken refs are deliberately **not** diagnosed. `lat check` belongs in a pre-commit hook and in CI,
so a second, weaker copy of that rule in the editor would only drift.

## Design decisions

- **Plain CommonJS JavaScript, no build step.** The server is forked by whatever Node the client
  happens to have — VS Code's extension host, or the `node` on the developer's PATH. Committing
  TypeScript would mean either a build step that goes stale before the editor starts, or relying on
  type stripping in a Node version we do not control. Types are still checked: `tsconfig.json` runs
  `checkJs` in `npm run typecheck`.
- **Package internals, not CLI output.** Shelling out to `lat` per request would mean re-parsing the
  whole lattice per keystroke and screen-scraping formatted text. Deep-importing `dist/src/*.js` is
  stable because the package ships those files with declarations and has no `exports` map.
- **Two-stage index, incremental updates.** `initialize` parses the lattice; requests after that
  answer in single-digit milliseconds. The occurrence tables — the ripgrep `@lat:` sweep and the
  wiki-link pass over every lattice file — cost more than the parse and are read by nothing but
  find-references, so they are built on first reference query and dropped whenever the lattice
  reloads. Saving a `lat.md/` file reloads the lattice, saving anything else re-scans only that file,
  and a file the client reports via `workspace/didChangeWatchedFiles` (a `git switch`, a generator,
  another editor) is re-read from disk.
- **Lenient jumping, strict listing.** Definition and hover accept a `[[ref]]` anywhere in any file,
  while the reverse index keeps `lat`'s rule that an `@lat:` annotation counts only in a `//` or `#`
  line comment. A ref inside a block comment jumps, but it is invisible to `lat check` and therefore
  not listed.
- **Source targets stay inside the project root.** `resolveWithinRoot()` rejects anything that
  escapes it, so a `[[../../elsewhere.ts#secret]]` ref neither hovers nor jumps.

## Tests

```bash
npm install
npm run typecheck
npm test
```

The suite drives the real server over stdio against the fixture lattice in `test/fixture/` — a
two-file lattice plus one annotated source file — and asserts the locations it returns. A fixture
rather than this repo's own docs, so the expectations do not move when documentation does.

## Releasing

The npm package and the VS Code extension are versioned together.

```bash
npm publish --access public          # @elea.health/lat-lsp
npm --prefix vscode run publish      # elea-health.lat-lsp, needs a Marketplace PAT
```

## License

MIT
