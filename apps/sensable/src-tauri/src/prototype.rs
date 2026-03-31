use crate::commands::project::{ensure_sensable_gitignore, generate_preview_entries};
use serde::{Deserialize, Serialize};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs as unix_fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

const DEFAULT_PORT: u16 = 5555;

/// Inspector IIFE injected into prototype iframes for element inspection.
/// Must stay in sync with apps/sensable/src/lib/inspector-script.ts.
const INSPECTOR_IIFE: &str = r#"(function() {
  var enabled = false;
  var overlay = null;
  var label = null;

  function createOverlay() {
    overlay = document.createElement("div");
    overlay.setAttribute("data-inspector", "overlay");
    overlay.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;" +
      "outline:2px solid #3b82f6;background:rgba(59,130,246,0.08);" +
      "transition:all 0.05s ease-out;display:none;";
    document.body.appendChild(overlay);

    label = document.createElement("div");
    label.setAttribute("data-inspector", "label");
    label.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;" +
      "background:#3b82f6;color:#fff;font-size:11px;font-family:monospace;" +
      "padding:2px 6px;border-radius:3px;white-space:nowrap;display:none;";
    document.body.appendChild(label);
  }

  function isInspectorElement(el) {
    return el && el.getAttribute && el.getAttribute("data-inspector");
  }

  function isIgnored(el) {
    var tag = el.tagName && el.tagName.toLowerCase();
    return tag === "html" || tag === "body" || isInspectorElement(el);
  }

  function buildSelector(el) {
    var parts = [];
    var current = el;
    var depth = 0;
    while (current && current.nodeType === 1 && depth < 4) {
      if (isIgnored(current)) break;
      var tag = current.tagName.toLowerCase();
      var cls = current.className && typeof current.className === "string"
        ? current.className.trim().split(/\s+/).filter(function(c) { return c; }).slice(0, 2).join(".")
        : "";
      parts.unshift(cls ? tag + "." + cls : tag);
      current = current.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  function getAncestors(el) {
    var ancestors = [];
    var current = el.parentElement;
    var depth = 0;
    while (current && current.nodeType === 1 && depth < 3) {
      if (isIgnored(current)) break;
      var tag = current.tagName.toLowerCase();
      var cls = current.className && typeof current.className === "string"
        ? current.className.trim().split(/\s+/).filter(function(c) { return c; }).slice(0, 2).join(".")
        : "";
      ancestors.push(cls ? tag + "." + cls : tag);
      current = current.parentElement;
      depth++;
    }
    return ancestors;
  }

  function getLabelText(el) {
    var tag = el.tagName.toLowerCase();
    var cls = el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\s+/).filter(function(c) { return c; }).slice(0, 2).join(".")
      : "";
    return tag + cls;
  }

  function onMouseMove(e) {
    var target = e.target;
    if (!target || isIgnored(target)) {
      overlay.style.display = "none";
      label.style.display = "none";
      return;
    }
    var rect = target.getBoundingClientRect();
    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    overlay.style.display = "block";

    label.textContent = getLabelText(target);
    var labelTop = rect.top - 22;
    if (labelTop < 0) labelTop = rect.bottom + 2;
    label.style.top = labelTop + "px";
    label.style.left = rect.left + "px";
    label.style.display = "block";
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var target = e.target;
    if (!target || isIgnored(target)) return;

    var text = (target.textContent || "").trim();
    if (text.length > 100) text = text.substring(0, 100) + "...";

    var html = target.outerHTML || "";
    if (html.length > 500) html = html.substring(0, 500) + "...";

    var classes = target.className && typeof target.className === "string"
      ? target.className.trim().split(/\s+/).filter(function(c) { return c; })
      : [];

    var payload = {
      tag: target.tagName.toLowerCase(),
      id: target.id || "",
      classes: classes,
      textContent: text,
      outerHTML: html,
      selector: buildSelector(target),
      ancestors: getAncestors(target)
    };

    window.parent.postMessage({ type: "element-selected", element: payload }, "*");
    disable();
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    if (!overlay) createOverlay();
    document.body.style.cursor = "crosshair";
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    if (overlay) {
      overlay.style.display = "none";
      label.style.display = "none";
    }
  }

  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "inspector-enable") enable();
    if (e.data && e.data.type === "inspector-disable") disable();
  });
})();"#;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrototypeServerStatus {
    pub running: bool,
    pub port: u16,
    pub setup: bool,
}

pub struct PrototypeServerManager {
    child: Arc<Mutex<Option<tokio::process::Child>>>,
    port: Arc<Mutex<u16>>,
}

fn prototype_server_dir(project_path: &str) -> PathBuf {
    Path::new(project_path)
        .join(".sensable")
        .join("prototype-server")
}

impl PrototypeServerManager {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(DEFAULT_PORT)),
        }
    }
}

/// Always use npm for the prototype server.
/// pnpm/yarn workspace hoisting installs deps at the workspace root instead of
/// locally, leaving node_modules empty when the project lives inside a monorepo.
/// npm is workspace-unaware and always installs locally — exactly what we need.
fn detect_package_manager() -> &'static str {
    "npm"
}

/// Scaffold the prototype server directory with Vite + framework deps
#[tauri::command]
pub async fn setup_prototype_server(
    project_path: String,
    framework: String,
) -> Result<(), String> {
    let server_dir = prototype_server_dir(&project_path);

    if server_dir.join("package.json").exists() {
        return Err("Prototype server already set up. Delete .sensable/prototype-server to re-scaffold.".to_string());
    }

    fs::create_dir_all(server_dir.join("src"))
        .map_err(|e| format!("Failed to create prototype-server dir: {}", e))?;
    fs::create_dir_all(server_dir.join("design-system").join("components"))
        .map_err(|e| format!("Failed to create design-system/components dir: {}", e))?;
    fs::create_dir_all(server_dir.join("design-system").join("layouts"))
        .map_err(|e| format!("Failed to create design-system/layouts dir: {}", e))?;
    fs::create_dir_all(server_dir.join("public"))
        .map_err(|e| format!("Failed to create public dir: {}", e))?;

    // Write inspector script for element inspection in prototypes
    fs::write(server_dir.join("public").join("__inspector.js"), INSPECTOR_IIFE)
        .map_err(|e| format!("Failed to write __inspector.js: {}", e))?;

    // Write package.json based on framework
    let package_json = match framework.as_str() {
        "vue" => serde_json::json!({
            "name": "sensable-prototypes",
            "private": true,
            "type": "module",
            "scripts": {
                "dev": "vite",
                "build": "vite build"
            },
            "dependencies": {
                "vue": "^3.5.0",
                "tw-animate-css": "^1.0.0"
            },
            "devDependencies": {
                "@vitejs/plugin-vue": "^5.0.0",
                "vite": "^6.0.0",
                "tailwindcss": "^4.0.0",
                "@tailwindcss/vite": "^4.0.0",
                "typescript": "^5.7.0"
            }
        }),
        _ => serde_json::json!({
            "name": "sensable-prototypes",
            "private": true,
            "type": "module",
            "scripts": {
                "dev": "vite",
                "build": "vite build"
            },
            "dependencies": {
                "react": "^19.0.0",
                "react-dom": "^19.0.0",
                "tw-animate-css": "^1.0.0"
            },
            "devDependencies": {
                "@vitejs/plugin-react": "^4.0.0",
                "@types/react": "^19.0.0",
                "@types/react-dom": "^19.0.0",
                "vite": "^6.0.0",
                "tailwindcss": "^4.0.0",
                "@tailwindcss/vite": "^4.0.0",
                "typescript": "^5.7.0"
            }
        }),
    };

    fs::write(
        server_dir.join("package.json"),
        serde_json::to_string_pretty(&package_json).unwrap(),
    )
    .map_err(|e| format!("Failed to write package.json: {}", e))?;

    // Write vite.config.ts
    write_vite_config(&server_dir, &framework)?;

    // Write tsconfig.json
    let tsconfig = match framework.as_str() {
        "vue" => serde_json::json!({
            "compilerOptions": {
                "target": "ES2020",
                "module": "ESNext",
                "moduleResolution": "bundler",
                "strict": true,
                "jsx": "preserve",
                "paths": {
                    "@/*": ["./src/*"],
                    "@layouts/*": ["../design-system/layouts/*"],
                    "@components/*": ["../design-system/components/*"]
                }
            },
            "include": ["src/**/*", "features/**/*", "design-system/**/*", "../design-system/**/*"]
        }),
        _ => serde_json::json!({
            "compilerOptions": {
                "target": "ES2020",
                "module": "ESNext",
                "moduleResolution": "bundler",
                "strict": true,
                "jsx": "react-jsx",
                "paths": {
                    "@/*": ["./src/*"],
                    "@layouts/*": ["../design-system/layouts/*"],
                    "@components/*": ["../design-system/components/*"]
                }
            },
            "include": ["src/**/*", "features/**/*", "design-system/**/*", "../design-system/**/*"]
        }),
    };
    fs::write(
        server_dir.join("tsconfig.json"),
        serde_json::to_string_pretty(&tsconfig).unwrap(),
    )
    .map_err(|e| format!("Failed to write tsconfig.json: {}", e))?;

    // Write src/globals.css
    // We own the single @import "tailwindcss" here. tokens.css may also contain one
    // (user-generated), so we strip it when copying to avoid duplicate Tailwind roots.
    // @source directives tell Tailwind to scan files outside the Vite project root
    // (design-system components/layouts and feature prototypes live in ../).
    let globals_css = r#"@import "tailwindcss";
@import "./tokens.css";
@source "../../design-system";
@source "../../features";
"#;
    fs::write(server_dir.join("src").join("globals.css"), globals_css)
        .map_err(|e| format!("Failed to write globals.css: {}", e))?;

    // Copy tokens.css from design-system if it exists, stripping any
    // @import "tailwindcss" to avoid a duplicate Tailwind root.
    let tokens_src = Path::new(&project_path)
        .join(".sensable")
        .join("design-system")
        .join("tokens.css");
    let tokens_dst = server_dir.join("src").join("tokens.css");
    if tokens_src.exists() {
        let content = fs::read_to_string(&tokens_src)
            .map_err(|e| format!("Failed to read tokens.css: {}", e))?;
        let filtered: String = content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                // Strip bare tailwindcss imports — globals.css owns the single import
                trimmed != r#"@import "tailwindcss";"#
                    && trimmed != "@import 'tailwindcss';"
            })
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&tokens_dst, filtered)
            .map_err(|e| format!("Failed to write tokens.css: {}", e))?;
    } else {
        // Write empty placeholder
        fs::write(&tokens_dst, "/* Design system tokens — generate via Architecture phase */\n")
            .map_err(|e| format!("Failed to write tokens.css placeholder: {}", e))?;
    }

    // Write index.html (Vite entry point)
    let index_html = match framework.as_str() {
        "vue" => r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sensable Prototypes</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
"#,
        _ => r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sensable Prototypes</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"#,
    };
    fs::write(server_dir.join("index.html"), index_html)
        .map_err(|e| format!("Failed to write index.html: {}", e))?;

    // Write src/main entry (app bootstrap)
    let main_entry = match framework.as_str() {
        "vue" => r##"import { createApp } from "vue";
import "./globals.css";

const app = createApp({
  template: `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#888">
    <p>Prototype server ready. Preview components and features from the Sensable app.</p>
  </div>`,
});
app.mount("#app");
"##,
        _ => r##"import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "system-ui", color: "#888" }}>
      <p>Prototype server ready. Preview components and features from the Sensable app.</p>
    </div>
  </React.StrictMode>
);
"##,
    };
    let main_filename = match framework.as_str() {
        "vue" => "main.ts",
        _ => "main.tsx",
    };
    fs::write(server_dir.join("src").join(main_filename), main_entry)
        .map_err(|e| format!("Failed to write {}: {}", main_filename, e))?;

    // Run package manager install
    let pkg_mgr = detect_package_manager();
    let output = Command::new(pkg_mgr)
        .arg("install")
        .current_dir(&server_dir)
        .output()
        .await
        .map_err(|e| format!("Failed to run {} install: {}", pkg_mgr, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{} install failed: {}", pkg_mgr, stderr));
    }

    // Ensure .sensable/.gitignore ignores auto-generated / runtime files
    let sensable_dir = server_dir
        .parent()
        .expect(".sensable dir is parent of prototype-server");
    ensure_sensable_gitignore(sensable_dir);

    Ok(())
}

/// Detect framework from the prototype server's package.json
fn detect_framework(server_dir: &Path) -> String {
    if let Ok(contents) = fs::read_to_string(server_dir.join("package.json")) {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&contents) {
            if pkg.get("dependencies").and_then(|d| d.get("vue")).is_some() {
                return "vue".to_string();
            }
        }
    }
    "react".to_string()
}

/// Write the vite.config.ts with correct aliases for the given framework
fn write_vite_config(server_dir: &Path, framework: &str) -> Result<(), String> {
    let vite_config = match framework {
        "vue" => r#"import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    {
      name: "sensable-inspector",
      transformIndexHtml(html) {
        return html.replace("</body>", '<script src="/__inspector.js"></script></body>');
      },
    },
    {
      name: "sensable-theme",
      transformIndexHtml(html) {
        const script = `<script>
          (function() {
            window.addEventListener("message", function(e) {
              if (e.data && e.data.type === "set-theme") {
                var isDark = e.data.theme === "dark";
                document.documentElement.classList.toggle("dark", isDark);
                document.body.classList.toggle("dark", isDark);
              }
            });
          })();
        </script>`;
        return html.replace("</head>", script + "</head>");
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@layouts": path.resolve(__dirname, "../design-system/layouts"),
      "@components": path.resolve(__dirname, "../design-system/components"),
    },
  },
  server: {
    port: 5555,
    strictPort: true,
  },
});
"#,
        _ => r#"import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "sensable-inspector",
      transformIndexHtml(html) {
        return html.replace("</body>", '<script src="/__inspector.js"></script></body>');
      },
    },
    {
      name: "sensable-theme",
      transformIndexHtml(html) {
        const script = `<script>
          (function() {
            window.addEventListener("message", function(e) {
              if (e.data && e.data.type === "set-theme") {
                var isDark = e.data.theme === "dark";
                document.documentElement.classList.toggle("dark", isDark);
                document.body.classList.toggle("dark", isDark);
              }
            });
          })();
        </script>`;
        return html.replace("</head>", script + "</head>");
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@layouts": path.resolve(__dirname, "../design-system/layouts"),
      "@components": path.resolve(__dirname, "../design-system/components"),
    },
  },
  server: {
    port: 5555,
    strictPort: true,
  },
});
"#,
    };
    fs::write(server_dir.join("vite.config.ts"), vite_config)
        .map_err(|e| format!("Failed to write vite.config.ts: {}", e))
}

/// Sync symlinks in prototype-server/features/ so each feature with a prototype
/// directory is accessible to Vite.
///
/// - Migrates real directories at prototype-server/features/{id} to the canonical
///   location at .sensable/features/{id}/prototype, then replaces them with symlinks
/// - Removes stale symlinks for features whose prototype dir no longer exists
/// - Creates symlinks: prototype-server/features/{id} -> ../../features/{id}/prototype
#[cfg(unix)]
fn sync_feature_symlinks(project_path: &str) -> Result<(), String> {
    let sensable = Path::new(project_path).join(".sensable");
    let features_src = sensable.join("features");
    let server_features = sensable.join("prototype-server").join("features");

    // Ensure the prototype-server/features/ directory exists
    fs::create_dir_all(&server_features)
        .map_err(|e| format!("Failed to create prototype-server/features dir: {}", e))?;

    // Phase 1: Migrate real directories to canonical location
    if let Ok(entries) = fs::read_dir(&server_features) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let metadata = match fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            // Only migrate real directories (not symlinks)
            if !metadata.file_type().is_symlink() && metadata.is_dir() {
                let feature_id = match entry_path.file_name() {
                    Some(n) => n.to_string_lossy().to_string(),
                    None => continue,
                };
                let canonical_dst = features_src.join(&feature_id).join("prototype");
                if !canonical_dst.exists() {
                    fs::create_dir_all(canonical_dst.parent().unwrap())
                        .map_err(|e| format!("Failed to create feature dir: {}", e))?;
                    fs::rename(&entry_path, &canonical_dst)
                        .map_err(|e| format!("Failed to migrate prototype for {}: {}", feature_id, e))?;
                } else {
                    // Canonical already exists — remove the stale real dir
                    let _ = fs::remove_dir_all(&entry_path);
                }
            }
        }
    }

    // Phase 2: Remove stale symlinks (targets no longer exist)
    if let Ok(entries) = fs::read_dir(&server_features) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let metadata = match fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if metadata.file_type().is_symlink() && !entry_path.exists() {
                let _ = fs::remove_file(&entry_path);
            }
        }
    }

    // Phase 3: Create missing symlinks for features that have a prototype dir
    if features_src.exists() {
        if let Ok(entries) = fs::read_dir(&features_src) {
            for entry in entries.flatten() {
                let feature_dir = entry.path();
                if !feature_dir.is_dir() {
                    continue;
                }
                let feature_id = match feature_dir.file_name() {
                    Some(n) => n.to_string_lossy().to_string(),
                    None => continue,
                };
                let prototype_src = feature_dir.join("prototype");
                if !prototype_src.exists() {
                    continue;
                }
                let symlink_path = server_features.join(&feature_id);
                // Skip if symlink already exists
                if symlink_path.exists() || fs::symlink_metadata(&symlink_path).is_ok() {
                    continue;
                }
                // Relative symlink: ../../features/{id}/prototype
                let target = Path::new("../../features").join(&feature_id).join("prototype");
                unix_fs::symlink(&target, &symlink_path)
                    .map_err(|e| format!("Failed to create symlink for feature {}: {}", feature_id, e))?;
            }
        }
    }

    Ok(())
}

/// Start the Vite dev server and wait until it's ready
#[tauri::command]
pub async fn start_prototype_server(
    state: tauri::State<'_, PrototypeServerManager>,
    project_path: String,
) -> Result<PrototypeServerStatus, String> {
    // Check if already running
    {
        let child = state.child.lock().await;
        if child.is_some() {
            let port = *state.port.lock().await;
            return Ok(PrototypeServerStatus {
                running: true,
                port,
                setup: true,
            });
        }
    }

    let server_dir = prototype_server_dir(&project_path);
    if !server_dir.join("package.json").exists() {
        return Err("Prototype server not set up. Run setup first.".to_string());
    }

    // Always regenerate vite.config.ts to pick up any fixes
    let framework = detect_framework(&server_dir);
    write_vite_config(&server_dir, &framework)?;

    // Check if node_modules exists, if not run install
    if !server_dir.join("node_modules").exists() {
        let pkg_mgr = detect_package_manager();
        let output = Command::new(pkg_mgr)
            .arg("install")
            .current_dir(&server_dir)
            .output()
            .await
            .map_err(|e| format!("Failed to run {} install: {}", pkg_mgr, e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("{} install failed: {}", pkg_mgr, stderr));
        }
    }

    // Sync symlinks for feature prototypes into prototype-server/features/
    sync_feature_symlinks(&project_path)?;

    // Spawn Vite dev server directly (not via npx) so that child.kill()
    // actually terminates Vite instead of just killing the npx wrapper.
    let vite_bin = server_dir
        .join("node_modules")
        .join(".bin")
        .join("vite");
    let mut cmd = Command::new(&vite_bin);
    cmd.arg("--port")
        .arg(DEFAULT_PORT.to_string())
        .arg("--strictPort")
        .current_dir(&server_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Vite dev server: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Vite stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Vite stderr".to_string())?;

    // Wait for Vite to be ready (look for "Local:" in output)
    // Vite v6 writes server URLs to stderr, so we must check both streams
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
    let ready_tx = Arc::new(Mutex::new(Some(ready_tx)));

    // Monitor stdout
    let ready_tx_stdout = ready_tx.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.contains("Local:") || line.contains("localhost") {
                        let mut tx = ready_tx_stdout.lock().await;
                        if let Some(tx) = tx.take() {
                            let _ = tx.send(());
                        }
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });

    // Monitor stderr (Vite v6 writes server URLs here)
    let ready_tx_stderr = ready_tx.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.contains("Local:") || line.contains("localhost") {
                        let mut tx = ready_tx_stderr.lock().await;
                        if let Some(tx) = tx.take() {
                            let _ = tx.send(());
                        }
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });

    // Wait for ready signal with timeout
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(30), ready_rx).await;

    match timeout {
        Ok(Ok(())) => {
            // Server is ready
            let port = DEFAULT_PORT;
            {
                let mut child_lock = state.child.lock().await;
                *child_lock = Some(child);
            }
            {
                let mut port_lock = state.port.lock().await;
                *port_lock = port;
            }
            Ok(PrototypeServerStatus {
                running: true,
                port,
                setup: true,
            })
        }
        _ => {
            // Timeout or channel error — kill the process
            let _ = child.kill().await;
            Err("Vite dev server failed to start within 30 seconds".to_string())
        }
    }
}

/// Stop the prototype server
#[tauri::command]
pub async fn stop_prototype_server(
    state: tauri::State<'_, PrototypeServerManager>,
) -> Result<(), String> {
    let port = *state.port.lock().await;
    let mut child_lock = state.child.lock().await;
    if let Some(ref mut child) = *child_lock {
        let _ = child.kill().await;
    }
    *child_lock = None;

    // Safety net: kill any orphaned process still holding the port
    kill_process_on_port(port).await;

    Ok(())
}

/// Kill any process listening on the given port (cleanup for orphaned children)
async fn kill_process_on_port(port: u16) {
    if let Ok(output) = Command::new("lsof")
        .args(["-ti", &format!(":{}", port)])
        .output()
        .await
    {
        if output.status.success() {
            let pids = String::from_utf8_lossy(&output.stdout);
            for pid_str in pids.split_whitespace() {
                let _ = Command::new("kill")
                    .arg(pid_str.trim())
                    .output()
                    .await;
            }
        }
    }
}

/// Reinstall the prototype server: stop it, delete the directory, and re-scaffold
#[tauri::command]
pub async fn reinstall_prototype_server(
    state: tauri::State<'_, PrototypeServerManager>,
    project_path: String,
    framework: String,
) -> Result<(), String> {
    // Stop the server if running
    let port = *state.port.lock().await;
    let mut child_lock = state.child.lock().await;
    if let Some(ref mut child) = *child_lock {
        let _ = child.kill().await;
    }
    *child_lock = None;
    drop(child_lock);
    kill_process_on_port(port).await;

    // Delete the prototype-server directory
    let server_dir = prototype_server_dir(&project_path);
    if server_dir.exists() {
        fs::remove_dir_all(&server_dir)
            .map_err(|e| format!("Failed to remove prototype-server directory: {}", e))?;
    }

    // Re-scaffold
    setup_prototype_server(project_path.clone(), framework.clone()).await?;

    // Regenerate preview entries for design-system components/layouts
    generate_preview_entries(&project_path, &framework);

    // Restore symlinks for feature prototypes (prototypes live outside prototype-server/)
    sync_feature_symlinks(&project_path)?;

    Ok(())
}

/// Get current prototype server status
#[tauri::command]
pub async fn get_prototype_server_status(
    state: tauri::State<'_, PrototypeServerManager>,
    project_path: String,
) -> Result<PrototypeServerStatus, String> {
    let child = state.child.lock().await;
    let port = *state.port.lock().await;
    let server_dir = prototype_server_dir(&project_path);
    let setup = server_dir.join("package.json").exists();

    Ok(PrototypeServerStatus {
        running: child.is_some(),
        port,
        setup,
    })
}
