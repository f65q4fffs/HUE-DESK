// Client Frontend Philips Hue Controller - Tauri v2 Vanilla JS

const tauriCore = window.__TAURI__ ? window.__TAURI__.core : null;
const tauriEvent = window.__TAURI__ ? window.__TAURI__.event : null;

// État local de l'application
const appState = {
  isConfigured: false,
  bridgeIp: null,
  rooms: [],
  lights: new Map(),
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

// Initialisation au chargement du DOM
document.addEventListener("DOMContentLoaded", async () => {
  setupHeaderControls();
  setupPairingEvents();

  if (!tauriCore) {
    console.warn("L'API Tauri n'est pas encore prête ou absente.");
    return;
  }

  // Écoute continue des événements temps réel SSE émis par le backend Rust
  if (tauriEvent) {
    appState.unlistenSse = await tauriEvent.listen("hue-state-changed", (event) => {
      handleHueSseEvent(event.payload);
    });
  }

  // Vérification de la configuration existante (%APPDATA%)
  await checkConnectionStatus();
});

/* ================= 1. GESTION DES VUES & HEADER ================= */

function switchView(viewName) {
  const viewPairing = document.getElementById("view-pairing");
  const viewDashboard = document.getElementById("view-dashboard");
  const btnMasterOff = document.getElementById("btn-master-off");

  if (viewName === "dashboard") {
    viewPairing.classList.add("hidden");
    viewDashboard.classList.remove("hidden");
    btnMasterOff.style.display = "inline-flex";
  } else {
    viewDashboard.classList.add("hidden");
    viewPairing.classList.remove("hidden");
    btnMasterOff.style.display = "none";
  }
}

function updateBridgeBadge(connected, ip = null) {
  const badge = document.getElementById("bridge-status-badge");
  const text = document.getElementById("bridge-status-text");

  if (connected && ip) {
    badge.classList.add("connected");
    text.textContent = `Pont connecté (${ip})`;
  } else {
    badge.classList.remove("connected");
    text.textContent = "Pont non connecté";
  }
}

function setupHeaderControls() {
  // Réduire vers la zone de notification (Tray)
  const btnMinimize = document.getElementById("btn-minimize-tray");
  if (btnMinimize) {
    btnMinimize.addEventListener("click", () => {
      if (tauriCore) {
        tauriCore.invoke("hide_window");
      }
    });
  }

  // Tout éteindre immédiatement
  const btnMasterOff = document.getElementById("btn-master-off");
  if (btnMasterOff) {
    btnMasterOff.addEventListener("click", async () => {
      if (!tauriCore || appState.rooms.length === 0) return;
      btnMasterOff.disabled = true;
      for (const room of appState.rooms) {
        try {
          await tauriCore.invoke("toggle_room", { roomId: room.id, on: false });
        } catch (e) {
          console.error(`Erreur extinction pièce ${room.id}:`, e);
        }
      }
      btnMasterOff.disabled = false;
      await loadDashboardData();
    });
  }

  // Bouton de rafraîchissement Dashboard
  const btnRefresh = document.getElementById("btn-refresh-dashboard");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => loadDashboardData());
  }
}

async function checkConnectionStatus() {
  try {
    const status = await tauriCore.invoke("get_connection_status");
    if (status.is_configured && status.bridge_ip) {
      appState.isConfigured = true;
      appState.bridgeIp = status.bridge_ip;
      updateBridgeBadge(true, status.bridge_ip);
      switchView("dashboard");
      await loadDashboardData();
    } else {
      appState.isConfigured = false;
      updateBridgeBadge(false);
      switchView("pairing");
      await scanBridges();
    }
  } catch (err) {
    console.error("Erreur vérification statut de connexion:", err);
    switchView("pairing");
    await scanBridges();
  }
}

/* ================= 2. APPAIRAGE PHILIPS HUE ================= */

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
    btnCancel.addEventListener("click", () => {
      hidePairingModal();
    });
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
          <span style="font-size:0.75rem;">Utilisez la saisie manuelle ci-dessous si le pont est sur un autre sous-réseau.</span>
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
        <span style="color: #ff858d;">Erreur lors du scan : ${escapeHtml(String(err))}</span>
      </div>
    `;
  }
}

async function startPairingProcess(ip) {
  showPairingModal();

  // Écoute de l'événement de progression d'appairage émis par Rust
  if (tauriEvent && !appState.unlistenPairing) {
    appState.unlistenPairing = await tauriEvent.listen("hue-pairing-status", (event) => {
      const data = event.payload;
      updatePairingCountdown(data.seconds_left, data.message);

      if (data.status === "success") {
        setTimeout(async () => {
          hidePairingModal();
          appState.isConfigured = true;
          appState.bridgeIp = ip;
          updateBridgeBadge(true, ip);
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
  updatePairingCountdown(30, "Appuyez sur le bouton rond central du pont Philips Hue.");
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

/* ================= 3. DASHBOARD & ACCORDÉON DES PIÈCES ================= */

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
    updateActiveLightsSummary();
  } catch (err) {
    console.error("Erreur chargement données Dashboard:", err);
  }
}

function renderAccordion() {
  const container = document.getElementById("rooms-accordion");
  container.innerHTML = "";

  if (appState.rooms.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>Aucune pièce trouvée sur ce pont Hue.</span>
      </div>
    `;
    return;
  }

  appState.rooms.forEach((room, index) => {
    // Identifier les lumières de la pièce
    const childIds = new Set(room.children.map((c) => c.rid));
    const roomLights = Array.from(appState.lights.values()).filter(
      (l) => childIds.has(l.id) || (l.owner && childIds.has(l.owner.rid))
    );

    // Détermination de l'état global de la pièce
    const isAnyOn = roomLights.some((l) => l.on && l.on.on);

    const roomItem = document.createElement("div");
    roomItem.className = `room-item ${index === 0 ? "expanded" : ""}`;
    roomItem.dataset.roomId = room.id;

    roomItem.innerHTML = `
      <div class="room-header">
        <div class="room-title-group">
          <span class="accordion-chevron">▶</span>
          <span class="room-icon">🛋️</span>
          <div class="room-info">
            <h3>${escapeHtml(room.metadata.name)}</h3>
            <span class="room-count">${roomLights.length} lumière(s)</span>
          </div>
        </div>

        <div class="room-actions">
          <label class="switch" title="Allumer/Éteindre la pièce">
            <input type="checkbox" class="room-toggle" ${isAnyOn ? "checked" : ""} />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>

      <div class="room-content" id="room-content-${room.id}">
        <!-- Les cartes de lampes sont insérées ici -->
      </div>
    `;

    // Dépliage / repliage au clic sur l'en-tête (sauf sur le switch)
    const header = roomItem.querySelector(".room-header");
    header.addEventListener("click", (e) => {
      if (e.target.closest(".switch")) return;
      roomItem.classList.toggle("expanded");
    });

    // Interrupteur général de la pièce
    const roomToggle = roomItem.querySelector(".room-toggle");
    roomToggle.addEventListener("change", async (e) => {
      const turnOn = e.target.checked;
      try {
        await tauriCore.invoke("toggle_room", { roomId: room.id, on: turnOn });
        // Mise à jour visuelle immédiate des lampes enfants
        roomLights.forEach((l) => {
          if (l.on) l.on.on = turnOn;
          updateLightCardState(l.id, turnOn);
        });
        updateActiveLightsSummary();
      } catch (err) {
        console.error("Erreur toggle_room:", err);
        e.target.checked = !turnOn;
      }
    });

    // Rendu des cartes individuelles de lampes
    const content = roomItem.querySelector(`#room-content-${room.id}`);
    roomLights.forEach((light) => {
      content.appendChild(createLightCard(light));
    });

    container.appendChild(roomItem);
  });
}

function createLightCard(light) {
  const card = document.createElement("div");
  const isOn = light.on && light.on.on;
  card.className = `light-card ${isOn ? "on" : ""}`;
  card.id = `light-card-${light.id}`;

  const currentBrightness = light.dimming ? Math.round(light.dimming.brightness) : 100;
  const currentMirek = light.color_temperature ? light.color_temperature.mirek || 366 : 366;

  card.innerHTML = `
    <div class="light-header">
      <div class="light-title-group">
        <div class="light-glow-icon">💡</div>
        <span class="light-name">${escapeHtml(light.metadata ? light.metadata.name : "Lampe")}</span>
      </div>

      <label class="switch">
        <input type="checkbox" class="light-toggle" ${isOn ? "checked" : ""} />
        <span class="switch-slider"></span>
      </label>
    </div>

    <!-- Luminosité -->
    <div class="control-row">
      <div class="control-label-row">
        <span>Luminosité</span>
        <span class="brightness-label">${currentBrightness}%</span>
      </div>
      <input type="range" class="slider-input brightness-slider" min="1" max="100" value="${currentBrightness}" />
    </div>

    <!-- Température de couleur (Mirek 153 froid à 500 chaud) -->
    <div class="control-row">
      <div class="control-label-row">
        <span>Température</span>
        <span class="temp-label">${Math.round(1000000 / currentMirek)}K</span>
      </div>
      <input type="range" class="slider-input temp-slider" min="153" max="500" value="${currentMirek}" />
    </div>

    <!-- Palette de couleurs rapides -->
    <div class="color-palette-row">
      <span class="color-chip" style="background:#ff9a00;" data-hex="#ff9a00" title="Ambre chaud"></span>
      <span class="color-chip" style="background:#ffe0b2;" data-hex="#ffe0b2" title="Blanc doux"></span>
      <span class="color-chip" style="background:#00b4d8;" data-hex="#00b4d8" title="Cyan ciel"></span>
      <span class="color-chip" style="background:#9d4edd;" data-hex="#9d4edd" title="Violet électrique"></span>
      <span class="color-chip" style="background:#e63946;" data-hex="#e63946" title="Rouge cosy"></span>
      <input type="color" class="color-picker-native" value="#ff9a00" title="Palette complète" />
    </div>
  `;

  // Événement Switch On/Off
  const toggle = card.querySelector(".light-toggle");
  toggle.addEventListener("change", async (e) => {
    const turnOn = e.target.checked;
    updateLightCardState(light.id, turnOn);
    try {
      await tauriCore.invoke("toggle_light", { lightId: light.id, on: turnOn });
      if (light.on) light.on.on = turnOn;
      updateActiveLightsSummary();
    } catch (err) {
      console.error("Erreur toggle_light:", err);
      toggle.checked = !turnOn;
      updateLightCardState(light.id, !turnOn);
    }
  });

  // Slider Luminosité (avec debounce 50ms)
  const bSlider = card.querySelector(".brightness-slider");
  const bLabel = card.querySelector(".brightness-label");

  const sendBrightness = debounce(async (val) => {
    try {
      await tauriCore.invoke("set_brightness", { lightId: light.id, brightness: parseFloat(val) });
      if (light.dimming) light.dimming.brightness = parseFloat(val);
    } catch (err) {
      console.error("Erreur set_brightness:", err);
    }
  }, 50);

  bSlider.addEventListener("pointerdown", () => (bSlider.dataset.interacting = "true"));
  bSlider.addEventListener("pointerup", () => {
    setTimeout(() => (bSlider.dataset.interacting = "false"), 150);
  });
  bSlider.addEventListener("input", (e) => {
    bSlider.dataset.interacting = "true";
    bLabel.textContent = `${e.target.value}%`;
    if (!toggle.checked) {
      toggle.checked = true;
      updateLightCardState(light.id, true);
    }
    sendBrightness(e.target.value);
  });

  // Slider Température de blanc
  const tSlider = card.querySelector(".temp-slider");
  const tLabel = card.querySelector(".temp-label");

  const sendColorTemp = debounce(async (mirek) => {
    try {
      await tauriCore.invoke("set_color_temperature", { lightId: light.id, mirek: parseInt(mirek) });
    } catch (err) {
      console.error("Erreur set_color_temperature:", err);
    }
  }, 50);

  tSlider.addEventListener("pointerdown", () => (tSlider.dataset.interacting = "true"));
  tSlider.addEventListener("pointerup", () => {
    setTimeout(() => (tSlider.dataset.interacting = "false"), 150);
  });
  tSlider.addEventListener("input", (e) => {
    tSlider.dataset.interacting = "true";
    const k = Math.round(1000000 / e.target.value);
    tLabel.textContent = `${k}K`;
    sendColorTemp(e.target.value);
  });

  // Pastilles de couleur
  card.querySelectorAll(".color-chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      const hex = chip.dataset.hex;
      try {
        await tauriCore.invoke("set_color", { lightId: light.id, hexColor: hex });
        if (!toggle.checked) {
          toggle.checked = true;
          updateLightCardState(light.id, true);
        }
      } catch (err) {
        console.error("Erreur set_color:", err);
      }
    });
  });

  // Palette native
  const nativePicker = card.querySelector(".color-picker-native");
  nativePicker.addEventListener("change", async (e) => {
    try {
      await tauriCore.invoke("set_color", { lightId: light.id, hexColor: e.target.value });
      if (!toggle.checked) {
        toggle.checked = true;
        updateLightCardState(light.id, true);
      }
    } catch (err) {
      console.error("Erreur set_color:", err);
    }
  });

  return card;
}

function updateLightCardState(lightId, isOn) {
  const card = document.getElementById(`light-card-${lightId}`);
  if (!card) return;

  if (isOn) {
    card.classList.add("on");
  } else {
    card.classList.remove("on");
  }

  const toggle = card.querySelector(".light-toggle");
  if (toggle) toggle.checked = isOn;
}

function updateActiveLightsSummary() {
  const summary = document.getElementById("summary-active-count");
  if (!summary) return;

  let activeCount = 0;
  appState.lights.forEach((l) => {
    if (l.on && l.on.on) activeCount++;
  });

  summary.textContent = `${activeCount} lumière(s) allumée(s)`;
}

/* ================= 4. TRAITEMENT SSE TEMPS RÉEL (SANS DÉSYNCHRO) ================= */

function handleHueSseEvent(payload) {
  if (!Array.isArray(payload)) return;

  payload.forEach((batch) => {
    if (!batch.data || !Array.isArray(batch.data)) return;

    batch.data.forEach((item) => {
      if (item.type !== "light") return;

      const light = appState.lights.get(item.id);
      const card = document.getElementById(`light-card-${item.id}`);

      // 1. Mise à jour de l'état On/Off
      if (item.on !== undefined && item.on !== null) {
        const isOn = item.on.on;
        if (light) {
          if (!light.on) light.on = { on: isOn };
          else light.on.on = isOn;
        }
        updateLightCardState(item.id, isOn);
      }

      // 2. Mise à jour de la luminosité (uniquement si l'utilisateur ne manipule pas le slider)
      if (item.dimming && card) {
        const slider = card.querySelector(".brightness-slider");
        const label = card.querySelector(".brightness-label");
        const newBri = Math.round(item.dimming.brightness);

        if (light) {
          if (!light.dimming) light.dimming = { brightness: newBri };
          else light.dimming.brightness = newBri;
        }

        if (slider && slider.dataset.interacting !== "true") {
          slider.value = newBri;
          if (label) label.textContent = `${newBri}%`;
        }
      }

      // 3. Mise à jour de la température de couleur
      if (item.color_temperature && card) {
        const slider = card.querySelector(".temp-slider");
        const label = card.querySelector(".temp-label");
        const mirek = item.color_temperature.mirek;

        if (slider && slider.dataset.interacting !== "true" && mirek) {
          slider.value = mirek;
          if (label) label.textContent = `${Math.round(1000000 / mirek)}K`;
        }
      }
    });
  });

  updateActiveLightsSummary();
}

// Utilitaire anti-XSS
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
