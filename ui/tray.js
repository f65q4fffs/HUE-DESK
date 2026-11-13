/**
 * HueDesk - Mini Flyout System Tray Controller
 */

const tauriCore = window.__TAURI__ ? window.__TAURI__.core : null;

let localRooms = [];
let localProfiles = [];
let activeProfileId = null;

// Initialisation
document.addEventListener("DOMContentLoaded", () => {
  setupHeader();
  setupQuickShortcuts();
  setupFooter();
  refreshData();

  // Recharger lors de la prise de focus
  window.addEventListener("focus", () => {
    refreshData();
  });

  // Rafraîchissement périodique léger (3s)
  setInterval(() => {
    refreshData();
  }, 3000);
});

/* ================= 1. EN-TÊTE & NAVIGATION ================= */
function setupHeader() {
  const btnExpand = document.getElementById("btn-tray-expand");
  if (btnExpand) {
    btnExpand.addEventListener("click", async () => {
      if (tauriCore) {
        try {
          await tauriCore.invoke("open_main_window");
        } catch (e) {
          console.error("Erreur open_main_window:", e);
        }
      }
    });
  }
}

/* ================= 2. RACCOURCIS RAPIDES ================= */
function setupQuickShortcuts() {
  // Tout Allumer
  const btnAllOn = document.getElementById("btn-quick-on");
  if (btnAllOn) {
    btnAllOn.addEventListener("click", async () => {
      if (!tauriCore) return;
      try {
        const lights = await tauriCore.invoke("get_lights");
        for (const light of lights) {
          await tauriCore.invoke("toggle_light", { lightId: light.id, on: true });
        }
        setTimeout(refreshData, 300);
      } catch (e) {
        console.error("Erreur Tout Allumer:", e);
      }
    });
  }

  // Tout Éteindre
  const btnAllOff = document.getElementById("btn-quick-off");
  if (btnAllOff) {
    btnAllOff.addEventListener("click", async () => {
      if (!tauriCore) return;
      try {
        const lights = await tauriCore.invoke("get_lights");
        for (const light of lights) {
          await tauriCore.invoke("toggle_light", { lightId: light.id, on: false });
        }
        activeProfileId = null;
        updateProfileButtonsVisual();
        setTimeout(refreshData, 300);
      } catch (e) {
        console.error("Erreur Tout Éteindre:", e);
      }
    });
  }

  // Mode Nuit (Veilleuse chaude 10%, 2200K)
  const btnNight = document.getElementById("btn-quick-night");
  if (btnNight) {
    btnNight.addEventListener("click", async () => {
      if (!tauriCore) return;
      try {
        const lights = await tauriCore.invoke("get_lights");
        for (const light of lights) {
          await tauriCore.invoke("toggle_light", { lightId: light.id, on: true });
          await tauriCore.invoke("set_brightness", { lightId: light.id, brightness: 10.0 });
          await tauriCore.invoke("set_color_temperature", { lightId: light.id, mirek: 454 });
        }
        activeProfileId = null;
        updateProfileButtonsVisual();
        setTimeout(refreshData, 300);
      } catch (e) {
        console.error("Erreur Mode Nuit:", e);
      }
    });
  }
}

/* ================= 3. PIÈCES & LUMINOSITÉ ================= */
async function loadRooms() {
  if (!tauriCore) return;
  try {
    const rooms = await tauriCore.invoke("get_rooms");
    const lights = await tauriCore.invoke("get_lights");
    localRooms = rooms || [];

    const container = document.getElementById("tray-rooms-list");
    if (!container) return;

    if (localRooms.length === 0) {
      container.innerHTML = `<div class="tray-loading-placeholder">Aucune pièce détectée</div>`;
      return;
    }

    container.innerHTML = "";

    localRooms.forEach((room) => {
      // Trouver les lampes de la pièce
      const roomLights = lights.filter((l) => {
        if (!room.children) return false;
        return room.children.some((c) => c.rid === l.id || c.rid === l.owner?.rid);
      });

      // Calculer si au moins une lampe est allumée et la luminosité moyenne
      const onLights = roomLights.filter((l) => l.on && l.on.on);
      const isAnyOn = onLights.length > 0;
      let avgBrightness = 100;
      if (onLights.length > 0) {
        const total = onLights.reduce((acc, l) => acc + (l.dimming ? l.dimming.brightness : 100), 0);
        avgBrightness = Math.round(total / onLights.length);
      }

      const card = document.createElement("div");
      card.className = "tray-room-card";
      card.dataset.roomId = room.id;

      card.innerHTML = `
        <div class="room-card-header">
          <div class="room-name-group">
            <span class="room-card-name">${escapeHtml(room.metadata?.name || "Pièce")}</span>
            <span class="room-card-count">(${roomLights.length} ${roomLights.length > 1 ? "lumières" : "lumière"})</span>
          </div>
          <label class="switch">
            <input type="checkbox" class="room-toggle-input" ${isAnyOn ? "checked" : ""} />
            <span class="slider-round"></span>
          </label>
        </div>
        <div class="room-slider-row">
          <span class="room-slider-label">Tout régler :</span>
          <input type="range" min="1" max="100" value="${avgBrightness}" class="tray-brightness-slider" />
        </div>
      `;

      // Événement Toggle Pièce
      const toggleInput = card.querySelector(".room-toggle-input");
      toggleInput.addEventListener("change", async (e) => {
        const targetState = e.target.checked;
        try {
          await tauriCore.invoke("toggle_room", { roomId: room.id, on: targetState });
          setTimeout(refreshData, 300);
        } catch (err) {
          console.error("Erreur toggle pièce:", err);
        }
      });

      // Événement Slider Luminosité
      const slider = card.querySelector(".tray-brightness-slider");
      updateSliderTrack(slider, avgBrightness);

      let sliderTimeout = null;
      slider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        updateSliderTrack(slider, val);
        clearTimeout(sliderTimeout);
        sliderTimeout = setTimeout(async () => {
          try {
            await tauriCore.invoke("set_room_brightness", { roomId: room.id, brightness: val });
          } catch (err) {
            console.error("Erreur réglage luminosité pièce:", err);
          }
        }, 80);
      });

      container.appendChild(card);
    });
  } catch (e) {
    console.error("Erreur chargement pièces:", e);
  }
}

/* ================= 4. PROFILS D'AMBIANCE ================= */
async function loadProfiles() {
  if (!tauriCore) return;
  try {
    const profiles = await tauriCore.invoke("get_profiles");
    localProfiles = profiles || [];

    const container = document.getElementById("tray-profiles-list");
    if (!container) return;

    if (localProfiles.length === 0) {
      container.innerHTML = `<div class="tray-loading-placeholder">Aucun profil enregistré</div>`;
      return;
    }

    container.innerHTML = "";

    localProfiles.forEach((p) => {
      const btn = document.createElement("button");
      btn.className = `tray-profile-btn ${p.id === activeProfileId ? "active" : ""}`;
      btn.dataset.profileId = p.id;
      btn.innerHTML = `<span>${escapeHtml(p.name)}</span>`;

      btn.addEventListener("click", async () => {
        activeProfileId = p.id;
        updateProfileButtonsVisual();
        try {
          await tauriCore.invoke("apply_profile", { id: p.id });
          setTimeout(refreshData, 300);
        } catch (e) {
          console.error("Erreur apply_profile:", e);
        }
      });

      container.appendChild(btn);
    });
  } catch (e) {
    console.error("Erreur chargement profils:", e);
  }
}

function updateProfileButtonsVisual() {
  const buttons = document.querySelectorAll(".tray-profile-btn");
  buttons.forEach((b) => {
    if (b.dataset.profileId === activeProfileId) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });
}

/* ================= 5. PIED DE PAGE ================= */
function setupFooter() {
  const btnSettings = document.getElementById("btn-tray-settings");
  if (btnSettings) {
    btnSettings.addEventListener("click", async () => {
      if (tauriCore) {
        try {
          await tauriCore.invoke("open_settings_in_main");
        } catch (e) {
          console.error("Erreur open_settings_in_main:", e);
        }
      }
    });
  }

  const btnQuit = document.getElementById("btn-tray-quit");
  if (btnQuit) {
    btnQuit.addEventListener("click", async () => {
      if (tauriCore) {
        try {
          await tauriCore.invoke("exit_app");
        } catch (e) {
          console.error("Erreur exit_app:", e);
        }
      }
    });
  }
}

/* ================= 6. RAFRAÎCHISSEMENT GLOBAL ================= */
async function refreshData() {
  await loadRooms();
  await loadProfiles();
}

function updateSliderTrack(slider, value) {
  if (!slider) return;
  const pct = Math.max(0, Math.min(100, parseFloat(value) || 0));
  slider.style.background = `linear-gradient(to right, #b45309 0%, #f59e0b ${pct * 0.7}%, #fef08a ${pct}%, rgba(255, 255, 255, 0.12) ${pct}%, rgba(255, 255, 255, 0.12) 100%)`;
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
