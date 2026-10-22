import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, aggregateMutations, communeStats, V, FLAG_TAB } from '../public/assets/js/dvf-core.js';
import { estimer, reperesTerrain } from '../public/assets/js/estimate.js';

const H = 'id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_suffixe,adresse_nom_voie,adresse_code_voie,code_postal,code_commune,nom_commune,code_departement,ancien_code_commune,ancien_nom_commune,id_parcelle,ancien_id_parcelle,numero_volume,lot1_numero,lot1_surface_carrez,lot2_numero,lot2_surface_carrez,lot3_numero,lot3_surface_carrez,lot4_numero,lot4_surface_carrez,lot5_numero,lot5_surface_carrez,nombre_lots,code_type_local,type_local,surface_reelle_bati,nombre_pieces_principales,code_nature_culture,nature_culture,code_nature_culture_speciale,nature_culture_speciale,surface_terrain,longitude,latitude';
const row = (o) => H.split(',').map((k) => o[k] ?? '').join(',');
const base = { nature_mutation: 'Vente', code_commune: '40065', nom_commune: 'Capbreton', code_departement: '40', longitude: '-1.42', latitude: '43.64' };

test('agrégation geo-dvf : maison + dépendance sur 2 parcelles', () => {
  const csv = [H,
    row({ ...base, id_mutation: 'M1', date_mutation: '2025-03-01', valeur_fonciere: '450000', id_parcelle: '40065000AB0001', code_type_local: '1', type_local: 'Maison', surface_reelle_bati: '110', nombre_pieces_principales: '5', code_nature_culture: 'S', nature_culture: 'sols', surface_terrain: '600' }),
    row({ ...base, id_mutation: 'M1', date_mutation: '2025-03-01', valeur_fonciere: '450000', id_parcelle: '40065000AB0001', code_type_local: '3', type_local: 'Dépendance', code_nature_culture: 'S', nature_culture: 'sols', surface_terrain: '600' }),
    row({ ...base, id_mutation: 'M1', date_mutation: '2025-03-01', valeur_fonciere: '450000', id_parcelle: '40065000AB0002', code_nature_culture: 'J', nature_culture: 'jardins', surface_terrain: '150' }),
    // appartement avec seulement la surface Carrez
    row({ ...base, id_mutation: 'A1', date_mutation: '2025-01-10', valeur_fonciere: '300000', id_parcelle: '40065000AC0010', lot1_numero: '12', lot1_surface_carrez: '60.5', code_type_local: '2', type_local: 'Appartement', surface_reelle_bati: '', nombre_pieces_principales: '3' }),
    // terrain à bâtir
    row({ ...base, id_mutation: 'T1', date_mutation: '2024-11-05', valeur_fonciere: '180000', id_parcelle: '40065000AD0003', code_nature_culture: 'AB', nature_culture: 'terrains a bâtir', surface_terrain: '520' }),
    // deux appartements vendus ensemble : écarté
    row({ ...base, id_mutation: 'X1', date_mutation: '2024-06-01', valeur_fonciere: '500000', id_parcelle: '40065000AC0011', lot1_numero: '1', code_type_local: '2', type_local: 'Appartement', surface_reelle_bati: '50', nombre_pieces_principales: '2' }),
    row({ ...base, id_mutation: 'X1', date_mutation: '2024-06-01', valeur_fonciere: '500000', id_parcelle: '40065000AC0011', lot1_numero: '2', code_type_local: '2', type_local: 'Appartement', surface_reelle_bati: '55', nombre_pieces_principales: '2' }),
    // local commercial : écarté
    row({ ...base, id_mutation: 'X2', date_mutation: '2024-06-01', valeur_fonciere: '200000', id_parcelle: '40065000AC0012', code_type_local: '4', type_local: 'Local industriel. commercial ou assimilé', surface_reelle_bati: '80' }),
    // échange : écarté
    row({ ...base, id_mutation: 'X3', nature_mutation: 'Echange', date_mutation: '2024-06-01', valeur_fonciere: '200000', id_parcelle: '40065000AC0013', code_type_local: '1', type_local: 'Maison', surface_reelle_bati: '80' }),
  ].join('\n');
  const v = aggregateMutations(parseCsv(csv));
  assert.equal(v.length, 3);
  const m = v.find((x) => x[V.type] === 'M');
  assert.equal(m[V.prix], 450000);
  assert.equal(m[V.surf], 110);
  assert.equal(m[V.terrain], 750, 'terrain dédoublonné : 600 + 150');
  const a = v.find((x) => x[V.type] === 'A');
  assert.equal(a[V.surf], 61);
  const t = v.find((x) => x[V.type] === 'T');
  assert.ok(t[V.flags] & FLAG_TAB);
  assert.equal(v[0][V.date], '2025-03-01', 'tri du plus récent au plus ancien');
  const s = communeStats(v, new Date('2025-06-01'));
  assert.equal(s.types.M.m2Median, Math.round(450000 / 110));
});

function marche(n = 60) {
  // Marché synthétique : 5 000 €/m² ± bruit, autour de Capbreton
  const out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const surf = 70 + Math.round(rnd() * 80);
    const m2 = 5000 * (0.85 + rnd() * 0.3);
    const mois = Math.floor(rnd() * 30);
    const d = new Date('2026-06-01'); d.setMonth(d.getMonth() - mois);
    out.push([d.toISOString().slice(0, 10), 'M', Math.round(surf * m2), surf, 4, 500 + Math.round(rnd() * 400), -1.42 + (rnd() - 0.5) * 0.02, 43.64 + (rnd() - 0.5) * 0.02, 0]);
  }
  for (let i = 0; i < 12; i++) out.push(['2025-09-01', 'T', 150000 + i * 4000, 0, 0, 450 + i * 10, -1.42 + i * 0.001, 43.64, 1]);
  return out;
}

test('estimation : maison de 100 m² sur un marché à ~5 000 €/m²', () => {
  const r = estimer({ lat: 43.64, lon: -1.42, type: 'M', surf: 100, terrain: 700, etat: 'bon', dpe: 'D' }, marche(), new Date('2026-06-15'));
  assert.ok(r.ok);
  assert.ok(r.valeur > 440000 && r.valeur < 560000, `valeur ${r.valeur}`);
  assert.ok(r.bas < r.valeur && r.haut > r.valeur);
  assert.ok(r.n >= 8);
});

test('estimation : coefficients appliqués (à rénover, DPE G)', () => {
  const v = marche();
  const ref = estimer({ lat: 43.64, lon: -1.42, type: 'M', surf: 100, terrain: 0, etat: 'bon', dpe: 'D' }, v, new Date('2026-06-15'));
  const bas = estimer({ lat: 43.64, lon: -1.42, type: 'M', surf: 100, terrain: 0, etat: 'renover', dpe: 'G' }, v, new Date('2026-06-15'));
  assert.ok(bas.valeur < ref.valeur * 0.75);
});

test('estimation : aucune vente', () => {
  const r = estimer({ lat: 43.64, lon: -1.42, type: 'A', surf: 50 }, [], new Date());
  assert.equal(r.ok, false);
});

test('repères terrain à bâtir', () => {
  const r = reperesTerrain(43.64, -1.42, marche(), new Date('2026-06-15'));
  assert.ok(r && r.n >= 5 && r.tabSeulement);
  assert.ok(r.m2 > 250 && r.m2 < 450, `m2 ${r.m2}`);
});
