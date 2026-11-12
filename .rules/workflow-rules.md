# RÈGLES DE WORKFLOW, COMMANDES & INTERDICTIONS

## COMMANDES MACHINE VÉRIFIÉES
- **Vérification syntaxique JS** : `node -c ui/main.js`
- **Vérification compilation Rust** : `cargo check --manifest-path src-tauri/Cargo.toml`
- **Tests unitaires Rust** : `cargo test --manifest-path src-tauri/Cargo.toml`
- **Tests API scratch** : `node scratch/test_bridge.js`
- **Build complet** : `cargo build --manifest-path src-tauri/Cargo.toml`
- **Lancement Dev Windows** : `cmd.exe /c Lancer_App.bat` ou `powershell -Command "Start-Process -FilePath '.\src-tauri\target\debug\hue-light-app.exe'"`

## RÈGLES D'EXÉCUTION POUR L'AGENT
1. **Validation systématique** : Après toute modification dans `ui/`, exécuter `node -c ui/main.js`. Après toute modification dans `src-tauri/`, exécuter `cargo check --manifest-path src-tauri/Cargo.toml`.
2. **Mise à jour obligatoire du README** : Avant CHAQUE push Git ou préparation de commit, le fichier `README.md` doit impérativement être passé en revue et mis à jour pour refléter fidèlement l'état réel de l'application (fonctionnalités ajoutées, correctifs, captures d'écran, instructions d'installation et raccourcis).
3. **Zéro sur-ingénierie** : NE PAS créer de `package.json`, `tsconfig.json` ou d'alias d'imports `@/...` à la racine.
4. **Certificats locaux** : Conserver `reqwest::ClientBuilder::danger_accept_invalid_certs(true)` pour la communication HTTPS locale avec le pont Philips Hue.
5. **Nettoyage des événements** : Toujours détacher les listeners temporaires (`onclick = null`, `onkeydown = null`) lors de la fermeture des modales ou tiroirs UI pour éviter les fuites mémoire sur WebView2.
6. **Audit de sécurité pré-push** : Avant tout push ou commit, vérifier systématiquement qu'aucune IP fixe réelle, clé d'API, token ou identifiant sensible ne soit présent dans le code versionné.
