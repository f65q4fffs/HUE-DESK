use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::storage::{self, HueConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingProgress {
    pub status: String,
    pub seconds_left: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingSuccess {
    pub bridge_ip: String,
    pub username: String,
    pub client_key: Option<String>,
}

#[derive(Deserialize)]
struct HueApiResponseItem {
    success: Option<HueSuccessPayload>,
    error: Option<HueErrorPayload>,
}

#[derive(Deserialize)]
struct HueSuccessPayload {
    username: String,
    clientkey: Option<String>,
}

#[derive(Deserialize)]
struct HueErrorPayload {
    #[serde(rename = "type")]
    error_type: u32,
    description: String,
}

/// Exécute la procédure d'appairage CLIP v2 avec polling de 30 secondes
pub async fn pair_with_bridge(
    app: &AppHandle,
    bridge_ip: &str,
) -> Result<PairingSuccess> {
    let clean_ip = bridge_ip.trim();
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .build()
        .context("Échec de création du client HTTP pour l'appairage")?;

    let url = format!("https://{}/api", clean_ip);
    let payload = serde_json::json!({
        "devicetype": "hue_desktop#user",
        "generateclientkey": true
    });

    let max_attempts = 15;
    let poll_interval = Duration::from_secs(2);

    for attempt in 0..max_attempts {
        let seconds_left = (max_attempts - attempt) * 2;

        let response = client
            .post(&url)
            .json(&payload)
            .send()
            .await;

        match response {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    return Err(anyhow!("Le pont a répondu avec le statut HTTP {}", status));
                }

                let items: Vec<HueApiResponseItem> = resp
                    .json()
                    .await
                    .context("Réponse JSON inattendue du pont Philips Hue")?;

                if let Some(item) = items.first() {
                    // Cas 1 : Succès (bouton pressé)
                    if let Some(success) = &item.success {
                        let result = PairingSuccess {
                            bridge_ip: clean_ip.to_string(),
                            username: success.username.clone(),
                            client_key: success.clientkey.clone(),
                        };

                        // Sauvegarde immédiate dans la configuration locale (%APPDATA%)
                        let new_config = HueConfig {
                            bridge_ip: Some(result.bridge_ip.clone()),
                            username: Some(result.username.clone()),
                            client_key: result.client_key.clone(),
                        };
                        storage::save_config(app, &new_config)
                            .context("Échec de la sauvegarde des identifiants dans la configuration")?;

                        // Émission de l'événement de réussite
                        let _ = app.emit(
                            "hue-pairing-status",
                            PairingProgress {
                                status: "success".to_string(),
                                seconds_left: 0,
                                message: "Appairage réussi avec le pont Philips Hue !".to_string(),
                            },
                        );

                        return Ok(result);
                    }

                    // Cas 2 : Erreur type 101 ("link button not pressed")
                    if let Some(err) = &item.error {
                        if err.error_type == 101 {
                            let _ = app.emit(
                                "hue-pairing-status",
                                PairingProgress {
                                    status: "waiting_link_button".to_string(),
                                    seconds_left,
                                    message: format!(
                                        "Appuyez sur le gros bouton rond du pont Hue ({seconds_left}s restantes)..."
                                    ),
                                },
                            );
                        } else {
                            return Err(anyhow!("Erreur Hue API (code {}): {}", err.error_type, err.description));
                        }
                    }
                }
            }
            Err(e) => {
                // Erreur de connexion réseau transitoire
                let _ = app.emit(
                    "hue-pairing-status",
                    PairingProgress {
                        status: "waiting_connection".to_string(),
                        seconds_left,
                        message: format!("Tentative de communication avec {}...", clean_ip),
                    },
                );
                eprintln!("[Hue Auth] Erreur réseau transitoire: {}", e);
            }
        }

        tokio::time::sleep(poll_interval).await;
    }

    // Cas 3 : Dépassement du délai de 30 secondes
    let _ = app.emit(
        "hue-pairing-status",
        PairingProgress {
            status: "timeout".to_string(),
            seconds_left: 0,
            message: "Délai d'attente dépassé (30s). Le bouton du pont n'a pas été pressé.".to_string(),
        },
    );

    Err(anyhow!(
        "Délai d'attente dépassé (30s) : le bouton d'association du pont n'a pas été pressé à temps."
    ))
}
