// Noéé : moteur d'estimation par comparables DVF.
import { CONFIG } from './config.js';
import { V, FLAG_TAB, distance, weightedQuantile, median } from './dvf-core.js';

const E = CONFIG.estimation;
const K = CONFIG.coefficients;

const moisEntre = (d, now) => (now - new Date(d)) / (1000 * 3600 * 24 * 30.44);

/**
 * @param {object} bien  { lat, lon, type:'M'|'A'|'T', surf, pieces, terrain, etat, dpe, piscine, vue, garage, exterieur, etage, ascenseur }
 * @param {Array} ventes ventes au format compact (dvf-core)
 */
export function estimer(bien, ventes, now = new Date()) {
  const t = bien.type;
  const taille = t === 'T' ? bien.terrain : bien.surf;
  if (!taille) throw new Error('Surface manquante');

  const enrichies = ventes
    .filter((v) => v[V.type] === t)
    .map((v) => ({
      v,
      d: distance(bien.lat, bien.lon, v[V.lat], v[V.lon]),
      age: moisEntre(v[V.date], now),
      taille: t === 'T' ? v[V.terrain] : v[V.surf],
    }));

  // Élargissement progressif : période, tolérance de surface, rayon
  let choisies = [];
  let rayon = 0;
  let tol = t === 'T' ? 0.5 : E.toleranceSurface;
  let mois = E.moisHistorique;
  const essais = [
    [E.moisHistorique, tol],
    [E.moisHistorique + 24, tol],
    [E.moisHistorique + 24, Math.max(tol, 0.6)],
  ];
  for (const [m, tl] of essais) {
    for (const r of E.rayons) {
      const c = enrichies.filter((e) => e.d <= r && e.age <= m && Math.abs(e.taille - taille) / taille <= tl);
      if (c.length >= E.minComparables) { choisies = c; rayon = r; tol = tl; mois = m; break; }
    }
    if (choisies.length) break;
  }
  if (!choisies.length) {
    // On prend ce qu'il y a de plus proche, même s'il y en a peu
    choisies = enrichies.filter((e) => e.age <= 72).sort((a, b) => a.d - b.d).slice(0, E.minComparables);
    rayon = choisies.length ? Math.max(...choisies.map((e) => e.d)) : 0;
    mois = 72;
  }
  if (!choisies.length) return { ok: false, raison: 'Aucune vente comparable trouvée autour de cette adresse.' };

  // Pondération : récence × proximité × ressemblance de surface (et terrain à bâtir pour un terrain)
  for (const e of choisies) {
    const wAge = e.age <= 12 ? 1 : e.age <= 24 ? 0.75 : e.age <= 36 ? 0.55 : 0.4;
    const wDist = 1 / (1 + e.d / Math.max(rayon, 300));
    const wSurf = 1 - Math.min(1, Math.abs(e.taille - taille) / taille) * 0.5;
    const wTab = t === 'T' && e.v[V.flags] & FLAG_TAB ? 1.3 : 1;
    e.w = wAge * wDist * wSurf * wTab;
    e.m2 = e.v[V.prix] / e.taille;
  }
  choisies.sort((a, b) => b.w - a.w);
  choisies = choisies.slice(0, 40);

  const items = choisies.map((e) => ({ v: e.m2, w: e.w }));
  const m2Med = weightedQuantile(items, 0.5);
  const m2Q1 = weightedQuantile(items, 0.25);
  const m2Q3 = weightedQuantile(items, 0.75);

  // Coefficients
  const ajustements = [];
  let coef = 0;
  const add = (label, c) => { if (c) { coef += c; ajustements.push({ label, pct: c }); } };
  if (t !== 'T') {
    add(libEtat(bien.etat), K.etat[bien.etat] || 0);
    add(`DPE ${bien.dpe || 'inconnu'}`, K.dpe[bien.dpe || 'inconnu'] || 0);
    if (bien.piscine && t === 'M') add('Piscine', K.piscine);
    if (bien.garage) add('Garage ou parking', K.garage);
    if (bien.exterieur && t === 'A') add('Extérieur privatif', K.exterieurAppart);
    if (t === 'A' && Number(bien.etage) >= 3 && !bien.ascenseur) add('3e étage ou plus sans ascenseur', K.ascenseurManquantEtage3);
  }
  if (bien.vue) add('Vue dégagée (mer, lac, golf)', K.vue);

  let base = m2Med * taille;
  let valeur = base * (1 + coef);

  // Maison : correction selon le terrain par rapport aux ventes comparables
  let ajustTerrain = 0;
  if (t === 'M' && bien.terrain) {
    const terrainsRef = choisies.map((e) => e.v[V.terrain]).filter(Boolean);
    const refTerrain = median(terrainsRef);
    const prixTerrainM2 = prixTerrainLocal(bien, enrichiesTerrains(bien, ventes, now));
    if (refTerrain && prixTerrainM2) {
      ajustTerrain = (bien.terrain - refTerrain) * prixTerrainM2 * 0.35;
      const cap = valeur * 0.25;
      ajustTerrain = Math.max(-cap, Math.min(cap, ajustTerrain));
      if (Math.abs(ajustTerrain) > valeur * 0.01) {
        ajustements.push({ label: `Terrain ${bien.terrain > refTerrain ? 'plus grand' : 'plus petit'} que la moyenne (${Math.round(refTerrain)} m²)`, eur: ajustTerrain });
      }
    }
  }
  valeur += ajustTerrain;

  const ratioBas = Math.min(0.95, Math.max(0.85, m2Q1 / m2Med || 0.9));
  const ratioHaut = Math.max(1.05, Math.min(1.15, m2Q3 / m2Med || 1.1));
  const dispersion = m2Med ? (m2Q3 - m2Q1) / m2Med : 1;

  let fiabilite = 'faible';
  if (choisies.length >= 12 && rayon <= 1500 && dispersion < 0.35) fiabilite = 'élevée';
  else if (choisies.length >= E.minComparables && rayon <= 6000 && dispersion < 0.6) fiabilite = 'moyenne';

  const arrondi = (x) => Math.round(x / 1000) * 1000;
  return {
    ok: true,
    valeur: arrondi(valeur),
    bas: arrondi(valeur * ratioBas),
    haut: arrondi(valeur * ratioHaut),
    m2: Math.round(valeur / taille),
    m2Marche: Math.round(m2Med),
    n: choisies.length,
    rayon: Math.round(rayon),
    mois,
    fiabilite,
    ajustements,
    comparables: choisies.map((e) => ({
      date: e.v[V.date], type: e.v[V.type], prix: e.v[V.prix], surf: e.v[V.surf], pieces: e.v[V.pieces],
      terrain: e.v[V.terrain], lat: e.v[V.lat], lon: e.v[V.lon], d: Math.round(e.d), m2: Math.round(e.m2), w: e.w,
    })),
  };
}

function enrichiesTerrains(bien, ventes, now) {
  return ventes
    .filter((v) => v[V.type] === 'T' && v[V.terrain] >= 150 && v[V.terrain] <= 3000)
    .map((v) => ({ v, d: distance(bien.lat, bien.lon, v[V.lat], v[V.lon]), age: moisEntre(v[V.date], now) }))
    .filter((e) => e.age <= 60);
}

/** Prix médian au m² des terrains (à bâtir de préférence) autour d'un point. */
export function prixTerrainLocal(bien, enr) {
  for (const r of [1500, 3000, 6000, 12000, 25000]) {
    const tab = enr.filter((e) => e.d <= r && e.v[V.flags] & FLAG_TAB);
    const c = tab.length >= 5 ? tab : enr.filter((e) => e.d <= r);
    if (c.length >= 5) return median(c.map((e) => e.v[V.prix] / e.v[V.terrain]));
  }
  return 0;
}

/** Repères terrain à bâtir pour la division : prix médian d'un lot et €/m². */
export function reperesTerrain(lat, lon, ventes, now = new Date()) {
  const enr = enrichiesTerrains({ lat, lon }, ventes, now);
  for (const r of [1500, 3000, 6000, 12000, 25000]) {
    const tab = enr.filter((e) => e.d <= r && e.v[V.flags] & FLAG_TAB);
    const c = tab.length >= 5 ? tab : enr.filter((e) => e.d <= r);
    if (c.length >= 5) {
      return {
        n: c.length,
        rayon: r,
        m2: Math.round(median(c.map((e) => e.v[V.prix] / e.v[V.terrain]))),
        prixLot: Math.round(median(c.map((e) => e.v[V.prix]))),
        surfLot: Math.round(median(c.map((e) => e.v[V.terrain]))),
        tabSeulement: tab.length >= 5,
      };
    }
  }
  return null;
}

export function libEtat(e) {
  return { renover: 'À rénover', rafraichir: 'À rafraîchir', bon: 'Bon état', refait: 'Refait à neuf', neuf: 'Neuf ou récent' }[e] || 'État non précisé';
}
