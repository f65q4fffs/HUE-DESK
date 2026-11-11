use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceMetadata {
    pub name: String,
    pub archetype: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceIdentifier {
    pub rid: String,
    pub rtype: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnState {
    pub on: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DimmingState {
    pub brightness: f32, // 0.0 à 100.0 %
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorTemperatureState {
    pub mirek: Option<u32>, // 153 (froid) à 500 (chaud)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XyColor {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorState {
    pub xy: XyColor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightResource {
    pub id: String,
    pub id_v1: Option<String>,
    pub metadata: Option<ResourceMetadata>,
    pub on: Option<OnState>,
    pub dimming: Option<DimmingState>,
    pub color_temperature: Option<ColorTemperatureState>,
    pub color: Option<ColorState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomResource {
    pub id: String,
    pub metadata: ResourceMetadata,
    pub children: Vec<ResourceIdentifier>,
    pub services: Vec<ResourceIdentifier>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupedLightResource {
    pub id: String,
    pub on: Option<OnState>,
    pub dimming: Option<DimmingState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LightUpdatePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on: Option<OnState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimming: Option<DimmingState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_temperature: Option<ColorTemperatureState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<ColorState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupedLightUpdatePayload {
    pub on: OnState,
}

#[derive(Deserialize)]
struct ClipResponse<T> {
    pub data: Vec<T>,
    #[allow(dead_code)]
    pub errors: Option<Vec<serde_json::Value>>,
}

pub struct HueClient {
    client: reqwest::Client,
    base_url: String,
}

impl HueClient {
    pub fn new(bridge_ip: &str, username: &str) -> Result<Self> {
        let mut headers = HeaderMap::new();
        headers.insert(
            "hue-application-key",
            HeaderValue::from_str(username)
                .context("Nom d'utilisateur Hue invalide pour l'en-tête HTTP")?,
        );

        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .default_headers(headers)
            .timeout(Duration::from_secs(6))
            .build()
            .context("Échec d'initialisation du client HTTP CLIP v2")?;

        Ok(Self {
            client,
            base_url: format!("https://{}", bridge_ip.trim()),
        })
    }

    /// Récupère l'ensemble des pièces définies sur le pont
    pub async fn get_rooms(&self) -> Result<Vec<RoomResource>> {
        let url = format!("{}/clip/v2/resource/room", self.base_url);
        let resp = self.client.get(&url).send().await
            .with_context(|| format!("Échec de requête GET {}", url))?;

        if !resp.status().is_success() {
            return Err(anyhow!("Le pont a répondu avec l'erreur HTTP {}", resp.status()));
        }

        let body: ClipResponse<RoomResource> = resp.json().await
            .context("Désérialisation des pièces (rooms) échouée")?;

        Ok(body.data)
    }

    /// Récupère la liste et l'état de toutes les lumières du pont
    pub async fn get_lights(&self) -> Result<Vec<LightResource>> {
        let url = format!("{}/clip/v2/resource/light", self.base_url);
        let resp = self.client.get(&url).send().await
            .with_context(|| format!("Échec de requête GET {}", url))?;

        if !resp.status().is_success() {
            return Err(anyhow!("Le pont a répondu avec l'erreur HTTP {}", resp.status()));
        }

        let body: ClipResponse<LightResource> = resp.json().await
            .context("Désérialisation des lumières (lights) échouée")?;

        Ok(body.data)
    }

    /// Modifie l'état d'une lumière ciblée par son UUID CLIP v2
    pub async fn update_light(&self, light_id: &str, payload: &LightUpdatePayload) -> Result<()> {
        let url = format!("{}/clip/v2/resource/light/{}", self.base_url, light_id);
        let resp = self.client.put(&url).json(payload).send().await
            .with_context(|| format!("Échec de requête PUT {}", url))?;

        if !resp.status().is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Échec mise à jour lampe {}: {}", light_id, error_text));
        }

        Ok(())
    }

    /// Allume ou éteint un ensemble de lampes via son service grouped_light
    pub async fn update_grouped_light(&self, grouped_light_id: &str, on: bool) -> Result<()> {
        let url = format!("{}/clip/v2/resource/grouped_light/{}", self.base_url, grouped_light_id);
        let payload = GroupedLightUpdatePayload {
            on: OnState { on },
        };

        let resp = self.client.put(&url).json(&payload).send().await
            .with_context(|| format!("Échec de requête PUT {}", url))?;

        if !resp.status().is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Échec mise à jour groupe {}: {}", grouped_light_id, error_text));
        }

        Ok(())
    }
}
