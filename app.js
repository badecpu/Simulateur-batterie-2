"use strict";

/* ============================================================
   1. PARAMÈTRES DE SIMULATION — localStorage
   ============================================================ */

const SETTINGS_KEY = "battSim.settings.v2";
const DATA_KEY = "battSim.data.v1";

const DEFAULT_SETTINGS = {
  tarifJour: 0.2516,
  tarifNuit: 0.2068,
  hcStart: 22,
  hcEnd: 6,
  prixPanneaux: 1200,
  puissanceKwc: 2,
  capaciteKwh: 5,
  prixBatterie: 4000,
  socMinPct: 10,
  socInitialPct: 50,
  rendementPct: 90,
  puissanceMaxKw: 3,
  dureeVieCycles: 6000,
  poolActive: true,
  poolPowerKw: 0.75,
  poolStartHour: 10,
  poolEndHour: 16,
  poolMonthStart: 6,
  poolMonthEnd: 9,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    console.warn("Réglages illisibles, valeurs par défaut utilisées.", e);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

let settings = loadSettings();

function fillSettingsForm() {
  document.getElementById("tarifJour").value = settings.tarifJour;
  document.getElementById("tarifNuit").value = settings.tarifNuit;
  document.getElementById("hcStart").value = settings.hcStart;
  document.getElementById("hcEnd").value = settings.hcEnd;
  document.getElementById("prixPanneaux").value = settings.prixPanneaux;
  document.getElementById("puissanceKwc").value = settings.puissanceKwc;
  document.getElementById("capaciteKwh").value = settings.capaciteKwh;
  document.getElementById("prixBatterie").value = settings.prixBatterie;
  document.getElementById("socMinPct").value = settings.socMinPct;
  document.getElementById("socInitialPct").value = settings.socInitialPct;
  document.getElementById("rendementPct").value = settings.rendementPct;
  document.getElementById("puissanceMaxKw").value = settings.puissanceMaxKw;
  document.getElementById("dureeVieCycles").value = settings.dureeVieCycles;
  document.getElementById("poolActive").checked = settings.poolActive;
  document.getElementById("poolPowerKw").value = settings.poolPowerKw;
  document.getElementById("poolStartHour").value = settings.poolStartHour;
  document.getElementById("poolEndHour").value = settings.poolEndHour;
  document.getElementById("poolMonthStart").value = settings.poolMonthStart;
  document.getElementById("poolMonthEnd").value = settings.poolMonthEnd;
}

function readSettingsForm() {
  return {
    tarifJour: parseFloat(document.getElementById("tarifJour").value) || 0,
    tarifNuit: parseFloat(document.getElementById("tarifNuit").value) || 0,
    hcStart: clampInt(document.getElementById("hcStart").value, 0, 23, 22),
    hcEnd: clampInt(document.getElementById("hcEnd").value, 0, 23, 6),
    prixPanneaux: parseFloat(document.getElementById("prixPanneaux").value) || 0,
    puissanceKwc: parseFloat(document.getElementById("puissanceKwc").value) || 0.1,
    capaciteKwh: parseFloat(document.getElementById("capaciteKwh").value) || 0.1,
    prixBatterie: parseFloat(document.getElementById("prixBatterie").value) || 0,
    socMinPct: clampInt(document.getElementById("socMinPct").value, 0, 90, 10),
    socInitialPct: clampInt(document.getElementById("socInitialPct").value, 0, 100, 50),
    rendementPct: clampInt(document.getElementById("rendementPct").value, 1, 100, 90),
    puissanceMaxKw: parseFloat(document.getElementById("puissanceMaxKw").value) || 0,
    dureeVieCycles: parseInt(document.getElementById("dureeVieCycles").value, 10) || 6000,
    poolActive: document.getElementById("poolActive").checked,
    poolPowerKw: parseFloat(document.getElementById("poolPowerKw").value) || 0,
    poolStartHour: clampInt(document.getElementById("poolStartHour").value, 0, 23, 10),
    poolEndHour: clampInt(document.getElementById("poolEndHour").value, 0, 23, 16),
    poolMonthStart: clampInt(document.getElementById("poolMonthStart").value, 1, 12, 6),
    poolMonthEnd: clampInt(document.getElementById("poolMonthEnd").value, 1, 12, 9),
  };
}

function clampInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ============================================================
   2. DONNÉES HISTORISÉES — fusion et persistance
   ============================================================ */

// masterData : Map<tMs, {t, hour, prod, conso, retour, durH}>
let masterData = new Map();

function loadMasterData() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    masterData = new Map(arr.map((r) => [r.t, r]));
  } catch (e) {
    console.warn("Historique illisible, il sera reconstruit au prochain import.", e);
    masterData = new Map();
  }
}

function persistMasterData() {
  const arr = Array.from(masterData.values()).sort((a, b) => a.t - b.t);
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(arr));
    return { ok: true, count: arr.length };
  } catch (e) {
    console.warn("Impossible de sauvegarder l'historique complet (quota dépassé ?).", e);
    return { ok: false, count: arr.length };
  }
}

function clearMasterData() {
  masterData = new Map();
  localStorage.removeItem(DATA_KEY);
}

/* ============================================================
   3. NAVIGATION PAR ONGLETS
   ============================================================ */

function switchView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  document.querySelectorAll("nav.tabbar button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
}

document.querySelectorAll("nav.tabbar button").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

/* ============================================================
   4. IMPORT CSV — automatique, sans étape de correspondance
   ============================================================ */

const fileStatusEl = document.getElementById("fileStatus");
const historyStatusEl = document.getElementById("historyStatus");

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Lecture impossible pour " + file.name));
    reader.readAsText(file, "UTF-8");
  });
}

/**
 * Parse le format réel des exports Shelly EM3 : une succession de blocs
 * ("Phase A", "Phase B", "Phase C", "Total", "Retour Phase A", ...), chacun
 * suivi d'une ligne d'en-tête "Temps, Wh" puis de lignes "date , valeur".
 * Retourne un objet { "Phase A": Map(dateStr -> valeur Wh), ... }.
 */
function parseShellyBlocks(text) {
  const sections = {};
  let current = null;
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const commaIdx = line.indexOf(",");

    // Ligne sans virgule : titre de section (ex. "Phase A", "Retour Phase A")
    if (commaIdx === -1) {
      current = line;
      if (!sections[current]) sections[current] = new Map();
      continue;
    }

    // Ligne d'en-tête "Temps, Wh" à l'intérieur d'un bloc : on l'ignore
    if (/^temps/i.test(line)) continue;

    // Ligne de donnée "date , valeur"
    if (!current) continue;
    const datePart = line.slice(0, commaIdx).trim();
    const valPart = line.slice(commaIdx + 1).trim();
    const val = parseFloat(valPart.replace(",", "."));
    if (Number.isNaN(val)) continue;
    sections[current].set(datePart, val);
  }

  return sections;
}

function findSection(sections, exactNames) {
  const keys = Object.keys(sections);
  for (const name of exactNames) {
    const match = keys.find((k) => k.trim().toLowerCase() === name.toLowerCase());
    if (match) return sections[match];
  }
  return null;
}

/**
 * Construit les points normalisés {t, hour, prod, conso, retour, durH} en kWh
 * à partir des blocs "Phase A" (conso réseau), "Phase B" (production PV) et
 * "Retour Phase A" (surplus exporté, stocké en valeurs négatives dans le fichier).
 */
function buildPointsFromSections(sections) {
  const consoSection = findSection(sections, ["Phase A"]);
  const prodSection = findSection(sections, ["Phase B"]);
  const retourSection = findSection(sections, ["Retour Phase A"]);

  if (!consoSection && !prodSection) return null; // format non reconnu

  const dateKeys = new Set([
    ...(consoSection ? consoSection.keys() : []),
    ...(prodSection ? prodSection.keys() : []),
  ]);

  const dated = [];
  for (const dateStr of dateKeys) {
    const date = parseTimestamp(dateStr);
    if (!date) continue;
    const consoWh = consoSection ? (consoSection.get(dateStr) || 0) : 0;
    const prodWh = prodSection ? (prodSection.get(dateStr) || 0) : 0;
    const retourRawWh = retourSection ? (retourSection.get(dateStr) || 0) : 0;
    dated.push({
      tMs: date.getTime(),
      hour: date.getHours(),
      consoWh,
      prodWh,
      retourWh: Math.max(0, -retourRawWh), // le fichier stocke l'export en négatif
    });
  }
  dated.sort((a, b) => a.tMs - b.tMs);
  if (dated.length === 0) return null;

  let intervalHours = 1;
  if (dated.length > 1) {
    const diffs = [];
    for (let i = 1; i < Math.min(dated.length, 200); i++) {
      diffs.push((dated[i].tMs - dated[i - 1].tMs) / 3600000);
    }
    diffs.sort((a, b) => a - b);
    const median = diffs[Math.floor(diffs.length / 2)];
    if (median > 0 && Number.isFinite(median)) intervalHours = median;
  }

  return dated.map((d) => ({
    t: d.tMs,
    hour: d.hour,
    prod: d.prodWh / 1000,
    conso: d.consoWh / 1000,
    retour: d.retourWh / 1000,
    durH: intervalHours,
  }));
}

async function handleSelectedFiles(fileList) {
  const files = Array.from(fileList).filter((f) => /\.csv$/i.test(f.name));
  if (files.length === 0) {
    fileStatusEl.textContent = "Aucun fichier .csv trouvé dans la sélection.";
    fileStatusEl.className = "file-status err";
    return;
  }
  await importFiles(files);
}

async function importFiles(files) {
  fileStatusEl.textContent = "Import de " + files.length + " fichier(s) en cours…";
  fileStatusEl.className = "file-status";

  let addedRows = 0;
  let skippedFiles = 0;
  let anyRetourFound = false;

  for (const file of files) {
    try {
      const text = await readFileAsText(file);
      const sections = parseShellyBlocks(text);
      const points = buildPointsFromSections(sections);
      if (!points) {
        console.warn("Format non reconnu dans " + file.name, Object.keys(sections));
        skippedFiles++;
        continue;
      }
      if (findSection(sections, ["Retour Phase A"])) anyRetourFound = true;

      for (const row of points) {
        masterData.set(row.t, row); // une nouvelle importation remplace une éventuelle ligne existante au même horodatage
      }
      addedRows += points.length;
    } catch (err) {
      console.warn("Fichier ignoré (" + file.name + ") :", err);
      skippedFiles++;
    }
  }

  const persistResult = persistMasterData();

  let msg = addedRows + " lignes traitées depuis " + files.length + " fichier(s)";
  if (skippedFiles) msg += " (" + skippedFiles + " fichier(s) ignoré(s) — format non reconnu)";
  if (addedRows > 0 && !anyRetourFound) {
    msg += ". Bloc « Retour Phase A » introuvable : le surplus exporté est compté comme nul.";
  }
  fileStatusEl.textContent = msg;
  fileStatusEl.className = skippedFiles && addedRows === 0 ? "file-status err" : "file-status ok";

  if (!persistResult.ok) {
    fileStatusEl.textContent +=
      " Attention : l'historique complet (" + persistResult.count +
      " lignes) est trop volumineux pour être sauvegardé localement — seule cette session le conserve.";
  }

  updateHistoryStatus();
  runStoredSimulation();
}

function updateHistoryStatus() {
  const n = masterData.size;
  const text = n === 0
    ? "Aucune donnée en mémoire."
    : n.toLocaleString("fr-FR") + " points horaires en mémoire au total.";
  historyStatusEl.textContent = text;
  document.getElementById("dataSummaryText").textContent = text;
  updateMissingDaysDisplay();
}

function fmtDateFr(d) {
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

/**
 * Repère les jours calendaires sans aucune donnée entre le premier et le
 * dernier import, et regroupe les jours consécutifs manquants en plages.
 */
function computeMissingDayRanges() {
  if (masterData.size === 0) return [];
  const times = Array.from(masterData.keys()).sort((a, b) => a - b);
  const presentDays = new Set(times.map((t) => dayKeyOf(new Date(t))));
  const first = new Date(times[0]);
  const last = new Date(times[times.length - 1]);
  const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate());

  const missingDays = [];
  while (cursor <= end) {
    if (!presentDays.has(dayKeyOf(cursor))) missingDays.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const ranges = [];
  let rangeStart = null, prev = null;
  for (const d of missingDays) {
    if (rangeStart === null) { rangeStart = d; prev = d; continue; }
    const diffDays = Math.round((d - prev) / 86400000);
    if (diffDays === 1) { prev = d; continue; }
    ranges.push([rangeStart, prev]);
    rangeStart = d; prev = d;
  }
  if (rangeStart !== null) ranges.push([rangeStart, prev]);
  return ranges;
}

function updateMissingDaysDisplay() {
  const el = document.getElementById("missingDaysStatus");
  const ranges = computeMissingDayRanges();
  if (ranges.length === 0) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  const parts = ranges.map(([a, b]) => (a.getTime() === b.getTime() ? fmtDateFr(a) : fmtDateFr(a) + " → " + fmtDateFr(b)));
  el.textContent = "Jours manquants : " + parts.join(", ");
  el.style.display = "block";
}

/* ============================================================
   5. NORMALISATION + MOTEUR DE SIMULATION
   ============================================================ */

function parseTimestamp(raw) {
  if (raw == null || raw === "") return null;
  const str = String(raw).trim();

  // Format JJ/MM/AAAA[ HH:mm[:ss]] des exports Shelly — testé EN PREMIER, car le
  // constructeur natif Date() interprète à tort "10/09/2026" comme MM/JJ/AAAA
  // (format américain) pour les jours ≤ 12, inversant silencieusement jour et mois.
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[ T]?(\d{1,2})?:?(\d{2})?:?(\d{2})?$/);
  if (m) {
    let [, dd, mm, yyyy, hh, min, ss] = m;
    if (yyyy.length === 2) yyyy = "20" + yyyy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh || 0), Number(min || 0), Number(ss || 0));
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Sinon, formats standards (ISO, RFC...) via le constructeur natif
  const d2 = new Date(str);
  if (!Number.isNaN(d2.getTime())) return d2;

  return null;
}

function isNightHour(hour, hcStart, hcEnd) {
  if (hcStart === hcEnd) return false;
  if (hcStart < hcEnd) return hour >= hcStart && hour < hcEnd;
  return hour >= hcStart || hour < hcEnd;
}

/**
 * Simule la batterie virtuelle sur l'ensemble des points historisés, triés par temps,
 * avec rendement aller-retour et limite de puissance de charge/décharge.
 */
function runSimulation(points, cfg) {
  if (points.length === 0) {
    throw new Error("Aucune donnée à simuler.");
  }

  const capaciteKwh = cfg.capaciteKwh;
  const socMinKwh = capaciteKwh * (cfg.socMinPct / 100);
  let soc = capaciteKwh * (cfg.socInitialPct / 100);
  const efficacite = cfg.rendementPct / 100;
  const puissanceMaxKw = cfg.puissanceMaxKw > 0 ? cfg.puissanceMaxKw : Infinity;

  const series = [];

  // Synthèse "panneaux seuls" (indépendante de la batterie)
  let totalProduction = 0;
  let totalConsoGrid = 0; // Phase A — import réseau déjà mesuré
  let totalRetourBrut = 0; // surplus exporté / non autoconsommé
  let totalGainPanneaux = 0;
  let totalPerteEuros = 0;

  // Simulation batterie
  let totalStocke = 0;
  let totalCouvertParBatterie = 0;
  let totalEconomieBatterie = 0;

  for (const p of points) {
    totalProduction += p.prod;
    totalConsoGrid += p.conso;
    totalRetourBrut += p.retour;

    const tarif = isNightHour(p.hour, cfg.hcStart, cfg.hcEnd) ? cfg.tarifNuit : cfg.tarifJour;

    // Autoconsommation directe de cette ligne (avant toute batterie)
    const autoconsoDirecteLigne = Math.max(0, p.prod - p.retour);
    totalGainPanneaux += autoconsoDirecteLigne * tarif;
    totalPerteEuros += p.retour * tarif;

    // --- Charge de la batterie, limitée par la puissance max et le rendement ---
    const maxEnergieParIntervalle = puissanceMaxKw * p.durH;
    const energiePreleveeSurplus = Math.min(p.retour, maxEnergieParIntervalle);
    const placeDisponible = Math.max(0, capaciteKwh - soc);
    const stocke = Math.min(energiePreleveeSurplus * efficacite, placeDisponible);
    soc += stocke;
    totalStocke += stocke;

    // --- Décharge pour couvrir la consommation réseau ---
    const maxDechargeParIntervalle = puissanceMaxKw * p.durH;
    const disponible = Math.max(0, soc - socMinKwh);
    const dechargeable = Math.min(p.conso, disponible, maxDechargeParIntervalle);
    soc -= dechargeable;
    totalCouvertParBatterie += dechargeable;
    totalEconomieBatterie += dechargeable * tarif;

    series.push({
      t: new Date(p.t),
      prod: p.prod,
      retour: p.retour,
      stocke,
      dech: dechargeable,
      consoTotale: p.conso + Math.max(0, p.prod - p.retour),
      soc,
      socPct: capaciteKwh > 0 ? (soc / capaciteKwh) * 100 : 0,
    });
  }

  const uniqueDays = new Set(points.map((p) => dayKeyOf(new Date(p.t))));
  const nbJours = Math.max(uniqueDays.size, 1); // jours réellement couverts, pas l'écart calendaire (robuste aux jours manquants)
  const facteurAnnuel = 365 / nbJours;

  // Synthèse panneaux seuls
  const consommationTotale = totalConsoGrid + Math.max(0, totalProduction - totalRetourBrut);
  const autoconsoDirecteKwh = Math.max(0, totalProduction - totalRetourBrut);
  const autoconsoPctSansBatterie = totalProduction > 0 ? (autoconsoDirecteKwh / totalProduction) * 100 : 0;
  const gainPanneauxAnnuel = totalGainPanneaux * facteurAnnuel;
  const rentabilitePanneauxAnnees = gainPanneauxAnnuel > 0 ? cfg.prixPanneaux / gainPanneauxAnnuel : null;

  // Synthèse batterie
  const autoconsoAvecBatterieKwh = Math.min(totalProduction, autoconsoDirecteKwh + totalCouvertParBatterie);
  const autoconsoPctAvecBatterie = totalProduction > 0 ? (autoconsoAvecBatterieKwh / totalProduction) * 100 : 0;
  const nbCyclesPeriode = capaciteKwh > 0 ? totalStocke / capaciteKwh : 0;
  const nbCyclesParAn = nbCyclesPeriode * facteurAnnuel;
  const dureeVieAnnees = nbCyclesParAn > 0 ? cfg.dureeVieCycles / nbCyclesParAn : null;
  const economieBatterieAnnuelle = totalEconomieBatterie * facteurAnnuel;
  const rentabiliteBatterieAnnees = economieBatterieAnnuelle > 0 ? cfg.prixBatterie / economieBatterieAnnuelle : null;

  return {
    series,
    periodStart: new Date(points[0].t),
    periodEnd: new Date(points[points.length - 1].t),
    kpis: {
      totalProduction,
      consommationTotale,
      autoconsoDirecteKwh,
      autoconsoPctSansBatterie,
      totalGainPanneaux,
      rentabilitePanneauxAnnees,
      totalRetourBrut,
      totalPerteEuros,
      totalStocke,
      nbCyclesPeriode,
      totalCouvertParBatterie,
      totalEconomieBatterie,
      autoconsoPctAvecBatterie,
      dureeVieAnnees,
      rentabiliteBatterieAnnees,
      nbJours,
    },
  };
}

function runStoredSimulation() {
  if (masterData.size === 0) return;
  const points = Array.from(masterData.values()).sort((a, b) => a.t - b.t);
  try {
    const result = runSimulation(points, settings);
    renderResults(result);
  } catch (err) {
    console.error(err);
  }
}

/* ============================================================
   6b. VUE JOURNALIÈRE — navigation < / > entre les jours
   ============================================================ */

let dailySeries = [];   // série complète de la dernière simulation
let dayKeys = [];       // clés "YYYY-MM-DD" triées, une par jour disponible
let currentDayIndex = -1;

function dayKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function initDailyView(series) {
  dailySeries = series;
  const seen = new Set();
  dayKeys = [];
  for (const p of series) {
    const key = dayKeyOf(p.t);
    if (!seen.has(key)) { seen.add(key); dayKeys.push(key); }
  }
  dayKeys.sort();
  currentDayIndex = dayKeys.length - 1; // le jour le plus récent par défaut
  renderDailyView();
}

function renderDailyView() {
  if (dayKeys.length === 0) {
    document.getElementById("dayLabel").textContent = "Aucune donnée";
    return;
  }
  const key = dayKeys[currentDayIndex];
  const points = dailySeries.filter((p) => dayKeyOf(p.t) === key);

  const [y, m, d] = key.split("-");
  document.getElementById("dayLabel").textContent = d + "/" + m + "/" + y;
  document.getElementById("dayPrevBtn").disabled = currentDayIndex <= 0;
  document.getElementById("dayNextBtn").disabled = currentDayIndex >= dayKeys.length - 1;

  document.getElementById("dailyChart").innerHTML = buildLineChartSVG(points);
  document.getElementById("chartSettingsNote").textContent =
    "Simulé avec : capacité " + settings.capaciteKwh.toLocaleString("fr-FR") + " kWh · SOC min " +
    settings.socMinPct + "% · puissance max " + settings.puissanceMaxKw.toLocaleString("fr-FR") + " kW";

  // --- Stats du jour affiché ---
  const prodJour = points.reduce((s, p) => s + p.prod, 0);
  const consoJour = points.reduce((s, p) => s + p.consoTotale, 0);
  const autoconsoDirecteJour = points.reduce((s, p) => s + Math.max(0, p.prod - p.retour), 0);
  const autoconsoPctJour = prodJour > 0 ? (autoconsoDirecteJour / prodJour) * 100 : 0;
  const dechJour = points.reduce((s, p) => s + p.dech, 0);
  const stockeJour = points.reduce((s, p) => s + p.stocke, 0);
  const consoPVJour = autoconsoDirecteJour + dechJour;
  const autoconsoAvecBatteriePctJour = prodJour > 0 ? Math.min(100, (consoPVJour / prodJour) * 100) : 0;
  const nbCyclesJour = settings.capaciteKwh > 0 ? stockeJour / settings.capaciteKwh : 0;

  document.getElementById("dayKpiProd").textContent = fmtKwh(prodJour);
  document.getElementById("dayKpiConso").textContent = fmtKwh(consoJour);
  document.getElementById("dayKpiAutoconso").textContent = fmtPct(autoconsoPctJour);
  document.getElementById("dayKpiAutoconsoBatt").textContent = fmtPct(autoconsoAvecBatteriePctJour);
  document.getElementById("dayKpiConsoPV").textContent = fmtKwh(consoPVJour);
  document.getElementById("dayKpiCycles").textContent = nbCyclesJour.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/**
 * Construit un graphique linéaire en SVG pur (sans dépendance externe) pour
 * un jour de données : consommation totale, production PV et niveau de
 * batterie, tous exprimés en kWh sur un même axe.
 */
function buildLineChartSVG(points) {
  const W = 700, H = 280;
  const padL = 42, padR = 16, padT = 14, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = points.length;

  const maxEnergy = Math.max(0.1, ...points.map((p) => Math.max(p.consoTotale, p.prod, p.soc))) * 1.15;

  const xAt = (i) => padL + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
  const yAt = (v) => padT + plotH * (1 - v / maxEnergy);

  const pathOf = (values) =>
    values.map((v, i) => (i === 0 ? "M" : "L") + xAt(i).toFixed(1) + " " + yAt(v).toFixed(1)).join(" ");

  const consoPath = pathOf(points.map((p) => p.consoTotale));
  const prodPath = pathOf(points.map((p) => p.prod));
  const socPath = pathOf(points.map((p) => p.soc));

  // Grille horizontale (repères kWh)
  const gridValues = [0, maxEnergy / 4, maxEnergy / 2, (3 * maxEnergy) / 4, maxEnergy];
  const gridLines = gridValues.map((v) => {
    const yy = yAt(v).toFixed(1);
    return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="#2a333f" stroke-width="1" />';
  }).join("");

  // Étiquettes d'heures (une sur plusieurs pour ne pas surcharger)
  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = points.map((p, i) => {
    if (i % step !== 0 && i !== n - 1) return "";
    const hh = String(p.t.getHours()).padStart(2, "0") + "h";
    return '<text x="' + xAt(i).toFixed(1) + '" y="' + (H - 8) + '" fill="#93a1b0" font-size="10" text-anchor="middle">' + hh + "</text>";
  }).join("");

  const yLabels = gridValues.map((v) =>
    '<text x="' + (padL - 6) + '" y="' + (yAt(v) + 3).toFixed(1) + '" fill="#93a1b0" font-size="10" text-anchor="end">' + v.toFixed(1) + "</text>"
  ).join("");

  return (
    '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' +
    gridLines +
    xLabels +
    yLabels +
    '<path d="' + consoPath + '" fill="none" stroke="#7c93c9" stroke-width="2" />' +
    '<path d="' + prodPath + '" fill="none" stroke="#f0a94e" stroke-width="2" />' +
    '<path d="' + socPath + '" fill="none" stroke="#4fc9a0" stroke-width="2.5" />' +
    "</svg>"
  );
}

document.getElementById("dayPrevBtn").addEventListener("click", () => {
  if (currentDayIndex > 0) { currentDayIndex--; renderDailyView(); }
});
document.getElementById("dayNextBtn").addEventListener("click", () => {
  if (currentDayIndex < dayKeys.length - 1) { currentDayIndex++; renderDailyView(); }
});

/* ============================================================
   6. RENDU DES RÉSULTATS (KPIs)
   ============================================================ */

function fmtKwh(v) { return v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " kWh"; }
function fmtEuro(v) { return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " €"; }
function fmtPct(v) { return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " %"; }
function fmtAnnees(v) {
  if (v == null) return "N/A";
  if (v > 99) return "> 99 ans";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " ans";
}

function renderResults(result) {
  document.getElementById("resultsEmpty").style.display = "none";
  document.getElementById("results").style.display = "block";

  const k = result.kpis;

  document.getElementById("periodLabel").textContent =
    result.periodStart.toLocaleDateString("fr-FR") + " → " + result.periodEnd.toLocaleDateString("fr-FR");

  // Synthèse globale
  document.getElementById("kpiProdTotale").textContent = fmtKwh(k.totalProduction);
  document.getElementById("kpiConsoTotale").textContent = fmtKwh(k.consommationTotale);
  document.getElementById("kpiAutoconsoQty").textContent = fmtKwh(k.autoconsoDirecteKwh);
  document.getElementById("kpiAutoconsoPctSansBatt").textContent = fmtPct(k.autoconsoPctSansBatterie);
  document.getElementById("kpiGainPanneaux").textContent = fmtEuro(k.totalGainPanneaux);
  document.getElementById("kpiRentabilitePanneaux").textContent = fmtAnnees(k.rentabilitePanneauxAnnees);
  document.getElementById("kpiRentabilitePanneauxNote").textContent =
    "Pour " + settings.prixPanneaux.toLocaleString("fr-FR") + " € d'installation, extrapolation annuelle";
  document.getElementById("kpiExportTotale").textContent = fmtKwh(k.totalRetourBrut);
  document.getElementById("kpiPerteEuros").textContent = fmtEuro(k.totalPerteEuros);

  // Simulateur de batterie
  document.getElementById("kpiQtyStockee").textContent = fmtKwh(k.totalStocke);
  document.getElementById("kpiNbCycles").textContent =
    k.nbCyclesPeriode.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  document.getElementById("kpiQtyUtiliseeBatt").textContent = fmtKwh(k.totalCouvertParBatterie);
  document.getElementById("kpiEconomieBatt").textContent = fmtEuro(k.totalEconomieBatterie);
  document.getElementById("kpiAutoconsoPctAvecBatt").textContent = fmtPct(k.autoconsoPctAvecBatterie);
  document.getElementById("kpiDureeVie").textContent = fmtAnnees(k.dureeVieAnnees);
  document.getElementById("kpiRentabiliteBatt").textContent = fmtAnnees(k.rentabiliteBatterieAnnees);

  initDailyView(result.series);

  const dailyAutoconso = computeDailyAutoconsoSeries(result.series);
  document.getElementById("autoconsoEvolutionChart").innerHTML = buildAutoconsoEvolutionSVG(dailyAutoconso);
}

/**
 * Regroupe la série horaire par jour pour obtenir le taux d'autoconsommation
 * quotidien, sans puis avec batterie, sur toute la période chargée.
 */
function computeDailyAutoconsoSeries(series) {
  const byDay = new Map();
  for (const p of series) {
    const key = dayKeyOf(p.t);
    if (!byDay.has(key)) byDay.set(key, { t: p.t, prod: 0, conso: 0, autoDirecte: 0, dech: 0 });
    const e = byDay.get(key);
    e.prod += p.prod;
    e.conso += p.consoTotale;
    e.autoDirecte += Math.max(0, p.prod - p.retour);
    e.dech += p.dech;
  }
  const days = Array.from(byDay.values()).sort((a, b) => a.t - b.t);
  return days.map((d) => ({
    t: d.t,
    pctSansBatt: d.prod > 0 ? (d.autoDirecte / d.prod) * 100 : 0,
    pctAvecBatt: d.prod > 0 ? Math.min(100, ((d.autoDirecte + d.dech) / d.prod) * 100) : 0,
    pctAutoproduction: d.conso > 0 ? Math.min(100, ((d.autoDirecte + d.dech) / d.conso) * 100) : 0,
  }));
}

/** Graphique SVG natif : deux courbes de % (0-100), une par jour de la période. */
function buildAutoconsoEvolutionSVG(days) {
  const W = 700, H = 260;
  const padL = 36, padR = 16, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = days.length;

  const xAt = (i) => padL + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
  const yAt = (v) => padT + plotH * (1 - Math.max(0, Math.min(100, v)) / 100);
  const pathOf = (vals) => vals.map((v, i) => (i === 0 ? "M" : "L") + xAt(i).toFixed(1) + " " + yAt(v).toFixed(1)).join(" ");

  const gridLines = [0, 25, 50, 75, 100].map((v) => {
    const yy = yAt(v).toFixed(1);
    return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="#2a333f" stroke-width="1" />';
  }).join("");
  const yLabels = [0, 50, 100].map((v) =>
    '<text x="' + (padL - 6) + '" y="' + (yAt(v) + 3).toFixed(1) + '" fill="#93a1b0" font-size="10" text-anchor="end">' + v + "%</text>"
  ).join("");

  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = days.map((d, i) => {
    if (i % step !== 0 && i !== n - 1) return "";
    const dt = new Date(d.t);
    const lab = String(dt.getDate()).padStart(2, "0") + "/" + String(dt.getMonth() + 1).padStart(2, "0");
    return '<text x="' + xAt(i).toFixed(1) + '" y="' + (H - 8) + '" fill="#93a1b0" font-size="10" text-anchor="middle">' + lab + "</text>";
  }).join("");

  return (
    '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' +
    gridLines + xLabels + yLabels +
    '<path d="' + pathOf(days.map((d) => d.pctSansBatt)) + '" fill="none" stroke="#7c93c9" stroke-width="2" />' +
    '<path d="' + pathOf(days.map((d) => d.pctAvecBatt)) + '" fill="none" stroke="#4fc9a0" stroke-width="2.5" />' +
    '<path d="' + pathOf(days.map((d) => d.pctAutoproduction)) + '" fill="none" stroke="#f0a94e" stroke-width="2" stroke-dasharray="4 3" />' +
    "</svg>"
  );
}

/* ============================================================
   7. ÉVÉNEMENTS
   ============================================================ */

document.getElementById("csvInput").addEventListener("change", (evt) => {
  if (evt.target.files.length) handleSelectedFiles(evt.target.files);
  evt.target.value = "";
});

document.getElementById("pickFilesBtn").addEventListener("click", () => {
  document.getElementById("csvInputFiles").click();
});
document.getElementById("csvInputFiles").addEventListener("change", (evt) => {
  if (evt.target.files.length) handleSelectedFiles(evt.target.files);
  evt.target.value = "";
});

document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  settings = readSettingsForm();
  saveSettings(settings);
  const toast = document.getElementById("saveToast");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1600);
  runStoredSimulation();
});

document.getElementById("resetSettingsBtn").addEventListener("click", () => {
  settings = { ...DEFAULT_SETTINGS };
  saveSettings(settings);
  fillSettingsForm();
  runStoredSimulation();
});

document.getElementById("clearDataBtn").addEventListener("click", () => {
  if (!confirm("Effacer tout l'historique importé ?")) return;
  clearMasterData();
  updateHistoryStatus();
  document.getElementById("results").style.display = "none";
  document.getElementById("resultsEmpty").style.display = "block";
  document.getElementById("periodLabel").textContent = "Aucune donnée";
  fileStatusEl.textContent = "Aucune donnée importée pour le moment.";
  fileStatusEl.className = "file-status";
});

/* ============================================================
   8. INITIALISATION
   ============================================================ */

fillSettingsForm();
loadMasterData();
updateHistoryStatus();

if (masterData.size > 0) {
  runStoredSimulation();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Échec d'enregistrement du service worker :", err);
    });
  });
}
