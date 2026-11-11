use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Démarre le worker d'écoute SSE en tâche de fond avec reconnexion automatique
pub fn start_sse_worker(
    app: AppHandle,
    bridge_ip: String,
    username: String,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut backoff = Duration::from_secs(1);

        loop {
            println!(
                "[Hue SSE] Connexion au flux d'événements temps réel sur https://{}/eventstream/clip/v2...",
                bridge_ip
            );

            match listen_eventstream(&app, &bridge_ip, &username).await {
                Ok(_) => {
                    // Connexion fermée normalement, réinitialisation du backoff
                    backoff = Duration::from_secs(1);
                }
                Err(e) => {
                    eprintln!(
                        "[Hue SSE] Perte du flux d'événements : {}. Nouvelle tentative dans {}s...",
                        e,
                        backoff.as_secs()
                    );
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(Duration::from_secs(30));
                }
            }
        }
    })
}

async fn listen_eventstream(app: &AppHandle, bridge_ip: &str, username: &str) -> Result<()> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "hue-application-key",
        HeaderValue::from_str(username)
            .context("Nom d'utilisateur invalide pour le header SSE")?,
    );
    headers.insert(
        "Accept",
        HeaderValue::from_static("text/event-stream"),
    );

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .default_headers(headers)
        // Pas de timeout global pour un flux continu SSE
        .tcp_keepalive(Some(Duration::from_secs(15)))
        .build()
        .context("Échec d'instanciation du client SSE")?;

    let url = format!("https://{}/eventstream/clip/v2", bridge_ip.trim());
    let mut resp = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("Impossible de joindre le flux SSE sur {}", url))?;

    if !resp.status().is_success() {
        return Err(anyhow!("Le flux SSE a répondu avec le statut HTTP {}", resp.status()));
    }

    println!("[Hue SSE] Connecté au flux temps réel avec succès.");

    let mut buffer = String::new();

    // Lecture incrémentale des segments du flux
    while let Some(chunk) = resp.chunk().await.context("Erreur lors de la lecture d'un segment SSE")? {
        if let Ok(text) = std::str::from_utf8(&chunk) {
            buffer.push_str(text);

            // Traitement des paquets terminés par une double fin de ligne
            while let Some(pos) = buffer.find("\n\n") {
                let message = buffer[..pos].to_string();
                buffer.drain(..pos + 2);

                process_sse_message(app, &message);
            }
        }
    }

    Ok(())
}

fn process_sse_message(app: &AppHandle, message: &str) {
    for line in message.lines() {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("data:") {
            let json_str = stripped.trim();
            if json_str.is_empty() {
                continue;
            }

            match serde_json::from_str::<serde_json::Value>(json_str) {
                Ok(event_data) => {
                    // Émission de l'événement vers le frontend Tauri
                    if let Err(e) = app.emit("hue-state-changed", &event_data) {
                        eprintln!("[Hue SSE] Erreur lors de l'émission Tauri: {}", e);
                    }
                }
                Err(e) => {
                    eprintln!("[Hue SSE] Payload JSON invalide ignoré: {} | Données: {}", e, json_str);
                }
            }
        }
    }
}
