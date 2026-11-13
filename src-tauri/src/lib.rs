pub mod audio;
pub mod hue;

use hue::HueState;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Window, WindowEvent,
};

// Commande Tauri : Ouvre la fenêtre principale depuis le tray flyout
#[tauri::command]
fn open_main_window(app: tauri::AppHandle) {
    if let Some(tray) = app.get_webview_window("tray") {
        let _ = tray.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

/// Commande Tauri : Ouvre les paramètres dans la fenêtre principale depuis le tray flyout
#[tauri::command]
fn open_settings_in_main(app: tauri::AppHandle) {
    if let Some(tray) = app.get_webview_window("tray") {
        let _ = tray.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        let _ = main.emit("open-settings", ());
    }
}

/// Commande Tauri : Quitte complètement l'application
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Commande Tauri : Masque la fenêtre principale vers la zone de notification
#[tauri::command]
fn hide_window(window: Window) {
    let _ = window.hide();
}

/// Commande Tauri : Alterne entre agrandi et taille normale
#[tauri::command]
fn toggle_maximize(window: Window) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unminimize();
        } else {
            let _ = window.maximize();
        }
    }
}

/// Commande Tauri : Réduit la fenêtre
#[tauri::command]
fn minimize_window(window: Window) {
    let _ = window.minimize();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            println!("[SingleInstance] Nouvelle tentative de lancement : réveil de la fenêtre existante");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // Chargement de la configuration initiale (%APPDATA%)
            let initial_config = hue::storage::load_config(app.handle()).unwrap_or_default();
            let hue_state = HueState::new(initial_config.clone());

            // Démarrage automatique du flux SSE en arrière-plan si le pont est déjà configuré
            if let (Some(ip), Some(username)) = (&initial_config.bridge_ip, &initial_config.username) {
                let handle = hue::sse::start_sse_worker(app.handle().clone(), ip.clone(), username.clone());
                *hue_state.sse_handle.blocking_lock() = Some(handle);
            }

            app.manage(hue_state);
            app.manage(audio::AudioState::new());

            // Construction de l'icône dans la barre des tâches (System Tray)
            let mut tray_builder = TrayIconBuilder::new()
                .show_menu_on_left_click(false)
                .tooltip("HueDesk - Contrôleur local Philips Hue")
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Right,
                            button_state: MouseButtonState::Up,
                            rect,
                            ..
                        } => {
                            let app = tray.app_handle();
                            if let Some(tray_win) = app.get_webview_window("tray") {
                                if tray_win.is_visible().unwrap_or(false) {
                                    let _ = tray_win.hide();
                                } else {
                                    let scale_factor = tray_win.scale_factor().unwrap_or(1.0);
                                    let win_w = 340.0 * scale_factor;
                                    let win_h = 525.0 * scale_factor;

                                    let monitor = tray_win
                                        .current_monitor()
                                        .ok()
                                        .flatten()
                                        .or_else(|| tray_win.primary_monitor().ok().flatten());

                                    let (mon_x, mon_y, mon_w, mon_h) = if let Some(m) = monitor {
                                        (
                                            m.position().x as f64,
                                            m.position().y as f64,
                                            m.size().width as f64,
                                            m.size().height as f64,
                                        )
                                    } else {
                                        (0.0, 0.0, 1920.0 * scale_factor, 1080.0 * scale_factor)
                                    };

                                    let (tray_x, tray_y) = match rect.position {
                                        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
                                        tauri::Position::Logical(l) => {
                                            (l.x * scale_factor, l.y * scale_factor)
                                        }
                                    };

                                    let (tray_w, _tray_h) = match rect.size {
                                        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
                                        tauri::Size::Logical(l) => {
                                            (l.width * scale_factor, l.height * scale_factor)
                                        }
                                    };

                                    let mut target_x = if tray_w > 0.0 {
                                        tray_x + (tray_w / 2.0) - (win_w / 2.0)
                                    } else {
                                        mon_x + mon_w - win_w - (16.0 * scale_factor)
                                    };

                                    let min_x = mon_x + (8.0 * scale_factor);
                                    let max_x = mon_x + mon_w - win_w - (8.0 * scale_factor);
                                    if target_x < min_x {
                                        target_x = min_x;
                                    } else if target_x > max_x {
                                        target_x = max_x;
                                    }

                                    let mut target_y = if tray_y > 0.0 {
                                        tray_y - win_h - (10.0 * scale_factor)
                                    } else {
                                        mon_y + mon_h - win_h - (60.0 * scale_factor)
                                    };

                                    let min_y = mon_y + (8.0 * scale_factor);
                                    let max_y = mon_y + mon_h - win_h - (8.0 * scale_factor);
                                    if target_y < min_y {
                                        target_y = min_y;
                                    } else if target_y > max_y {
                                        target_y = max_y;
                                    }

                                    let _ = tray_win.set_position(tauri::PhysicalPosition::new(
                                        target_x as i32,
                                        target_y as i32,
                                    ));

                                    let _ = tray_win.set_shadow(false);
                                    let _ = tray_win.show();
                                    let _ = tray_win.set_focus();
                                }
                            }
                        }
                        _ => {}
                    }
                });

            // Utilise l'icône par défaut de l'application si présente
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            // Forcer l'affichage de la fenêtre principale sans ombre DWM Windows
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            if let Some(tray_win) = app.get_webview_window("tray") {
                let _ = tray_win.set_shadow(false);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            minimize_window,
            toggle_maximize,
            open_main_window,
            open_settings_in_main,
            exit_app,
            hue::discover_bridge,
            hue::verify_manual_ip,
            hue::start_pairing,
            hue::get_connection_status,
            hue::get_rooms,
            hue::get_lights,
            hue::toggle_light,
            hue::set_brightness,
            hue::set_color,
            hue::set_color_temperature,
            hue::toggle_room,
            hue::set_room_brightness,
            hue::assign_light_to_room,
            hue::set_light_effect,
            hue::create_room,
            hue::delete_room,
            hue::rename_room,
            hue::rename_light,
            hue::set_room_color,
            hue::set_room_effect,
            hue::drag_window,
            hue::profiles::get_profiles,
            hue::profiles::save_profile,
            hue::profiles::delete_profile,
            hue::profiles::apply_profile,
            hue::profiles::capture_current_profile,
            audio::start_audio_sync,
            audio::stop_audio_sync,
            audio::get_audio_sync_status,
            audio::get_audio_devices
        ])
        .on_window_event(|window, event| {
            // Auto-masquage du mini-flyout dès qu'il perd le focus
            if let WindowEvent::Focused(false) = event {
                if window.label() == "tray" {
                    let _ = window.hide();
                }
            }
            // Interception de la fermeture : masquage dans le System Tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("Erreur lors de l'exécution de l'application Tauri");
}
