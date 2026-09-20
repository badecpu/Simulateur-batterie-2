"use strict";

/* ============================================================
   1. CONFIGURATION & CACHE INDEXEDDB
   ============================================================ */

const METEO_LAT = 45.817;
const METEO_LON = 3.148;
const METEO_TZ = "Europe/Paris";
const PERFORMANCE_RATIO = 0.8; // pertes réelles (onduleur, câblage, température, salissure) — hypothèse standard

const DB_NAME = "battSimMeteo";
const DB_STORE = "weatherCache";

function openMeteoDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  try {
    const db = await openMeteoDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null; // IndexedDB indisponible : on retombera sur un fetch réseau
  }
}

async function dbSet(key, value) {
  try {
    const db = await openMeteoDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // Échec silencieux : le cache est un confort, pas une exigence
  }
}

/* ============================================================
   2. APPEL API OPEN-METEO (avec cache)
   ============================================================ */

function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/**
 * Récupère les données météo journalières entre deux dates (incluses),
 * en passant par le cache IndexedDB si déjà téléchargées.
 * Retourne un tableau [{date, sunshineH, daylightH, ghiKwhM2, tempMax, tempMin}].
 */
async function fetchWeatherRange(startDate, endDate) {
  const cacheKey = isoDate(startDate) + "_" + isoDate(endDate);
  const cached = await dbGet(cacheKey);
  if (cached) return cached;

  const url =
    "https://archive-api.open-meteo.com/v1/archive" +
    "?latitude=" + METEO_LAT + "&longitude=" + METEO_LON +
    "&start_date=" + isoDate(startDate) + "&end_date=" + isoDate(endDate) +
    "&daily=sunshine_duration,daylight_duration,shortwave_radiation_sum,temperature_2m_max,temperature_2m_min" +
    "&timezone=" + encodeURIComponent(METEO_TZ);

  const response = await fetch(url);
  if (!response.ok) {
    let reason = response.status;
    try { const errJson = await response.json(); if (errJson.reason) reason = errJson.reason; } catch (e) {}
    throw new Error("Erreur API météo (" + reason + ")");
  }
  const json = await response.json();
  if (!json.daily || !json.daily.time) {
    throw new Error("Réponse météo inattendue (pas de données journalières).");
  }

  const days = json.daily.time.map((dateStr, i) => ({
    date: dateStr,
    sunshineH: (json.daily.sunshine_duration[i] || 0) / 3600,
    daylightH: (json.daily.daylight_duration[i] || 0) / 3600,
    ghiKwhM2: (json.daily.shortwave_radiation_sum[i] || 0) / 3.6, // MJ/m² -> kWh/m²
    tempMax: json.daily.temperature_2m_max[i],
    tempMin: json.daily.temperature_2m_min[i],
  })).filter((d) => d.ghiKwhM2 != null && !Number.isNaN(d.ghiKwhM2));

  await dbSet(cacheKey, days);
  return days;
}

/* ============================================================
   3. CLIMATOLOGIE MENSUELLE & PROFILS HORAIRES TYPIQUES
   ============================================================ */

/** Moyenne, par mois calendaire (1-12), du GHI et des heures d'ensoleillement/jour de lumière. */
function computeMonthlyClimatology(weatherDays) {
  const buckets = {}; // month(1-12) -> {ghiSum, sunshineSum, daylightSum, n}
  for (const d of weatherDays) {
    const month = Number(d.date.slice(5, 7));
    if (!buckets[month]) buckets[month] = { ghiSum: 0, sunshineSum: 0, daylightSum: 0, n: 0 };
    buckets[month].ghiSum += d.ghiKwhM2;
    buckets[month].sunshineSum += d.sunshineH;
    buckets[month].daylightSum += d.daylightH;
    buckets[month].n++;
  }
  const climatology = {};
  for (let m = 1; m <= 12; m++) {
    const b = buckets[m];
    climatology[m] = b && b.n > 0
      ? { avgGhi: b.ghiSum / b.n, avgSunshineH: b.sunshineSum / b.n, avgDaylightH: b.daylightSum / b.n }
      : { avgGhi: 0, avgSunshineH: 0, avgDaylightH: 0 };
  }
  return climatology;
}

/**
 * Construit les profils horaires moyens réels de consommation totale (kWh),
 * séparément pour jours de semaine et week-end, à partir de l'historique Shelly importé.
 */
function computeTypicalConsoProfiles() {
  const sums = { weekday: new Array(24).fill(0), weekend: new Array(24).fill(0) };
  const counts = { weekday: new Array(24).fill(0), weekend: new Array(24).fill(0) };

  for (const p of masterData.values()) {
    const date = new Date(p.t);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const key = isWeekend ? "weekend" : "weekday";
    const consoTotale = p.conso + Math.max(0, p.prod - p.retour);
    sums[key][p.hour] += consoTotale;
    counts[key][p.hour]++;
  }

  const avg = (key) => sums[key].map((s, h) => (counts[key][h] > 0 ? s / counts[key][h] : 0));
  return { weekday: avg("weekday"), weekend: avg("weekend") };
}

/**
 * Dérive un profil "hors saison piscine" en retirant la consommation de la
 * pompe des heures où elle tourne habituellement. Le profil observé (issu de
 * l'historique importé) est supposé être "en saison" par défaut.
 */
function buildOffSeasonProfile(profile, cfg) {
  if (!cfg.poolActive) return profile;
  return profile.map((v, h) => (h >= cfg.poolStartHour && h < cfg.poolEndHour ? Math.max(0, v - cfg.poolPowerKw) : v));
}

function isPoolSeasonMonth(month1to12, cfg) {
  if (!cfg.poolActive) return false;
  return month1to12 >= cfg.poolMonthStart && month1to12 <= cfg.poolMonthEnd;
}

/** Répartit une production journalière moyenne (kWh) sur 24h en courbe solaire (sinus), centrée à 12h30. */
function buildPvHourlyShape(dailyKwh, daylightH) {
  const center = 12.5;
  const half = Math.max(0.5, daylightH / 2);
  const start = center - half, end = center + half;
  const raw = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const mid = h + 0.5;
    if (mid > start && mid < end) {
      raw[h] = Math.sin(Math.PI * (mid - start) / (end - start));
    }
  }
  const rawSum = raw.reduce((s, v) => s + v, 0);
  if (rawSum <= 0) return raw;
  return raw.map((v) => (v / rawSum) * dailyKwh);
}

/* ============================================================
   4. MOTEUR DE PROJECTION SUR 12 MOIS GLISSANTS
   ============================================================ */

/**
 * Simule heure par heure les 12 prochains mois calendaires (continu, la batterie
 * garde son état d'un mois à l'autre) à partir de la climatologie météo et des
 * profils de consommation réels, puis agrège par mois et sur l'année.
 */
function runYearProjection(climatology, consoProfilesInSeason, cfg) {
  const consoProfilesOffSeason = {
    weekday: buildOffSeasonProfile(consoProfilesInSeason.weekday, cfg),
    weekend: buildOffSeasonProfile(consoProfilesInSeason.weekend, cfg),
  };

  const now = new Date();
  const monthsMeta = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    monthsMeta.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }

  const capaciteKwh = cfg.capaciteKwh;
  const socMinKwh = capaciteKwh * (cfg.socMinPct / 100);
  let soc = capaciteKwh * (cfg.socInitialPct / 100);
  const efficacite = cfg.rendementPct / 100;
  const puissanceMaxKw = cfg.puissanceMaxKw > 0 ? cfg.puissanceMaxKw : Infinity;

  const monthlyResults = monthsMeta.map((m) => ({
    ...m, prod: 0, conso: 0, autoconsoDirecte: 0, autoconsoBatt: 0, economieSeul: 0, economieBatt: 0,
  }));

  for (let mi = 0; mi < monthsMeta.length; mi++) {
    const { year, month } = monthsMeta[mi];
    const climMonth = climatology[month + 1]; // climatology est indexée 1-12
    const dailyProdKwh = cfg.puissanceKwc * climMonth.avgGhi * PERFORMANCE_RATIO;
    const pvShape = buildPvHourlyShape(dailyProdKwh, climMonth.avgDaylightH);

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const enSaison = isPoolSeasonMonth(month + 1, cfg);
    const profilesDuMois = enSaison ? consoProfilesInSeason : consoProfilesOffSeason;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const consoProfile = isWeekend ? profilesDuMois.weekend : profilesDuMois.weekday;

      for (let hour = 0; hour < 24; hour++) {
        const prod = pvShape[hour];
        const conso = consoProfile[hour];
        const surplus = Math.max(0, prod - conso);
        const deficit = Math.max(0, conso - prod);
        const directAutoconso = Math.min(prod, conso);

        const chargeable = Math.min(surplus, puissanceMaxKw);
        const place = Math.max(0, capaciteKwh - soc);
        const stocke = Math.min(chargeable * efficacite, place);
        soc += stocke;

        const dispo = Math.max(0, soc - socMinKwh);
        const dechargeable = Math.min(deficit, dispo, puissanceMaxKw);
        soc -= dechargeable;

        const tarif = isNightHour(hour, cfg.hcStart, cfg.hcEnd) ? cfg.tarifNuit : cfg.tarifJour;

        const r = monthlyResults[mi];
        r.prod += prod;
        r.conso += conso;
        r.autoconsoDirecte += directAutoconso;
        r.autoconsoBatt += directAutoconso + dechargeable;
        r.economieSeul += directAutoconso * tarif;
        r.economieBatt += (directAutoconso + dechargeable) * tarif;
      }
    }
  }

  const totals = monthlyResults.reduce((acc, r) => ({
    prod: acc.prod + r.prod,
    conso: acc.conso + r.conso,
    autoconsoDirecte: acc.autoconsoDirecte + r.autoconsoDirecte,
    autoconsoBatt: acc.autoconsoBatt + r.autoconsoBatt,
    economieSeul: acc.economieSeul + r.economieSeul,
    economieBatt: acc.economieBatt + r.economieBatt,
  }), { prod: 0, conso: 0, autoconsoDirecte: 0, autoconsoBatt: 0, economieSeul: 0, economieBatt: 0 });

  return { monthlyResults, totals };
}

/* ============================================================
   5. GRAPHIQUES SVG
   ============================================================ */

function buildCorrelationChartSVG(labels, consoKwh, prodKwh, sunshineH) {
  const W = 700, H = 280;
  const padL = 42, padR = 42, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = labels.length;
  const maxKwh = Math.max(0.1, ...consoKwh, ...prodKwh) * 1.15;
  const maxSun = Math.max(0.1, ...sunshineH) * 1.15;

  const xAt = (i) => padL + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
  const yKwhAt = (v) => padT + plotH * (1 - v / maxKwh);
  const ySunAt = (v) => padT + plotH * (1 - v / maxSun);
  const pathOf = (values, yFn) => values.map((v, i) => (i === 0 ? "M" : "L") + xAt(i).toFixed(1) + " " + yFn(v).toFixed(1)).join(" ");

  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = labels.map((lab, i) => {
    if (i % step !== 0 && i !== n - 1) return "";
    return '<text x="' + xAt(i).toFixed(1) + '" y="' + (H - 8) + '" fill="#93a1b0" font-size="10" text-anchor="middle">' + lab + "</text>";
  }).join("");

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const yy = (padT + plotH * (1 - f)).toFixed(1);
    return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="#2a333f" stroke-width="1" />';
  }).join("");

  const yKwhLabels = [0, maxKwh / 2, maxKwh].map((v) => '<text x="' + (padL - 6) + '" y="' + (yKwhAt(v) + 3).toFixed(1) + '" fill="#93a1b0" font-size="10" text-anchor="end">' + v.toFixed(1) + "</text>").join("");
  const ySunLabels = [0, maxSun / 2, maxSun].map((v) => '<text x="' + (W - padR + 6) + '" y="' + (ySunAt(v) + 3).toFixed(1) + '" fill="#93a1b0" font-size="10" text-anchor="start">' + v.toFixed(1) + "</text>").join("");

  return (
    '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' +
    gridLines + xLabels + yKwhLabels + ySunLabels +
    '<path d="' + pathOf(consoKwh, yKwhAt) + '" fill="none" stroke="#7c93c9" stroke-width="2" />' +
    '<path d="' + pathOf(prodKwh, yKwhAt) + '" fill="none" stroke="#f0a94e" stroke-width="2" />' +
    '<path d="' + pathOf(sunshineH, ySunAt) + '" fill="none" stroke="#e8c468" stroke-width="2" stroke-dasharray="4 3" />' +
    "</svg>"
  );
}

function buildMonthlyBarChartSVG(monthlyResults) {
  const W = 700, H = 320;
  const padL = 42, padR = 10, padT = 14, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = monthlyResults.length;
  const maxVal = Math.max(0.1, ...monthlyResults.map((m) => Math.max(m.prod, m.conso))) * 1.15;
  const yAt = (v) => padT + plotH * (1 - v / maxVal);

  const groupW = plotW / n;
  const barW = groupW / 5;

  let bars = "";
  monthlyResults.forEach((m, i) => {
    const gx = padL + i * groupW + groupW / 2;
    const bars3 = [
      { v: m.prod, color: "#f0a94e", offset: -1.1 },
      { v: m.conso, color: "#7c93c9", offset: 0 },
      { v: m.autoconsoBatt, color: "#4fc9a0", offset: 1.1 },
    ];
    for (const b of bars3) {
      const x = gx + b.offset * barW - barW / 2;
      const y = yAt(b.v);
      const h = padT + plotH - y;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" fill="' + b.color + '" rx="1.5" />';
    }
    bars += '<text x="' + gx.toFixed(1) + '" y="' + (H - 12) + '" fill="#93a1b0" font-size="9" text-anchor="middle">' + m.label + "</text>";
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const yy = (padT + plotH * (1 - f)).toFixed(1);
    return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="#2a333f" stroke-width="1" />';
  }).join("");
  const yLabels = [0, maxVal / 2, maxVal].map((v) => '<text x="' + (padL - 6) + '" y="' + (yAt(v) + 3).toFixed(1) + '" fill="#93a1b0" font-size="10" text-anchor="end">' + v.toFixed(0) + "</text>").join("");

  return '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' + gridLines + yLabels + bars + "</svg>";
}

/* ============================================================
   6. ORCHESTRATION & RENDU
   ============================================================ */

const meteoStatusEl = document.getElementById("meteoStatus");
const loadMeteoBtn = document.getElementById("loadMeteoBtn");

function fmtHeures(v) { return v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " h"; }

async function loadMeteoAndProject() {
  if (masterData.size === 0) {
    meteoStatusEl.textContent = "Importe d'abord ton historique Shelly dans le Tableau de bord.";
    meteoStatusEl.className = "file-status err";
    return;
  }

  loadMeteoBtn.disabled = true;
  meteoStatusEl.textContent = "Chargement des données météo de Gerzat…";
  meteoStatusEl.className = "file-status";

  try {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - 6); // marge de sécurité : délai de publication ERA5 (~5 jours)
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 364);

    // S'assurer que la plage couvre aussi le premier jour importé, pour le graphique de corrélation
    const firstImportedMs = Math.min(...masterData.keys());
    const firstImported = new Date(firstImportedMs);
    if (firstImported < startDate) startDate.setTime(firstImported.getTime());

    const weatherDays = await fetchWeatherRange(startDate, endDate);
    if (weatherDays.length === 0) throw new Error("Aucune donnée météo retournée pour cette période.");

    const climatology = computeMonthlyClimatology(weatherDays);
    const consoProfiles = computeTypicalConsoProfiles();
    const { monthlyResults, totals } = runYearProjection(climatology, consoProfiles, settings);

    renderMeteoResults(weatherDays, monthlyResults, totals);

    meteoStatusEl.textContent = weatherDays.length.toLocaleString("fr-FR") + " jours météo chargés (Gerzat, Open-Meteo).";
    meteoStatusEl.className = "file-status ok";
  } catch (err) {
    console.error(err);
    meteoStatusEl.textContent = "Erreur : " + err.message + " — vérifie ta connexion et réessaie.";
    meteoStatusEl.className = "file-status err";
  } finally {
    loadMeteoBtn.disabled = false;
  }
}

function renderMeteoResults(weatherDays, monthlyResults, totals) {
  document.getElementById("meteoEmpty").style.display = "none";
  document.getElementById("meteoResults").style.display = "block";

  const autoconsoSeulPct = totals.prod > 0 ? (totals.autoconsoDirecte / totals.prod) * 100 : 0;
  const autoconsoBattPct = totals.prod > 0 ? (totals.autoconsoBatt / totals.prod) * 100 : 0;
  const roiSeul = totals.economieSeul > 0 ? settings.prixPanneaux / totals.economieSeul : null;
  const roiBatt = totals.economieBatt > 0 ? (settings.prixPanneaux + settings.prixBatterie) / totals.economieBatt : null;

  document.getElementById("mKpiProdAn").textContent = fmtKwh(totals.prod);
  document.getElementById("mKpiAutoconsoSeul").textContent = fmtPct(autoconsoSeulPct);
  document.getElementById("mKpiAutoconsoBatt").textContent = fmtPct(autoconsoBattPct);
  document.getElementById("mKpiGainsSeul").textContent = fmtEuro(totals.economieSeul);
  document.getElementById("mKpiGainsBatt").textContent = fmtEuro(totals.economieBatt);
  document.getElementById("mKpiRoiSeul").textContent = fmtAnnees(roiSeul);
  document.getElementById("mKpiRoiBatt").textContent = fmtAnnees(roiBatt);

  // --- Graphique de corrélation : conso + production quotidiennes réelles vs ensoleillement ---
  const weatherByDate = new Map(weatherDays.map((d) => [d.date, d]));
  const dayTotals = new Map(); // "YYYY-MM-DD" -> {conso, prod} kWh
  for (const p of masterData.values()) {
    const key = dayKeyOf(new Date(p.t));
    const consoTotale = p.conso + Math.max(0, p.prod - p.retour);
    const entry = dayTotals.get(key) || { conso: 0, prod: 0 };
    entry.conso += consoTotale;
    entry.prod += p.prod;
    dayTotals.set(key, entry);
  }
  // On ne garde que les jours où la météo est réellement disponible (délai de publication ERA5).
  const sortedDays = Array.from(dayTotals.keys()).filter((d) => weatherByDate.has(d)).sort();
  const lastWeatherDate = weatherDays.length ? weatherDays[weatherDays.length - 1].date : null;

  if (sortedDays.length > 0) {
    const corrLabels = sortedDays.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7));
    const corrConso = sortedDays.map((d) => dayTotals.get(d).conso);
    const corrProd = sortedDays.map((d) => dayTotals.get(d).prod);
    const corrSunshine = sortedDays.map((d) => weatherByDate.get(d).sunshineH);
    document.getElementById("correlationChart").innerHTML = buildCorrelationChartSVG(corrLabels, corrConso, corrProd, corrSunshine);
  } else {
    document.getElementById("correlationChart").innerHTML = "";
  }

  const omittedDays = dayTotals.size - sortedDays.length;
  const noteEl = document.getElementById("correlationNote");
  if (noteEl) {
    noteEl.textContent = omittedDays > 0
      ? "Météo disponible jusqu'au " + (lastWeatherDate ? lastWeatherDate.split("-").reverse().join("/") : "?") +
        " (délai de publication ERA5 ~5-6 jours) — " + omittedDays + " jour(s) récent(s) pas encore affiché(s) faute de météo."
      : "";
  }

  // --- Graphique mensuel ---
  document.getElementById("monthlyChart").innerHTML = buildMonthlyBarChartSVG(monthlyResults);
}

loadMeteoBtn.addEventListener("click", loadMeteoAndProject);
