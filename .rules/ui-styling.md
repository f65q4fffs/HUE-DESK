# RÈGLES UI, STYLING & INTERACTIONS (`ui/`)

## CONTRAINTES STRICTES
- **Zéro dépendance externe** : NE PAS installer Tailwind, React, Vue ou tout bundler (`npm`, `vite`, `webpack`). Tout est en Vanilla JS (ES2022+) et CSS3 pur dans `ui/`.
- **Design System** : Style Apple Home / Dark Glassmorphism (`backdrop-filter: blur()`), fenêtre frameless (`decorations: false`), variables CSS natives (`--bg-app`, `--bg-tile`, `--accent-amber`, `--accent-blue`).
- **Nommage DOM & CSS** : Kebab-case strict pour toutes les classes et IDs (`.apple-switch`, `.color-drawer`, `#view-dashboard`, `#modal-rename`).
- **Rendu Graphique** : Utiliser uniquement HTML5 Canvas 2D pour la roue chromatique et le visualiseur spectral (cible 60 fps).
- **Modales natives interdites** : NE JAMAIS utiliser `window.alert()`, `window.confirm()` ou `window.prompt()` (bloque WebView2 et affiche « tauri.localhost indique »). Utiliser exclusivement les modales HTML/CSS intégrées avec gestion clavier (`Enter` / `Escape`).

## PATTERN MODÈLE (Modale sombre & gestion clavier — `ui/main.js`)
```javascript
function showRenameModal(title, initialValue, onConfirm) {
  const modal = document.getElementById("modal-rename");
  const titleEl = document.getElementById("modal-rename-title");
  const input = document.getElementById("rename-input");
  const btnCancel = document.getElementById("btn-cancel-rename");
  const btnConfirm = document.getElementById("btn-confirm-rename");
  if (!modal || !titleEl || !input || !btnCancel || !btnConfirm) return;
  titleEl.textContent = title;
  input.value = initialValue;
  modal.classList.remove("hidden");
  setTimeout(() => { input.focus(); input.select(); }, 50);
  const close = () => { modal.classList.add("hidden"); btnCancel.onclick = null; btnConfirm.onclick = null; input.onkeydown = null; };
  btnCancel.onclick = close;
  const submit = () => { const val = input.value.trim(); if (val && val !== initialValue) onConfirm(val); close(); };
  btnConfirm.onclick = submit;
  input.onkeydown = (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); };
}
```
