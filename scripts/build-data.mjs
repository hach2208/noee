#!/usr/bin/env node
// Noéé : télécharge les ventes DVF (geo-dvf, data.gouv) et la liste des communes,
// puis prépare un fichier JSON compact par commune dans public/data/.
//
//   npm run data                      → départements de config.js, 5 dernières années
//   npm run data -- --deps 40,64,33   → autres départements
//   npm run data -- --csv-dir ./dvf   → fichiers déjà téléchargés : ./dvf/<année>/<dep>.csv(.gz)
//
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../public/assets/js/config.js';
import { splitCsvLine, aggregateMutations, communeStats, slugify } from '../public/assets/js/dvf-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

const deps = (opt('--deps') || CONFIG.departements.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const csvDir = opt('--csv-dir');
const communesFile = opt('--communes-file');
const nbAnnees = Number(opt('--annees') || 5);
const BASE = 'https://files.data.gouv.fr/geo-dvf/latest/csv';

fs.mkdirSync(path.join(OUT, 'dvf'), { recursive: true });

async function lignesDepuis(stream, gz) {
  const src = gz ? stream.pipe(zlib.createGunzip()) : stream;
  return readline.createInterface({ input: src, crlfDelay: Infinity });
}

async function ouvrir(annee, dep) {
  if (csvDir) {
    for (const ext of ['.csv.gz', '.csv']) {
      const f = path.join(csvDir, String(annee), `${dep}${ext}`);
      if (fs.existsSync(f)) return lignesDepuis(fs.createReadStream(f), ext.endsWith('.gz'));
    }
    return null;
  }
  const url = `${BASE}/${annee}/departements/${dep}.csv.gz`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return lignesDepuis(Readable.fromWeb(r.body), true);
}

async function chargerCommunes() {
  if (communesFile) return JSON.parse(fs.readFileSync(communesFile, 'utf8'));
  const toutes = [];
  for (const dep of deps) {
    const r = await fetch(`https://geo.api.gouv.fr/departements/${dep}/communes?fields=nom,code,codesPostaux,centre,population&format=json`);
    if (!r.ok) throw new Error(`geo.api.gouv.fr ${dep} : HTTP ${r.status}`);
    for (const c of await r.json()) {
      toutes.push({ c: c.code, n: c.nom, s: slugify(c.nom), cp: c.codesPostaux || [], x: c.centre?.coordinates?.[0], y: c.centre?.coordinates?.[1], pop: c.population || 0, dep });
    }
  }
  return toutes;
}

async function main() {
  console.log(`Noéé · données DVF pour ${deps.join(', ')}`);
  const communes = await chargerCommunes();
  // Homonymes : on ajoute le département au slug
  const vus = new Map();
  for (const c of communes) vus.set(c.s, (vus.get(c.s) || 0) + 1);
  for (const c of communes) if (vus.get(c.s) > 1) c.s = `${c.s}-${c.dep}`;
  console.log(`  ${communes.length} communes`);

  const parCommune = new Map(); // insee -> lignes
  const an = new Date().getFullYear();
  let annees = 0;
  for (let y = an; y >= an - 8 && annees < nbAnnees; y--) {
    let trouve = false;
    for (const dep of deps) {
      const rl = await ouvrir(y, dep);
      if (!rl) continue;
      trouve = true;
      let head = null;
      let n = 0;
      for await (const line of rl) {
        if (!line) continue;
        if (!head) { head = splitCsvLine(line); continue; }
        const cells = splitCsvLine(line);
        const r = {};
        for (let j = 0; j < head.length; j++) r[head[j]] = cells[j] ?? '';
        const code = r.code_commune;
        if (!parCommune.has(code)) parCommune.set(code, []);
        parCommune.get(code).push(r);
        n++;
      }
      console.log(`  ${y} · ${dep} : ${n.toLocaleString('fr-FR')} lignes`);
    }
    if (trouve) annees++;
  }
  if (!parCommune.size) throw new Error('Aucune donnée DVF lue. Vérifiez la connexion ou --csv-dir.');

  const stats = {};
  const maj = new Date().toISOString().slice(0, 10);
  let total = 0;
  for (const [insee, rows] of parCommune) {
    const ventes = aggregateMutations(rows);
    if (!ventes.length) continue;
    const nom = rows[0].nom_commune;
    fs.writeFileSync(path.join(OUT, 'dvf', `${insee}.json`), JSON.stringify({ insee, nom, maj, ventes }));
    stats[insee] = communeStats(ventes);
    total += ventes.length;
  }
  for (const c of communes) c.ventes = stats[c.c]?.total || 0;
  fs.writeFileSync(path.join(OUT, 'communes.json'), JSON.stringify(communes));
  fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify({ maj, communes: stats }));
  console.log(`  ${total.toLocaleString('fr-FR')} ventes exploitables dans ${Object.keys(stats).length} communes`);
  console.log('Terminé. Lancez maintenant : npm run pages');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
