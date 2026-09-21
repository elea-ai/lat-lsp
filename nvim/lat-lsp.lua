---
--- Purpose: register the lat.md language server with Neovim's built-in LSP
--- client, so `[[refs]]` and `@lat:` annotations are navigable from any buffer
--- inside a project that has a `lat.md/` directory. Adds `:LatNextRef` and
--- `:LatPrevRef` to walk the refs of the current buffer without the server.
---
--- Usage: `require`/`dofile` this file and call `setup()`. The server is located
--- next to this file, so no arguments are needed. `setup(opts)` accepts
--- `filetypes` (default: the extensions that carry annotations), `node` (the
--- Node binary, default `node`), `server` (an explicit server path) and
--- `keymaps` (`true` for `]l`/`[l`, or a table of overrides).
--- Returns false and notifies when the server is missing — install
--- `@elea.health/lat-lsp` first. Needs Neovim 0.11+ for `vim.lsp.config`.
---
--- Example:
---   local root = vim.trim(vim.fn.system('npm root -g'))
---   dofile(root .. '/@elea.health/lat-lsp/nvim/lat-lsp.lua').setup({ keymaps = true })

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

local default_keymaps = {
  next = "]l",
  prev = "[l",
}

local ref_pattern = "%[%[[^%]]-%]%]"

local function bundled_server_path()
  local source = debug.getinfo(1, "S").source:sub(2)
  return vim.fs.normalize(vim.fs.dirname(source) .. "/../bin/lat-lsp.js")
end

--- Every `[[target]]` in a buffer, in document order, as
--- `{ column = 0-based byte column, line = 1-based line, target = string }`.
--- `@lat:` annotations carry a wiki link, so the same scan finds them.
function M.refs(buffer)
  local refs = {}
  local lines = vim.api.nvim_buf_get_lines(buffer or 0, 0, -1, false)
  for line = 1, #lines do
    local from, to = string.find(lines[line], ref_pattern)
    while from ~= nil do
      local raw = string.sub(lines[line], from + 2, to - 2)
      local target = vim.trim(vim.split(raw, "|", { plain = true })[1])
      if target ~= "" then
        refs[#refs + 1] = { column = from - 1, line = line, target = target }
      end
      from, to = string.find(lines[line], ref_pattern, to + 1)
    end
  end
  return refs
end

local function is_after(ref, line, column)
  return ref.line > line or (ref.line == line and ref.column > column)
end

--- Move the cursor to the nearest ref in `direction` (1 forward, -1 back),
--- wrapping at the end of the buffer. Returns the ref, or nil when there is none.
local function goto_ref(direction, count)
  local refs = M.refs(0)
  if #refs == 0 then
    vim.notify("lat-lsp: no refs in this buffer", vim.log.levels.INFO)
    return nil
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  local index = direction > 0 and 1 or #refs
  if direction > 0 then
    for at = 1, #refs do
      if is_after(refs[at], cursor[1], cursor[2]) then
        index = at
        break
      end
    end
  else
    for at = #refs, 1, -1 do
      if not is_after(refs[at], cursor[1], cursor[2] - 1) then
        index = at
        break
      end
    end
  end

  index = (index - 1 + direction * (math.max(count or 1, 1) - 1)) % #refs + 1
  local hit = refs[index]
  vim.cmd("normal! m'")
  vim.api.nvim_win_set_cursor(0, { hit.line, hit.column })
  return hit
end

function M.goto_next_ref(count)
  return goto_ref(1, count)
end

function M.goto_prev_ref(count)
  return goto_ref(-1, count)
end

local function register_navigation(keymaps)
  vim.api.nvim_create_user_command("LatNextRef", function(command)
    M.goto_next_ref(command.count)
  end, { count = 1, desc = "Jump to the next lat.md ref in this buffer" })
  vim.api.nvim_create_user_command("LatPrevRef", function(command)
    M.goto_prev_ref(command.count)
  end, { count = 1, desc = "Jump to the previous lat.md ref in this buffer" })

  if keymaps == nil or keymaps == false then
    return
  end
  local keys = keymaps == true and default_keymaps
    or vim.tbl_extend("force", default_keymaps, keymaps)
  if keys.next then
    vim.keymap.set({ "n", "x" }, keys.next, function()
      M.goto_next_ref(vim.v.count1)
    end, { desc = "Next lat.md ref" })
  end
  if keys.prev then
    vim.keymap.set({ "n", "x" }, keys.prev, function()
      M.goto_prev_ref(vim.v.count1)
    end, { desc = "Previous lat.md ref" })
  end
end

function M.setup(opts)
  opts = opts or {}
  register_navigation(opts.keymaps)

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
