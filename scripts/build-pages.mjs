#!/usr/bin/env node
// Noéé : génère les pages statiques « Vendre à <commune> », la liste des communes et le sitemap.
//   npm run pages                         (après npm run data)
//   NOEE_SITE=https://noee.fr npm run pages   pour les URL canoniques
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../public/assets/js/config.js';
import { distance } from '../public/assets/js/dvf-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const SITE = (process.env.NOEE_SITE || 'https://noee.fr').replace(/\/$/, '');
const MIN_VENTES = 5;

const communes = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'communes.json'), 'utf8'));
const { maj, communes: stats } = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'stats.json'), 'utf8'));
const M = CONFIG.marque;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €';
const nb = (n) => new Intl.NumberFormat('fr-FR').format(n);
const LIB = { M: 'Maisons', A: 'Appartements', T: 'Terrains' };

function histo(parAn) {
  const ans = Object.keys(parAn).slice(-6);
  if (ans.length < 2) return '';
  const vals = ans.map((a) => parAn[a].m2);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const h = (v) => (max === min ? 70 : Math.round(25 + ((v - min) / (max - min)) * 75));
  return `<div class="histo" aria-hidden="true">${ans.map((a) => `<div style="height:${h(parAn[a].m2)}%"><span>${nb(parAn[a].m2)}</span></div>`).join('')}</div>
    <div class="histo-lib" aria-hidden="true">${ans.map((a) => `<span>${a}</span>`).join('')}</div>
    <table class="sr"><caption>Prix médian au m² par année</caption>${ans.map((a) => `<tr><th>${a}</th><td>${nb(parAn[a].m2)} €/m² (${parAn[a].n} ventes)</td></tr>`).join('')}</table>`;
}

function page(c, s, voisines) {
  const types = ['M', 'A', 'T'].filter((t) => s.types[t]);
  const desc = `Prix de l’immobilier à ${c.n} d’après ${nb(s.total)} ventes notariées. Estimez votre bien en 2 minutes et testez la division de votre terrain.`;
  const cartes = types.map((t) => {
    const d = s.types[t];
    return `<div class="carte-stat">
      <h3>${LIB[t]}</h3>
      <b>${nb(d.m2Median)} €/m²</b>
      <p class="petit">Prix médian ${t === 'T' ? 'd’un terrain' : 'de vente'} : ${eur(Math.round(d.prixMedian / 1000) * 1000)} pour ${nb(d.surfMediane)} m². ${nb(d.n)} ventes, dont ${nb(d.n12)} sur les 12 derniers mois.</p>
      ${histo(d.parAn)}
    </div>`;
  }).join('');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Vendre à ${esc(c.n)} : prix et estimation gratuite | ${esc(M.nom)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/vendre/${c.s}/">
<meta property="og:title" content="Vendre à ${esc(c.n)} | ${esc(M.nom)}">
<meta property="og:description" content="${esc(desc)}">
<meta name="theme-color" content="#0e3b43">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Noéé">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="stylesheet" href="/assets/css/noee.css">
</head>
<body data-page="communes">
<main id="contenu">
  <section class="bloc">
    <div class="wrap">
      <p class="petit"><a href="/communes/">Communes</a> / ${esc(c.n)} (${esc(c.cp[0] || c.dep)})</p>
      <h1>Vendre à ${esc(c.n)}</h1>
      <p class="lead">${nb(s.total)} ventes signées chez le notaire depuis ${esc(Object.keys(s.types[types[0]]?.parAn || {})[0] || '')}. Voici ce qu’elles disent des prix, rue par rue.</p>
      <form class="champ-adresse" action="/vendre/" method="get" style="max-width:560px;margin-top:24px">
        <div class="ligne">
          <label class="sr" for="adr">Adresse du bien à ${esc(c.n)}</label>
          <input id="adr" name="adresse" type="text" placeholder="N° et rue à ${esc(c.n)}" required>
          <input type="hidden" name="insee" value="${c.c}">
          <button class="btn resine" type="submit">Estimer</button>
        </div>
      </form>
      <div class="stat-commune">${cartes}</div>
      <p class="petit">Médianes calculées sur les ventes d’une seule maison, d’un seul appartement ou d’un terrain nu (DVF, données publiques). Mise à jour du ${esc(new Date(maj).toLocaleDateString('fr-FR'))}.</p>
    </div>
  </section>
  <section class="bloc">
    <div class="wrap">
      <div class="contact" style="background:var(--dune);color:var(--ink)">
        <div>
          <h2 style="color:var(--ocean)">Un grand terrain à ${esc(c.n)} ?</h2>
          <p style="margin:0">Une partie peut valoir plus vendue à part. Le test prend deux minutes.</p>
        </div>
        <div class="actions"><a class="btn" href="/division/">Tester mon terrain</a></div>
      </div>
    </div>
  </section>
  ${voisines.length ? `<section class="bloc"><div class="wrap"><h2>Communes voisines</h2><ul class="communes-liste">${voisines.map((v) => `<li><a href="/vendre/${v.s}/">${esc(v.n)}</a></li>`).join('')}</ul></div></section>` : ''}
</main>
<script type="module">
  import { montageCommun } from '/assets/js/ui.js';
  montageCommun();
</script>
</body>
</html>`;
}

const avec = communes.filter((c) => (stats[c.c]?.total || 0) >= MIN_VENTES);
let n = 0;
for (const c of avec) {
  const voisines = avec.filter((v) => v.c !== c.c && v.x && c.x).map((v) => ({ ...v, d: distance(c.y, c.x, v.y, v.x) })).sort((a, b) => a.d - b.d).slice(0, 12);
  const dir = path.join(PUB, 'vendre', c.s);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(c, stats[c.c], voisines));
  n++;
}

// Liste des communes (statique, triée par département puis nom)
const parDep = {};
for (const c of avec) (parDep[c.dep] ||= []).push(c);
const NOMS_DEP = { 40: 'Landes', 64: 'Pyrénées-Atlantiques', 33: 'Gironde', 32: 'Gers', 47: 'Lot-et-Garonne' };
const liste = Object.keys(parDep).sort().map((d) => `<h2>${esc(NOMS_DEP[d] || `Département ${d}`)}</h2><ul class="communes-liste">${parDep[d].sort((a, b) => a.n.localeCompare(b.n, 'fr')).map((c) => `<li><a href="/vendre/${c.s}/">${esc(c.n)}</a> <small>${nb(stats[c.c].total)}</small></li>`).join('')}</ul>`).join('');
const htmlListe = fs.readFileSync(path.join(PUB, 'communes', 'index.html'), 'utf8')
  .replace(/<!-- LISTE -->[\s\S]*<!-- \/LISTE -->/, `<!-- LISTE -->${liste}<!-- /LISTE -->`);
fs.writeFileSync(path.join(PUB, 'communes', 'index.html'), htmlListe);

// Sitemap
const urls = ['/', '/vendre/', '/division/', '/biens/', '/communes/', ...avec.map((c) => `/vendre/${c.s}/`)];
fs.writeFileSync(path.join(PUB, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${maj}</lastmod></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(PUB, 'robots.txt'), `User-agent: *\nDisallow: /admin/\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`Noéé · ${n} pages communes générées, sitemap à jour (${SITE}).`);
