# CONTEXTE PROJET — Hue Desk (Tauri v2 / Rust / Vanilla JS)

## STACK & ARCHITECTURE
- **Desktop / Backend** : Tauri v2 (`tauri = "2"`), Rust 2021 (`x86_64-pc-windows-msvc`), Tokio `v1` (`full`), Reqwest `v0.12` (`rustls-tls`), CPAL `v0.15` (WASAPI Loopback), RustFFT `v6.2`, mDNS-SD `v0.13`.
- **Frontend** : WebView2 Evergreen, Vanilla JS (ES2022+), Vanilla CSS3, HTML5 Canvas 2D. **Zéro bundler Node.js**, zéro TypeScript, zéro framework UI.
- **API & Stockage** : Philips Hue CLIP v2 REST & SSE (`/eventstream/clip/v2`) en HTTPS local auto-signé. Persistance JSON dans `%APPDATA%/com.huelight.controller/`.

## ARBORESCENCE CLÉ
- `src-tauri/src/` : Entrée desktop (`main.rs`, `lib.rs`) et System Tray.
- `src-tauri/src/hue/` : Logique Hue (`client.rs`, `auth.rs`, `discovery.rs`, `color.rs`, `sse.rs`, `storage.rs`, `profiles.rs`).
- `src-tauri/src/audio/` : Capture audio WASAPI et FFT temps réel (`mod.rs`).
- `ui/` : Frontend statique servi directement par Tauri (`index.html`, `main.js`, `style.css`).

## ROUTEUR DES RÈGLES (`.rules/`)
- **UI, CSS, Modales & Canvas** → Lire `.rules/ui-styling.md`
- **State JS/Rust, IPC, Hue CLIP v2 & Audio DSP** → Lire `.rules/state-data.md`
- **Commandes machine, Build & Interdictions critiques** → Lire `.rules/workflow-rules.md`

## PROTOCOLE D'AUTO-MAINTENANCE
Avant chaque tâche, lis la fiche `.rules/` correspondante. Si tu découvres une convention non documentée, un bug récurrent ou une nouvelle brique technique, mets à jour toi-même la fiche concernée ou crée un nouveau fichier dans `.rules/` en l'enregistrant dans le routeur `CONTEXT.md`.