pub mod audio;
pub mod hue;

use hue::HueState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Window, WindowEvent,
};

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

            // Création des éléments du menu contextuel du System Tray
            let open_item = MenuItem::with_id(app, "open", "Ouvrir", true, None::<&str>)?;
            let turn_off_item = MenuItem::with_id(app, "turn_off", "Tout éteindre", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;

            let tray_menu = Menu::with_items(app, &[&open_item, &turn_off_item, &quit_item])?;

            // Construction de l'icône dans la barre des tâches (System Tray)
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("HueDesk - Contrôleur local Philips Hue")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "turn_off" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(state) = app_clone.try_state::<HueState>() {
                                if let Ok(client) = state.get_client().await {
                                    if let Ok(rooms) = client.get_rooms().await {
                                        for room in rooms {
                                            for service in room.services {
                                                if service.rtype == "grouped_light" {
                                                    let _ = client.update_grouped_light(&service.rid, false).await;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });

            // Utilise l'icône par défaut de l'application si présente
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            // Forcer l'affichage de la fenêtre principale
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            minimize_window,
            toggle_maximize,
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
            // Interception de la fermeture : masquage dans le System Tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("Erreur lors de l'exécution de l'application Tauri");
}
