use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

const DEFAULT_PORT: u16 = 5555;

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

/// Detect which package manager is available
fn detect_package_manager() -> &'static str {
    let managers = ["pnpm", "yarn", "npm"];
    for mgr in &managers {
        if let Ok(output) = std::process::Command::new("which").arg(mgr).output() {
            if output.status.success() {
                return mgr;
            }
        }
    }
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
    fs::create_dir_all(server_dir.join("features"))
        .map_err(|e| format!("Failed to create features dir: {}", e))?;
    fs::create_dir_all(server_dir.join("design-system").join("components"))
        .map_err(|e| format!("Failed to create design-system/components dir: {}", e))?;
    fs::create_dir_all(server_dir.join("design-system").join("layouts"))
        .map_err(|e| format!("Failed to create design-system/layouts dir: {}", e))?;

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
                "vue": "^3.5.0"
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
                "react-dom": "^19.0.0"
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
    let vite_config = match framework.as_str() {
        "vue" => r#"import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src/"),
      "@layouts/": path.resolve(__dirname, "../design-system/layouts/"),
      "@components/": path.resolve(__dirname, "../design-system/components/"),
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
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src/"),
      "@layouts/": path.resolve(__dirname, "../design-system/layouts/"),
      "@components/": path.resolve(__dirname, "../design-system/components/"),
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
        .map_err(|e| format!("Failed to write vite.config.ts: {}", e))?;

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

    // Write src/globals.css (Tailwind v4 + tokens)
    let globals_css = r#"@import "tailwindcss";
@import "./tokens.css";
"#;
    fs::write(server_dir.join("src").join("globals.css"), globals_css)
        .map_err(|e| format!("Failed to write globals.css: {}", e))?;

    // Copy tokens.css from design-system if it exists
    let tokens_src = Path::new(&project_path)
        .join(".sensable")
        .join("design-system")
        .join("tokens.css");
    let tokens_dst = server_dir.join("src").join("tokens.css");
    if tokens_src.exists() {
        fs::copy(&tokens_src, &tokens_dst)
            .map_err(|e| format!("Failed to copy tokens.css: {}", e))?;
    } else {
        // Write empty placeholder
        fs::write(&tokens_dst, "/* Design system tokens — generate via Architecture phase */\n")
            .map_err(|e| format!("Failed to write tokens.css placeholder: {}", e))?;
    }

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

    // Spawn Vite dev server
    let mut cmd = Command::new("npx");
    cmd.arg("vite")
        .arg("--port")
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

    // Wait for Vite to be ready (look for "Local:" in output)
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
    let ready_tx = Arc::new(Mutex::new(Some(ready_tx)));

    let ready_tx_clone = ready_tx.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.contains("Local:") || line.contains("localhost") {
                        let mut tx = ready_tx_clone.lock().await;
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
    let mut child_lock = state.child.lock().await;
    if let Some(ref mut child) = *child_lock {
        child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill Vite process: {}", e))?;
    }
    *child_lock = None;
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
