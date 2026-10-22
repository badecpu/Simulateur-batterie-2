# Shelly Battery Simulator

PWA statique pour GitHub Pages.

## Utilisation
1. Déposer ces fichiers dans un dépôt GitHub.
2. Activer GitHub Pages sur la branche souhaitée.
3. Ouvrir l'URL HTTPS de la PWA.
4. Importer un export CSV Shelly 3EM.
5. Configurer les paramètres : ils sont sauvegardés dans `localStorage`.

Le CSV reste dans le navigateur et n'est pas téléversé par l'application.

## Hypothèses reprises du script Python fourni
- Phase A = consommation.
- Phase B = production PV.
- Retour Phase A négatif = énergie injectée.
- Tarif jour : 06:00–22:00 ; tarif nuit : 22:00–06:00.
- Batterie initialisée à son SOC minimum.
- Simulation continue sur l'ensemble de l'historique.
- Rendement aller-retour réparti à parts égales entre charge et décharge.
- Puissance maximale appliquée à la charge et à la décharge.
- Cycles = énergie cumulée chargée / capacité.
