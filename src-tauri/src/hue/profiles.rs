use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use super::client::{ColorState, DimmingState, LightUpdatePayload, OnState, XyColor};
use super::HueState;

const PROFILES_FILE: &str = "profiles.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileLightState {
    pub light_id: String,
    pub on: bool,
    pub brightness: Option<f32>,
    pub color_xy: Option<(f32, f32)>,
    pub color_temp_mirek: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub is_active: bool,
    pub gradient: Option<String>,
    pub targets: Vec<ProfileLightState>,
}

fn get_profiles_path(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .context("Impossible de déterminer le répertoire app_data_dir")?;

    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .context("Échec de la création du dossier de données utilisateur")?;
    }

    Ok(data_dir.join(PROFILES_FILE))
}

fn get_default_profiles() -> Vec<Profile> {
    vec![
        Profile {
            id: "preset-code-focus".to_string(),
            name: "Code & Focus".to_string(),
            icon: "💻".to_string(),
            is_active: false,
            gradient: Some("linear-gradient(135deg, #0284c7, #2563eb, #38bdf8)".to_string()),
            targets: vec![],
        },
        Profile {
            id: "preset-cinema-gaming".to_string(),
            name: "Cinéma & Gaming".to_string(),
            icon: "🎬".to_string(),
            is_active: false,
            gradient: Some("linear-gradient(135deg, #581c87, #7c3aed, #ec4899)".to_string()),
            targets: vec![],
        },
        Profile {
            id: "preset-soiree-chill".to_string(),
            name: "Soirée & Chill".to_string(),
            icon: "🍷".to_string(),
            is_active: false,
            gradient: Some("linear-gradient(135deg, #7c2d12, #d97706, #fbbf24)".to_string()),
            targets: vec![],
        },
    ]
}

pub fn load_profiles_from_disk(app: &AppHandle) -> Result<Vec<Profile>> {
    let path = get_profiles_path(app)?;
    if !path.exists() {
        let defaults = get_default_profiles();
        let serialized = serde_json::to_string_pretty(&defaults)?;
        let _ = fs::write(&path, serialized);
        return Ok(defaults);
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Lecture échouée du fichier {:?}", path))?;
    let profiles: Vec<Profile> = serde_json::from_str(&content)
        .unwrap_or_else(|_| get_default_profiles());

    Ok(profiles)
}

pub fn save_profiles_to_disk(app: &AppHandle, profiles: &[Profile]) -> Result<()> {
    let path = get_profiles_path(app)?;
    let serialized = serde_json::to_string_pretty(profiles)
        .context("Sérialisation JSON des profils échouée")?;
    fs::write(&path, serialized)
        .with_context(|| format!("Écriture échouée dans {:?}", path))?;
    Ok(())
}

/// Commande Tauri : Récupère la liste de tous les profils enregistrés
#[tauri::command]
pub async fn get_profiles(app: AppHandle) -> Result<Vec<Profile>, String> {
    load_profiles_from_disk(&app).map_err(|e| e.to_string())
}

/// Commande Tauri : Sauvegarde ou met à jour un profil
#[tauri::command]
pub async fn save_profile(app: AppHandle, profile: Profile) -> Result<(), String> {
    let mut profiles = load_profiles_from_disk(&app).map_err(|e| e.to_string())?;
    if let Some(idx) = profiles.iter().position(|p| p.id == profile.id) {
        profiles[idx] = profile;
    } else {
        profiles.push(profile);
    }
    save_profiles_to_disk(&app, &profiles).map_err(|e| e.to_string())
}

/// Commande Tauri : Supprime un profil
#[tauri::command]
pub async fn delete_profile(app: AppHandle, id: String) -> Result<(), String> {
    let mut profiles = load_profiles_from_disk(&app).map_err(|e| e.to_string())?;
    profiles.retain(|p| p.id != id);
    save_profiles_to_disk(&app, &profiles).map_err(|e| e.to_string())
}

/// Commande Tauri : Capture l'état instantané de toutes les lampes allumées pour créer un profil
#[tauri::command]
pub async fn capture_current_profile(
    app: AppHandle,
    state: State<'_, HueState>,
    name: String,
    icon: String,
    gradient: Option<String>,
) -> Result<Profile, String> {
    let client = state.get_client().await?;
    let lights = client.get_lights().await.map_err(|e| e.to_string())?;

    let targets: Vec<ProfileLightState> = lights
        .into_iter()
        .map(|l| {
            let is_on = l.on.as_ref().map(|o| o.on).unwrap_or(false);
            let brightness = l.dimming.as_ref().map(|d| d.brightness);
            let color_xy = l.color.as_ref().map(|c| (c.xy.x, c.xy.y));
            let color_temp_mirek = l.color_temperature.as_ref().and_then(|ct| ct.mirek);

            ProfileLightState {
                light_id: l.id,
                on: is_on,
                brightness,
                color_xy,
                color_temp_mirek,
            }
        })
        .collect();

    let new_profile = Profile {
        id: format!("profile-{}", uuid_simple()),
        name,
        icon,
        is_active: true,
        gradient: gradient.or_else(|| Some("linear-gradient(135deg, #3b82f6, #8b5cf6)".to_string())),
        targets,
    };

    let _ = save_profile(app, new_profile.clone()).await;
    Ok(new_profile)
}

/// Commande Tauri : Applique un profil en un clic en exécutant toutes les requêtes en parallèle
#[tauri::command]
pub async fn apply_profile(
    app: AppHandle,
    state: State<'_, HueState>,
    id: String,
) -> Result<(), String> {
    let mut profiles = load_profiles_from_disk(&app).map_err(|e| e.to_string())?;
    let target_profile = profiles
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| format!("Profil introuvable avec l'ID {}", id))?;

    let client = state.get_client().await?;
    let mut set = tokio::task::JoinSet::new();

    // Si le profil cible a des cibles spécifiques
    if !target_profile.targets.is_empty() {
        for target in target_profile.targets {
            let client_clone = client.clone();
            set.spawn(async move {
                let payload = LightUpdatePayload {
                    on: Some(OnState { on: target.on }),
                    dimming: target.brightness.map(|b| DimmingState { brightness: b }),
                    color: target.color_xy.map(|(x, y)| ColorState {
                        xy: XyColor { x, y },
                    }),
                    color_temperature: target.color_temp_mirek.map(|m| super::client::ColorTemperatureState {
                        mirek: Some(m),
                    }),
                    ..Default::default()
                };
                let _ = client_clone.update_light(&target.light_id, &payload).await;
            });
        }
    } else {
        // Profils pré-intégrés génériques appliqués à toutes les lumières disponibles
        let lights = client.get_lights().await.map_err(|e| e.to_string())?;
        for l in lights {
            let client_clone = client.clone();
            let pid = target_profile.id.clone();
            set.spawn(async move {
                let payload = match pid.as_str() {
                    "preset-code-focus" => LightUpdatePayload {
                        on: Some(OnState { on: true }),
                        dimming: Some(DimmingState { brightness: 100.0 }),
                        color_temperature: Some(super::client::ColorTemperatureState { mirek: Some(166) }), // 6000K froid
                        ..Default::default()
                    },
                    "preset-cinema-gaming" => LightUpdatePayload {
                        on: Some(OnState { on: true }),
                        dimming: Some(DimmingState { brightness: 35.0 }),
                        color: Some(ColorState {
                            xy: XyColor { x: 0.22, y: 0.12 }, // Bleu / pourpre sombre
                        }),
                        ..Default::default()
                    },
                    "preset-soiree-chill" => LightUpdatePayload {
                        on: Some(OnState { on: true }),
                        dimming: Some(DimmingState { brightness: 55.0 }),
                        color_temperature: Some(super::client::ColorTemperatureState { mirek: Some(454) }), // 2200K ambre
                        ..Default::default()
                    },
                    _ => LightUpdatePayload {
                        on: Some(OnState { on: true }),
                        dimming: Some(DimmingState { brightness: 80.0 }),
                        ..Default::default()
                    },
                };
                let _ = client_clone.update_light(&l.id, &payload).await;
            });
        }
    }

    while let Some(_) = set.join_next().await {}

    // Marquer ce profil comme actif et les autres comme inactifs
    for p in &mut profiles {
        p.is_active = p.id == id;
    }
    let _ = save_profiles_to_disk(&app, &profiles);

    Ok(())
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{:x}", millis)
}
