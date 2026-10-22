# PV Valorisation — surplus, batterie et ballon ECS

Outil local pour comparer la référence photovoltaïque seule à trois stratégies : batterie, ballon électrique ECS piloté par surplus, et combinaison des deux. **Aucune donnée réelle n'est incluse dans le dépôt.** Les exemples sont synthétiques.

## État du livrable

Ce dépôt fournit un socle exécutable : fonctions d'ingestion tolérantes, conversions d'énergie, modèles simplifiés batterie/ballon, allocation exclusive du surplus, métriques financières, interface statique d'aperçu, configuration et tests. Il ne faut pas confondre ce socle avec une analyse réelle déjà calculée : les exports de l'utilisateur ne sont pas présents et l'interface web n'interprète pas encore les fichiers sélectionnés. Le moteur Python n'est pas encore un pipeline d'analyse complètement automatisé pour tous les formats Shelly/EDF.

## Installation

```bash
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows : .venv\Scripts\activate
pip install -e '.[dev]'
pytest -q
ruff check .
python pv_analysis.py
```

Ouvrir `web/index.html` pour voir l'interface statique. Elle ne téléverse aucun fichier. À ce stade, les champs de fichiers sont des repères d'interface et ne sont pas encore consommés par les calculs web.

## Formats attendus et ingestion

CSV ou XLSX. La fonction `ingest.loaders.normalize_timeseries` tente de détecter une colonne date/heure et une colonne de mesure. Pour un usage fiable, préciser explicitement les colonnes et l'unité (`W`, `kW`, `Wh`, `kWh`). Les données de puissance doivent être intégrées dans le temps ; les données d'énergie doivent être interprétées comme énergie de l'intervalle, jamais comme watts instantanés. Pour des mesures Shelly, confirmer si les valeurs sont une puissance instantanée, une énergie cumulée ou une énergie par intervalle.

Exports utiles :

- Production PV : horodatage + puissance (W) ou énergie d'intervalle (Wh).
- Réseau : import/export séparés, ou puissance signée avec convention documentée.
- Pompe : puissance/énergie dédiée (le facteur de démarrage n'est pas une consommation permanente).
- EDF/Enedis : consommation avec horodatage, tarif HP/HC et couleur Tempo par date ou fichier séparé.
- Gaz : index datés et unité clairement indiquée (m³ ou kWh).

## Hypothèses et limites physiques

- Un surplus net ne peut pas être attribué deux fois. `model.allocation.allocate_surplus` vérifie ce principe.
- La batterie a une capacité en kWh et une limite de puissance en W : les deux contraignent la charge/décharge.
- Le modèle de ballon est un bilan énergétique simplifié, sans stratification, légionelle, mélange réel, thermostat ni hydraulique de chaudière. Il ne suffit pas à valider un montage sanitaire.
- Les données mensuelles ou quotidiennes ne permettent pas de reconstruire fidèlement les pointes et le surplus simultané. Une simulation 15 min est préférable ; extrapolation annuelle doit être séparée des mesures.
- L'ECS ne peut être déduite avec certitude des seuls index gaz sans chauffage que si les dates et l'absence effective de chauffage sont établies. La cuisson et les pertes de chaudière peuvent brouiller l'estimation.
- Le prix évité d'électricité dépend de la couleur Tempo et des heures HP/HC réellement évitées, pas d'un tarif moyen arbitraire.
- La rentabilité doit inclure coût posé, remplacement, dégradation, pertes et durée de vie. ROI simple ne signifie pas VAN actualisée.

## Paramètres à compléter

Dans `config.yaml` : prix Tempo six cases, prix gaz en €/kWh, conversion gaz m³→kWh depuis facture, coût installé du ballon, coût batterie, pertes et puissances à vérifier. Ne pas interpréter les valeurs initiales marquées comme hypothèses comme des données mesurées.

## Analyse réelle à effectuer

1. Importer et auditer chaque fichier ; publier le nombre de points, trous, doublons, unités, couverture temporelle et valeurs aberrantes.
2. Synchroniser les flux et calculer le surplus résiduel après consommation domestique et pompe. Éviter de soustraire la pompe deux fois si elle est déjà incluse dans la mesure réseau/maison.
3. Calculer l'autoconsommation réellement mesurée et l'économie PV seule par heure/couleur Tempo.
4. Estimer l'ECS à partir des périodes sans chauffage, puis borner l'estimation et la corriger saisonnièrement.
5. Simuler chaque option sur les mêmes pas de temps et comparer deux ordres de priorité pour l'option C.
6. Tester prix, puissance, capacité, efficacité, durée de vie, part ECS et surplus dans des scénarios pessimiste/optimiste.

## Confidentialité

Le dossier `data/` est ignoré par Git. Ne jamais committer des exports personnels. L'interface web est statique et n'envoie rien à un serveur ; pour un usage hors ligne, ouvrir les fichiers localement.

## Licence

MIT. Les résultats sont indicatifs et ne constituent ni un audit réglementaire, ni une validation d'installation électrique ou sanitaire.

## Import multiple des exports journaliers Shelly et annuels gaz

Dans `web/index.html`, les champs « Exports Shelly journaliers » et « Exports gaz annuels » acceptent la sélection multiple. Sélectionnez tous les CSV journaliers Shelly ensemble, puis les exports gaz d'une ou plusieurs années. L'aperçu est calculé localement dans le navigateur : aucun fichier n'est téléversé.

- Shelly : lecture des blocs `Phase A`, `Phase B`, `Phase C`, `Retour Phase A/B/C` et `Retour Total`, avec horodatages et valeurs `Wh` par intervalle dans le format d'export testé. Les sommes sont affichées séparément par section ; elles ne sont pas automatiquement assimilées à un surplus avant confirmation du rôle et du signe de chaque phase.
- Gaz : lecture des exports de relevés avec dates, index en m³, consommation par intervalle en m³ et en kWh. Les dates en double sont signalées dans le résumé. Les totaux affichés par année de relève ne répartissent pas encore les intervalles à cheval sur le 1er janvier.
- Les fichiers XLSX gaz sont acceptés par le sélecteur, mais le parseur navigateur actuel lit le texte CSV ; exporter les fichiers gaz en CSV avant import. L'analyse détaillée des fichiers EDF/Enedis et la simulation financière temporelle alimentée par ces imports restent à compléter.

Les exports personnels ne doivent pas être ajoutés au dépôt GitHub ; le dossier `/data/` est exclu par `.gitignore`.
