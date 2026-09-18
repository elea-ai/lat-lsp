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

The extension is published to [Open VSX](https://open-vsx.org/extension/elea-health/lat-lsp) as
`elea-health.lat-lsp`, and bundles the server — no separate install, no configuration.

Editors that use Open VSX as their registry — VSCodium, Cursor, Windsurf, Gitpod, Theia — install it
from the Extensions view, and pick it up from a workspace recommendation:

```json
{ "recommendations": ["elea-health.lat-lsp"] }
```

Stock VS Code only queries Microsoft's Marketplace, where this extension is deliberately not
published. Install the `.vsix` from Open VSX by hand instead:

```bash
code --install-extension lat-lsp-<version>.vsix
```

### Claude Code

`claude/` is a Claude Code plugin that declares the server, and the repository doubles as the
marketplace that carries it:

```bash
claude plugin marketplace add elea-ai/lat-lsp
claude plugin install lat-lsp@lat-lsp
```

Or, to enable it for everyone working in a repository, commit it to `.claude/settings.json`:

```json
{
  "enabledPlugins": { "lat-lsp@lat-lsp": true },
  "extraKnownMarketplaces": {
    "lat-lsp": { "source": { "source": "github", "repo": "elea-ai/lat-lsp" } }
  }
}
```

The plugin declares the command as the bare `lat-lsp` binary, so the global install above — or
whatever puts it on `PATH` — is still what supplies the server; only the wiring comes from here.

Claude Code starts at most one language server per file extension: when several enabled plugins
declare the same extension, the first registered wins and the rest never start. So
`extensionToLanguage` maps `.md` and the source extensions that carry annotations, but deliberately
not `.py` — that one is almost always claimed by a real Python language server, and an `@lat:`
annotation in a Python file is still listed by find-references from the section it points at.
Surrender any other extension the same way when a real language server for it is added.

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

`ripgrep` has to be on `PATH`: the `@lat:` sweep shells out to it.

## Releasing

The npm package, the VS Code extension and the Claude Code plugin are versioned together.

Bump `version` in `package.json`, `vscode/package.json` and `claude/.claude-plugin/plugin.json`,
then merge to `main`. The **Publish** workflow notices the change, runs the typecheck and the suite,
and publishes `@elea.health/lat-lsp` with `--provenance` through npm [trusted
publishing](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN`, the registry verifies the
workflow's OIDC identity — then cuts the matching GitHub release. A push that does not change the
version is a no-op.

The Claude Code plugin has no publish step of its own: a marketplace added from GitHub reads `main`,
so the bump is only there to keep the three manifests telling the same story.

The same run then publishes the extension to Open VSX, once the npm version is servable — it depends
on the package by exact version. Open VSX has no OIDC equivalent, so that half authenticates with an
access token stored as the `OVSX_PAT` repository secret, and is skipped entirely while the secret is
unset. `ovsx publish` packages from source; there is no separate `.vsix` build step.

To publish the extension by hand instead:

```bash
npm --prefix vscode install
npm --prefix vscode run publish
```

### First release

Two things exist only after a manual first step.

`npm trust` configures a publisher *for an existing package*, so the first `@elea.health/lat-lsp`
goes out by hand:

```bash
npm publish --provenance --access public
npm trust github @elea.health/lat-lsp --repo elea-ai/lat-lsp --file publish.yml --allow-publish
```

`repository.url` in `package.json` has to match the GitHub repository exactly, or the OIDC exchange
fails at publish time — the trust configuration itself is not validated when saved.

The Open VSX namespace has to be registered once, from a token generated in your open-vsx.org user
settings. Creating it does not make you a verified owner; that is a separate claim.

```bash
npx ovsx create-namespace elea-health -p <token>
```

## License

MIT
