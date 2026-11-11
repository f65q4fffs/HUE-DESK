use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CONFIG_FILE_NAME: &str = "hue_config.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HueConfig {
    pub bridge_ip: Option<String>,
    pub username: Option<String>,
    pub client_key: Option<String>,
}

fn get_config_path(app: &AppHandle) -> Result<PathBuf> {
    let config_dir = app
        .path()
        .app_config_dir()
        .context("Impossible de déterminer le dossier de configuration utilisateur")?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .context("Échec de la création du dossier de configuration")?;
    }

    Ok(config_dir.join(CONFIG_FILE_NAME))
}

pub fn load_config(app: &AppHandle) -> Result<HueConfig> {
    let path = get_config_path(app)?;
    if !path.exists() {
        return Ok(HueConfig::default());
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Impossible de lire le fichier de configuration: {:?}", path))?;

    let config: HueConfig = serde_json::from_str(&content)
        .with_context(|| format!("Format de configuration JSON invalide dans {:?}", path))?;

    Ok(config)
}

pub fn save_config(app: &AppHandle, config: &HueConfig) -> Result<()> {
    let path = get_config_path(app)?;
    let serialized = serde_json::to_string_pretty(config)
        .context("Échec de la sérialisation de la configuration Hue")?;

    fs::write(&path, serialized)
        .with_context(|| format!("Impossible d'écrire la configuration dans {:?}", path))?;

    Ok(())
}
