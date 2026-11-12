use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::hue::client::{ColorState, DimmingState, LightUpdatePayload, OnState, XyColor};
use crate::hue::color::hex_to_cie_xy;
use crate::hue::HueState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioVisualizerConfig {
    pub device_name: Option<String>,
    pub sensitivity: f32,
    pub palette: String,
    pub bass_boost: bool,
    pub min_brightness: Option<f32>,
    pub max_brightness: Option<f32>,
    pub target_light_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioSpectrumPayload {
    pub bins: Vec<f32>,
    pub bass: f32,
    pub rms: f32,
    pub current_hex: String,
    pub current_brightness: f32,
}

pub struct AudioState {
    pub is_running: Arc<AtomicBool>,
    pub stop_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            stop_tx: Mutex::new(None),
        }
    }
}

/// Commande Tauri : Liste tous les périphériques de sortie audio disponibles
#[tauri::command]
pub async fn get_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_name = host.default_output_device().and_then(|d| d.name().ok());

    let mut result = Vec::new();
    if let Ok(devices) = host.output_devices() {
        for dev in devices {
            if let Ok(name) = dev.name() {
                let is_default = default_name.as_ref().map(|n| n == &name).unwrap_or(false);
                // Éviter les doublons
                if !result.iter().any(|d: &AudioDeviceInfo| d.name == name) {
                    result.push(AudioDeviceInfo {
                        id: name.clone(),
                        name,
                        is_default,
                    });
                }
            }
        }
    }
    Ok(result)
}

fn build_loopback_stream_for_type<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    ring_buffer: Arc<Mutex<Vec<f32>>>,
    channels: usize,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::Sample + cpal::SizedSample + 'static,
    f32: cpal::FromSample<T>,
{
    const FFT_SIZE: usize = 1024;
    let rb_clone = ring_buffer.clone();

    device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            if let Ok(mut buffer) = rb_clone.lock() {
                let mut i = 0;
                while i < data.len() {
                    let mut sum = 0.0f32;
                    for ch in 0..channels {
                        if i + ch < data.len() {
                            sum += data[i + ch].to_sample::<f32>();
                        }
                    }
                    buffer.push(sum / channels as f32);
                    i += channels;
                }
                if buffer.len() > FFT_SIZE * 8 {
                    let drain_count = buffer.len() - FFT_SIZE * 2;
                    buffer.drain(0..drain_count);
                }
            }
        },
        |err| eprintln!("[Audio Loopback] Erreur de flux audio : {}", err),
        None,
    )
}

/// Commande Tauri : Démarre la capture audio WASAPI loopback et l'analyse FFT
#[tauri::command]
pub async fn start_audio_sync(
    app: AppHandle,
    state: State<'_, AudioState>,
    config: AudioVisualizerConfig,
) -> Result<(), String> {
    stop_audio_sync_internal(&state);

    let is_running = state.is_running.clone();
    is_running.store(true, Ordering::SeqCst);

    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut guard = state.stop_tx.lock().unwrap();
        *guard = Some(stop_tx);
    }

    let hue_state = app.state::<HueState>();
    let client = match hue_state.get_client().await {
        Ok(c) => Some(c),
        Err(e) => {
            println!("[Audio Sync] Pont Hue non connecté ({}), fonctionnement en mode visualisation seul.", e);
            None
        }
    };

    let app_handle = app.clone();
    let is_running_clone = is_running.clone();

    std::thread::spawn(move || {
        let host = cpal::default_host();

        // Sélection du périphérique selon le nom demandé ou périphérique par défaut
        let target_device_name = config.device_name.clone();
        let device = if let Some(ref name) = target_device_name {
            if !name.trim().is_empty() {
                let mut found = None;
                if let Ok(devs) = host.output_devices() {
                    for d in devs {
                        if let Ok(d_name) = d.name() {
                            if &d_name == name {
                                found = Some(d);
                                break;
                            }
                        }
                    }
                }
                found.or_else(|| host.default_output_device())
            } else {
                host.default_output_device()
            }
        } else {
            host.default_output_device()
        };

        let device = match device {
            Some(d) => d,
            None => {
                eprintln!("[Audio Sync] Aucun périphérique audio disponible.");
                is_running_clone.store(false, Ordering::SeqCst);
                return;
            }
        };

        let dev_name = device.name().unwrap_or_else(|_| "Inconnu".to_string());
        println!("[Audio Sync] Périphérique sélectionné pour la capture loopback : {}", dev_name);

        let default_config = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[Audio Sync] Impossible de lire la configuration audio du périphérique '{}' : {}", dev_name, e);
                is_running_clone.store(false, Ordering::SeqCst);
                return;
            }
        };

        let sample_rate = default_config.sample_rate().0;
        let channels = default_config.channels() as usize;
        let sample_format = default_config.sample_format();
        let stream_config: cpal::StreamConfig = default_config.into();

        const FFT_SIZE: usize = 1024;
        let ring_buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(FFT_SIZE * 4)));

        // Construction du flux avec support multi-formats WASAPI (f32, i16, u16)
        let stream = match sample_format {
            cpal::SampleFormat::F32 => {
                build_loopback_stream_for_type::<f32>(&device, &stream_config, ring_buffer.clone(), channels)
            }
            cpal::SampleFormat::I16 => {
                build_loopback_stream_for_type::<i16>(&device, &stream_config, ring_buffer.clone(), channels)
            }
            cpal::SampleFormat::U16 => {
                build_loopback_stream_for_type::<u16>(&device, &stream_config, ring_buffer.clone(), channels)
            }
            other => {
                eprintln!("[Audio Sync] Format d'échantillonnage audio non supporté : {:?}", other);
                is_running_clone.store(false, Ordering::SeqCst);
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[Audio Sync] Échec initialisation du flux loopback WASAPI : {}", e);
                is_running_clone.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("[Audio Sync] Échec stream.play() : {}", e);
            is_running_clone.store(false, Ordering::SeqCst);
            return;
        }

        println!("[Audio Sync] Capture active sur '{}' ({} Hz, {:?})", dev_name, sample_rate, sample_format);

        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);

        let mut hann_window = vec![0.0f32; FFT_SIZE];
        for i in 0..FFT_SIZE {
            hann_window[i] = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos());
        }

        // Pré-calcul des index fréquentiels logarithmiques pour 24 bandes (25 Hz -> 14 000 Hz)
        const NUM_BANDS: usize = 24;
        let hz_per_bin = sample_rate as f32 / FFT_SIZE as f32;
        let mut band_indices: Vec<(usize, usize)> = Vec::with_capacity(NUM_BANDS);
        let min_freq: f32 = 25.0;
        let max_freq: f32 = 14000.0;
        for b in 0..NUM_BANDS {
            let f_start = min_freq * (max_freq / min_freq).powf(b as f32 / NUM_BANDS as f32);
            let f_end = min_freq * (max_freq / min_freq).powf((b + 1) as f32 / NUM_BANDS as f32);
            let mut start_bin = (f_start / hz_per_bin).floor() as usize;
            let mut end_bin = (f_end / hz_per_bin).ceil() as usize;
            if start_bin < 1 { start_bin = 1; }
            if end_bin <= start_bin { end_bin = start_bin + 1; }
            if end_bin > FFT_SIZE / 2 { end_bin = FFT_SIZE / 2; }
            band_indices.push((start_bin, end_bin));
        }

        let mut smoothed_bass: f32 = 0.0;
        let min_brightness = config.min_brightness.unwrap_or(15.0).clamp(5.0, 50.0);
        let max_brightness = config.max_brightness.unwrap_or(100.0).clamp(min_brightness + 10.0, 100.0);
        let mut smoothed_bri: f32 = min_brightness;

        let mut last_hue_update = Instant::now();
        let mut last_ui_emit = Instant::now();
        let mut last_sent_bri: f32 = min_brightness;
        let mut last_sent_hex: String = String::new();

        // AGC (Automatic Gain Control) & Suivi de crête
        let mut peak_tracker: f32 = 0.05;
        let sensitivity = config.sensitivity.clamp(0.2, 5.0);
        let bass_boost = config.bass_boost;
        let palette = config.palette.clone();
        let target_lights = config.target_light_ids.clone();

        let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[Audio Sync] Échec création runtime Tokio : {}", e);
                return;
            }
        };

        while is_running_clone.load(Ordering::Relaxed) {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            std::thread::sleep(Duration::from_millis(16)); // ~60 Hz

            let samples = {
                if let Ok(buf) = ring_buffer.lock() {
                    if buf.len() >= FFT_SIZE {
                        Some(buf[buf.len() - FFT_SIZE..].to_vec())
                    } else {
                        None
                    }
                } else {
                    None
                }
            };

            let samples = match samples {
                Some(s) => s,
                None => continue,
            };

            // Mesure du niveau RMS direct (signal level)
            let rms_energy: f32 = (samples.iter().map(|&s| s * s).sum::<f32>() / FFT_SIZE as f32).sqrt();
            let is_silence = rms_energy < 0.0008;

            // AGC dynamique : adaptatif avec décroissance douce
            if rms_energy > peak_tracker {
                peak_tracker = rms_energy * 0.4 + peak_tracker * 0.6;
            } else {
                peak_tracker = (peak_tracker * 0.995).max(0.015);
            }

            let agc_gain = (1.0 / peak_tracker.max(0.015)) * (sensitivity * 0.85);

            // Préparation du buffer FFT avec fenêtrage Hann et gain adaptatif
            let mut complex_buffer: Vec<Complex<f32>> = samples
                .iter()
                .zip(hann_window.iter())
                .map(|(&s, &w)| Complex::new(s * w * agc_gain, 0.0))
                .collect();

            fft.process(&mut complex_buffer);

            let num_bins = FFT_SIZE / 2;
            let mut magnitudes = vec![0.0f32; num_bins];
            for i in 0..num_bins {
                magnitudes[i] = (complex_buffer[i].norm() / (FFT_SIZE as f32 / 4.0)).min(2.5);
            }

            // Calcul des 24 bandes spectrales logarithmiques
            let mut visual_bins = vec![0.0f32; NUM_BANDS];
            for b in 0..NUM_BANDS {
                let (start, end) = band_indices[b];
                let count = (end - start).max(1);
                let sum: f32 = magnitudes[start..end].iter().sum();
                let avg = sum / count as f32;
                visual_bins[b] = if is_silence { 0.0 } else { (avg * 1.6).clamp(0.0, 1.0) };
            }

            // Énergie des Basses (bandes 0 à 4 : ~25 Hz à 200 Hz)
            let raw_bass = if is_silence {
                0.0
            } else {
                let bass_sum: f32 = visual_bins[0..5].iter().sum();
                let b_avg = bass_sum / 5.0;
                (b_avg * (if bass_boost { 1.7 } else { 1.15 })).min(1.0)
            };

            // Attack ultra-rapide sur kick, Decay progressif
            if raw_bass > smoothed_bass {
                smoothed_bass = raw_bass * 0.92 + smoothed_bass * 0.08;
            } else {
                smoothed_bass = smoothed_bass * 0.76 + raw_bass * 0.24;
            }

            // Calcul de la luminosité percutante avec plage min_brightness -> max_brightness
            let target_bri = if is_silence {
                min_brightness
            } else {
                let punch = smoothed_bass.powf(1.1);
                (min_brightness + punch * (max_brightness - min_brightness)).min(max_brightness)
            };

            // Enveloppe Fast Attack (bondit sur les crêtes) / Smooth Release (descente fluide)
            if target_bri > smoothed_bri {
                smoothed_bri = smoothed_bri * 0.15 + target_bri * 0.85;
            } else {
                smoothed_bri = smoothed_bri * 0.75 + target_bri * 0.25;
            }

            // Détection couleur (Énergie Médiums vs Aigus)
            let mids_sum: f32 = visual_bins[5..15].iter().sum();
            let highs_sum: f32 = visual_bins[15..24].iter().sum();
            let energy_ratio = if mids_sum + highs_sum > 0.05 {
                (highs_sum / (mids_sum + highs_sum)).clamp(0.0, 1.0)
            } else {
                0.5
            };

            let current_hex = match palette.as_str() {
                "soft" => {
                    if energy_ratio < 0.35 {
                        "#ff9500".to_string()
                    } else if energy_ratio < 0.7 {
                        "#ff7043".to_string()
                    } else {
                        "#f48fb1".to_string()
                    }
                }
                "party" => {
                    if energy_ratio < 0.35 {
                        "#ff0033".to_string()
                    } else if energy_ratio < 0.7 {
                        "#00ff66".to_string()
                    } else {
                        "#0077ff".to_string()
                    }
                }
                _ => {
                    if energy_ratio < 0.33 {
                        "#00f3ff".to_string()
                    } else if energy_ratio < 0.66 {
                        "#8b00ff".to_string()
                    } else {
                        "#ff007f".to_string()
                    }
                }
            };

            // Émission vers l'UI (30-60 fps)
            if last_ui_emit.elapsed() >= Duration::from_millis(30) {
                let rms_pct = (rms_energy * 350.0 * sensitivity).clamp(0.0, 100.0);
                let payload = AudioSpectrumPayload {
                    bins: visual_bins,
                    bass: smoothed_bass.clamp(0.0, 1.0),
                    rms: if is_silence { 0.0 } else { rms_pct },
                    current_hex: current_hex.clone(),
                    current_brightness: smoothed_bri.round(),
                };

                let _ = app_handle.emit("audio-spectrum-data", payload);
                last_ui_emit = Instant::now();
            }

            // Envoi vers le pont Hue (10 updates/sec max avec lissage et seuil de deadband)
            if let Some(ref c) = client {
                if last_hue_update.elapsed() >= Duration::from_millis(90) && !target_lights.is_empty() {
                    let bri_diff = (smoothed_bri - last_sent_bri).abs();
                    let color_diff = current_hex != last_sent_hex;

                    if bri_diff >= 3.0 || color_diff {
                        let xy_opt = hex_to_cie_xy(&current_hex).ok();
                        let target_bri_round = smoothed_bri.round();
                        let client_clone = c.clone();
                        let lights_clone = target_lights.clone();

                        rt.block_on(async {
                            let mut join_set = tokio::task::JoinSet::new();
                            for lid in lights_clone {
                                let cl = client_clone.clone();
                                let xy_c = xy_opt;
                                join_set.spawn(async move {
                                    let payload = LightUpdatePayload {
                                        on: Some(OnState { on: true }),
                                        dimming: Some(DimmingState { brightness: target_bri_round }),
                                        color: xy_c.map(|(x, y)| ColorState { xy: XyColor { x, y } }),
                                        dynamics: Some(crate::hue::client::DynamicsState { duration: 80 }),
                                        ..Default::default()
                                    };
                                    let _ = cl.update_light(&lid, &payload).await;
                                });
                            }
                            while let Some(_) = join_set.join_next().await {}
                        });

                        last_sent_bri = smoothed_bri;
                        last_sent_hex = current_hex;
                        last_hue_update = Instant::now();
                    }
                }
            }
        }

        let _ = stream.pause();
        println!("[Audio Sync] Flux audio arrêté proprement.");
    });

    Ok(())
}

fn stop_audio_sync_internal(state: &AudioState) {
    state.is_running.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = state.stop_tx.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }
}

/// Commande Tauri : Arrête la capture audio
#[tauri::command]
pub async fn stop_audio_sync(state: State<'_, AudioState>) -> Result<(), String> {
    stop_audio_sync_internal(&state);
    Ok(())
}

/// Commande Tauri : Vérifie si la synchronisation audio est en cours
#[tauri::command]
pub async fn get_audio_sync_status(state: State<'_, AudioState>) -> Result<bool, String> {
    Ok(state.is_running.load(Ordering::Relaxed))
}
