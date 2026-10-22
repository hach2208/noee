// Noéé : logique DVF partagée (navigateur + script Node). Aucun accès au DOM ici.
//
// Format compact d'une vente (tableau) :
//   [0] date 'AAAA-MM-JJ'  [1] type 'M' maison | 'A' appartement | 'T' terrain
//   [2] prix €             [3] surface bâtie m² (0 pour un terrain)
//   [4] pièces             [5] surface terrain m²
//   [6] longitude          [7] latitude
//   [8] drapeaux : 1 = terrain à bâtir, 2 = VEFA (neuf sur plan)

export const V = { date: 0, type: 1, prix: 2, surf: 3, pieces: 4, terrain: 5, lon: 6, lat: 7, flags: 8 };
export const FLAG_TAB = 1;
export const FLAG_VEFA = 2;

/** Découpe une ligne CSV en tenant compte des guillemets. */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Transforme un texte CSV geo-dvf en lignes objets. */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const head = splitCsvLine(lines[0] || '');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = splitCsvLine(lines[i]);
    const r = {};
    for (let j = 0; j < head.length; j++) r[head[j]] = cells[j] ?? '';
    rows.push(r);
  }
  return rows;
}

const num = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Regroupe les lignes geo-dvf par mutation et ne garde que les ventes exploitables :
 * une seule maison ou un seul appartement (dépendances tolérées), ou un terrain nu.
 */
export function aggregateMutations(rows) {
  const groups = new Map();
  for (const r of rows) {
    const id = r.id_mutation;
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(r);
  }
  const ventes = [];
  for (const g of groups.values()) {
    const v = toVente(g);
    if (v) ventes.push(v);
  }
  ventes.sort((a, b) => (a[V.date] < b[V.date] ? 1 : -1));
  return ventes;
}

function toVente(g) {
  const first = g[0];
  const nature = first.nature_mutation || '';
  const vefa = /futur d.ach/i.test(nature);
  if (nature !== 'Vente' && !vefa) return null;
  const prix = num(first.valeur_fonciere);
  if (prix < 1000) return null;

  const locaux = new Map();
  let autreLocal = false;
  const terres = new Map();
  let tab = false;
  let lon = 0;
  let lat = 0;

  for (const r of g) {
    const t = r.type_local;
    if (t === 'Maison' || t === 'Appartement') {
      const k = [r.id_parcelle, t, r.surface_reelle_bati, r.nombre_pieces_principales, r.lot1_numero].join('|');
      if (!locaux.has(k)) locaux.set(k, r);
    } else if (t && t !== 'Dépendance') {
      autreLocal = true;
    }
    if (r.surface_terrain) {
      const k = [r.id_parcelle, r.code_nature_culture, r.surface_terrain].join('|');
      if (!terres.has(k)) terres.set(k, num(r.surface_terrain));
    }
    if (r.code_nature_culture === 'AB') tab = true;
    if (!lon && r.longitude && r.latitude) { lon = num(r.longitude); lat = num(r.latitude); }
  }
  if (autreLocal || locaux.size > 1 || !lon) return null;

  const terrain = Math.round([...terres.values()].reduce((a, b) => a + b, 0));
  const date = first.date_mutation;
  const flags = (tab ? FLAG_TAB : 0) | (vefa ? FLAG_VEFA : 0);
  const ll = [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];

  if (locaux.size === 1) {
    const r = [...locaux.values()][0];
    const type = r.type_local === 'Maison' ? 'M' : 'A';
    let surf = num(r.surface_reelle_bati);
    if (!surf && type === 'A') surf = num(r.lot1_surface_carrez);
    if (surf < 9 || surf > 1000) return null;
    const m2 = prix / surf;
    if (m2 < 400 || m2 > 30000) return null;
    return [date, type, Math.round(prix), Math.round(surf), num(r.nombre_pieces_principales), terrain, ll[0], ll[1], flags];
  }
  // Terrain nu
  if (terrain < 50 || prix < 5000) return null;
  const m2 = prix / terrain;
  if (m2 < 2 || m2 > 3000) return null;
  return [date, 'T', Math.round(prix), 0, 0, terrain, ll[0], ll[1], flags];
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Médiane pondérée : valeurs [{v, w}]. */
export function weightedQuantile(items, q) {
  const s = items.filter((i) => i.w > 0).sort((a, b) => a.v - b.v);
  const total = s.reduce((a, b) => a + b.w, 0);
  if (!total) return 0;
  let acc = 0;
  for (const i of s) {
    acc += i.w;
    if (acc >= total * q) return i.v;
  }
  return s[s.length - 1].v;
}

/** Statistiques agrégées d'une commune (pour pages communes et compteurs). */
export function communeStats(ventes, now = new Date()) {
  const il12 = new Date(now); il12.setMonth(il12.getMonth() - 12);
  const lim = il12.toISOString().slice(0, 10);
  const out = { total: ventes.length, derniere: ventes[0]?.[V.date] || null, types: {} };
  for (const t of ['M', 'A', 'T']) {
    const vs = ventes.filter((v) => v[V.type] === t && (t !== 'T' || v[V.flags] & FLAG_TAB || v[V.terrain] < 3000));
    if (!vs.length) continue;
    const m2 = vs.map((v) => v[V.prix] / (t === 'T' ? v[V.terrain] : v[V.surf]));
    const parAn = {};
    for (const v of vs) {
      const y = v[V.date].slice(0, 4);
      (parAn[y] ||= []).push(v[V.prix] / (t === 'T' ? v[V.terrain] : v[V.surf]));
    }
    out.types[t] = {
      n: vs.length,
      n12: vs.filter((v) => v[V.date] >= lim).length,
      prixMedian: Math.round(median(vs.map((v) => v[V.prix]))),
      m2Median: Math.round(median(m2)),
      surfMediane: Math.round(median(vs.map((v) => (t === 'T' ? v[V.terrain] : v[V.surf])))),
      terrainMedian: Math.round(median(vs.map((v) => v[V.terrain]).filter(Boolean))),
      parAn: Object.fromEntries(Object.entries(parAn).sort().map(([y, a]) => [y, { n: a.length, m2: Math.round(median(a)) }])),
    };
  }
  return out;
}

/** Distance en mètres (haversine). */
export function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
