use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize, Default)]
pub struct Prefs {
    pub workspace: Option<String>,
    /// Per-provider API credentials, keyed by provider id (e.g. "modelslab").
    #[serde(default)]
    pub credentials: HashMap<String, String>,
    /// Currently active AI provider id. One provider is active at a time.
    #[serde(default)]
    pub active_provider: Option<String>,
    /// Legacy single-key field. Migrated into `credentials` on read, then dropped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modelslab_api_key: Option<String>,
}

impl Prefs {
    /// API key for a provider, if one is stored and non-empty.
    pub fn provider_key(&self, provider: &str) -> Option<String> {
        self.credentials
            .get(provider)
            .cloned()
            .filter(|k| !k.is_empty())
    }

    /// Fold the legacy `modelslab_api_key` into the credential map so older
    /// prefs files keep working. Runs on every read; the legacy field is then
    /// dropped on the next write.
    fn migrate(&mut self) {
        if let Some(key) = self.modelslab_api_key.take() {
            if !key.is_empty() {
                self.credentials
                    .entry("modelslab".to_string())
                    .or_insert(key);
            }
        }
    }
}

pub fn prefs_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("prefs.json")
}

pub fn read_prefs(app: &tauri::AppHandle) -> Prefs {
    let path = prefs_path(app);
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Prefs::default();
    };
    let mut prefs: Prefs = serde_json::from_str(&content).unwrap_or_default();
    prefs.migrate();
    prefs
}

pub fn write_prefs(app: &tauri::AppHandle, prefs: &Prefs) -> Result<(), String> {
    let path = prefs_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}
