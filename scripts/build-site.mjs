#!/usr/bin/env node
// Noéé : copie public/ vers _site/ en adaptant les chemins quand le site vit dans un sous-dossier
// (ex. GitHub Pages : https://hach2208.github.io/noee/ → NOEE_BASE=/noee/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, '_site');
let BASE = process.env.NOEE_BASE || '/';
if (!BASE.startsWith('/')) BASE = `/${BASE}`;
if (!BASE.endsWith('/')) BASE += '/';

const RACINES = ['assets', 'vendor', 'data', 'vendre', 'division', 'biens', 'communes', 'admin', 'installer', 'maj', 'mentions-legales', 'icons', 'favicon\\.svg', 'manifest\\.webmanifest', 'sw\\.js', 'sitemap\\.xml'];
const re = new RegExp(`(["'\`(=])\\/(${RACINES.join('|')})`, 'g');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

let n = 0;
(function parcourir(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'data') parcourir(f); continue; }
    if (!/\.(html|js|css)$/.test(e.name) || BASE === '/') continue;
    let s = fs.readFileSync(f, 'utf8');
    const avant = s;
    s = s.replace(re, `$1${BASE}$2`).replace(/href="\/"/g, `href="${BASE}"`);
    if (s !== avant) { fs.writeFileSync(f, s); n++; }
  }
})(OUT);
// Le CSS des polices est dans assets : déjà traité. robots.txt : chemins à jour.
const robots = path.join(OUT, 'robots.txt');
if (fs.existsSync(robots)) fs.writeFileSync(robots, fs.readFileSync(robots, 'utf8').replace('Disallow: /admin/', `Disallow: ${BASE}admin/`));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`Noéé · site prêt dans _site/ (base ${BASE}, ${n} fichiers adaptés)`);
