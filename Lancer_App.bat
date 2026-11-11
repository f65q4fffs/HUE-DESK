@echo off
cd /d "%~dp0"

:: Ferme les instances résiduelles éventuelles
taskkill /f /im hue-light-app.exe >nul 2>&1

:: Lancement propre de l'application Tauri v2
start "" "src-tauri\target\debug\hue-light-app.exe"
