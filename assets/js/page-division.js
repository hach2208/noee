// Noéé : page Terrain. Sélection de parcelles (additionnées), croquis de division,
// capacité en logements (repris d'Imoscope), recherche de terrains par surface.
import { CONFIG } from './config.js';
import { geocode, parcelleAuPoint, parcellePourAdresse, zonesUrba, prescriptions, communeRnu, batimentsDans, routesDans, ventesAutour, parcellesCommune, parcellesDans, adressesCommune, communes } from './api.js';
import { reperesTerrain } from './estimate.js';
import { analyserDivision, reglesPourZone, uniteFonciere } from './division-calc.js';
import { PROGRAMMES, PART_SOCIALE_DEFAUT, zoneInfo, capacite, bilanPromoteur, chargerRegles, enregistrerRegle } from './programme.js';
import { V, FLAG_VEFA, distance, median } from './dvf-core.js';
import { montageCommun, creerCarte, champAdresse, paramsUrl, euro, nombre, esc, $, $$, toast, modePerso } from './ui.js';
import { enregistrerLead, telValide, emailValide } from './leads.js';

montageCommun();
const params = paramsUrl();
const L = window.L;
const turf = window.turf;

const { map } = creerCarte($('#carte'), { zoom: 16, fond: 'ortho', zonage: false });
map.doubleClickZoom.disable();
const rendu = L.canvas({ padding: 0.5 });
const cRecherche = L.layerGroup().addTo(map);
const cParcelles = L.layerGroup().addTo(map);
const cEtiquettes = L.layerGroup().addTo(map); // surface des parcelles (masquée quand un croquis est dessiné)
const cCroquis = L.layerGroup().addTo(map);
const cBati = L.layerGroup().addTo(map);
const cNumeros = L.layerGroup().addTo(map);

const etat = {
  parcelles: [],
  mode: 'lots',
  batiments: [],
  routes: [],
  ventes: [],
  reperes: null,
  rnu: {},
  rotation: 0,
  reglesAuto: true,
  zoneRegles: null,
  programme: 'collectif',
  hyp: { ...PROGRAMMES.collectif, partSociale: PART_SOCIALE_DEFAUT },
  regles: chargerRegles(),
  adresses: {},
  seq: 0,
  ctxCle: '',
  analyse: null,
  prixAuto: true,
};

// ── Message d'état sur la carte ──
function message(txt, type = '') {
  const e = $('#etat');
  e.textContent = txt;
  e.className = `etat ${type}`;
}

// ── Recherche d'adresse : va sur place et sélectionne la parcelle ──
champAdresse($('#adresse'), {
  onChoix: async (it) => {
    map.setView([it.lat, it.lon], 18);
    etat.parcelles = [];
    await ajouterAuPoint(it.lon, it.lat, it);
  },
});

map.on('click', (e) => ajouterAuPoint(e.latlng.lng, e.latlng.lat));

async function ajouterAuPoint(lon, lat, adresse = null) {
  message('Recherche de la parcelle…', 'charge-e');
  let p;
  try { p = adresse ? await parcellePourAdresse(adresse) : await parcelleAuPoint(lon, lat); } catch { message('Le cadastre ne répond pas. Réessayez dans un instant.', 'ko'); return; }
  if (!p) { message('Aucune parcelle ici. Zoomez et touchez une parcelle.', 'ko'); return; }
  const idu = p.properties.idu;
  const i = etat.parcelles.findIndex((x) => x.idu === idu);
  if (i >= 0) {
    etat.parcelles.splice(i, 1);
    message(`Parcelle ${p.properties.section} ${p.properties.numero} retirée.`);
    return actualiser();
  }
  const parcelle = {
    idu, section: p.properties.section, numero: p.properties.numero, surface: p.properties.contenance || Math.round(turf.area(p)),
    insee: p.properties.insee, commune: p.properties.commune, feature: p, geometry: p.geometry, zones: null, prescriptions: [],
  };
  etat.parcelles.push(parcelle);
  if (etat.parcelles.length === 1) { etat.reglesAuto = true; etat.rotation = 0; }
  message(`Parcelle ${parcelle.section} ${parcelle.numero} : ${nombre(parcelle.surface)} m². Lecture du PLU…`, 'charge-e');
  dessinerParcelles();
  const [zones, presc] = await Promise.all([zonesUrba(p.geometry).catch(() => []), prescriptions(p.geometry)]);
  parcelle.zones = zones;
  parcelle.prescriptions = presc;
  message(zones.length ? `Parcelle ${parcelle.section} ${parcelle.numero} : ${nombre(parcelle.surface)} m², zone ${zones.map((z) => z.libelle).join(', ')}.` : `Parcelle ${parcelle.section} ${parcelle.numero} : ${nombre(parcelle.surface)} m².`, 'ok');
  actualiser();
}

// ── Dessin des parcelles sélectionnées avec leur surface ──
function dessinerParcelles() {
  cParcelles.clearLayers();
  cEtiquettes.clearLayers();
  for (const p of etat.parcelles) {
    L.geoJSON(p.feature, { style: { color: '#c98a12', weight: 3, fillColor: '#c98a12', fillOpacity: 0.12 }, interactive: false }).addTo(cParcelles);
    const pt = turf.pointOnFeature(p.feature).geometry.coordinates;
    L.tooltip({ permanent: true, direction: 'center', className: 'lbl-carte', interactive: false })
      .setLatLng([pt[1], pt[0]])
      .setContent(`${esc(p.section)} ${esc(p.numero)}<br>${nombre(p.surface)} m²`)
      .addTo(cEtiquettes);
  }
  $('#vider').hidden = !etat.parcelles.length;
}
$('#vider').addEventListener('click', () => { etat.parcelles = []; cCroquis.clearLayers(); cBati.clearLayers(); actualiser(); message('Sélection vidée. Touchez une parcelle.'); });

// ── Contexte : bâtiments, routes, ventes, RNU, adresses (rechargé quand l'emprise change) ──
async function chargerContexte() {
  const unite = uniteFonciere(etat.parcelles.map((p) => p.feature));
  const bb = turf.bbox(turf.buffer(unite, 60, { units: 'meters' }));
  const cle = bb.map((x) => x.toFixed(4)).join(',');
  if (cle === etat.ctxCle) return;
  etat.ctxCle = cle;
  const centre = turf.centroid(unite).geometry.coordinates;
  const insees = [...new Set(etat.parcelles.map((p) => p.insee))];
  const [bats, routes, ventes] = await Promise.all([
    batimentsDans(bb).catch(() => null),
    routesDans(bb).catch(() => []),
    ventesAutour(centre[1], centre[0], insees[0]).catch(() => []),
    ...insees.map(async (c) => { if (!(c in etat.rnu)) etat.rnu[c] = await communeRnu(c); }),
    ...insees.map(async (c) => { etat.adresses[c] = await adressesCommune(c); }),
  ]);
  etat.batiments = bats || [];
  etat.batimentsIndispo = bats === null;
  etat.routes = routes;
  etat.ventes = ventes;
  etat.centre = centre;
  etat.reperes = reperesTerrain(centre[1], centre[0], ventes);
  etat.prixAppart = prixNeuf(centre, ventes);
  if (etat.prixAuto && etat.prixAppart) $('#b-prix').value = etat.prixAppart.m2;
  dessinerNumeros();
}

/** Prix de vente d'un appartement neuf autour : ventes VEFA si assez nombreuses, sinon ancien + 15 %. */
function prixNeuf(centre, ventes) {
  const now = Date.now();
  const app = ventes.filter((v) => v[V.type] === 'A' && now - new Date(v[V.date]) < 36 * 30.44 * 864e5 && distance(centre[1], centre[0], v[V.lat], v[V.lon]) <= 2500);
  const vefa = app.filter((v) => v[V.flags] & FLAG_VEFA);
  if (vefa.length >= 5) return { m2: Math.round(median(vefa.map((v) => v[V.prix] / v[V.surf])) / 10) * 10, n: vefa.length, source: 'ventes en VEFA' };
  if (app.length >= 5) return { m2: Math.round((median(app.map((v) => v[V.prix] / v[V.surf])) * 1.15) / 10) * 10, n: app.length, source: 'appartements anciens + 15 %' };
  return null;
}

// ── Mise à jour générale ──
let minuteur;
function actualiser() {
  dessinerParcelles();
  renduSelection();
  clearTimeout(minuteur);
  minuteur = setTimeout(async () => {
    const my = ++etat.seq;
    if (!etat.parcelles.length) { cCroquis.clearLayers(); cBati.clearLayers(); renduMode(); return; }
    if (etat.parcelles.some((p) => p.zones === null)) return; // une lecture PLU est en cours
    $('#res-lots').innerHTML = '<div class="charge">Bâtiments, rues et prix autour…</div>';
    await chargerContexte();
    if (my !== etat.seq) return;
    const cleSel = etat.parcelles.map((p) => p.idu).join(',');
    if (cleSel !== etat.dernierCadrage) {
      etat.dernierCadrage = cleSel;
      map.fitBounds(L.geoJSON(etat.parcelles.map((p) => p.feature)).getBounds(), { padding: [24, 24], maxZoom: 20 });
    }
    renduSelection();
    renduMode();
  }, 250);
}

function zonePrincipale() {
  const parZone = {};
  for (const p of etat.parcelles) {
    const z = p.zones?.[0];
    if (!z) continue;
    parZone[z.libelle] ||= { ...z, surface: 0, insee: p.insee };
    parZone[z.libelle].surface += p.surface;
  }
  return Object.values(parZone).sort((a, b) => b.surface - a.surface)[0] || null;
}

// ── Liste des parcelles sélectionnées ──
function renduSelection() {
  const box = $('#selection');
  if (!etat.parcelles.length) {
    box.innerHTML = '<p class="petit">Aucune parcelle sélectionnée. Touchez la carte, ou cherchez une adresse.</p>';
    return;
  }
  const total = etat.parcelles.reduce((a, p) => a + p.surface, 0);
  box.innerHTML = `${etat.parcelles.map((p, i) => {
    const z = p.zones?.[0];
    const zi = zoneInfo(z?.typezone);
    const adr = adressesDe(p);
    return `<div class="parcelle">
      <div class="haut"><span class="ref">${esc(p.commune || '')} ${esc(p.section)} ${esc(p.numero)}</span>
        <span><span class="surf">${nombre(p.surface)} m²</span> <button type="button" class="retirer" data-i="${i}" aria-label="Retirer la parcelle ${esc(p.section)} ${esc(p.numero)}">✕</button></span></div>
      ${adr ? `<div class="adr">${esc(adr)}</div>` : ''}
      <div class="zone">${p.zones === null ? '<span class="petit">Lecture du PLU…</span>'
        : z ? `<span class="pastille-zone" style="background:${zi.couleur}">${esc(z.libelle)}</span><span>${esc(z.libelong || zi.nom)}</span>${z.reglement ? ` <a href="${esc(z.reglement)}" target="_blank" rel="noopener">Règlement</a>` : ''}`
          : etat.rnu[p.insee] ? '<span class="pastille-zone" style="background:#7f8c8d">RNU</span><span>Règlement national d’urbanisme</span>' : '<span class="petit">Zone du PLU non trouvée</span>'}</div>
    </div>`;
  }).join('')}
  ${etat.parcelles.length > 1 ? `<div class="total-sel"><span>${etat.parcelles.length} parcelles</span><b>${nombre(total)} m²</b></div>` : ''}
  ${alertes()}`;
  $$('.retirer', box).forEach((b) => b.addEventListener('click', () => { etat.parcelles.splice(Number(b.dataset.i), 1); actualiser(); }));
}

function alertes() {
  const ps = etat.parcelles.flatMap((p) => p.prescriptions || []);
  const ebc = ps.some((p) => p.type === '01' || /bois/i.test(p.libelle));
  const autres = [...new Set(ps.filter((p) => !(p.type === '01' || /bois/i.test(p.libelle))).map((p) => p.libelle))].slice(0, 5);
  let h = '';
  if (ebc) h += '<div class="encart ko"><p><b>Espace boisé classé</b> sur une partie du terrain : pas d’abattage pour construire à cet endroit.</p></div>';
  if (autres.length) h += `<p class="petit">Prescriptions : ${autres.map(esc).join(', ')}.</p>`;
  if (etat.batimentsIndispo) h += '<p class="petit">Les bâtiments n’ont pas pu être lus : la maison existante n’est pas déduite.</p>';
  return h;
}

// ── Numéros de rue (BAN) ──
function adressesDe(p) {
  const liste = etat.adresses[p.insee] || [];
  const liees = liste.filter((a) => (a[4] || []).includes(p.idu));
  if (!liees.length) return '';
  const parVoie = new Map();
  for (const a of liees) { if (!parVoie.has(a[3])) parVoie.set(a[3], []); parVoie.get(a[3]).push(a[2]); }
  return [...parVoie].map(([voie, nums]) => `${[...new Set(nums)].slice(0, 3).join(', ')} ${voie}`).join(', ');
}

function dessinerNumeros() {
  cNumeros.clearLayers();
  if (map.getZoom() < 17) return;
  const b = map.getBounds();
  let n = 0;
  for (const liste of Object.values(etat.adresses)) {
    for (const a of liste) {
      if (n > 500) return;
      if (!b.contains([a[1], a[0]])) continue;
      L.tooltip({ permanent: true, direction: 'center', className: 'lbl-carte lbl-num', interactive: false }).setLatLng([a[1], a[0]]).setContent(esc(a[2])).addTo(cNumeros);
      n++;
    }
  }
}
map.on('moveend', async () => {
  // Charger les adresses de la commune visible (pour la recherche et la lecture du plan)
  if (map.getZoom() >= 17) {
    const c = communeProche(map.getCenter());
    if (c && !etat.adresses[c.c]) etat.adresses[c.c] = await adressesCommune(c.c);
  }
  dessinerNumeros();
});

// ── Onglets ──
$$('.onglets button').forEach((b) => b.addEventListener('click', () => choisirMode(b.id.slice(2))));
function choisirMode(m) {
  etat.mode = m;
  $$('.onglets button').forEach((b) => b.setAttribute('aria-selected', String(b.id === `t-${m}`)));
  for (const id of ['lots', 'logements', 'chercher']) $(`#p-${id}`).hidden = id !== m;
  renduMode();
}

function renduMode() {
  if (etat.mode === 'lots') renduLots();
  else if (etat.mode === 'logements') renduLogements();
  else { cCroquis.clearLayers(); cBati.clearLayers(); }
  const croquisVisible = cCroquis.getLayers().length > 0;
  if (croquisVisible) map.removeLayer(cEtiquettes); else if (!map.hasLayer(cEtiquettes)) cEtiquettes.addTo(map);
}

// ── Division en lots + croquis ──
function preremplirRegles() {
  const zp = zonePrincipale();
  const rnu = !zp && etat.parcelles.some((p) => etat.rnu[p.insee]);
  const cleZone = zp ? `${zp.insee}|${zp.libelle}` : 'rnu';
  if (!etat.reglesAuto && etat.zoneRegles === cleZone) return;
  const r = reglesPourZone(zp?.typezone, rnu);
  const saisie = zp ? etat.regles[cleZone] : null;
  $('#r-ces').value = saisie?.emprise ?? r.ces;
  $('#r-recul').value = r.recul;
  $('#r-lotmin').value = r.lotMin;
  $('#r-lot').value = CONFIG.division.lotCibleM2;
  $('#r-acces').value = CONFIG.division.largeurAcces;
  etat.zoneRegles = cleZone;
  etat.reglesAuto = false;
}

function renduLots() {
  cCroquis.clearLayers();
  cBati.clearLayers();
  const box = $('#res-lots');
  if (!etat.parcelles.length) { box.innerHTML = '<p class="petit">Le croquis de division s’affiche ici et sur la carte dès qu’une parcelle est sélectionnée.</p>'; return; }
  preremplirRegles();
  const zp = zonePrincipale();
  const rnu = !zp && etat.parcelles.some((p) => etat.rnu[p.insee]);
  const base = reglesPourZone(zp?.typezone, rnu);
  const a = analyserDivision({
    parcelles: etat.parcelles.map((p) => p.feature),
    batiments: etat.batiments,
    regles: { ces: Number($('#r-ces').value), recul: Number($('#r-recul').value), lotMin: Number($('#r-lotmin').value), constructible: base.constructible },
    options: { lotCible: Number($('#r-lot').value), largeurAcces: Number($('#r-acces').value), routes: etat.routes, rotation: etat.rotation },
    reperes: etat.reperes,
  });
  etat.analyse = a;
  dessinerCroquis(a);

  const pastille = { oui: '✓', peutetre: '?', non: '×' }[a.verdict];
  const lots = a.croquis?.lots || [];
  const R = etat.reperes;
  const v = a.valo;
  box.innerHTML = `
    <div class="verdict ${a.verdict}"><div class="pastille" aria-hidden="true">${pastille}</div><div><h3>${esc(a.titre)}</h3><p>${esc(a.texte)}</p></div></div>
    <div class="chiffres">
      <div><b>${nombre(a.surface)} m²</b><span>surface cadastrale</span></div>
      <div><b>${nombre(a.emprise)} m²</b><span>bâti au sol (${Math.round(a.cesActuel * 100)} %)</span></div>
      <div><b>${nombre(a.detachable)} m²</b><span>en lots à bâtir</span></div>
    </div>
    ${lots.length ? `<div class="table-wrap"><table class="ventes lots"><thead><tr><th>Lot</th><th>Surface</th><th>Façade</th><th>Profondeur</th>${v ? '<th>Prix</th>' : ''}</tr></thead><tbody>
      ${lots.map((l, i) => `<tr><td><b>${l.properties.nom}</b> ${l.properties.position === 'fond' ? '(drapeau)' : '(sur rue)'}</td><td>${nombre(l.properties.aire)} m²</td><td>${l.properties.facade} m</td><td>${l.properties.profondeur} m</td>${v ? `<td>${euro(v.parLot[i])}</td>` : ''}</tr>`).join('')}
      ${a.aireMaison ? `<tr><td>Maison</td><td>${nombre(a.aireMaison)} m²</td><td></td><td></td>${v ? '<td></td>' : ''}</tr>` : ''}
      ${a.acces ? `<tr><td>Accès</td><td>${nombre(a.acces)} m²</td><td>${$('#r-acces').value} m</td><td></td>${v ? '<td></td>' : ''}</tr>` : ''}
    </tbody></table></div>` : ''}
    ${a.croquis ? `<p class="petit">${a.croquis.auto ? 'Côté rue repéré automatiquement.' : 'Rue non repérée : côté choisi par défaut.'} <button type="button" class="lien-btn" id="tourner">Changer le côté de la rue</button></p>` : ''}
    ${v ? `
      <h3>Ce que ça peut rapporter</h3>
      <ul class="ajust">
        <li><span>Vente de ${lots.length > 1 ? `${lots.length} lots` : 'ce lot'}</span><span class="plus">+${euro(v.brut)}</span></li>
        <li><span>Géomètre, viabilisation${a.acces ? ', accès' : ''}</span><span class="moins">−${euro(v.couts)}</span></li>
        ${v.perteMaison ? `<li><span>Valeur perdue par la maison (jardin réduit)</span><span class="moins">−${euro(v.perteMaison)}</span></li>` : ''}
        <li><span><b>Gain estimé de la division</b></span><span class="${v.net >= 0 ? 'plus' : 'moins'}"><b>${v.net >= 0 ? '+' : ''}${euro(v.net)}</b></span></li>
      </ul>
      <p class="petit">Prix d’après ${R.n} ventes de terrains${R.tabSeulement ? ' à bâtir' : ''} à moins de ${nombre(R.rayon / 1000, 1)} km (médiane ${nombre(R.m2)} €/m²). Avant impôt sur la plus-value éventuelle.</p>`
    : lots.length && !R ? '<p class="petit">Pas assez de ventes de terrains autour pour chiffrer les lots.</p>' : ''}
    <div class="legende">
      <span style="--c:#0e3b43">Maison</span><span style="--c:#7fd18f">Lots à bâtir</span>${a.acces ? '<span style="--c:#d9d2c3">Accès</span>' : ''}
    </div>`;
  $('#tourner')?.addEventListener('click', () => { etat.rotation = (etat.rotation + 1) % 4; renduLots(); });
  if (cCroquis.getLayers().length) map.removeLayer(cEtiquettes);
}

const COULEURS_LOTS = ['#7fd18f', '#5dbb73', '#9ee0a9', '#4aa865', '#b6e8bd', '#3d9a59'];
function dessinerCroquis(a) {
  for (const b of a.batiments) L.geoJSON(b, { style: { color: '#0e3b43', weight: 1, fillColor: '#0e3b43', fillOpacity: 0.65 }, interactive: false }).addTo(cBati);
  const c = a.croquis;
  if (!c) return;
  const etiquette = (f, html, cls = 'lbl-carte') => {
    const pt = turf.pointOnFeature(f).geometry.coordinates;
    L.tooltip({ permanent: true, direction: 'center', className: cls, interactive: false }).setLatLng([pt[1], pt[0]]).setContent(html).addTo(cCroquis);
  };
  if (c.maison) {
    L.geoJSON(c.maison, { style: { color: '#ffffff', weight: 2, fillColor: '#0e3b43', fillOpacity: 0.28 }, interactive: false }).addTo(cCroquis);
  }
  c.lots.forEach((l, i) => {
    L.geoJSON(l, { style: { color: '#ffffff', weight: 2.5, dashArray: '7 5', fillColor: COULEURS_LOTS[i % COULEURS_LOTS.length], fillOpacity: 0.5 }, interactive: false }).addTo(cCroquis);
    etiquette(l, `<b>${l.properties.nom}</b>${nombre(l.properties.aire)} m²`, 'lbl-carte lbl-lot');
  });
  if (c.acces) {
    L.geoJSON(c.acces, { style: { color: '#ffffff', weight: 1, fillColor: '#d9d2c3', fillOpacity: 0.85 }, interactive: false }).addTo(cCroquis);
  }
  if (c.maison) etiquette(c.maison, `Maison<br>${nombre(c.maison.properties.aire)} m²`);
}

['#r-ces', '#r-recul', '#r-lotmin', '#r-lot', '#r-acces'].forEach((s) => $(s).addEventListener('input', () => { if (etat.parcelles.length) renduLots(); }));

// ── Logements (repris d'Imoscope) ──
function renduProgrammes() {
  $('#programmes').innerHTML = Object.entries(PROGRAMMES).map(([k, p]) => `<label><input type="radio" name="prog" value="${k}" ${k === etat.programme ? 'checked' : ''}>${esc(p.nom)}<small>${p.emprise} % au sol, ${p.niveaux} niv.</small></label>`).join('');
  $$('#programmes input').forEach((i) => i.addEventListener('change', () => {
    etat.programme = i.value;
    etat.hyp = { ...PROGRAMMES[i.value], partSociale: etat.hyp.partSociale };
    remplirHyp();
    renduLogements();
  }));
}
function remplirHyp() {
  $('#h-emprise').value = etat.hyp.emprise;
  $('#h-niveaux').value = etat.hyp.niveaux;
  $('#h-sdp').value = etat.hyp.sdpParLogement;
  $('#h-social').value = etat.hyp.partSociale;
}
renduProgrammes();
remplirHyp();
[['#h-emprise', 'emprise'], ['#h-niveaux', 'niveaux'], ['#h-sdp', 'sdpParLogement'], ['#h-social', 'partSociale']].forEach(([s, k]) => $(s).addEventListener('input', () => { etat.hyp[k] = Number($(s).value); renduLogements(); }));
['#b-social', '#b-cout', '#b-marge'].forEach((s) => $(s).addEventListener('input', renduLogements));
$('#b-prix').addEventListener('input', () => { etat.prixAuto = false; renduLogements(); });

function renduLogements() {
  if (etat.mode !== 'logements') return;
  cCroquis.clearLayers();
  const box = $('#res-logements');
  if (!etat.parcelles.length) { box.innerHTML = '<p class="petit">Sélectionnez une ou plusieurs parcelles pour obtenir le nombre de logements.</p>'; return; }
  const cap = capacite(etat.parcelles.map((p) => ({ ...p, zones: p.zones || [] })), etat.hyp, etat.regles);
  const b = bilanPromoteur({
    sdp: cap.sdp, logements: cap.logements, sociaux: cap.sociaux, shab: etat.hyp.shab || 0.85,
    prixLibreM2: Number($('#b-prix').value), prixSocialM2: Number($('#b-social').value),
    coutConstructionM2: Number($('#b-cout').value), marge: Number($('#b-marge').value) / 100,
  });
  const valeurMarche = etat.reperes ? Math.round((etat.reperes.m2 * cap.surfaceConstructible) / 1000) * 1000 : null;
  const coul = { oui: 'var(--pin)', peutetre: '#7a540b', non: 'var(--alerte)' };

  // Enveloppe constructible sur la carte : retrait de 4 m des limites
  try {
    const unite = uniteFonciere(etat.parcelles.map((p) => p.feature));
    const env = turf.buffer(unite, -4, { units: 'meters' });
    if (env) {
      L.geoJSON(env, { style: { color: '#c98a12', weight: 2, dashArray: '6 4', fillColor: '#c98a12', fillOpacity: 0.25 }, interactive: false }).addTo(cCroquis);
      const pt = turf.pointOnFeature(env).geometry.coordinates;
      L.tooltip({ permanent: true, direction: 'center', className: 'lbl-carte lbl-lot', interactive: false }).setLatLng([pt[1], pt[0]])
        .setContent(`<b>≈ ${cap.logements} logement${cap.logements > 1 ? 's' : ''}</b>${nombre(cap.sdp)} m² de plancher`).addTo(cCroquis);
    }
  } catch { /* forme trop petite pour l'enveloppe */ }

  box.innerHTML = `
    <div class="chiffres">
      <div><b>${nombre(cap.total)} m²</b><span>terrain sélectionné</span></div>
      <div><b>${nombre(cap.sdp)} m²</b><span>surface de plancher</span></div>
      <div><b>≈ ${cap.logements}</b><span>logements, dont ${cap.sociaux} sociaux (${cap.part} %)</span></div>
    </div>
    ${cap.collectif ? `<p><b>Immeuble, appartements :</b> <span style="color:${coul[cap.collectif.niveau]}">${esc(cap.collectif.texte)}</span></p>` : ''}
    <h3>Par zone</h3>
    ${cap.parZone.map((z) => regleZoneHtml(z)).join('')}
    ${cap.mixite.length ? `<div class="encart"><h3>Secteur de mixité sociale</h3>${cap.mixite.map((m) => `<p>${esc(m.libelle)}${m.txt ? `<br><span class="petit">${esc(m.txt)}</span>` : ''}${m.urlfic ? `<br><a href="${esc(m.urlfic)}" target="_blank" rel="noopener">Pièce écrite</a>` : ''}</p>`).join('')}<p class="petit">Le taux de ce secteur prime sur la part saisie.</p></div>` : ''}
    ${b ? `
      <h3>Bilan promoteur : prix maximum du terrain</h3>
      <ul class="ajust">
        <li><span>Chiffre d’affaires (${nombre(b.shab)} m² habitables)</span><span class="plus">${euro(b.ca)}</span></li>
        <li><span>Construction (${nombre(cap.sdp)} m² × ${nombre(Number($('#b-cout').value))} €)</span><span class="moins">−${euro(b.construction)}</span></li>
        <li><span>Honoraires, VRD, taxes (12 %)</span><span class="moins">−${euro(b.annexes)}</span></li>
        <li><span>Commercialisation et frais financiers (8 % du CA)</span><span class="moins">−${euro(b.vente)}</span></li>
        <li><span>Marge du promoteur</span><span class="moins">−${euro(b.marge)}</span></li>
        <li><span><b>Charge foncière : ce qu’un promoteur peut payer le terrain</b></span><span class="${b.chargeFonciere >= 0 ? 'plus' : 'moins'}"><b>${euro(b.chargeFonciere)}</b></span></li>
      </ul>
      <p class="petit">Prix de vente libre : ${nombre(Number($('#b-prix').value))} €/m²${etat.prixAppart && etat.prixAuto ? `, d’après ${etat.prixAppart.n} ${etat.prixAppart.source} à moins de 2,5 km` : ''}. ${valeurMarche ? `À comparer avec la valeur du terrain au prix des terrains à bâtir du secteur : ${euro(valeurMarche)}.` : ''}</p>`
    : '<p class="petit">Indiquez un prix de vente pour obtenir le bilan promoteur.</p>'}
    <p class="petit">${cap.zonesReglees ? `${cap.zonesReglees} zone${cap.zonesReglees > 1 ? 's' : ''} calculée${cap.zonesReglees > 1 ? 's' : ''} avec les valeurs du règlement saisies, le reste avec les hypothèses.` : 'Calcul sur les hypothèses : le Géoportail ne publie ni l’emprise, ni la hauteur, ni la part sociale. Saisissez-les par zone pour un résultat exact.'}</p>`;

  $$('[data-editer]', box).forEach((btn) => btn.addEventListener('click', () => {
    const f = btn.closest('.zone-regle').querySelector('.mini-champs');
    f.hidden = !f.hidden;
  }));
  $$('[data-enregistrer]', box).forEach((btn) => btn.addEventListener('click', () => {
    const z = btn.closest('.zone-regle');
    const nb = (s) => { const v = z.querySelector(s).value; return v === '' ? null : Number(v); };
    etat.regles = enregistrerRegle(btn.dataset.enregistrer, { emprise: nb('[name=emprise]'), hauteurM: nb('[name=hauteur]'), niveaux: nb('[name=niveaux]'), partSociale: nb('[name=social]'), source: z.querySelector('[name=source]').value || null });
    etat.reglesAuto = true;
    toast(`Règles de la zone enregistrées sur cet appareil.`);
    renduLogements();
  }));
  $$('[data-effacer]', box).forEach((btn) => btn.addEventListener('click', () => { etat.regles = enregistrerRegle(btn.dataset.effacer, null); etat.reglesAuto = true; renduLogements(); }));
}

function regleZoneHtml(z) {
  const zi = zoneInfo(z.typezone);
  const r = z.regle;
  return `<div class="zone-regle">
    <div class="haut" style="display:flex;justify-content:space-between;gap:8px">
      <span><span class="pastille-zone" style="background:${zi.couleur}">${esc(z.libelle === '?' ? 'Zone' : z.libelle)}</span> ${nombre(z.surface)} m² ${z.constructible ? '' : '<b style="color:var(--alerte)">inconstructible</b>'}</span>
      ${z.reglement ? `<a href="${esc(z.reglement)}" target="_blank" rel="noopener">Règlement</a>` : ''}
    </div>
    ${z.constructible ? `<p style="margin:6px 0 0">${r ? `Règlement saisi : emprise ${r.emprise ?? '?'} %${r.hauteurM ? `, ${r.hauteurM} m` : ''}${r.niveaux ? `, ${r.niveaux} niveaux` : ''}${r.partSociale != null ? `, ${r.partSociale} % social` : ''}.` : `Hypothèse : emprise ${z.empriseUtilisee} %, ${z.niveauxUtilises} niveau${z.niveauxUtilises > 1 ? 'x' : ''}.`}
      <button type="button" class="lien-btn" data-editer>${r ? 'Modifier' : 'Saisir le règlement'}</button></p>
    <div class="mini-champs" hidden>
      <label>Emprise au sol (%)<input name="emprise" type="number" inputmode="decimal" value="${r?.emprise ?? ''}"></label>
      <label>Hauteur max (m)<input name="hauteur" type="number" inputmode="decimal" value="${r?.hauteurM ?? ''}"></label>
      <label>Niveaux<input name="niveaux" type="number" inputmode="numeric" value="${r?.niveaux ?? ''}"></label>
      <label>Logements sociaux (%)<input name="social" type="number" inputmode="numeric" value="${r?.partSociale ?? ''}"></label>
      <label style="grid-column:1/-1">Référence<input name="source" type="text" value="${esc(r?.source || '')}" placeholder="PLUi MACS, article…"></label>
      <button type="button" class="btn petit-btn" data-enregistrer="${esc(z.cle)}">Enregistrer pour ${esc(z.libelle)}</button>
      ${r ? `<button type="button" class="btn petit-btn ghost" data-effacer="${esc(z.cle)}">Effacer</button>` : ''}
    </div>` : `<p class="petit" style="margin:6px 0 0">${esc(zi.note)}</p>`}
  </div>`;
}

// ── Recherche de terrains par surface ──
let listeCommunes = [];
function communeProche(ll) {
  let best = null;
  for (const c of listeCommunes) {
    if (!c.x) continue;
    const d = distance(ll.lat, ll.lng, c.y, c.x);
    if (!best || d < best.d) best = { ...c, d };
  }
  return best;
}
communes().then((liste) => {
  listeCommunes = liste;
  const tri = [...liste].sort((a, b) => a.n.localeCompare(b.n, 'fr'));
  $('#c-commune').innerHTML = tri.map((c) => `<option value="${c.c}">${esc(c.n)} (${c.dep})</option>`).join('');
  const c = communeProche(map.getCenter());
  if (c) $('#c-commune').value = c.c;
});
map.on('moveend', () => {
  if (etat.mode === 'chercher' && !etat.rechercheEnCours) {
    const c = communeProche(map.getCenter());
    if (c && !etat.communeChoisie) $('#c-commune').value = c.c;
  }
});
$('#c-commune').addEventListener('change', () => { etat.communeChoisie = true; });

const cacheCommune = {};
let rechercheId = 0;
$('#c-lancer').addEventListener('click', async () => {
  const insee = $('#c-commune').value;
  const min = Number($('#c-min').value) || 0;
  const max = $('#c-max').value === '' ? Infinity : Number($('#c-max').value);
  if (min > max) { $('#c-etat').textContent = 'La surface minimale dépasse la maximale.'; return; }
  const my = ++rechercheId;
  etat.rechercheEnCours = true;
  $('#c-lancer').disabled = true;
  $('#c-resultats').innerHTML = '';
  cRecherche.clearLayers();
  let toutes = cacheCommune[insee];
  let partiel = false;
  try {
    if (!toutes) {
      $('#c-etat').textContent = 'Chargement du cadastre de la commune…';
      try {
        toutes = await parcellesCommune(insee, (n) => { if (my === rechercheId) $('#c-etat').textContent = `Chargement du cadastre… ${nombre(n)} parcelles`; });
        cacheCommune[insee] = toutes;
      } catch {
        $('#c-etat').textContent = 'Cadastre de la commune indisponible : recherche dans la vue affichée…';
        const b = map.getBounds();
        toutes = await parcellesDans([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        partiel = true;
      }
    }
    if (my !== rechercheId) return;
    const trouves = toutes.filter((f) => f.properties.contenance >= min && f.properties.contenance <= max).sort((a, b) => b.properties.contenance - a.properties.contenance);
    if (!etat.adresses[insee]) etat.adresses[insee] = await adressesCommune(insee);
    const nom = $('#c-commune').selectedOptions[0]?.textContent || '';
    $('#c-etat').textContent = trouves.length
      ? `${nombre(trouves.length)} terrain${trouves.length > 1 ? 's' : ''} sur ${nombre(toutes.length)} parcelles de ${partiel ? 'la vue affichée' : nom}.`
      : `Aucun terrain dans cette fourchette (${nombre(toutes.length)} parcelles examinées).`;
    if (trouves.length) {
      L.geoJSON({ type: 'FeatureCollection', features: trouves }, { renderer: rendu, style: { color: '#1e7a3c', weight: 1.5, fillColor: '#2ecc71', fillOpacity: 0.45 }, interactive: false }).addTo(cRecherche);
      map.fitBounds(L.geoJSON({ type: 'FeatureCollection', features: trouves }).getBounds(), { maxZoom: 16, padding: [20, 20] });
      $('#c-resultats').innerHTML = `<div class="res-liste">${trouves.slice(0, 200).map((f, i) => {
        const a = adressesDe({ insee: f.properties.insee, idu: f.properties.idu });
        return `<button type="button" data-i="${i}"><span>Parcelle ${esc(f.properties.section)} ${esc(f.properties.numero)}${a ? `<small>${esc(a)}</small>` : ''}</span><b>${nombre(f.properties.contenance)} m²</b></button>`;
      }).join('')}</div>
      ${trouves.length > 200 ? '<p class="petit">200 premiers affichés : tous sont en vert sur la carte.</p>' : ''}
      <button type="button" class="btn ghost petit-btn" id="c-effacer" style="margin-top:8px">Effacer les résultats</button>`;
      $$('#c-resultats [data-i]').forEach((b) => b.addEventListener('click', () => {
        const f = trouves[Number(b.dataset.i)];
        map.fitBounds(L.geoJSON(f).getBounds(), { maxZoom: 19, padding: [60, 60] });
        if (window.innerWidth < 980) $('.terrain-carte').scrollIntoView({ behavior: 'smooth' });
      }));
      $('#c-effacer').addEventListener('click', () => { cRecherche.clearLayers(); $('#c-resultats').innerHTML = ''; $('#c-etat').textContent = ''; });
    }
  } catch (err) {
    if (my === rechercheId) $('#c-etat').textContent = `Échec du chargement du cadastre (${err.message}).`;
  } finally {
    if (my === rechercheId) { etat.rechercheEnCours = false; $('#c-lancer').disabled = false; }
  }
});

// ── Formulaire de contact (masqué en mode perso) ──
if (modePerso.actif) $('#form-lead').hidden = true;
$('#form-lead').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nom = $('#nom').value.trim();
  const tel = $('#tel').value.trim();
  const mail = $('#email').value.trim();
  let msg = '';
  if (nom.length < 2) msg = 'Indiquez votre nom.';
  else if (!tel && !mail) msg = 'Indiquez un téléphone ou un e-mail.';
  else if (tel && !telValide(tel)) msg = 'Ce numéro de téléphone ne semble pas complet.';
  else if (mail && !emailValide(mail)) msg = 'Cette adresse e-mail ne semble pas valide.';
  else if (!$('#consent').checked) msg = 'Cochez la case pour que nous puissions vous recontacter.';
  $('#err-lead').textContent = msg;
  $('#err-lead').hidden = !msg;
  if (msg) return;
  const a = etat.analyse;
  await enregistrerLead({
    type: 'division',
    contact: { nom, telephone: tel, email: mail },
    bien: { adresse: etat.parcelles.map((p) => adressesDe(p) || `${p.commune} ${p.section} ${p.numero}`).join(' ; '), insee: etat.parcelles[0]?.insee, parcelles: etat.parcelles.map((p) => p.idu) },
    resultat: a ? { zone: zonePrincipale()?.libelle || null, surface: a.surface, emprise: a.emprise, detachable: a.detachable, lots: a.lots, verdict: a.verdict, gain: a.valo?.net ?? null } : null,
  });
  $('#form-lead').innerHTML = `<h2 class="sous-titre">Demande enregistrée</h2><p>Merci ${esc(nom.split(' ')[0])}. Vous recevez l’étude détaillée sous 48 h.</p>`;
});

// ── Arrivée par lien (?adresse=…&lat=…&lon=…) ──
(async () => {
  let lat = Number(params.lat);
  let lon = Number(params.lon);
  if ((!lat || !lon) && params.adresse) {
    try { const r = await geocode(params.adresse, { limit: 1 }); if (r[0]) { lat = r[0].lat; lon = r[0].lon; } } catch { /* rien */ }
  }
  if (lat && lon) {
    map.setView([lat, lon], 18);
    await ajouterAuPoint(lon, lat, { lon, lat, insee: params.insee || null });
  } else {
    map.setView([CONFIG.carte.lat, CONFIG.carte.lon], 16);
  }
  if (params.mode && ['lots', 'logements', 'chercher'].includes(params.mode)) choisirMode(params.mode);
})();
