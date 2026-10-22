// Noéé : accès aux données publiques (Géoplateforme IGN, API Carto, DVF).
import { CONFIG } from './config.js';
import { parseCsv, aggregateMutations, distance } from './dvf-core.js';

const A = CONFIG.api;

async function getJson(url, { timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${new URL(url).host}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ── Adresses (BAN servie par la Géoplateforme, ancienne API en secours) ──
export async function geocode(q, { limit = 6, type } = {}) {
  if (!q || q.trim().length < 3) return [];
  const params = new URLSearchParams({ q, limit: String(limit), autocomplete: '1' });
  if (type) params.set('type', type);
  let lastErr;
  for (const base of A.geocodage) {
    try {
      const j = await getJson(`${base}?${params}`, { timeout: 6000 });
      return (j.features || []).map((f) => ({
        label: f.properties.label,
        name: f.properties.name,
        ville: f.properties.city,
        cp: f.properties.postcode,
        insee: f.properties.citycode,
        type: f.properties.type,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      }));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Recherche d’adresse indisponible');
}

// ── Cadastre (API Carto IGN) ──
const pointGeom = (lon, lat) => JSON.stringify({ type: 'Point', coordinates: [lon, lat] });

export async function parcelleAuPoint(lon, lat) {
  const j = await getJson(`${A.cadastre}?geom=${encodeURIComponent(pointGeom(lon, lat))}`);
  const f = (j.features || [])[0];
  if (!f) return null;
  return normaliseParcelle(f);
}

function normaliseParcelle(f) {
  const p = f.properties || {};
  const idu = p.idu || `${p.code_dep}${p.code_com}${p.com_abs || '000'}${p.section}${String(p.numero).padStart(4, '0')}`;
  return {
    type: 'Feature',
    geometry: stripZ(f.geometry),
    properties: {
      idu,
      section: p.section,
      numero: p.numero,
      contenance: Number(p.contenance) || 0,
      commune: p.nom_com,
      insee: p.code_insee || `${p.code_dep}${p.code_com}`,
    },
  };
}

// ── Urbanisme (Géoportail de l'urbanisme via API Carto) ──
export async function zonesUrba(geom) {
  const j = await getJson(`${A.gpu}/zone-urba?geom=${encodeURIComponent(JSON.stringify(geom))}`);
  return (j.features || []).map((f) => ({
    libelle: f.properties.libelle,
    libelong: f.properties.libelong,
    typezone: f.properties.typezone,
    reglement: f.properties.urlfic || null,
    dateAppro: f.properties.datappro || null,
    idurba: f.properties.idurba,
    geometry: stripZ(f.geometry),
  }));
}

export async function prescriptions(geom) {
  const out = [];
  for (const kind of ['prescription-surf', 'prescription-lin', 'prescription-pct', 'info-surf']) {
    try {
      const j = await getJson(`${A.gpu}/${kind}?geom=${encodeURIComponent(JSON.stringify(geom))}`, { timeout: 10000 });
      for (const f of j.features || []) {
        const p = f.properties || {};
        out.push({ source: kind, libelle: p.libelle || p.txt || 'Prescription', txt: p.txt || '', urlfic: p.urlfic || null, type: p.typepsc || p.typeinf || '', sousType: p.stypepsc || p.stypeinf || '' });
      }
    } catch { /* une couche manquante n’empêche pas l’analyse */ }
  }
  return out;
}

export async function documentUrba(geom) {
  try {
    const j = await getJson(`${A.gpu}/document?geom=${encodeURIComponent(JSON.stringify(geom))}`, { timeout: 10000 });
    const f = (j.features || [])[0];
    return f ? { type: f.properties.du_type, nom: f.properties.grid_title || f.properties.partition, etat: f.properties.etat } : null;
  } catch { return null; }
}

export async function communeRnu(insee) {
  try {
    const j = await getJson(`${A.gpu}/municipality?insee=${insee}`, { timeout: 10000 });
    const f = (j.features || [])[0];
    return f ? Boolean(f.properties.is_rnu) : null;
  } catch { return null; }
}

// Toutes les parcelles d'une commune (pages de 1000), pour la recherche par surface
export async function parcellesCommune(insee, onProgress) {
  const toutes = [];
  for (let page = 0; page < 40; page++) {
    const j = await getJson(`${A.cadastre}?code_insee=${insee}&_limit=1000&_start=${page * 1000}`, { timeout: 30000 });
    const f = j.features || [];
    toutes.push(...f);
    onProgress?.(toutes.length);
    if (f.length < 1000) break;
  }
  return toutes.map(normaliseParcelle);
}

// Parcelles visibles dans un rectangle (repli si la commune entière échoue)
export async function parcellesDans(bbox) {
  const [w, s2, e, n] = bbox;
  const poly = { type: 'Polygon', coordinates: [[[w, s2], [e, s2], [e, n], [w, n], [w, s2]]] };
  const j = await getJson(`${A.cadastre}?geom=${encodeURIComponent(JSON.stringify(poly))}&_limit=1000`, { timeout: 30000 });
  return (j.features || []).map(normaliseParcelle);
}

// Numéros de rue (Base adresse nationale), préparés par npm run data
const adressesCache = new Map();
export function adressesCommune(insee) {
  if (!adressesCache.has(insee)) {
    adressesCache.set(insee, getJson(`/data/adresses/${insee}.json`, { timeout: 15000 }).then((j) => j.adresses || []).catch(() => []));
  }
  return adressesCache.get(insee);
}

// Routes (BD TOPO) pour savoir de quel côté est la rue
export async function routesDans(bbox) {
  const [minx, miny, maxx, maxy] = bbox;
  const params = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '1.0.0', REQUEST: 'GetFeature',
    TYPENAME: 'BDTOPO_V3:troncon_de_route', OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:4326', BBOX: `${minx},${miny},${maxx},${maxy}`, MAXFEATURES: '200',
  });
  const j = await getJson(`${A.wfs}?${params}`, { timeout: 20000 });
  const lignes = [];
  for (const f of j.features || []) {
    const g = fixAxes(stripZ(f.geometry));
    if (g.type === 'LineString') lignes.push(g.coordinates);
    else if (g.type === 'MultiLineString') lignes.push(...g.coordinates);
  }
  return lignes;
}

// ── Bâtiments (BD TOPO, WFS Géoplateforme) ──
export async function batimentsDans(bbox) {
  const [minx, miny, maxx, maxy] = bbox;
  const params = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '1.0.0', REQUEST: 'GetFeature',
    TYPENAME: 'BDTOPO_V3:batiment', OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:4326', BBOX: `${minx},${miny},${maxx},${maxy}`, MAXFEATURES: '400',
  });
  const j = await getJson(`${A.wfs}?${params}`, { timeout: 20000 });
  return (j.features || []).map((f) => ({ type: 'Feature', properties: { hauteur: f.properties?.hauteur ?? null, usage: f.properties?.usage_1 ?? '' }, geometry: fixAxes(stripZ(f.geometry)) }));
}

// Retire l'altitude des coordonnées (Turf préfère du 2D)
export function stripZ(geom) {
  if (!geom) return geom;
  const s = (c) => (typeof c[0] === 'number' ? [c[0], c[1]] : c.map(s));
  return { type: geom.type, coordinates: s(geom.coordinates) };
}

// Sécurité : en France la latitude (41–51) est toujours > à la longitude (-5–10)
function fixAxes(geom) {
  if (!geom) return geom;
  let first = geom.coordinates;
  while (Array.isArray(first[0])) first = first[0];
  if (first[0] > 40 && first[1] < 15) {
    const s = (c) => (typeof c[0] === 'number' ? [c[1], c[0]] : c.map(s));
    return { type: geom.type, coordinates: s(geom.coordinates) };
  }
  return geom;
}

// ── DVF : ventes notariées ──
let communesCache = null;
export async function communes() {
  if (communesCache) return communesCache;
  try { communesCache = await getJson('/data/communes.json', { timeout: 8000 }); } catch { communesCache = []; }
  return communesCache;
}

const ventesCache = new Map();
export async function ventesCommune(insee) {
  if (ventesCache.has(insee)) return ventesCache.get(insee);
  const p = (async () => {
    try {
      const j = await getJson(`${A.dvfLocal}/${insee}.json`, { timeout: 10000 });
      return j.ventes || [];
    } catch {
      return ventesDistantes(insee);
    }
  })();
  ventesCache.set(insee, p);
  return p;
}

// Secours : lecture directe des CSV geo-dvf depuis le navigateur
async function ventesDistantes(insee) {
  const dep = insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2);
  const an = new Date().getFullYear();
  const rows = [];
  await Promise.all([an, an - 1, an - 2, an - 3, an - 4].map(async (y) => {
    try {
      const r = await fetch(`${A.dvfDistant}/${y}/communes/${dep}/${insee}.csv`);
      if (r.ok) rows.push(...parseCsv(await r.text()));
    } catch { /* année absente */ }
  }));
  return aggregateMutations(rows);
}

/** Ventes de la commune et des communes voisines (centre à moins de `rayon` mètres). */
export async function ventesAutour(lat, lon, insee, rayon = 9000) {
  const liste = await communes();
  const codes = new Set([insee]);
  for (const c of liste) if (c.x && distance(lat, lon, c.y, c.x) <= rayon) codes.add(c.c);
  const lots = await Promise.all([...codes].map((c) => ventesCommune(c).catch(() => [])));
  return lots.flat();
}
