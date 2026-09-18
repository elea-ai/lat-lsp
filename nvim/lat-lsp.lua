--- Purpose: register the lat.md language server with Neovim's built-in LSP
--- client, so `[[refs]]` and `@lat:` annotations are navigable from any buffer
--- inside a project that has a `lat.md/` directory.
---
--- Usage: `require`/`dofile` this file and call `setup()`. The server is located
--- next to this file, so no arguments are needed. `setup(opts)` accepts
--- `filetypes` (default: the extensions that carry annotations), `node` (the
--- Node binary, default `node`) and `server` (an explicit server path).
--- Returns false and notifies when the server is missing — install
--- `@elea.health/lat-lsp` first. Needs Neovim 0.11+ for `vim.lsp.config`.
---
--- Example:
---   local root = vim.trim(vim.fn.system('npm root -g'))
---   dofile(root .. '/@elea.health/lat-lsp/nvim/lat-lsp.lua').setup()

local M = {}

local default_filetypes = {
  "dart",
  "go",
  "javascript",
  "javascriptreact",
  "lua",
  "markdown",
  "python",
  "rust",
  "sh",
  "sql",
  "terraform",
  "toml",
  "typescript",
  "typescriptreact",
  "yaml",
}

local function bundled_server_path()
  local source = debug.getinfo(1, "S").source:sub(2)
  return vim.fs.normalize(vim.fs.dirname(source) .. "/../bin/lat-lsp.js")
end

function M.setup(opts)
  opts = opts or {}
  local server = opts.server or bundled_server_path()
  if vim.fn.filereadable(server) == 0 then
    vim.notify("lat-lsp: server not found at " .. server, vim.log.levels.WARN)
    return false
  end

  vim.lsp.config("lat_lsp", {
    cmd = { opts.node or "node", server, "--stdio" },
    filetypes = opts.filetypes or default_filetypes,
    root_markers = { "lat.md" },
  })
  vim.lsp.enable("lat_lsp")
  return true
end

return M
