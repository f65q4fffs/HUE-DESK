use anyhow::{anyhow, Context, Result};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::IpAddr;
use std::time::{Duration, Instant};

const HUE_SERVICE_TYPE: &str = "_hue._tcp.local.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredBridge {
    pub id: String,
    pub ip: String,
    pub port: u16,
    pub hostname: String,
}

/// Découverte automatique des ponts Philips Hue sur le réseau local via mDNS
pub async fn discover_bridges(scan_duration: Duration) -> Result<Vec<DiscoveredBridge>> {
    tokio::task::spawn_blocking(move || {
        let mdns = ServiceDaemon::new()
            .context("Échec d'initialisation du démon mDNS")?;

        let receiver = mdns
            .browse(HUE_SERVICE_TYPE)
            .context("Échec du démarrage de la recherche mDNS pour Philips Hue")?;

        let start = Instant::now();
        let mut discovered = Vec::new();
        let mut seen_ips = HashSet::new();

        while start.elapsed() < scan_duration {
            if let Ok(event) = receiver.recv_timeout(Duration::from_millis(200)) {
                if let ServiceEvent::ServiceResolved(info) = event {
                    let id = info
                        .get_property_val_str("bridgeid")
                        .unwrap_or_else(|| info.get_fullname())
                        .to_string();

                    let hostname = info.get_hostname().to_string();
                    let port = info.get_port();

                    // Priorité aux adresses IPv4
                    let ipv4_addrs = info.get_addresses_v4();
                    for ip in &ipv4_addrs {
                        let ip_str = ip.to_string();
                        if seen_ips.insert(ip_str.clone()) {
                            discovered.push(DiscoveredBridge {
                                id: id.clone(),
                                ip: ip_str,
                                port,
                                hostname: hostname.clone(),
                            });
                        }
                    }

                    // Si pas d'IPv4, tenter les adresses générales
                    if ipv4_addrs.is_empty() {
                        for ip in info.get_addresses() {
                            let ip_str = ip.to_string();
                            if seen_ips.insert(ip_str.clone()) {
                                discovered.push(DiscoveredBridge {
                                    id: id.clone(),
                                    ip: ip_str,
                                    port,
                                    hostname: hostname.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }

        let _ = mdns.stop_browse(HUE_SERVICE_TYPE);
        Ok(discovered)
    })
    .await
    .map_err(|e| anyhow!("Erreur de tâche concurrente: {}", e))?
}

/// Méthode de secours : vérification d'une adresse IP saisie manuellement
pub async fn verify_manual_ip(ip: &str) -> Result<DiscoveredBridge> {
    let clean_ip = ip.trim();
    if clean_ip.parse::<IpAddr>().is_err() {
        return Err(anyhow!("Format d'adresse IP invalide : '{}'", clean_ip));
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(4))
        .build()
        .context("Échec de création du client HTTP")?;

    let url = format!("https://{}/api/config", clean_ip);
    let resp = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("Impossible de joindre le pont Philips Hue sur https://{}/api/config", clean_ip))?;

    if !resp.status().is_success() {
        return Err(anyhow!("Le périphérique à l'adresse {} a renvoyé un statut HTTP {}", clean_ip, resp.status()));
    }

    #[derive(Deserialize)]
    struct HueBridgeConfig {
        name: Option<String>,
        bridgeid: Option<String>,
        modelid: Option<String>,
    }

    let config: HueBridgeConfig = resp.json().await
        .context("Réponse invalide reçue de l'IP indiquée (ce périphérique ne semble pas être un pont Hue)")?;

    let bridge_id = config.bridgeid.unwrap_or_else(|| "inconnu".to_string());
    let bridge_name = config.name.unwrap_or_else(|| format!("Pont Hue ({})", config.modelid.as_deref().unwrap_or("standard")));

    Ok(DiscoveredBridge {
        id: bridge_id,
        ip: clean_ip.to_string(),
        port: 443,
        hostname: bridge_name,
    })
}
