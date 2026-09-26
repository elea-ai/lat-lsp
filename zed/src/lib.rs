//! Purpose: the Zed extension entry point. Tells Zed how to start the
//! `@elea.health/lat-lsp` server for every language that carries `[[refs]]`
//! or `@lat:` annotations.
//!
//! Usage: loaded by Zed, never called directly. The server is taken from, in
//!   order: the `lsp.lat-lsp.binary` setting, a `lat-lsp` on the worktree's
//!   PATH, and finally an npm install of the matching server version into the
//!   extension's work directory, run with Zed's own Node.
//!
//! Example:
//!   Command palette → `zed: install dev extension` → pick this `zed/` folder.

use std::fs;

use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

const PACKAGE_NAME: &str = "@elea.health/lat-lsp";
const SERVER_BINARY: &str = "lat-lsp";
const SERVER_PATH: &str = "node_modules/@elea.health/lat-lsp/bin/lat-lsp.js";
// The server and the extension are versioned together, so the extension pins
// the server it was released with instead of chasing `latest`.
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

struct LatExtension {
    installed: bool,
}

impl LatExtension {
    fn server_script_exists() -> bool {
        fs::metadata(SERVER_PATH).is_ok_and(|stat| stat.is_file())
    }

    fn install_server(&mut self, language_server_id: &LanguageServerId) -> Result<String> {
        if self.installed && Self::server_script_exists() {
            return Ok(SERVER_PATH.to_string());
        }

        let installed_version = zed::npm_package_installed_version(PACKAGE_NAME)?;
        if !Self::server_script_exists() || installed_version.as_deref() != Some(SERVER_VERSION) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            if let Err(error) = zed::npm_install_package(PACKAGE_NAME, SERVER_VERSION) {
                // An offline start keeps whatever version is already installed.
                if !Self::server_script_exists() {
                    return Err(format!("lat-lsp: cannot install {PACKAGE_NAME}: {error}"));
                }
            }
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::None,
            );
        }

        self.installed = true;
        Ok(SERVER_PATH.to_string())
    }
}

impl zed::Extension for LatExtension {
    fn new() -> Self {
        Self { installed: false }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // The server shells out to ripgrep, which lives on the user's PATH.
        let mut env = worktree.shell_env();

        let binary = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);
        if let Some(binary) = binary {
            env.extend(binary.env.unwrap_or_default());
            if let Some(path) = binary.path {
                return Ok(zed::Command {
                    command: path,
                    args: binary
                        .arguments
                        .unwrap_or_else(|| vec!["--stdio".to_string()]),
                    env,
                });
            }
        }

        if let Some(path) = worktree.which(SERVER_BINARY) {
            return Ok(zed::Command {
                command: path,
                args: vec!["--stdio".to_string()],
                env,
            });
        }

        let server_path = self.install_server(language_server_id)?;
        let server_path = std::env::current_dir()
            .map_err(|error| format!("lat-lsp: no extension work directory: {error}"))?
            .join(server_path);
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                server_path.to_string_lossy().into_owned(),
                "--stdio".to_string(),
            ],
            env,
        })
    }
}

zed::register_extension!(LatExtension);
