// HueDesk Controller - Style Apple Home / Philips Hue Tech (Tauri v2)

const tauriCore = window.__TAURI__ ? window.__TAURI__.core : null;
const tauriEvent = window.__TAURI__ ? window.__TAURI__.event : null;

// État local de l'application
const appState = {
  isConfigured: false,
  bridgeIp: null,
  rooms: [],
  lights: new Map(),
  profiles: [],
  unlistenPairing: null,
  unlistenSse: null,
};

// Utilitaire de debounce (50ms)
function debounce(fn, wait = 50) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Remplissage dynamique des sliders façon Apple Glass (actif à gauche, grisé à droite)
function updateSliderVisualFill(slider, value, min, max, _gradientColor) {
  if (!slider) return;
  const val = parseFloat(value) || 0;
  const minVal = min !== undefined ? min : (parseFloat(slider.min) || 0);
  const maxVal = max !== undefined ? max : (parseFloat(slider.max) || 100);
  const pct = Math.max(0, Math.min(100, ((val - minVal) / (maxVal - minVal)) * 100));

  // Charte Philips Hue uniforme sur toute l'application (ambre & or chaud)
  slider.style.background = `linear-gradient(to right, #b45309 0%, #f59e0b ${pct * 0.7}%, #fef08a ${pct}%, rgba(255, 255, 255, 0.12) ${pct}%, rgba(255, 255, 255, 0.12) 100%)`;
}

// Initialisation au chargement du DOM
document.addEventListener("DOMContentLoaded", async () => {
  setupWindowControls();
  setupNavigation();
  setupQuickActions();
  setupPairingEvents();
  setupFooter();
  setupContextMenuAndRoomModal();

  // Écoute des clics globaux pour fermer l'accordéon au clic extérieur (Étape 4)
  document.addEventListener("click", (e) => {
    const focusedTile = document.querySelector(".light-tile.is-focused");
    if (!focusedTile) return;
    if (focusedTile.contains(e.target)) return;
    closeAllColorDrawers();
  });

  if (!tauriCore) {
    console.warn("L'API Tauri est en cours de chargement...");
    return;
  }

  // Écoute des événements temps réel SSE émis par le pont Hue
  if (tauriEvent) {
    appState.unlistenSse = await tauriEvent.listen("hue-state-changed", (event) => {
      handleHueSseEvent(event.payload);
    });
  }

  // Vérification de la configuration
  await checkConnectionStatus();
});

/* ================= 1. CONTRÔLES DE FENÊTRE & DÉPLACEMENT ================= */
function setupWindowControls() {
  const btnMin = document.getElementById("win-btn-minimize");
  const btnMax = document.getElementById("win-btn-maximize");
  const btnClose = document.getElementById("win-btn-close");

  if (btnMin) {
    btnMin.addEventListener("click", () => {
      if (tauriCore) tauriCore.invoke("minimize_window");
    });
  }

  if (btnMax) {
    btnMax.addEventListener("click", () => {
      if (tauriCore) tauriCore.invoke("toggle_maximize");
    });
  }

  if (btnClose) {
    btnClose.addEventListener("click", () => {
      if (tauriCore) tauriCore.invoke("hide_window");
    });
  }

  // Déplacement natif fluide de la fenêtre sans bordure
  const appHeader = document.querySelector(".app-header");
  if (appHeader) {
    appHeader.addEventListener("mousedown", (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".traffic-lights") || e.target.closest(".macos-segmented-control")) return;
      if (e.buttons === 1) {
        if (tauriCore) tauriCore.invoke("drag_window");
      }
    });
    appHeader.addEventListener("dblclick", (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".traffic-lights") || e.target.closest(".macos-segmented-control")) return;
      if (tauriCore) tauriCore.invoke("toggle_maximize");
    });
  }
}

function switchView(viewName) {
  const viewPairing = document.getElementById("view-pairing");
  const viewDashboard = document.getElementById("view-dashboard");
  const viewProfiles = document.getElementById("view-profiles");
  const viewAudio = document.getElementById("view-audio");
  const viewSettings = document.getElementById("view-settings");
  const btnPairingBack = document.getElementById("btn-pairing-back");
  const tabLights = document.getElementById("nav-tab-lights");
  const tabProfiles = document.getElementById("nav-tab-profiles");
  const tabAudio = document.getElementById("nav-tab-audio");

  if (viewPairing) viewPairing.classList.add("hidden");
  if (viewDashboard) viewDashboard.classList.add("hidden");
  if (viewProfiles) viewProfiles.classList.add("hidden");
  if (viewAudio) viewAudio.classList.add("hidden");
  if (viewSettings) viewSettings.classList.add("hidden");

  if (tabLights) tabLights.classList.remove("active");
  if (tabProfiles) tabProfiles.classList.remove("active");
  if (tabAudio) tabAudio.classList.remove("active");

  if (viewName === "dashboard") {
    if (viewDashboard) viewDashboard.classList.remove("hidden");
    if (tabLights) tabLights.classList.add("active");
  } else if (viewName === "profiles") {
    if (viewProfiles) viewProfiles.classList.remove("hidden");
    if (tabProfiles) tabProfiles.classList.add("active");
  } else if (viewName === "audio") {
    if (viewAudio) viewAudio.classList.remove("hidden");
    if (tabAudio) tabAudio.classList.add("active");
    setupAudioVisualizerUI();
  } else if (viewName === "settings") {
    if (viewSettings) viewSettings.classList.remove("hidden");
    const ipEl = document.getElementById("settings-bridge-ip");
    if (ipEl && appState.bridgeIp) ipEl.textContent = appState.bridgeIp;
  } else if (viewName === "pairing") {
    if (viewPairing) viewPairing.classList.remove("hidden");
    if (btnPairingBack) {
      if (appState.isConfigured) {
        btnPairingBack.classList.remove("hidden");
      } else {
        btnPairingBack.classList.add("hidden");
      }
    }
  }
}

/* ================= 1.05 GESTIONNAIRE DE PROFILS ================= */
function setupNavigation() {
  const tabLights = document.getElementById("nav-tab-lights");
  const tabProfiles = document.getElementById("nav-tab-profiles");
  const tabAudio = document.getElementById("nav-tab-audio");

  if (tabLights) {
    tabLights.addEventListener("click", () => {
      switchView("dashboard");
    });
  }

  if (tabProfiles) {
    tabProfiles.addEventListener("click", () => {
      switchView("profiles");
      loadProfiles();
    });
  }

  if (tabAudio) {
    tabAudio.addEventListener("click", () => {
      switchView("audio");
    });
  }

  // Modale de capture de profil
  const btnCapture = document.getElementById("btn-capture-profile");
  const modalProfile = document.getElementById("modal-create-profile");
  const inputProfileName = document.getElementById("new-profile-name-input");
  const iconPicker = document.getElementById("profile-icon-picker");
  const btnCancelProfile = document.getElementById("btn-cancel-create-profile");
  const btnConfirmProfile = document.getElementById("btn-confirm-create-profile");

  let selectedIcon = "💻";

  if (iconPicker) {
    iconPicker.querySelectorAll(".icon-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        iconPicker.querySelectorAll(".icon-opt").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedIcon = btn.dataset.icon;
      });
    });
  }

  if (btnCapture && modalProfile) {
    btnCapture.addEventListener("click", () => {
      if (inputProfileName) inputProfileName.value = "";
      modalProfile.classList.remove("hidden");
      if (inputProfileName) {
        setTimeout(() => inputProfileName.focus(), 50);
      }
    });
  }

  if (btnCancelProfile && modalProfile) {
    btnCancelProfile.addEventListener("click", () => {
      modalProfile.classList.add("hidden");
    });
  }

  if (btnConfirmProfile && modalProfile) {
    btnConfirmProfile.addEventListener("click", async () => {
      const name = (inputProfileName ? inputProfileName.value.trim() : "") || "Mon Ambiance";
      try {
        await tauriCore.invoke("capture_current_profile", {
          name,
          icon: selectedIcon,
          gradient: null,
        });
        modalProfile.classList.add("hidden");
        await loadProfiles();
      } catch (err) {
        alert("Erreur capture profil : " + err);
      }
    });
  }
}

async function loadProfiles() {
  const container = document.getElementById("profiles-grid");
  if (!container) return;
  try {
    const profiles = await tauriCore.invoke("get_profiles");
    appState.profiles = profiles;
    renderProfiles(profiles);
  } catch (err) {
    console.error("Erreur chargement profils:", err);
  }
}

function getProfileIconSvg(icon, name) {
  const n = (name || "").toLowerCase();
  const i = (icon || "").toLowerCase();
  if (n.includes("code") || n.includes("focus") || n.includes("dev") || i.includes("💻")) {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
  }
  if (n.includes("ciné") || n.includes("cine") || n.includes("gam") || i.includes("🎬")) {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`;
  }
  if (n.includes("soir") || n.includes("chill") || n.includes("nuit") || i.includes("🍷")) {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 22h8"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5z"/></svg>`;
  }
  if (n.includes("base") || n.includes("mac") || n.includes("pc") || n.includes("bureau")) {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>`;
  }
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>`;
}

function renderProfiles(profiles) {
  const container = document.getElementById("profiles-grid");
  if (!container) return;
  container.innerHTML = "";

  if (!profiles || profiles.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>Aucun profil d'ambiance configuré.</span>
        <span style="font-size:0.75rem;">Cliquez sur "Capturer l'état actuel" pour en créer un.</span>
      </div>
    `;
    return;
  }

  profiles.forEach((p) => {
    const card = document.createElement("div");
    card.className = `profile-card ${p.is_active ? "active-profile" : ""}`;
    if (p.gradient) {
      card.style.setProperty("--profile-gradient", p.gradient);
    }

    const lightCountText = p.targets && p.targets.length > 0
      ? `${p.targets.length} lampe${p.targets.length > 1 ? "s" : ""} incluse${p.targets.length > 1 ? "s" : ""}`
      : "Ambiance générale";

    card.innerHTML = `
      <div class="profile-card-top">
        <div class="profile-card-icon">${getProfileIconSvg(p.icon, p.name)}</div>
        ${p.is_active ? `<span class="profile-badge-active">ACTIF</span>` : ""}
      </div>
      <div class="profile-card-info">
        <h3>${escapeHtml(p.name)}</h3>
        <span class="profile-card-desc">${lightCountText}</span>
      </div>
      <div class="profile-card-actions">
        ${!p.id.startsWith("preset-") ? `<button class="btn-delete-profile" title="Supprimer ce profil"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : `<span></span>`}
      </div>
    `;

    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Activer le profil ${p.name}`);

    // Accessibilité clavier : Activation avec Entrée ou Espace
    card.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.target.closest(".btn-delete-profile")) {
        e.preventDefault();
        card.click();
      }
    });

    // Clic pour appliquer le profil
    card.addEventListener("click", async (e) => {
      if (e.target.closest(".btn-delete-profile")) return;
      try {
        await tauriCore.invoke("apply_profile", { id: p.id });
        await loadProfiles();
        setTimeout(loadDashboardData, 250);
      } catch (err) {
        console.error("Erreur application profil:", err);
      }
    });

    // Suppression de profil personnalisé
    const btnDel = card.querySelector(".btn-delete-profile");
    if (btnDel) {
      btnDel.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = confirm(`Supprimer le profil "${p.name}" ?`);
        if (ok) {
          try {
            await tauriCore.invoke("delete_profile", { id: p.id });
            await loadProfiles();
          } catch (err) {
            console.error("Erreur suppression profil:", err);
          }
        }
      });
    }

    container.appendChild(card);
  });
}

/* ================= 1.08 AUDIO VISUALIZER UI & CANVAS ================= */
let audioVisualizerInitialized = false;
let currentSpectrumData = {
  bins: new Array(24).fill(0),
  bass: 0,
  rms: 0,
  current_hex: "#ff9f0a",
  current_brightness: 50,
};
let audioAnimFrameId = null;

async function loadAudioDevices() {
  const select = document.getElementById("audio-device-select");
  if (!select || !tauriCore) return;

  try {
    const devices = await tauriCore.invoke("get_audio_devices");
    const savedDevice = localStorage.getItem("hue_audio_selected_device");
    select.innerHTML = "";

    if (!devices || devices.length === 0) {
      select.innerHTML = `<option value="">Périphérique par défaut Windows</option>`;
      return;
    }

    devices.forEach((dev) => {
      const opt = document.createElement("option");
      opt.value = dev.name;
      opt.textContent = `${dev.name}${dev.is_default ? " (Défaut)" : ""}`;
      if (savedDevice && savedDevice === dev.name) {
        opt.selected = true;
      } else if (!savedDevice && dev.is_default) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Erreur chargement périphériques audio :", err);
  }
}

function setupAudioVisualizerUI() {
  populateAudioLightsSelector();

  const canvas = document.getElementById("audio-canvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const masterToggle = document.getElementById("audio-master-toggle");

  if (audioVisualizerInitialized) {
    if (masterToggle && masterToggle.checked) {
      startCanvasVisualizerLoop();
    }
    return;
  }
  audioVisualizerInitialized = true;

  const badgeStatus = document.getElementById("audio-badge-status");
  const gainSlider = document.getElementById("audio-gain-slider");
  const gainDisplay = document.getElementById("audio-gain-display");
  const minBriSlider = document.getElementById("audio-min-bri-slider");
  const maxBriSlider = document.getElementById("audio-max-bri-slider");
  const rangeDisplay = document.getElementById("audio-range-display");
  const bassBoostToggle = document.getElementById("audio-bass-boost-toggle");
  const paletteBtns = document.querySelectorAll(".palette-btn");
  const selectAllBtn = document.getElementById("btn-select-all-audio-lights");
  const deviceSelect = document.getElementById("audio-device-select");
  const btnRefreshDevices = document.getElementById("btn-refresh-audio-devices");

  let activePalette = "neon";

  // Initialisation de la liste des périphériques
  loadAudioDevices();

  if (btnRefreshDevices) {
    btnRefreshDevices.addEventListener("click", () => {
      loadAudioDevices();
    });
  }

  if (deviceSelect) {
    deviceSelect.addEventListener("change", () => {
      localStorage.setItem("hue_audio_selected_device", deviceSelect.value);
      if (masterToggle && masterToggle.checked) {
        restartAudioSyncWithCurrentConfig();
      }
    });
  }

  if (gainSlider && gainDisplay) {
    updateSliderVisualFill(gainSlider, gainSlider.value, 0.5, 4.0, "amber");
    gainSlider.addEventListener("input", () => {
      updateSliderVisualFill(gainSlider, gainSlider.value, 0.5, 4.0, "amber");
      gainDisplay.textContent = `${parseFloat(gainSlider.value).toFixed(1)}x`;
      if (masterToggle && masterToggle.checked) {
        restartAudioSyncWithCurrentConfig();
      }
    });
  }

  function updateRangeDisplay() {
    if (!rangeDisplay || !minBriSlider || !maxBriSlider) return;
    const minVal = parseInt(minBriSlider.value, 10);
    const maxVal = parseInt(maxBriSlider.value, 10);
    rangeDisplay.textContent = `${minVal}% - ${maxVal}%`;
  }

  if (minBriSlider) {
    updateSliderVisualFill(minBriSlider, minBriSlider.value, 5, 50, "amber");
    minBriSlider.addEventListener("input", () => {
      updateSliderVisualFill(minBriSlider, minBriSlider.value, 5, 50, "amber");
      updateRangeDisplay();
      if (masterToggle && masterToggle.checked) {
        restartAudioSyncWithCurrentConfig();
      }
    });
  }

  if (maxBriSlider) {
    updateSliderVisualFill(maxBriSlider, maxBriSlider.value, 50, 100, "amber");
    maxBriSlider.addEventListener("input", () => {
      updateSliderVisualFill(maxBriSlider, maxBriSlider.value, 50, 100, "amber");
      updateRangeDisplay();
      if (masterToggle && masterToggle.checked) {
        restartAudioSyncWithCurrentConfig();
      }
    });
  }

  if (bassBoostToggle) {
    bassBoostToggle.addEventListener("change", () => {
      if (masterToggle && masterToggle.checked) {
        restartAudioSyncWithCurrentConfig();
      }
    });
  }

  paletteBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      paletteBtns.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      activePalette = btn.dataset.palette;
      if (masterToggle && masterToggle.checked) {
        restartAudioSyncWithCurrentConfig();
      }
    });
  });

  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      const cbs = document.querySelectorAll(".audio-light-cb");
      const allChecked = Array.from(cbs).every((cb) => cb.checked);
      cbs.forEach((cb) => (cb.checked = !allChecked));
      selectAllBtn.textContent = allChecked ? "Tout cocher" : "Tout décocher";
      if (masterToggle && masterToggle.checked) {
        restartAudioSyncWithCurrentConfig();
      }
    });
  }

  function getAudioConfig() {
    const selectedLightIds = [];
    document.querySelectorAll(".audio-light-cb:checked").forEach((cb) => {
      selectedLightIds.push(cb.dataset.lightId);
    });

    return {
      device_name: deviceSelect && deviceSelect.value ? deviceSelect.value : null,
      sensitivity: gainSlider ? parseFloat(gainSlider.value) : 1.0,
      palette: activePalette,
      bass_boost: bassBoostToggle ? bassBoostToggle.checked : true,
      min_brightness: minBriSlider ? parseFloat(minBriSlider.value) : 15.0,
      max_brightness: maxBriSlider ? parseFloat(maxBriSlider.value) : 100.0,
      target_light_ids: selectedLightIds,
    };
  }

  async function restartAudioSyncWithCurrentConfig() {
    try {
      await tauriCore.invoke("start_audio_sync", { config: getAudioConfig() });
    } catch (e) {
      console.error("Erreur relance audio sync :", e);
    }
  }

  if (masterToggle) {
    masterToggle.addEventListener("change", async () => {
      if (masterToggle.checked) {
        try {
          await tauriCore.invoke("start_audio_sync", { config: getAudioConfig() });
          if (badgeStatus) {
            badgeStatus.textContent = "EN ÉCOUTE";
            badgeStatus.className = "audio-badge-listening";
          }
          startCanvasVisualizerLoop();
        } catch (err) {
          console.error("Erreur start_audio_sync:", err);
          masterToggle.checked = false;
        }
      } else {
        try {
          await tauriCore.invoke("stop_audio_sync");
          if (badgeStatus) {
            badgeStatus.textContent = "EN PAUSE";
            badgeStatus.className = "audio-badge-idle";
          }
          stopCanvasVisualizerLoop();
        } catch (err) {
          console.error("Erreur stop_audio_sync:", err);
        }
      }
    });
  }

  // Écoute de l'événement Tauri de spectre audio émis à 30-60 fps
  if (tauriEvent) {
    tauriEvent.listen("audio-spectrum-data", (event) => {
      currentSpectrumData = event.payload;

      const briDisplay = document.getElementById("audio-meta-bri");
      const colorPill = document.getElementById("audio-color-pill");
      const bassMeterFill = document.getElementById("bass-meter-fill");
      const vuFill = document.getElementById("audio-vu-fill");

      if (briDisplay) briDisplay.textContent = `${Math.round(currentSpectrumData.current_brightness)}%`;
      if (colorPill) {
        colorPill.style.backgroundColor = currentSpectrumData.current_hex;
        colorPill.style.boxShadow = `0 0 10px ${currentSpectrumData.current_hex}`;
      }
      if (bassMeterFill) {
        bassMeterFill.style.width = `${Math.min(100, Math.round((currentSpectrumData.bass || 0) * 100))}%`;
      }
      if (vuFill) {
        const pct = Math.min(100, Math.round(currentSpectrumData.rms || 0));
        vuFill.style.width = `${pct}%`;
        const vuPct = document.getElementById("audio-vu-pct");
        if (vuPct) vuPct.textContent = `${pct}%`;
      }
    });
  }

  // Boucle de rendu Canvas 60 fps
  function renderCanvas() {
    if (!ctx || !canvas) return;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Fond sombre
    const gradBg = ctx.createLinearGradient(0, 0, 0, height);
    gradBg.addColorStop(0, "#080c14");
    gradBg.addColorStop(1, "#03060a");
    ctx.fillStyle = gradBg;
    ctx.fillRect(0, 0, width, height);

    const bins = currentSpectrumData.bins || [];
    const numBars = bins.length || 24;
    const barSpacing = 4;
    const totalSpacing = (numBars + 1) * barSpacing;
    const barWidth = Math.max(3, (width - totalSpacing) / numBars);
    const hex = currentSpectrumData.current_hex || "#ff9f0a";

    for (let i = 0; i < numBars; i++) {
      const val = bins[i] || 0;
      const barHeight = Math.max(4, val * (height - 24));
      const x = barSpacing + i * (barWidth + barSpacing);
      const y = height - barHeight - 8;

      const barGrad = ctx.createLinearGradient(0, y, 0, height);
      barGrad.addColorStop(0, hex);
      barGrad.addColorStop(1, "rgba(255, 159, 10, 0.08)");

      ctx.fillStyle = barGrad;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
      ctx.fill();

      // Capuchon lumineux sur les barres
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = hex;
      ctx.shadowBlur = 8;
      ctx.fillRect(x, y, barWidth, 2);
      ctx.shadowBlur = 0;
    }

    // Double onde fluide lumineuse style Philips Hue Amber & Gold
    const now = Date.now() * 0.006;
    const bass = currentSpectrumData.bass || 0;

    // Onde 1 : Ambre chaud Philips Hue
    ctx.beginPath();
    ctx.strokeStyle = "#ff9f0a";
    ctx.lineWidth = 2.4;
    ctx.shadowColor = "#ff9f0a";
    ctx.shadowBlur = 12;
    for (let i = 0; i < numBars; i++) {
      const val = bins[i] || 0;
      const x = barSpacing + i * (barWidth + barSpacing) + barWidth / 2;
      const waveAmp = (val * (height * 0.35)) + (bass * 20);
      const y = (height * 0.5) - (waveAmp * Math.sin(i * 0.45 + now));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Onde 2 : Or chaud lumineux Philips Hue
    ctx.beginPath();
    ctx.strokeStyle = "#fef08a";
    ctx.lineWidth = 2.0;
    ctx.shadowColor = "#fef08a";
    ctx.shadowBlur = 12;
    for (let i = 0; i < numBars; i++) {
      const val = bins[numBars - 1 - i] || 0;
      const x = barSpacing + i * (barWidth + barSpacing) + barWidth / 2;
      const waveAmp = (val * (height * 0.30)) + (bass * 16);
      const y = (height * 0.5) - (waveAmp * Math.cos(i * 0.45 - now * 0.85));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    audioAnimFrameId = requestAnimationFrame(renderCanvas);
  }

  function startCanvasVisualizerLoop() {
    if (!audioAnimFrameId) {
      audioAnimFrameId = requestAnimationFrame(renderCanvas);
    }
  }

  function stopCanvasVisualizerLoop() {
    if (audioAnimFrameId) {
      cancelAnimationFrame(audioAnimFrameId);
      audioAnimFrameId = null;
    }
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#080c14";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
}

function populateAudioLightsSelector() {
  const container = document.getElementById("audio-lights-selector");
  if (!container) return;
  container.innerHTML = "";

  if (!appState.lights || appState.lights.size === 0) {
    container.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">Aucune lampe détectée.</span>`;
    return;
  }

  appState.lights.forEach((light) => {
    const item = document.createElement("label");
    item.className = "audio-light-item";
    const name = light.metadata ? light.metadata.name : "Lampe";
    item.innerHTML = `
      <span class="audio-light-name-wrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg> ${escapeHtml(name)}</span>
      <input type="checkbox" class="audio-light-cb" data-light-id="${light.id}" checked />
    `;
    container.appendChild(item);
  });
}

function updateConnectionStatus(connected, ip = null) {
  const statusEl = document.getElementById("connection-status");
  const textEl = document.getElementById("bridge-status-text");

  if (connected && ip) {
    statusEl.classList.add("connected");
    textEl.textContent = "Connecté";
  } else {
    statusEl.classList.remove("connected");
    textEl.textContent = "Déconnecté";
  }
}

function setupFooter() {
  const btnSettings = document.getElementById("btn-footer-settings");
  if (btnSettings) {
    btnSettings.addEventListener("click", () => {
      switchView("settings");
    });
  }

  // Écoute de l'événement Tauri déclenché depuis le mini-flyout (System Tray)
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen("open-settings", () => {
      switchView("settings");
    });
  }

  const btnSettingsBack = document.getElementById("btn-settings-back");
  if (btnSettingsBack) {
    btnSettingsBack.addEventListener("click", () => {
      switchView("dashboard");
    });
  }

  const btnPairingBack = document.getElementById("btn-pairing-back");
  if (btnPairingBack) {
    btnPairingBack.addEventListener("click", () => {
      switchView("dashboard");
    });
  }

  const btnSettingsChange = document.getElementById("btn-settings-change-bridge");
  if (btnSettingsChange) {
    btnSettingsChange.addEventListener("click", () => {
      switchView("pairing");
      scanBridges();
    });
  }
}

/* ================= 1.1 MODALE DE RENOMMAGE MODERNE (REMPLACE PROMPT) ================= */
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
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);

  const close = () => {
    modal.classList.add("hidden");
    btnCancel.onclick = null;
    btnConfirm.onclick = null;
    input.onkeydown = null;
  };

  btnCancel.onclick = close;

  const submit = () => {
    const val = input.value.trim();
    if (val && val !== initialValue) {
      onConfirm(val);
    }
    close();
  };

  btnConfirm.onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") close();
  };
}

/* ================= 1.2 MENU CONTEXTUEL & CRÉATION DE PIÈCE ================= */
function setupContextMenuAndRoomModal() {
  const contextMenu = document.getElementById("custom-context-menu");
  const menuItemNewRoom = document.getElementById("menu-item-new-room");
  const modalCreateRoom = document.getElementById("modal-create-room");
  const inputRoomName = document.getElementById("new-room-name-input");
  const btnCancelRoom = document.getElementById("btn-cancel-create-room");
  const btnConfirmRoom = document.getElementById("btn-confirm-create-room");
  const dashboard = document.getElementById("view-dashboard");

  const itemRenameLight = document.getElementById("menu-item-rename-light");
  const itemToggleLight = document.getElementById("menu-item-toggle-light");
  const itemColorLight = document.getElementById("menu-item-color-light");
  const menuSepLight = document.getElementById("menu-sep-light");
  const textToggleLight = document.getElementById("menu-text-toggle-light");

  let activeLightForMenu = null;

  if (!contextMenu || !dashboard) return;

  // Exposition pour createLightTile
  window.openLightContextMenu = (e, light) => {
    activeLightForMenu = light;
    const isOn = light.on && light.on.on;
    if (textToggleLight) {
      textToggleLight.textContent = isOn ? "Éteindre ce luminaire" : "Allumer ce luminaire";
    }
    if (itemRenameLight) itemRenameLight.classList.remove("hidden");
    if (itemToggleLight) itemToggleLight.classList.remove("hidden");
    if (itemColorLight) itemColorLight.classList.remove("hidden");
    if (menuSepLight) menuSepLight.classList.remove("hidden");

    contextMenu.style.left = `${Math.min(window.innerWidth - 210, e.clientX)}px`;
    contextMenu.style.top = `${Math.min(window.innerHeight - 150, e.clientY)}px`;
    contextMenu.classList.remove("hidden");
  };

  // Clic droit sur le dashboard pour afficher le menu contextuel général
  dashboard.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".light-tile")) return; // géré par openLightContextMenu
    if (e.target.closest("input") || e.target.closest("button") || e.target.closest(".apple-switch")) {
      return;
    }
    e.preventDefault();
    activeLightForMenu = null;
    if (itemRenameLight) itemRenameLight.classList.add("hidden");
    if (itemToggleLight) itemToggleLight.classList.add("hidden");
    if (itemColorLight) itemColorLight.classList.add("hidden");
    if (menuSepLight) menuSepLight.classList.add("hidden");

    contextMenu.style.left = `${Math.min(window.innerWidth - 190, e.clientX)}px`;
    contextMenu.style.top = `${Math.min(window.innerHeight - 70, e.clientY)}px`;
    contextMenu.classList.remove("hidden");
  });

  // Actions contextuelles sur luminaire
  if (itemRenameLight) {
    itemRenameLight.addEventListener("click", () => {
      contextMenu.classList.add("hidden");
      if (!activeLightForMenu) return;
      const currentName = activeLightForMenu.metadata ? activeLightForMenu.metadata.name : "Luminaire";
      showRenameModal("Renommer le luminaire", currentName, async (newName) => {
        try {
          await tauriCore.invoke("rename_light", { lightId: activeLightForMenu.id, name: newName });
          setTimeout(loadDashboardData, 250);
        } catch (err) {
          console.error("Erreur renommage:", err);
        }
      });
    });
  }

  if (itemToggleLight) {
    itemToggleLight.addEventListener("click", async () => {
      contextMenu.classList.add("hidden");
      if (!activeLightForMenu) return;
      const nextState = !(activeLightForMenu.on && activeLightForMenu.on.on);
      try {
        await tauriCore.invoke("toggle_light", { lightId: activeLightForMenu.id, on: nextState });
        setTimeout(loadDashboardData, 200);
      } catch (err) {
        console.error("Erreur toggle contextmenu:", err);
      }
    });
  }

  if (itemColorLight) {
    itemColorLight.addEventListener("click", () => {
      contextMenu.classList.add("hidden");
      if (!activeLightForMenu) return;
      const tile = document.getElementById(`light-tile-${activeLightForMenu.id}`);
      if (tile) {
        const chipBtn = tile.querySelector(".color-chip-btn");
        if (chipBtn) chipBtn.click();
      }
    });
  }

  // Masquer le menu contextuel au clic ailleurs
  document.addEventListener("click", () => {
    contextMenu.classList.add("hidden");
  });

  // Clic sur "Créer une nouvelle pièce"
  if (menuItemNewRoom && modalCreateRoom && inputRoomName) {
    menuItemNewRoom.addEventListener("click", () => {
      contextMenu.classList.add("hidden");
      inputRoomName.value = "";
      modalCreateRoom.classList.remove("hidden");
      setTimeout(() => inputRoomName.focus(), 100);
    });
  }

  // Annuler la création
  if (btnCancelRoom && modalCreateRoom) {
    btnCancelRoom.addEventListener("click", () => {
      modalCreateRoom.classList.add("hidden");
    });
  }

  // Valider la création
  if (btnConfirmRoom && modalCreateRoom && inputRoomName) {
    btnConfirmRoom.addEventListener("click", async () => {
      const name = inputRoomName.value.trim();
      if (!name) return;
      btnConfirmRoom.disabled = true;
      btnConfirmRoom.textContent = "Création...";
      try {
        await tauriCore.invoke("create_room", { name, archetype: "other" });
        modalCreateRoom.classList.add("hidden");
        setTimeout(loadDashboardData, 300);
      } catch (err) {
        alert("Erreur création de pièce : " + err);
      } finally {
        btnConfirmRoom.disabled = false;
        btnConfirmRoom.textContent = "Créer la pièce";
      }
    });

    inputRoomName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnConfirmRoom.click();
    });
  }
}

/* ================= 2. RACCOURCIS RAPIDES ================= */
function setupQuickActions() {
  // Tout Allumer
  const btnAllOn = document.getElementById("btn-quick-all-on");
  if (btnAllOn) {
    btnAllOn.addEventListener("click", async () => {
      if (!tauriCore || appState.lights.size === 0) return;
      for (const light of appState.lights.values()) {
        try {
          await tauriCore.invoke("toggle_light", { lightId: light.id, on: true });
          if (light.on) light.on.on = true;
          updateLightTileVisuals(light.id, true);
        } catch (e) {
          console.error(e);
        }
      }
      setTimeout(loadDashboardData, 250);
    });
  }

  // Tout Éteindre
  const btnAllOff = document.getElementById("btn-quick-all-off");
  if (btnAllOff) {
    btnAllOff.addEventListener("click", async () => {
      if (!tauriCore || appState.lights.size === 0) return;
      for (const light of appState.lights.values()) {
        try {
          await tauriCore.invoke("toggle_light", { lightId: light.id, on: false });
          if (light.on) light.on.on = false;
          updateLightTileVisuals(light.id, false);
        } catch (e) {
          console.error(e);
        }
      }
      setTimeout(loadDashboardData, 250);
    });
  }

  // Nuit : Veilleuse douce (10% et blanc très chaud 2200K)
  const btnNight = document.getElementById("btn-quick-night");
  if (btnNight) {
    btnNight.addEventListener("click", async () => {
      if (!tauriCore || appState.lights.size === 0) return;
      for (const light of appState.lights.values()) {
        try {
          await tauriCore.invoke("toggle_light", { lightId: light.id, on: true });
          await tauriCore.invoke("set_brightness", { lightId: light.id, brightness: 10.0 });
          await tauriCore.invoke("set_color_temperature", { lightId: light.id, mirek: 454 });
          if (light.on) light.on.on = true;
          if (light.dimming) light.dimming.brightness = 10;
          updateLightTileVisuals(light.id, true, 10);
        } catch (e) {
          console.error(e);
        }
      }
      setTimeout(loadDashboardData, 250);
    });
  }
}

/* ================= 3. CHARGEMENT DES DONNÉES ================= */
async function checkConnectionStatus() {
  try {
    const status = await tauriCore.invoke("get_connection_status");
    if (status.is_configured && status.bridge_ip) {
      appState.isConfigured = true;
      appState.bridgeIp = status.bridge_ip;
      updateConnectionStatus(true, status.bridge_ip);
      switchView("dashboard");
      await loadDashboardData();
    } else {
      appState.isConfigured = false;
      updateConnectionStatus(false);
      switchView("pairing");
      await scanBridges();
    }
  } catch (err) {
    console.error("Erreur statut:", err);
    switchView("pairing");
    await scanBridges();
  }
}

async function loadDashboardData() {
  if (!tauriCore) return;

  try {
    const [rooms, lights] = await Promise.all([
      tauriCore.invoke("get_rooms"),
      tauriCore.invoke("get_lights"),
    ]);

    appState.rooms = rooms || [];
    appState.lights.clear();
    (lights || []).forEach((l) => appState.lights.set(l.id, l));

    renderAccordion();
  } catch (err) {
    console.error("Erreur chargement données:", err);
  }
}

/* ================= 4. ACCORDÉON DES PIÈCES & LIAISON ================= */
function closeAllColorDrawers() {
  document.querySelectorAll(".light-tile.is-focused").forEach((tile) => {
    tile.classList.remove("is-focused");
  });
  const viewDashboard = document.getElementById("view-dashboard");
  if (viewDashboard) viewDashboard.classList.remove("has-focus");
}

function renderAccordion() {
  const container = document.getElementById("rooms-accordion");
  container.innerHTML = "";

  if (appState.lights.size === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>Aucune ampoule trouvée sur ce pont Hue.</span>
      </div>
    `;
    return;
  }

  const assignedLightIds = new Set();
  const roomsToRender = [...appState.rooms];

  // Pré-calcul de l'assignation des lampes aux pièces
  roomsToRender.forEach((room) => {
    const childIds = new Set((room.children || []).map((c) => c.rid));
    const roomLights = Array.from(appState.lights.values()).filter((l) => {
      const match = childIds.has(l.id) || (l.owner && childIds.has(l.owner.rid));
      if (match) assignedLightIds.add(l.id);
      return match;
    });
    room._matchedLights = roomLights;
  });

  // Gestion des lumières non assignées à une pièce spécifique
  const unassignedLights = Array.from(appState.lights.values()).filter(
    (l) => !assignedLightIds.has(l.id)
  );
  if (unassignedLights.length > 0) {
    roomsToRender.push({
      id: "unassigned",
      metadata: { name: "Autres lumières" },
      children: [],
      services: [],
      _matchedLights: unassignedLights,
    });
  }

  roomsToRender.forEach((room, index) => {
    const roomLights = room._matchedLights || [];
    const isAnyOn = roomLights.some((l) => l.on && l.on.on);
    const avgBrightness = roomLights.length > 0
      ? Math.round(
          roomLights.reduce((acc, l) => acc + (l.dimming ? l.dimming.brightness : 0), 0) /
            roomLights.length
        )
      : 80;

    const roomItem = document.createElement("div");
    roomItem.className = `room-item ${index === 0 ? "expanded" : ""}`;
    roomItem.dataset.roomId = room.id;

    roomItem.innerHTML = `
      <div class="room-header">
        <div class="room-title-left">
          <span class="room-chevron">▶</span>
          <span class="room-name-wrapper">
            <span class="room-name-text">${escapeHtml(room.metadata.name)}</span>
            ${room.id !== "unassigned" ? `<button class="btn-rename-room" title="Renommer la pièce"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>` : ""}
          </span>
          <span class="room-light-count">(${roomLights.length} lumière${roomLights.length > 1 ? "s" : ""})</span>
        </div>

        <div class="room-header-right">
          <span class="room-brightness-pct">${avgBrightness}%</span>
          <label class="apple-switch room-switch" title="Allumer ou éteindre toute la pièce">
            <input type="checkbox" class="room-toggle-input" ${isAnyOn ? "checked" : ""} />
            <span class="apple-switch-slider"></span>
          </label>
          ${room.id !== "unassigned" ? `<button class="btn-delete-room" title="Supprimer cette pièce"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ""}
        </div>
      </div>

      <div class="room-content" id="room-content-${room.id}">
        <!-- Bandeau horizontal pleine largeur Tout régler -->
        ${roomLights.length > 0 ? `
        <div class="room-master-strip">
          <div class="room-master-top-row">
            <span class="room-master-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
              <span>Tout régler :</span>
            </span>
            <input type="range" class="apple-slider room-master-slider brightness-slider" min="1" max="100" value="${avgBrightness}" />
            <button class="color-chip-btn room-color-chip-btn" title="Régler la couleur & effets de toute la pièce"></button>
          </div>

          <!-- Tiroir Accordéon Collectif pour la Pièce -->
          <div class="color-drawer room-color-drawer">
            <div class="drawer-tabs">
              <button class="drawer-tab-btn room-tab-color active"><span>🎨</span> Couleur Pièce</button>
              <button class="drawer-tab-btn room-tab-effects"><span>✨</span> Effets Pièce</button>
            </div>

            <div class="tab-pane room-pane-color">
              <div class="drawer-content-flex">
                <div class="chroma-wheel-wrapper">
                  <canvas class="chroma-wheel-canvas room-wheel-canvas" width="140" height="140"></canvas>
                  <div class="chroma-wheel-cursor room-wheel-cursor" style="background-color: #ff9e42;"></div>
                </div>
                <div class="drawer-controls-col">
                  <div class="presets-grid">
                    <button class="preset-pill-btn room-preset-btn" data-color="#ff9e42"><span class="preset-pill-dot" style="background:#ff9e42;"></span><span>Chaud</span></button>
                    <button class="preset-pill-btn room-preset-btn" data-color="#d8ecff"><span class="preset-pill-dot" style="background:#d8ecff;"></span><span>Froid</span></button>
                    <button class="preset-pill-btn room-preset-btn" data-color="#ff5500"><span class="preset-pill-dot" style="background:#ff5500;"></span><span>Nuit</span></button>
                    <button class="preset-pill-btn room-preset-btn" data-color="#ffd294"><span class="preset-pill-dot" style="background:#ffd294;"></span><span>Lecture</span></button>
                    <button class="preset-pill-btn room-preset-btn" data-color="#2563eb"><span class="preset-pill-dot" style="background:#2563eb;"></span><span>Bleu</span></button>
                    <button class="preset-pill-btn room-preset-btn" data-color="#9333ea"><span class="preset-pill-dot" style="background:#9333ea;"></span><span>Violet</span></button>
                  </div>
                </div>
              </div>
            </div>

            <div class="tab-pane room-pane-effects hidden">
              <div class="effects-grid">
                <button class="effect-card-btn room-effect-btn" data-effect="fire"><span>🔥</span> <span>Feu</span></button>
                <button class="effect-card-btn room-effect-btn" data-effect="candle"><span>🕯️</span> <span>Bougie</span></button>
                <button class="effect-card-btn room-effect-btn" data-effect="prism"><span>🌈</span> <span>Prisme</span></button>
                <button class="effect-card-btn room-effect-btn" data-effect="sparkle"><span>✨</span> <span>Scintillement</span></button>
                <button class="effect-card-btn room-effect-btn" data-effect="opal"><span>🌸</span> <span>Opale</span></button>
                <button class="effect-card-btn room-effect-btn" data-effect="glisten"><span>💎</span> <span>Lueur</span></button>
                <button class="effect-card-btn room-effect-btn" data-effect="cosmos"><span>🌌</span> <span>Cosmos</span></button>
              </div>
              <div class="effect-intensity-box">
                <div class="effect-intensity-label">
                  <span>Intensité de l'effet</span>
                  <span class="room-effect-intensity-pct">100%</span>
                </div>
                <input type="range" class="apple-slider effect-intensity-slider room-effect-intensity-slider" min="10" max="100" value="100" />
              </div>
              <button class="btn-stop-effect room-btn-stop-effect" style="margin-top: 8px;"><span>⏹️</span> Arrêter l'effet sur toute la pièce</button>
            </div>
          </div>
        </div>` : ""}

        <!-- Grille des lampes de la pièce -->
        <div class="room-lights-grid" id="room-lights-grid-${room.id}"></div>
      </div>
    `;

    // Déplier / replier au clic sur l'en-tête (hors contrôles)
    const header = roomItem.querySelector(".room-header");
    header.addEventListener("click", (e) => {
      if (e.target.closest(".apple-switch") || e.target.closest("button")) return;
      roomItem.classList.toggle("expanded");
    });

    // Bascule On/Off de la pièce via son Apple switch
    const roomToggleInput = roomItem.querySelector(".room-toggle-input");
    if (roomToggleInput) {
      roomToggleInput.addEventListener("change", async (e) => {
        const nextState = roomToggleInput.checked;
        try {
          if (room.id !== "unassigned") {
            await tauriCore.invoke("toggle_room", { roomId: room.id, on: nextState });
          } else {
            for (const l of roomLights) {
              await tauriCore.invoke("toggle_light", { lightId: l.id, on: nextState });
            }
          }
          roomLights.forEach((l) => {
            if (l.on) l.on.on = nextState;
            updateLightTileVisuals(l.id, nextState);
          });
          setTimeout(loadDashboardData, 200);
        } catch (err) {
          console.error("Erreur bascule pièce:", err);
          roomToggleInput.checked = !nextState;
        }
      });
    }

    // Renommer la pièce avec modale intégrée moderne
    const btnRename = roomItem.querySelector(".btn-rename-room");
    if (btnRename) {
      btnRename.addEventListener("click", (e) => {
        e.stopPropagation();
        const currentName = room.metadata.name;
        showRenameModal("Renommer la pièce", currentName, async (newName) => {
          try {
            await tauriCore.invoke("rename_room", { roomId: room.id, name: newName });
            setTimeout(loadDashboardData, 250);
          } catch (err) {
            console.error("Erreur renommage pièce :", err);
          }
        });
      });
    }

    // Supprimer la pièce
    const btnDelete = roomItem.querySelector(".btn-delete-room");
    if (btnDelete) {
      btnDelete.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = confirm(`Voulez-vous vraiment supprimer la pièce "${room.metadata.name}" ?\nLes lampes seront conservées dans "Autres lumières".`);
        if (ok) {
          try {
            await tauriCore.invoke("delete_room", { roomId: room.id });
            setTimeout(loadDashboardData, 300);
          } catch (err) {
            alert("Erreur suppression pièce : " + err);
          }
        }
      });
    }

    // Slider Master de Luminosité
    const mSlider = roomItem.querySelector(".room-master-slider");
    const mPct = roomItem.querySelector(".room-brightness-pct");
    if (mSlider) {
      updateSliderVisualFill(mSlider, mSlider.value);
      const sendRoomBrightness = debounce(async (val) => {
        try {
          if (room.id !== "unassigned") {
            await tauriCore.invoke("set_room_brightness", { roomId: room.id, brightness: parseFloat(val) });
          } else {
            for (const l of roomLights) {
              await tauriCore.invoke("set_brightness", { lightId: l.id, brightness: parseFloat(val) });
            }
          }
          roomLights.forEach((l) => {
            if (l.dimming) l.dimming.brightness = parseFloat(val);
            updateLightTileVisuals(l.id, true, val);
          });
        } catch (err) {
          console.error("Erreur réglage luminosité pièce:", err);
        }
      }, 50);

      mSlider.addEventListener("input", (e) => {
        updateSliderVisualFill(mSlider, e.target.value);
        if (mPct) mPct.textContent = `${e.target.value}%`;
        sendRoomBrightness(e.target.value);
      });
    }

    // Contrôles Couleur & Effets pour toute la pièce
    const roomChipBtn = roomItem.querySelector(".room-color-chip-btn");
    const roomDrawer = roomItem.querySelector(".room-color-drawer");
    if (roomChipBtn && roomDrawer) {
      const roomWheelCanvas = roomItem.querySelector(".room-wheel-canvas");
      const roomWheelCursor = roomItem.querySelector(".room-wheel-cursor");
      let roomWheelDrawn = false;

      roomChipBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = roomDrawer.style.maxHeight && roomDrawer.style.maxHeight !== "0px";
        if (isOpen) {
          roomDrawer.style.maxHeight = "0px";
          roomDrawer.style.opacity = "0";
        } else {
          roomDrawer.style.maxHeight = "360px";
          roomDrawer.style.opacity = "1";
          if (!roomWheelDrawn) {
            drawColorWheel(roomWheelCanvas);
            roomWheelDrawn = true;
          }
        }
      });

      // Onglets Pièce
      const tabCol = roomItem.querySelector(".room-tab-color");
      const tabEff = roomItem.querySelector(".room-tab-effects");
      const paneCol = roomItem.querySelector(".room-pane-color");
      const paneEff = roomItem.querySelector(".room-pane-effects");

      tabCol.addEventListener("click", (e) => {
        e.stopPropagation();
        tabCol.classList.add("active");
        tabEff.classList.remove("active");
        paneCol.classList.remove("hidden");
        paneEff.classList.add("hidden");
      });

      tabEff.addEventListener("click", (e) => {
        e.stopPropagation();
        tabEff.classList.add("active");
        tabCol.classList.remove("active");
        paneEff.classList.remove("hidden");
        paneCol.classList.add("hidden");
      });

      // Roue Chromatique pour toute la pièce
      const sendRoomColorDebounced = debounce(async (hex) => {
        try {
          if (room.id !== "unassigned") {
            await tauriCore.invoke("set_room_color", { roomId: room.id, hexColor: hex });
          } else {
            for (const l of roomLights) {
              await tauriCore.invoke("set_color", { lightId: l.id, hexColor: hex });
            }
          }
        } catch (err) {
          console.error("Erreur set_room_color:", err);
        }
      }, 50);

      function handleRoomWheel(e) {
        const rect = roomWheelCanvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const x = clientX - rect.left - cx;
        const y = clientY - rect.top - cy;

        const radius = Math.min(cx, cy) - 4;
        const dist = Math.sqrt(x * x + y * y);
        const clampedDist = Math.min(dist, radius);
        let angle = Math.atan2(y, x) * (180 / Math.PI);
        if (angle < 0) angle += 360;

        const sat = Math.min(1, clampedDist / radius);
        const rgb = hslToRgb(angle, sat * 100, 50);
        const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

        const cursorX = cx + (clampedDist * Math.cos((angle * Math.PI) / 180));
        const cursorY = cy + (clampedDist * Math.sin((angle * Math.PI) / 180));
        roomWheelCursor.style.left = `${cursorX}px`;
        roomWheelCursor.style.top = `${cursorY}px`;
        roomWheelCursor.style.backgroundColor = hex;

        sendRoomColorDebounced(hex);
      }

      let isDraggingRoomWheel = false;
      roomWheelCanvas.addEventListener("pointerdown", (e) => {
        isDraggingRoomWheel = true;
        roomWheelCanvas.setPointerCapture(e.pointerId);
        handleRoomWheel(e);
      });
      roomWheelCanvas.addEventListener("pointermove", (e) => {
        if (isDraggingRoomWheel) handleRoomWheel(e);
      });
      const stopRoomWheelDrag = (e) => {
        if (isDraggingRoomWheel) {
          isDraggingRoomWheel = false;
          try { roomWheelCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      };
      roomWheelCanvas.addEventListener("pointerup", stopRoomWheelDrag);
      roomWheelCanvas.addEventListener("pointercancel", stopRoomWheelDrag);

      // Presets pour toute la pièce
      roomItem.querySelectorAll(".room-preset-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const hex = btn.dataset.color;
          roomWheelCursor.style.backgroundColor = hex;
          try {
            if (room.id !== "unassigned") {
              await tauriCore.invoke("set_room_color", { roomId: room.id, hexColor: hex });
            } else {
              for (const l of roomLights) {
                await tauriCore.invoke("set_color", { lightId: l.id, hexColor: hex });
              }
            }
          } catch (err) {
            console.error(err);
          }
          roomDrawer.style.maxHeight = "0px";
          roomDrawer.style.opacity = "0";
        });
      });

      // Intensité des effets pour toute la pièce
      let currentRoomEffect = null;
      const roomIntensitySlider = roomItem.querySelector(".room-effect-intensity-slider");
      const roomIntensityPct = roomItem.querySelector(".room-effect-intensity-pct");

      const updateRoomEffectIntensity = debounce(async (val) => {
        if (!currentRoomEffect || currentRoomEffect === "no_effect") return;
        try {
          const b = parseFloat(val);
          if (room.id !== "unassigned") {
            await tauriCore.invoke("set_room_effect", { roomId: room.id, effect: currentRoomEffect, brightness: b });
          } else {
            for (const l of roomLights) {
              await tauriCore.invoke("set_light_effect", { lightId: l.id, effect: currentRoomEffect, brightness: b });
            }
          }
        } catch (err) {
          console.error(err);
        }
      }, 60);

      if (roomIntensitySlider) {
        roomIntensitySlider.addEventListener("input", (e) => {
          if (roomIntensityPct) roomIntensityPct.textContent = `${e.target.value}%`;
          updateRoomEffectIntensity(e.target.value);
        });
      }

      // Effets pour toute la pièce
      roomItem.querySelectorAll(".room-effect-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const effect = btn.dataset.effect;
          currentRoomEffect = effect;
          const brightness = roomIntensitySlider ? parseFloat(roomIntensitySlider.value) : 100;
          try {
            if (room.id !== "unassigned") {
              await tauriCore.invoke("set_room_effect", { roomId: room.id, effect, brightness });
            } else {
              for (const l of roomLights) {
                await tauriCore.invoke("set_light_effect", { lightId: l.id, effect, brightness });
              }
            }
          } catch (err) {
            console.error(err);
          }
        });
      });

      const btnStopRoomEff = roomItem.querySelector(".room-btn-stop-effect");
      if (btnStopRoomEff) {
        btnStopRoomEff.addEventListener("click", async (e) => {
          e.stopPropagation();
          currentRoomEffect = null;
          try {
            if (room.id !== "unassigned") {
              await tauriCore.invoke("set_room_effect", { roomId: room.id, effect: "no_effect", brightness: null });
            } else {
              for (const l of roomLights) {
                await tauriCore.invoke("set_light_effect", { lightId: l.id, effect: "no_effect", brightness: null });
              }
            }
          } catch (err) {
            console.error(err);
          }
        });
      }
    }

    // Insertion des tuiles de lumière dans la grille dédiée
    const grid = roomItem.querySelector(`#room-lights-grid-${room.id}`) || roomItem.querySelector(`#room-content-${room.id}`);
    roomLights.forEach((light) => {
      grid.appendChild(createLightTile(light, roomsToRender, room.id));
    });

    container.appendChild(roomItem);
  });
}

/* ================= 5. TUILE DE LUMIÈRE (OPTION HYBRIDE + ONGLETS + EFFETS) ================= */
function setupPointerDrag(tile, light, currentRoomId) {
  const dragHandle = tile.querySelector(".tile-identity");
  if (!dragHandle) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let ghost = null;
  let hoveredRoom = null;

  const onPointerMove = (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 8) {
      isDragging = true;
      tile.classList.add("is-dragging");
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg> <span>${escapeHtml(light.metadata ? light.metadata.name : "Luminaire")}</span>`;
      document.body.appendChild(ghost);
    }

    if (isDragging && ghost) {
      ghost.style.left = `${e.clientX + 14}px`;
      ghost.style.top = `${e.clientY + 14}px`;

      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      const targetRoom = elements ? elements.find((el) => el.classList && el.classList.contains("room-item")) : null;

      document.querySelectorAll(".room-item.drag-over").forEach((el) => {
        if (el !== targetRoom) el.classList.remove("drag-over");
      });

      if (targetRoom) {
        targetRoom.classList.add("drag-over");
        hoveredRoom = targetRoom;
      } else {
        hoveredRoom = null;
      }
    }
  };

  const onPointerUp = async (e) => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);

    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    tile.classList.remove("is-dragging");
    document.querySelectorAll(".room-item.drag-over").forEach((el) => el.classList.remove("drag-over"));

    if (isDragging && hoveredRoom) {
      const targetRoomId = hoveredRoom.id.replace("room-", "");
      if (targetRoomId && targetRoomId !== currentRoomId && targetRoomId !== "unassigned") {
        try {
          await tauriCore.invoke("assign_light_to_room", { lightId: light.id, targetRoomId });
          await loadDashboardData();
        } catch (err) {
          console.error("Erreur lors du déplacement de la lumière:", err);
        }
      }
    }
    isDragging = false;
  };

  dragHandle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".apple-switch")) return;
    startX = e.clientX;
    startY = e.clientY;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });
}

function createLightTile(light, allRooms, currentRoomId) {
  const tile = document.createElement("div");
  const isOn = light.on && light.on.on;
  tile.className = `light-tile ${isOn ? "on" : "off"}`;
  tile.id = `light-tile-${light.id}`;

  const currentBrightness = light.dimming ? Math.round(light.dimming.brightness) : 100;
  const currentMirek = light.color_temperature ? light.color_temperature.mirek || 370 : 370;

  // Correction Kelvin inversé : à gauche (153 sur le slider) = 500 mirek (2700K chaud)
  // à droite (500 sur le slider) = 153 mirek (6500K froid)
  const sliderKelvinValue = Math.max(153, Math.min(500, 653 - currentMirek));

  // Calcul de la couleur RGB initiale
  let initialRgb = { r: 255, g: 183, b: 3 };
  if (light.color && light.color.xy) {
    initialRgb = xyBriToRgb(light.color.xy.x, light.color.xy.y, currentBrightness);
  } else if (light.color_temperature && light.color_temperature.mirek) {
    initialRgb = mirekToRgb(light.color_temperature.mirek);
  }
  let initialHex = rgbToHex(initialRgb.r, initialRgb.g, initialRgb.b);

  // Icône contextuelle
  let deviceIcon = "💡";
  const nameLower = (light.metadata ? light.metadata.name : "").toLowerCase();
  if (nameLower.includes("télé") || nameLower.includes("tv")) deviceIcon = "📺";
  else if (nameLower.includes("ruban") || nameLower.includes("strip")) deviceIcon = "〰️";
  else if (nameLower.includes("lampadaire") || nameLower.includes("salon")) deviceIcon = "🛋️";
  else if (nameLower.includes("plafonnier")) deviceIcon = "💡";

  // Sous-titre de statut Apple
  const statusSubtitleHtml = isOn
    ? `<span class="status-tag-on">Allumée</span> <span class="status-tag-pct">• ${currentBrightness}%</span>`
    : `<span class="status-tag-off">Éteinte</span>`;

  const rawName = (light.metadata ? light.metadata.name : "Luminaire").replace(/millieu/gi, "milieu");
  const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  tile.innerHTML = `
    <!-- Étape 1 : Accès Rapide & Simplification (Sans dropdown encombrant) -->
    <div class="tile-top-row">
      <div class="tile-identity" title="Maintenir et glisser pour déplacer dans une autre pièce">
        <div class="tile-icon-badge" title="Cliquer pour allumer/éteindre" style="${isOn ? `box-shadow: 0 0 14px ${initialHex}66; border-color: ${initialHex}; color: ${initialHex};` : 'color: var(--text-dim);'}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${isOn ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
        </div>
        <div class="tile-info">
          <div class="tile-name-row">
            <span class="tile-name">${escapeHtml(cleanName)}</span>
            <button class="btn-rename-light" title="Renommer ce luminaire">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
          </div>
          <div class="tile-status-subtitle">${statusSubtitleHtml}</div>
        </div>
      </div>

      <label class="apple-switch" title="Interrupteur On/Off">
        <input type="checkbox" class="tile-toggle-input" ${isOn ? "checked" : ""} />
        <span class="apple-switch-slider"></span>
      </label>
    </div>

    <!-- Slider de Luminosité (0-100%) -->
    <div class="slider-group">
      <div class="slider-label-row">
        <span>Luminosité</span>
        <span class="brightness-display">${currentBrightness}%</span>
      </div>
      <input type="range" class="apple-slider brightness-slider" min="1" max="100" value="${currentBrightness}" />
    </div>

    <!-- Slider Température Kelvin (2700K - 6500K) + Pastille Dégradé Conique Arc-en-Ciel -->
    <div class="temp-controls-row">
      <div class="temp-slider-col">
        <input type="range" class="apple-slider kelvin-slider" min="153" max="500" value="${sliderKelvinValue}" />
        <div class="kelvin-scale-row">
          <span>2700K</span>
          <span>6500K</span>
        </div>
      </div>
      <button class="color-chip-btn" title="Ouvrir le sélecteur & effets (Option Hybride)"></button>
    </div>

    <!-- Étape 2 & 3 : Tiroir Accordéon avec Système d'Onglets (Couleur / Effets) -->
    <div class="color-drawer">
      <!-- Navigation par Onglets -->
      <div class="drawer-tabs">
        <button class="drawer-tab-btn tab-btn-color active" data-tab="color">
          <span>🎨</span> Couleur
        </button>
        <button class="drawer-tab-btn tab-btn-effects" data-tab="effects">
          <span>✨</span> Effets
        </button>
      </div>

      <!-- Onglet A : COULEUR -->
      <div class="tab-pane tab-pane-color">
        <div class="drawer-content-flex">
          <!-- Roue Canvas Circulaire -->
          <div class="chroma-wheel-wrapper">
            <canvas class="chroma-wheel-canvas" width="140" height="140"></canvas>
            <div class="chroma-wheel-cursor" style="background-color: ${initialHex};"></div>
          </div>

          <!-- Presets rounded-full & Numériques RGB -->
          <div class="drawer-controls-col">
            <div class="presets-grid">
              <button class="preset-pill-btn" data-color="#ff9e42" title="Chaud 2700K">
                <span class="preset-pill-dot" style="background: #ff9e42;"></span>
                <span>Chaud</span>
              </button>
              <button class="preset-pill-btn" data-color="#d8ecff" title="Froid 6500K">
                <span class="preset-pill-dot" style="background: #d8ecff;"></span>
                <span>Froid</span>
              </button>
              <button class="preset-pill-btn" data-color="#ff5500" title="Veilleuse">
                <span class="preset-pill-dot" style="background: #ff5500;"></span>
                <span>Nuit</span>
              </button>
              <button class="preset-pill-btn" data-color="#ffd294" title="Lecture">
                <span class="preset-pill-dot" style="background: #ffd294;"></span>
                <span>Lecture</span>
              </button>
              <button class="preset-pill-btn" data-color="#2563eb" title="Bleu Ciel">
                <span class="preset-pill-dot" style="background: #2563eb;"></span>
                <span>Bleu</span>
              </button>
              <button class="preset-pill-btn" data-color="#9333ea" title="Violet Néon">
                <span class="preset-pill-dot" style="background: #9333ea;"></span>
                <span>Violet</span>
              </button>
            </div>

            <div class="rgb-inputs-row">
              <div class="rgb-field"><span>R</span><input type="number" class="rgb-input rgb-r" min="0" max="255" value="${initialRgb.r}" /></div>
              <div class="rgb-field"><span>G</span><input type="number" class="rgb-input rgb-g" min="0" max="255" value="${initialRgb.g}" /></div>
              <div class="rgb-field"><span>B</span><input type="number" class="rgb-input rgb-b" min="0" max="255" value="${initialRgb.b}" /></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Onglet B : EFFETS NATIFS CLIP V2 -->
      <div class="tab-pane tab-pane-effects hidden">
        <div class="effects-grid">
          <button class="effect-card-btn" data-effect="fire"><span>🔥</span> <span>Feu</span></button>
          <button class="effect-card-btn" data-effect="candle"><span>🕯️</span> <span>Bougie</span></button>
          <button class="effect-card-btn" data-effect="prism"><span>🌈</span> <span>Prisme</span></button>
          <button class="effect-card-btn" data-effect="sparkle"><span>✨</span> <span>Scintillement</span></button>
          <button class="effect-card-btn" data-effect="opal"><span>🌸</span> <span>Opale</span></button>
          <button class="effect-card-btn" data-effect="glisten"><span>💎</span> <span>Lueur</span></button>
          <button class="effect-card-btn" data-effect="cosmos"><span>🌌</span> <span>Cosmos</span></button>
        </div>
        <div class="effect-intensity-box">
          <div class="effect-intensity-label">
            <span>Intensité de l'effet</span>
            <span class="light-effect-intensity-pct">100%</span>
          </div>
          <input type="range" class="apple-slider effect-intensity-slider light-effect-intensity-slider" min="10" max="100" value="100" />
        </div>
        <button class="btn-stop-effect" data-effect="no_effect" style="margin-top: 8px;">
          <span>⏹️</span> Arrêter l'effet
        </button>
      </div>
    </div>
  `;

  // Éléments du DOM de la tuile
  const iconBadge = tile.querySelector(".tile-icon-badge");
  const toggleInput = tile.querySelector(".tile-toggle-input");
  const bSlider = tile.querySelector(".brightness-slider");
  const bDisplay = tile.querySelector(".brightness-display");
  const tSlider = tile.querySelector(".kelvin-slider");
  const colorChipBtn = tile.querySelector(".color-chip-btn");
  const wheelCanvas = tile.querySelector(".chroma-wheel-canvas");
  const wheelCursor = tile.querySelector(".chroma-wheel-cursor");
  const rgbInputR = tile.querySelector(".rgb-r");
  const rgbInputG = tile.querySelector(".rgb-g");
  const rgbInputB = tile.querySelector(".rgb-b");
  const statusSubtitle = tile.querySelector(".tile-status-subtitle");

  // Interaction 1 : Bascule On/Off
  async function toggleLightState() {
    const currentIsOn = light.on && light.on.on;
    const nextState = !currentIsOn;
    toggleInput.checked = nextState;
    updateLightTileVisuals(light.id, nextState);
    try {
      await tauriCore.invoke("toggle_light", { lightId: light.id, on: nextState });
      if (light.on) light.on.on = nextState;
    } catch (e) {
      console.error(e);
      toggleInput.checked = currentIsOn;
      updateLightTileVisuals(light.id, currentIsOn);
    }
  }

  iconBadge.addEventListener("click", toggleLightState);
  toggleInput.addEventListener("change", toggleLightState);

  // Interaction 2 : Slider de Luminosité avec debounce 50ms
  if (bSlider) updateSliderVisualFill(bSlider, bSlider.value);

  const sendBrightness = debounce(async (val) => {
    try {
      await tauriCore.invoke("set_brightness", { lightId: light.id, brightness: parseFloat(val) });
      if (light.dimming) light.dimming.brightness = parseFloat(val);
    } catch (e) {
      console.error(e);
    }
  }, 50);

  bSlider.addEventListener("pointerdown", () => (bSlider.dataset.interacting = "true"));
  bSlider.addEventListener("pointerup", () => {
    setTimeout(() => (bSlider.dataset.interacting = "false"), 150);
  });
  bSlider.addEventListener("input", (e) => {
    bSlider.dataset.interacting = "true";
    updateSliderVisualFill(bSlider, e.target.value);
    bDisplay.textContent = `${e.target.value}%`;
    if (!toggleInput.checked) {
      toggleInput.checked = true;
      if (light.on) light.on.on = true;
    }
    updateLightTileVisuals(light.id, true, e.target.value);
    sendBrightness(e.target.value);
  });

  // Interaction 3 : Slider Température Kelvin (Inversion corrigée : gauche=2700K chaud, droite=6500K froid)
  const sendTemp = debounce(async (sliderVal) => {
    const calculatedMirek = Math.max(153, Math.min(500, 653 - parseInt(sliderVal)));
    try {
      await tauriCore.invoke("set_color_temperature", { lightId: light.id, mirek: calculatedMirek });
      const rgb = mirekToRgb(calculatedMirek);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      wheelCursor.style.backgroundColor = hex;
      rgbInputR.value = rgb.r;
      rgbInputG.value = rgb.g;
      rgbInputB.value = rgb.b;
    } catch (e) {
      console.error(e);
    }
  }, 50);

  tSlider.addEventListener("pointerdown", () => (tSlider.dataset.interacting = "true"));
  tSlider.addEventListener("pointerup", () => {
    setTimeout(() => (tSlider.dataset.interacting = "false"), 150);
  });
  tSlider.addEventListener("input", (e) => {
    tSlider.dataset.interacting = "true";
    sendTemp(e.target.value);
  });

  // Interaction 4 : Onglets Couleur / Effets
  const tabBtnColor = tile.querySelector(".tab-btn-color");
  const tabBtnEffects = tile.querySelector(".tab-btn-effects");
  const paneColor = tile.querySelector(".tab-pane-color");
  const paneEffects = tile.querySelector(".tab-pane-effects");

  tabBtnColor.addEventListener("click", (e) => {
    e.stopPropagation();
    tabBtnColor.classList.add("active");
    tabBtnEffects.classList.remove("active");
    paneColor.classList.remove("hidden");
    paneEffects.classList.add("hidden");
  });

  tabBtnEffects.addEventListener("click", (e) => {
    e.stopPropagation();
    tabBtnEffects.classList.add("active");
    tabBtnColor.classList.remove("active");
    paneEffects.classList.remove("hidden");
    paneColor.classList.add("hidden");
  });

  // Interaction 5 : Ouverture / Fermeture Accordéon & Effet Focus
  let wheelDrawn = false;
  colorChipBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isCurrentlyFocused = tile.classList.contains("is-focused");
    const viewDashboard = document.getElementById("view-dashboard");

    if (isCurrentlyFocused) {
      tile.classList.remove("is-focused");
      if (viewDashboard) viewDashboard.classList.remove("has-focus");
    } else {
      closeAllColorDrawers();
      tile.classList.add("is-focused");
      if (viewDashboard) viewDashboard.classList.add("has-focus");

      if (!wheelDrawn) {
        drawColorWheel(wheelCanvas);
        wheelDrawn = true;
      }
    }
  });

  // Interaction 6 : Roue Chromatique Canvas
  const sendColorDebounced = debounce(async (hex) => {
    try {
      await tauriCore.invoke("set_color", { lightId: light.id, hexColor: hex });
      if (!toggleInput.checked) {
        toggleInput.checked = true;
        if (light.on) light.on.on = true;
      }
      updateLightTileVisuals(light.id, true);
    } catch (err) {
      console.error("Erreur set_color:", err);
    }
  }, 50);

  function handleWheelPointer(e) {
    const rect = wheelCanvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    const x = clientX - rect.left - cx;
    const y = clientY - rect.top - cy;

    const radius = Math.min(cx, cy) - 4;
    const dist = Math.sqrt(x * x + y * y);
    const clampedDist = Math.min(dist, radius);
    let angle = Math.atan2(y, x) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    const sat = Math.min(1, clampedDist / radius);
    const rgb = hslToRgb(angle, sat * 100, 50);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

    const cursorX = cx + (clampedDist * Math.cos((angle * Math.PI) / 180));
    const cursorY = cy + (clampedDist * Math.sin((angle * Math.PI) / 180));
    wheelCursor.style.left = `${cursorX}px`;
    wheelCursor.style.top = `${cursorY}px`;
    wheelCursor.style.backgroundColor = hex;

    rgbInputR.value = rgb.r;
    rgbInputG.value = rgb.g;
    rgbInputB.value = rgb.b;

    sendColorDebounced(hex);
  }

  let isDraggingWheel = false;
  wheelCanvas.addEventListener("pointerdown", (e) => {
    isDraggingWheel = true;
    wheelCanvas.setPointerCapture(e.pointerId);
    handleWheelPointer(e);
  });
  wheelCanvas.addEventListener("pointermove", (e) => {
    if (isDraggingWheel) handleWheelPointer(e);
  });
  const stopWheelDrag = (e) => {
    if (isDraggingWheel) {
      isDraggingWheel = false;
      try { wheelCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  };
  wheelCanvas.addEventListener("pointerup", stopWheelDrag);
  wheelCanvas.addEventListener("pointercancel", stopWheelDrag);

  // Interaction 7 : Presets Rapides
  tile.querySelectorAll(".preset-pill-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const hex = btn.dataset.color;
      const rgb = hexToRgb(hex);

      wheelCursor.style.backgroundColor = hex;
      rgbInputR.value = rgb.r;
      rgbInputG.value = rgb.g;
      rgbInputB.value = rgb.b;

      try {
        await tauriCore.invoke("set_color", { lightId: light.id, hexColor: hex });
        if (!toggleInput.checked) {
          toggleInput.checked = true;
          if (light.on) light.on.on = true;
        }
        updateLightTileVisuals(light.id, true);
      } catch (err) {
        console.error(err);
      }

      tile.classList.remove("is-focused");
      const viewDashboard = document.getElementById("view-dashboard");
      if (viewDashboard) viewDashboard.classList.remove("has-focus");
    });
  });

  // Interaction 8 : Inputs RGB Numériques
  const onRgbInputChange = debounce(async () => {
    const r = Math.max(0, Math.min(255, parseInt(rgbInputR.value) || 0));
    const g = Math.max(0, Math.min(255, parseInt(rgbInputG.value) || 0));
    const b = Math.max(0, Math.min(255, parseInt(rgbInputB.value) || 0));
    const hex = rgbToHex(r, g, b);

    wheelCursor.style.backgroundColor = hex;
    sendColorDebounced(hex);
  }, 60);

  [rgbInputR, rgbInputG, rgbInputB].forEach((inp) => {
    inp.addEventListener("input", onRgbInputChange);
  });

  // Interaction 9 : Effets Matériels Philips Hue
  const effectBtns = tile.querySelectorAll(".effect-card-btn");
  const stopEffectBtn = tile.querySelector(".btn-stop-effect");

  const effectLabels = {
    fire: "🔥 Feu actif",
    candle: "🕯️ Bougie active",
    prism: "🌈 Prisme en cours",
    sparkle: "✨ Scintillement",
    opal: "🌸 Opale active",
    glisten: "💎 Lueur active",
    cosmos: "🌌 Cosmos actif",
  };

  // Filtrage intelligent selon les capacités matérielles de cette lampe spécifique
  const supportedEffs = light.effects && light.effects.effect_values ? light.effects.effect_values : null;
  if (supportedEffs) {
    effectBtns.forEach((b) => {
      const eff = b.dataset.effect;
      if (!supportedEffs.includes(eff)) {
        b.style.display = "none";
      }
    });
  }

  let currentLightEffect = null;
  const lightIntensitySlider = tile.querySelector(".light-effect-intensity-slider");
  const lightIntensityPct = tile.querySelector(".light-effect-intensity-pct");

  const sendLightEffectIntensity = debounce(async (val) => {
    if (!currentLightEffect || currentLightEffect === "no_effect") return;
    try {
      await tauriCore.invoke("set_light_effect", {
        lightId: light.id,
        effect: currentLightEffect,
        brightness: parseFloat(val),
      });
    } catch (e) {
      console.error(e);
    }
  }, 60);

  if (lightIntensitySlider) {
    lightIntensitySlider.addEventListener("input", (e) => {
      if (lightIntensityPct) lightIntensityPct.textContent = `${e.target.value}%`;
      sendLightEffectIntensity(e.target.value);
    });
  }

  effectBtns.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const effectName = btn.dataset.effect;
      currentLightEffect = effectName;

      effectBtns.forEach((b) => b.classList.remove("active-effect"));
      btn.classList.add("active-effect");
      iconBadge.classList.add("has-active-effect");

      if (statusSubtitle) {
        statusSubtitle.innerHTML = `<span class="status-tag-on">${effectLabels[effectName] || "Effet actif"}</span>`;
      }

      const brightness = lightIntensitySlider ? parseFloat(lightIntensitySlider.value) : 100;
      try {
        await tauriCore.invoke("set_light_effect", { lightId: light.id, effect: effectName, brightness });
        if (!toggleInput.checked) {
          toggleInput.checked = true;
          if (light.on) light.on.on = true;
        }
      } catch (err) {
        console.error("Erreur set_light_effect:", err);
      }
    });
  });

  stopEffectBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    currentLightEffect = null;
    effectBtns.forEach((b) => b.classList.remove("active-effect"));
    iconBadge.classList.remove("has-active-effect");

    try {
      await tauriCore.invoke("set_light_effect", { lightId: light.id, effect: "no_effect", brightness: null });
      updateLightTileVisuals(light.id, light.on ? light.on.on : true);
    } catch (err) {
      console.error("Erreur stop effect:", err);
    }
  });

  // Interaction 10 : Renommer le luminaire avec modale moderne
  const btnRenameLight = tile.querySelector(".btn-rename-light");
  if (btnRenameLight) {
    btnRenameLight.addEventListener("click", (e) => {
      e.stopPropagation();
      const oldName = light.metadata ? light.metadata.name : "Luminaire";
      showRenameModal("Renommer le luminaire", oldName, async (newName) => {
        try {
          await tauriCore.invoke("rename_light", { lightId: light.id, name: newName });
          await loadDashboardData();
        } catch (err) {
          console.error("Erreur renommage lampe :", err);
        }
      });
    });
  }

  // Interaction 11 : Menu contextuel Clic Droit étendu macOS
  tile.addEventListener("contextmenu", (e) => {
    if (e.target.closest("input") || e.target.closest("button") || e.target.closest(".apple-switch")) return;
    e.preventDefault();
    e.stopPropagation();
    if (window.openLightContextMenu) {
      window.openLightContextMenu(e, light);
    }
  });

  // Interaction 12 : Accessibilité clavier (Basculement On/Off avec Espace)
  tile.setAttribute("tabindex", "0");
  tile.setAttribute("aria-label", `Contrôles pour ${light.metadata ? light.metadata.name : "Luminaire"}`);
  tile.addEventListener("keydown", (e) => {
    if (e.key === " " && !e.target.matches("input, button")) {
      e.preventDefault();
      toggleLightState();
    }
  });

  // Interaction 13 : Glisser-déposer PointerEvents vers une autre pièce
  setupPointerDrag(tile, light, currentRoomId);

  return tile;
}

function updateLightTileVisuals(lightId, isOn, brightnessVal = null) {
  const tile = document.getElementById(`light-tile-${lightId}`);
  if (!tile) return;

  const subtitle = tile.querySelector(".tile-status-subtitle");
  const toggle = tile.querySelector(".tile-toggle-input");
  const bSlider = tile.querySelector(".brightness-slider");
  const bDisplay = tile.querySelector(".brightness-display");

  const val = brightnessVal !== null ? brightnessVal : bSlider ? bSlider.value : 100;

  if (toggle) toggle.checked = isOn;

  if (isOn) {
    tile.classList.add("on");
    tile.classList.remove("off");
    if (subtitle) {
      subtitle.innerHTML = `<span class="status-tag-on">Allumée</span> <span class="status-tag-pct">• ${val}%</span>`;
    }
    if (bDisplay) bDisplay.textContent = `${val}%`;
    if (bSlider) updateSliderVisualFill(bSlider, val);
  } else {
    tile.classList.remove("on");
    tile.classList.add("off");
    if (subtitle) {
      subtitle.innerHTML = `<span class="status-tag-off">Éteinte</span>`;
    }
    if (bSlider) updateSliderVisualFill(bSlider, val);
  }
}

/* ================= 6. APPAIRAGE PHILIPS HUE ================= */
function setupPairingEvents() {
  const btnRescan = document.getElementById("btn-rescan-bridges");
  if (btnRescan) {
    btnRescan.addEventListener("click", () => scanBridges());
  }

  const btnManualConnect = document.getElementById("btn-connect-manual");
  const inputManual = document.getElementById("manual-bridge-ip");
  const manualError = document.getElementById("manual-error");

  if (btnManualConnect && inputManual) {
    btnManualConnect.addEventListener("click", async () => {
      const ip = inputManual.value.trim();
      manualError.textContent = "";
      if (!ip) {
        manualError.textContent = "Veuillez entrer une adresse IP valide.";
        return;
      }

      btnManualConnect.disabled = true;
      btnManualConnect.textContent = "Test IP...";

      try {
        await tauriCore.invoke("verify_manual_ip", { ip });
        startPairingProcess(ip);
      } catch (err) {
        manualError.textContent = String(err);
      } finally {
        btnManualConnect.disabled = false;
        btnManualConnect.textContent = "Associer cette IP";
      }
    });
  }

  const btnCancel = document.getElementById("btn-cancel-pairing");
  if (btnCancel) {
    btnCancel.addEventListener("click", () => hidePairingModal());
  }
}

async function scanBridges() {
  const container = document.getElementById("bridges-container");
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Scan du réseau local en cours (mDNS)...</span>
    </div>
  `;

  try {
    const bridges = await tauriCore.invoke("discover_bridge");
    container.innerHTML = "";

    if (!bridges || bridges.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span>Aucun pont Hue détecté automatiquement.</span>
          <span style="font-size:0.72rem;">Utilisez la saisie manuelle ci-dessous.</span>
        </div>
      `;
      return;
    }

    bridges.forEach((b) => {
      const item = document.createElement("div");
      item.className = "bridge-item";
      item.innerHTML = `
        <div class="bridge-info">
          <h4>${escapeHtml(b.hostname || "Pont Philips Hue")}</h4>
          <span class="bridge-meta">IP : ${b.ip} • ID : ${escapeHtml(b.id)}</span>
        </div>
        <button class="btn btn-sm btn-primary btn-pair">Associer</button>
      `;

      item.querySelector(".btn-pair").addEventListener("click", () => {
        startPairingProcess(b.ip);
      });

      container.appendChild(item);
    });
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <span style="color: #ef4444;">Erreur scan : ${escapeHtml(String(err))}</span>
      </div>
    `;
  }
}

async function startPairingProcess(ip) {
  showPairingModal();

  if (tauriEvent && !appState.unlistenPairing) {
    appState.unlistenPairing = await tauriEvent.listen("hue-pairing-status", (event) => {
      const data = event.payload;
      updatePairingCountdown(data.seconds_left, data.message);

      if (data.status === "success") {
        setTimeout(async () => {
          hidePairingModal();
          appState.isConfigured = true;
          appState.bridgeIp = ip;
          updateConnectionStatus(true, ip);
          switchView("dashboard");
          await loadDashboardData();
        }, 800);
      }
    });
  }

  try {
    await tauriCore.invoke("start_pairing", { ip });
  } catch (err) {
    console.error("Échec appairage:", err);
    document.getElementById("pairing-instruction").textContent = `Erreur : ${err}`;
  }
}

function showPairingModal() {
  const modal = document.getElementById("modal-pairing");
  modal.classList.remove("hidden");
  updatePairingCountdown(30, "Appuyez sur le bouton rond au centre du pont Philips Hue.");
}

function hidePairingModal() {
  const modal = document.getElementById("modal-pairing");
  modal.classList.add("hidden");
  if (appState.unlistenPairing) {
    appState.unlistenPairing();
    appState.unlistenPairing = null;
  }
}

function updatePairingCountdown(secondsLeft, message) {
  const timerText = document.getElementById("countdown-timer");
  const fillBar = document.getElementById("countdown-progress");
  const instruction = document.getElementById("pairing-instruction");

  if (timerText) timerText.textContent = `${secondsLeft}s`;
  if (fillBar) fillBar.style.width = `${(secondsLeft / 30) * 100}%`;
  if (instruction && message) instruction.textContent = message;
}

/* ================= 7. TRAITEMENT SSE TEMPS RÉEL ================= */
function handleHueSseEvent(payload) {
  if (!Array.isArray(payload)) return;

  payload.forEach((batch) => {
    if (!batch.data || !Array.isArray(batch.data)) return;

    batch.data.forEach((item) => {
      if (item.type !== "light") return;

      const light = appState.lights.get(item.id);
      const tile = document.getElementById(`light-tile-${item.id}`);

      // 1. État On/Off
      if (item.on !== undefined && item.on !== null) {
        const isOn = item.on.on;
        if (light) {
          if (!light.on) light.on = { on: isOn };
          else light.on.on = isOn;
        }
        updateLightTileVisuals(item.id, isOn);
      }

      // 2. Luminosité (si l'utilisateur n'est pas en train de glisser)
      if (item.dimming && tile) {
        const slider = tile.querySelector(".brightness-slider");
        const newBri = Math.round(item.dimming.brightness);

        if (light) {
          if (!light.dimming) light.dimming = { brightness: newBri };
          else light.dimming.brightness = newBri;
        }

        if (slider && slider.dataset.interacting !== "true") {
          slider.value = newBri;
          updateLightTileVisuals(item.id, light ? light.on.on : true, newBri);
        }
      }

      // 3. Température de couleur
      if (item.color_temperature && tile) {
        const slider = tile.querySelector(".kelvin-slider");
        const mirek = item.color_temperature.mirek;

        if (slider && slider.dataset.interacting !== "true" && mirek) {
          slider.value = mirek;
        }
      }
    });
  });
}

// Dessin de la Roue Chromatique Canvas (Option Hybride)
function drawColorWheel(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - 2;

  ctx.clearRect(0, 0, width, height);
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const index = (y * width + x) * 4;

      if (dist <= radius) {
        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        if (angle < 0) angle += 360;
        const sat = Math.min(1, dist / radius);
        const rgb = hslToRgb(angle, sat * 100, 50);

        const edgeAlpha = dist > radius - 1 ? (radius - dist) : 1;

        data[index] = rgb.r;
        data[index + 1] = rgb.g;
        data[index + 2] = rgb.b;
        data[index + 3] = Math.round(255 * Math.max(0, edgeAlpha));
      } else {
        data[index + 3] = 0;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// Conversions de couleurs
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
  };
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
  );
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  if (isNaN(bigint)) return { r: 255, g: 255, b: 255 };
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function mirekToRgb(mirek) {
  const kelvin = 1000000 / mirek;
  const temp = kelvin / 100;
  let r, g, b;

  if (temp <= 66) {
    r = 255;
    g = Math.min(255, Math.max(0, 99.4708025861 * Math.log(temp) - 161.1195681661));
    b = temp <= 19 ? 0 : Math.min(255, Math.max(0, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
  } else {
    r = Math.min(255, Math.max(0, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
    g = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
    b = 255;
  }

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

function xyBriToRgb(x, y, bri = 100) {
  if (y === 0) return { r: 255, g: 255, b: 255 };
  const z = 1.0 - x - y;
  const Y = (bri / 100.0);
  const X = (Y / y) * x;
  const Z = (Y / y) * z;

  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.011530;

  [r, g, b] = [r, g, b].map((c) => {
    c = Math.max(0, c);
    return c <= 0.0031308 ? 12.92 * c : (1.0 + 0.055) * Math.pow(c, 1.0 / 2.4) - 0.055;
  });

  const max = Math.max(r, g, b);
  if (max > 1.0) {
    r /= max;
    g /= max;
    b /= max;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// Anti-XSS
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
