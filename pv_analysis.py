"""Point d'entrée minimal pour calculs exploratoires depuis séries déjà normalisées."""
from pathlib import Path
import yaml
from finance.metrics import simple_payback_years
from report.markdown import generate_report


def load_config(path="config.yaml"):
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def main():
    cfg = load_config()
    site = cfg["site"]
    payback = simple_payback_years(site["pv_invest_eur"], 0)
    generate_report("report_generated.md", "Analyse photovoltaïque — modèle à alimenter par les exports", [
        ("Données disponibles", "Aucun export réel n'est inclus dans le dépôt. Importez vos propres fichiers localement."),
        ("Référence PV", f"Investissement déclaré : {site['pv_invest_eur']} €. Le retour ne peut pas être calculé sans autoconsommation mesurée et prix évité. Valeur indicative de payback : {payback}."),
        ("Limites", "Le moteur contient des fonctions de simulation élémentaires. La qualité des résultats dépend de la sémantique réelle des colonnes, de la synchronisation des mesures et des paramètres de prix."),
    ])
    print("Rapport créé : report_generated.md")

if __name__ == "__main__":
    main()
