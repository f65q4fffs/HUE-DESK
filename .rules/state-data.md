# RÈGLES STATE, IPC, API HUE CLIP V2 & AUDIO DSP

## GESTION D'ÉTAT & IPC TAURI
- **Frontend (`ui/main.js`)** : État centralisé dans `appState` (`isConfigured`, `bridgeIp`, `rooms`, `lights: Map`, `profiles`). Variables/fonctions en `camelCase`, constantes en `UPPER_SNAKE_CASE`.
- **Pont IPC** : Appels via `window.__TAURI__.core.invoke` (mapping automatique `snake_case` Rust → `camelCase` JS, ex. `light_id` → `lightId`). Écoute temps réel via `window.__TAURI__.event.listen("hue-state-changed")`.
- **Sliders UI** : Toujours appliquer un debounce de `50-60 ms` sur les sliders avant d'invoquer le backend.
- **Backend (`src-tauri/src/`)** : État managé via `HueState` (`RwLock<HueConfig>`, `Mutex<Option<JoinHandle>>` pour SSE) et `AudioState` (`Arc<AtomicBool>`, canal `oneshot`). Fichiers/fonctions en `snake_case`, structs/enums en `CamelCase`.

## CONTRAINTES CRITIQUES API HUE & ZIGBEE
- **Sérialisation JSON CLIP v2** : Le pont Hue rejette tout champ `null`. Décorer OBLIGATOIREMENT tous les champs optionnels des payloads d'envoi avec `#[serde(skip_serializing_if = "Option::is_none")]`.
- **Rate Limiting Zigbee** : Le pont Hue sature au-delà de 10-15 req/s (`communication_error`). Toute boucle d'animation ou flux audio DSP (`src-tauri/src/audio/mod.rs`) DOIT être cadencé à `80-100 ms` minimum avec un seuil de variation (deadband).
- **Concurrence par lot** : Utiliser `tokio::task::JoinSet` pour appliquer des états sur plusieurs ampoules simultanément.
- **Persistance** : Fichiers JSON uniquement (`hue_config.json`, `profiles.json` dans `%APPDATA%/com.huelight.controller/`). Aucune base SQL/SQLite.

## PATTERN MODÈLE (Exécution concurrente par lot — `src-tauri/src/hue/profiles.rs`)
```rust
pub async fn apply_profile(app: AppHandle, state: State<'_, HueState>, id: String) -> Result<(), String> {
    let mut profiles = load_profiles_from_disk(&app).map_err(|e| e.to_string())?;
    let target_profile = profiles.iter().find(|p| p.id == id).cloned().ok_or_else(|| format!("Profil introuvable avec l'ID {}", id))?;
    let client = state.get_client().await?;
    let mut set = tokio::task::JoinSet::new();
    for target in target_profile.targets {
        let client_clone = client.clone();
        set.spawn(async move {
            let payload = LightUpdatePayload {
                on: Some(OnState { on: target.on }),
                dimming: target.brightness.map(|b| DimmingState { brightness: b }),
                color: target.color_xy.map(|(x, y)| ColorState { xy: XyColor { x, y } }),
                color_temperature: target.color_temp_mirek.map(|m| super::client::ColorTemperatureState { mirek: Some(m) }),
                ..Default::default()
            };
            let _ = client_clone.update_light(&target.light_id, &payload).await;
        });
    }
    while let Some(_) = set.join_next().await {}
    for p in &mut profiles { p.is_active = p.id == id; }
    let _ = save_profiles_to_disk(&app, &profiles);
    Ok(())
}
```
