pub mod auth;
pub mod client;
pub mod color;
pub mod discovery;
pub mod sse;
pub mod storage;

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::sync::{Mutex, RwLock};

pub use auth::PairingSuccess;
pub use client::{LightResource, RoomResource};
pub use discovery::DiscoveredBridge;
pub use storage::HueConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub is_configured: bool,
    pub bridge_ip: Option<String>,
    pub username: Option<String>,
    pub has_client_key: bool,
}

pub struct HueState {
    pub config: RwLock<HueConfig>,
    pub sse_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl HueState {
    pub fn new(config: HueConfig) -> Self {
        Self {
            config: RwLock::new(config),
            sse_handle: Mutex::new(None),
        }
    }

    pub async fn get_client(&self) -> Result<client::HueClient, String> {
        let guard = self.config.read().await;
        let ip = guard
            .bridge_ip
            .as_ref()
            .ok_or_else(|| "Pont non configuré : IP introuvable.".to_string())?;
        let username = guard
            .username
            .as_ref()
            .ok_or_else(|| "Pont non authentifié : Clé applicative introuvable.".to_string())?;

        client::HueClient::new(ip, username).map_err(|e| e.to_string())
    }

    pub async fn restart_sse(&self, app: AppHandle, bridge_ip: String, username: String) {
        let mut handle_guard = self.sse_handle.lock().await;
        if let Some(handle) = handle_guard.take() {
            handle.abort();
        }
        let new_handle = sse::start_sse_worker(app, bridge_ip, username);
        *handle_guard = Some(new_handle);
    }
}

/// Commande Tauri : Recherche automatique des ponts Hue sur le réseau local via mDNS
#[tauri::command]
pub async fn discover_bridge() -> Result<Vec<DiscoveredBridge>, String> {
    discovery::discover_bridges(Duration::from_secs(4))
        .await
        .map_err(|e| format!("Erreur lors de la découverte mDNS : {}", e))
}

/// Commande Tauri : Vérification d'une adresse IP saisie manuellement
#[tauri::command]
pub async fn verify_manual_ip(ip: String) -> Result<DiscoveredBridge, String> {
    discovery::verify_manual_ip(&ip)
        .await
        .map_err(|e| format!("Vérification manuelle échouée : {}", e))
}

/// Commande Tauri : Déclenchement de l'appairage avec polling sur le bouton du pont
#[tauri::command]
pub async fn start_pairing(
    app: AppHandle,
    state: State<'_, HueState>,
    ip: String,
) -> Result<PairingSuccess, String> {
    let result = auth::pair_with_bridge(&app, &ip)
        .await
        .map_err(|e| format!("Échec de l'appairage : {}", e))?;

    // Mise à jour de l'état en mémoire
    {
        let mut config_guard = state.config.write().await;
        config_guard.bridge_ip = Some(result.bridge_ip.clone());
        config_guard.username = Some(result.username.clone());
        config_guard.client_key = result.client_key.clone();
    }

    // Démarrage automatique du flux temps réel SSE
    state
        .restart_sse(app, result.bridge_ip.clone(), result.username.clone())
        .await;

    Ok(result)
}

/// Commande Tauri : Récupération de l'état actuel de connexion et de configuration
#[tauri::command]
pub async fn get_connection_status(
    app: AppHandle,
    state: State<'_, HueState>,
) -> Result<ConnectionStatus, String> {
    let mut config_guard = state.config.write().await;
    if config_guard.username.is_none() {
        if let Ok(loaded) = storage::load_config(&app) {
            *config_guard = loaded;
        }
    }

    let is_configured = config_guard.username.is_some() && config_guard.bridge_ip.is_some();
    let has_client_key = config_guard.client_key.is_some();

    Ok(ConnectionStatus {
        is_configured,
        bridge_ip: config_guard.bridge_ip.clone(),
        username: config_guard.username.clone(),
        has_client_key,
    })
}

/// Commande Tauri : Récupère la liste de toutes les pièces et zones
#[tauri::command]
pub async fn get_rooms(state: State<'_, HueState>) -> Result<Vec<client::RoomResource>, String> {
    let client = state.get_client().await?;
    client.get_rooms().await.map_err(|e| e.to_string())
}

/// Commande Tauri : Récupère la liste de toutes les lumières
#[tauri::command]
pub async fn get_lights(state: State<'_, HueState>) -> Result<Vec<client::LightResource>, String> {
    let client = state.get_client().await?;
    client.get_lights().await.map_err(|e| e.to_string())
}

/// Commande Tauri : Allume ou éteint une lumière spécifique
#[tauri::command]
pub async fn toggle_light(
    state: State<'_, HueState>,
    light_id: String,
    on: bool,
) -> Result<(), String> {
    let client = state.get_client().await?;
    let payload = client::LightUpdatePayload {
        on: Some(client::OnState { on }),
        ..Default::default()
    };
    client
        .update_light(&light_id, &payload)
        .await
        .map_err(|e| e.to_string())
}

/// Commande Tauri : Définit la luminosité d'une lumière (0.0 à 100.0 %)
#[tauri::command]
pub async fn set_brightness(
    state: State<'_, HueState>,
    light_id: String,
    brightness: f32,
) -> Result<(), String> {
    let client = state.get_client().await?;
    let clamped_brightness = brightness.clamp(0.0, 100.0);
    let payload = client::LightUpdatePayload {
        on: Some(client::OnState { on: true }),
        dimming: Some(client::DimmingState {
            brightness: clamped_brightness,
        }),
        ..Default::default()
    };
    client
        .update_light(&light_id, &payload)
        .await
        .map_err(|e| e.to_string())
}

/// Commande Tauri : Définit la couleur d'une lumière via code hexadécimal (#RRGGBB)
#[tauri::command]
pub async fn set_color(
    state: State<'_, HueState>,
    light_id: String,
    hex_color: String,
) -> Result<(), String> {
    let (x, y) = color::hex_to_cie_xy(&hex_color).map_err(|e| e.to_string())?;
    let client = state.get_client().await?;
    let payload = client::LightUpdatePayload {
        on: Some(client::OnState { on: true }),
        color: Some(client::ColorState {
            xy: client::XyColor { x, y },
        }),
        ..Default::default()
    };
    client
        .update_light(&light_id, &payload)
        .await
        .map_err(|e| e.to_string())
}

/// Commande Tauri : Définit la température de couleur (153 mireks = froid, 500 mireks = chaud)
#[tauri::command]
pub async fn set_color_temperature(
    state: State<'_, HueState>,
    light_id: String,
    mirek: u32,
) -> Result<(), String> {
    let client = state.get_client().await?;
    let clamped_mirek = mirek.clamp(153, 500);
    let payload = client::LightUpdatePayload {
        on: Some(client::OnState { on: true }),
        color_temperature: Some(client::ColorTemperatureState {
            mirek: Some(clamped_mirek),
        }),
        ..Default::default()
    };
    client
        .update_light(&light_id, &payload)
        .await
        .map_err(|e| e.to_string())
}

/// Commande Tauri : Allume ou éteint l'ensemble d'une pièce en une seule opération
#[tauri::command]
pub async fn toggle_room(
    state: State<'_, HueState>,
    room_id: String,
    on: bool,
) -> Result<(), String> {
    let client = state.get_client().await?;
    let rooms = client.get_rooms().await.map_err(|e| e.to_string())?;

    let room = rooms
        .into_iter()
        .find(|r| r.id == room_id)
        .ok_or_else(|| format!("Pièce introuvable avec l'ID {}", room_id))?;

    let grouped_service = room
        .services
        .into_iter()
        .find(|s| s.rtype == "grouped_light")
        .ok_or_else(|| "Service grouped_light introuvable pour cette pièce".to_string())?;

    client
        .update_grouped_light(&grouped_service.rid, on)
        .await
        .map_err(|e| e.to_string())
}
