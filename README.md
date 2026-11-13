<div align="center">
  <img src="docs/assets/logo.svg" alt="HueDesk Logo" width="96" height="96" />
  <h1>HueDesk</h1>
  <p><strong>Contrôleur de bureau ultra-léger, rapide et élégant pour vos éclairages Philips Hue.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri&logoColor=white" alt="Tauri v2" />
    <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/Philips%20Hue-CLIP%20v2-blueviolet" alt="Philips Hue CLIP v2" />
    <img src="https://img.shields.io/badge/Architecture-100%25%20Local-success" alt="100% Local" />
    <img src="https://img.shields.io/badge/RAM-%3C%2040%20Mo-brightgreen" alt="Empreinte mémoire" />
    <img src="https://img.shields.io/badge/Typographie-Inter%20(Local)-informational" alt="Inter Local Font" />
  </p>
</div>

---

## 💡 À propos

**HueDesk** est une application desktop moderne conçue avec **Tauri v2** et **Rust**, offrant un contrôle instantané de vos luminaires Philips Hue sur votre réseau local.

Contrairement aux applications lourdes basées sur Electron (qui consomment souvent plus de 300 Mo de mémoire vive), HueDesk fonctionne en tâche de fond avec une empreinte mémoire inférieure à **40 Mo de RAM**, tout en offrant une interface soignée inspirée des standards de design **macOS Sonoma** et des **Apple Human Interface Guidelines (HIG)**.

### 🌟 Points forts
* **100% Local & Privé** : Toutes les requêtes transitent directement via l'API locale sécurisée CLIP v2 de votre pont Hue. Zéro cloud, zéro latence, zéro collecte de données.
* **Mini-Widget System Tray (Accès Rapide)** : Un flyout compact accessible d'un clic droit sur l'icône de notification Windows pour éteindre, allumer ou changer de profil sans jamais interrompre votre travail.
* **Synchronisation temps réel SSE** : Écoute du flux Server-Sent Events (`/eventstream/clip/v2`) pour refléter immédiatement les changements d'état faits depuis vos télécommandes ou votre smartphone.
* **Audio Visualizer WASAPI** : Analyse spectrale FFT en temps réel du flux audio système Windows (boucle loopback) pour faire vibrer vos ampoules au rythme de la musique sur une palette ambre et or harmonisée.
* **Typographie & Design soigné** : Police **Inter** intégrée localement, curseurs dynamiques façon Apple Glass, fenêtres borderless arrondies sans cadre parasite, et navigation complète au clavier.

---

## 📸 Aperçu de l'interface

### Vue d'ensemble — Fenêtre principale et Mini-Widget Tray
<div align="center">
  <img src="docs/assets/overview.jpg" alt="HueDesk Vue d'ensemble" width="95%" style="border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,0.5);" />
</div>

<br/>

### 1. Tableau de bord — Pièces & Lampes
Contrôle unifié par pièce ou granulaire par luminaire (Interrupteurs Apple instantanés, réglette de luminosité dynamique ambre/or, température de blanc de 2000K à 6500K et nuancier RGB).

<div align="center">
  <img src="docs/assets/dashboard.jpg" alt="Tableau de bord Pièces et Lampes" width="85%" style="border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />
</div>

<br/>

### 2. Mini-Widget System Tray (Accès Rapide)
Accessible immédiatement depuis la barre des tâches Windows (clic droit sur l'icône) avec fermeture automatique dès la perte de focus. Permet d'allumer/éteindre rapidement, d'activer le mode Nuit, de doser la luminosité d'une pièce ou d'appliquer vos profils d'ambiance en une fraction de seconde.

<div align="center">
  <img src="docs/assets/tray_quick_access.jpg" alt="Widget Flyout System Tray" width="360" style="border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.55);" />
</div>

<br/>

### 3. Profils & Ambiances personnalisées
Enregistrez l'ambiance lumineuse actuelle de votre pièce en un clic ou appliquez instantanément vos scènes sauvegardées (*Code & Focus*, *Cinéma & Gaming*, *Soirée & Chill*, *Nuit*).

<div align="center">
  <img src="docs/assets/profiles.jpg" alt="Profils et Ambiances" width="85%" style="border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />
</div>

<br/>

### 4. Audio Visualizer (Réactivité sonore temps réel)
Transformez vos luminaires en visualiseur dynamique synchronisé avec n'importe quelle source sonore de votre ordinateur (Spotify, YouTube, jeux vidéo) avec analyse spectrale 24 bandes et détection dynamique des basses.

<div align="center">
  <img src="docs/assets/audio_visualizer.jpg" alt="Audio Visualizer" width="85%" style="border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />
</div>

---

## 🚀 Guide d'utilisation

### 1. Premier démarrage & Appairage automatique
1. Lancez **HueDesk** (via le raccourci sur votre Bureau ou votre barre des tâches). L'application s'ouvre directement comme une vraie application native Windows sans terminal console.
2. HueDesk utilise le protocole mDNS pour détecter automatiquement les ponts Philips Hue sur votre réseau local.
3. Lorsque votre pont apparaît, appuyez sur le bouton physique rond situé sur le dessus de votre **Philips Hue Bridge**.
4. Cliquez sur **« Associer »** dans HueDesk : l'application génère et enregistre votre clé d'accès locale chiffrée. Vos pièces et luminaires se chargent instantanément !

### 2. Le System Tray (Barre des tâches)
* **Clic gauche sur l'icône de notification** : Ouvre ou remet la fenêtre principale au premier plan.
* **Clic droit sur l'icône de notification** : Déploie le mini-widget **Quick Access** au-dessus de la barre des tâches.
* **Perte de focus** : Cliquer n'importe où ailleurs ferme discrètement le flyout pour ne pas encombrer votre écran.
* **Fermeture de la fenêtre principale** : Minimise automatiquement dans le System Tray sans interrompre la synchronisation SSE ni le visualiseur audio.

### 3. Contrôle des éclairages
* **Raccourcis rapides** : Cliquez sur *Tout Allumer*, *Tout Éteindre* ou *Mode Nuit* depuis la barre d'accès rapide.
* **Régler une pièce complète** : Ajustez la réglette *Tout régler* pour uniformiser la luminosité de toutes les lampes de la pièce d'un seul geste.
* **Contrôle individuel** :
  * Cliquez sur la pastille circulaire pour changer la couleur (nuancier avec prévisualisation en direct).
  * Faites un **clic droit** sur une vignette pour ouvrir le menu contextuel rapide (Allumer/Éteindre, Éditer la couleur, Renommer).
  * Cliquez sur la petite icône crayon pour renommer immédiatement votre luminaire.

### 4. Profils d'ambiance
1. Basculez sur l'onglet **« Profils & Ambiances »**.
2. Configurez vos lumières comme vous le souhaitez, puis cliquez sur **« Enregistrer l'état actuel »**.
3. Donnez un nom à votre profil (ex: *Focus Code*, *Détente Lecture*) et choisissez une icône.
4. Cliquez sur un profil pour restaurer instantanément l'état exact de chaque lampe.

### 5. Audio Visualizer
1. Rendez-vous dans l'onglet **« Audio Visualizer »**.
2. Choisissez la source de capture audio et sélectionnez la palette chromatique désirée.
3. Sélectionnez les luminaires participants et activez l'écoute pour voir vos lumières réagir en temps réel aux basses et aux rythmes musicaux.

### 6. Accessibilité et raccourcis clavier
* **Navigation fluide** : Touche <kbd>Tab</kbd> pour parcourir les contrôles avec anneau de focus haute visibilité (Apple HIG).
* **Basculer l'état** : Touche <kbd>Espace</kbd> sur un luminaire pour l'allumer ou l'éteindre.
* **Appliquer un profil** : Touches <kbd>Entrée</kbd> ou <kbd>Espace</kbd> sur une carte de profil.
* **Réduction de mouvement** : Prise en charge native du réglage système Windows/macOS `prefers-reduced-motion`.

---

## 🛠️ Architecture Technique

HueDesk est conçu pour une efficacité maximale sans fioritures :

| Composant | Technologie | Description |
| :--- | :--- | :--- |
| **Backend** | Rust 2021 + Tauri v2 | Gestion système, sous-système Windows GUI pur, requêtes HTTP/SSE asynchrones Tokio. |
| **System Tray** | Tauri TrayIcon + Win32 | Flyout dynamique positionné au-dessus de la barre des tâches avec masquage sur `blur`. |
| **DSP Audio** | CPAL + RustFFT | Capture audio native sans latence (WASAPI Loopback) et transformée de Fourier rapide. |
| **Frontend** | Vanilla JS + CSS3 + Canvas | Zéro bundler, zéro runtime Node.js embarqué, rendu ultra-léger via WebView2. |
| **Typographie** | Inter (WOFF2 local) | Polices embarquées dans l'application, aucun appel externe Google CDN. |
| **Réseau** | mDNS + Reqwest | Détection automatique zéro-configuration et communication locale sécurisée CLIP v2. |
| **Stockage** | JSON Local | Configuration chiffrée stockée dans `%APPDATA%\com.huelight.controller\hue_config.json`. |

---

## 💻 Installation & Compilation pour Développeurs

### Prérequis
* [Rust](https://www.rust-lang.org/) (version 1.75+ recommandée avec `cargo`).
* Windows 10/11 avec runtime [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (inclus par défaut).

### Démarrage en mode développement
Clonez le dépôt et lancez l'application :

```bash
# Cloner le projet
git clone https://github.com/f65q4fffs/HUE-DESK.git
cd "hue light projet"

# Lancement rapide ou compilation debug
cargo build --manifest-path src-tauri/Cargo.toml
```

Ou directement avec l'outillage Tauri :

```bash
cargo tauri dev
```

### Génération du package d'installation (Release)
Pour compiler un exécutable optimisé autonome :

```bash
cargo tauri build
```
L'exécutable et l'installeur `.msi` / `.exe` seront générés dans `src-tauri/target/release/bundle/`.

---

## 🔒 Sécurité & Vie Privée

* Aucune communication vers des serveurs tiers ou des services cloud.
* Les identifiants du pont (nom d'utilisateur généré, clé client) sont enregistrés exclusivement en local dans votre dossier utilisateur applicatif sécurisé et sont automatiquement exclus du suivi Git.
* Le dépôt contient des règles strictes d'audit pré-push pour garantir l'absence de fuite d'informations d'infrastructure privée.

---

## 📄 Licence

Ce projet est distribué sous licence MIT. Libre à vous de l'utiliser, l'adapter et l'enrichir.
