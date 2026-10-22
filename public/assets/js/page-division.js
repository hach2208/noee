// Noéé : simulateur de division parcellaire.
import { parcelleAuPoint, zonesUrba, prescriptions, communeRnu, documentUrba, batimentsDans, ventesAutour } from './api.js';
import { reperesTerrain } from './estimate.js';
import { analyserDivision, reglesPourZone, uniteFonciere, estContigue } from './division-calc.js';
import { montageCommun, creerCarte, champAdresse, paramsUrl, euro, nombre, esc, $, toast } from './ui.js';
import { enregistrerLead, telValide, emailValide } from './leads.js';
import { CONFIG } from './config.js';

montageCommun();
const params = paramsUrl();
const L = window.L;
const turf = window.turf;

const { map } = creerCarte($('#carte'), { zoom: 14, fond: 'ortho' });
const calqueParcelles = L.layerGroup().addTo(map);
const calqueBati = L.layerGroup().addTo(map);
const calqueLibre = L.layerGroup().addTo(map);

const etat = {
  adresse: null,
  parcelles: [],
  zones: [],
  zonePrincipale: null,
  rnu: null,
  document: null,
  prescriptions: [],
  batiments: [],
  reperes: null,
  analyse: null,
  reglesAuto: true,
  seq: 0,
};

const adr = champAdresse($('#adresse'), { onChoix: (it) => partirDe(it) });
$('#lancer').addEventListener('click', async () => {
  try {
    const it = adr.valeur || (await adr.premier());
    if (it) partirDe(it); else toast('Adresse introuvable. Ajoutez le numéro et la ville.');
  } catch { toast('La recherche d’adresse ne répond pas.'); }
});

async function partirDe(it) {
  etat.adresse = it;
  map.flyTo([it.lat, it.lon], 18, { duration: 0.7 });
  try {
    const p = await parcelleAuPoint(it.lon, it.lat);
    if (!p) { toast('Aucune parcelle à cette adresse. Touchez votre terrain sur la carte.'); return; }
    etat.parcelles = [p];
    etat.reglesAuto = true;
    await analyser();
  } catch {
    toast('Le cadastre ne répond pas. Réessayez dans un instant.');
  }
}

map.on('click', async (e) => {
  try {
    const p = await parcelleAuPoint(e.latlng.lng, e.latlng.lat);
    if (!p) return;
    const idx = etat.parcelles.findIndex((x) => x.properties.idu === p.properties.idu);
    if (idx >= 0) {
      if (etat.parcelles.length === 1) return;
      etat.parcelles.splice(idx, 1);
    } else if (etat.parcelles.length && estContigue(p, uniteFonciere(etat.parcelles))) {
      etat.parcelles.push(p);
    } else {
      etat.parcelles = [p];
      etat.reglesAuto = true;
      if (!etat.adresse) etat.adresse = { label: `${p.properties.commune}, section ${p.properties.section} n° ${p.properties.numero}`, insee: p.properties.insee, lat: e.latlng.lat, lon: e.latlng.lng };
    }
    await analyser();
  } catch {
    toast('Le cadastre ne répond pas. Réessayez dans un instant.');
  }
});

function dessinerParcelles() {
  calqueParcelles.clearLayers();
  for (const p of etat.parcelles) {
    L.geoJSON(p, { style: { color: '#c98a12', weight: 3, fillColor: '#c98a12', fillOpacity: 0.08 } }).addTo(calqueParcelles);
  }
  $('#parcelles').innerHTML = etat.parcelles.map((p) => `<span>Section ${esc(p.properties.section)} n° ${esc(p.properties.numero)}, ${nombre(p.properties.contenance)} m²</span>`).join('');
}

async function analyser() {
  const my = ++etat.seq;
  $('#analyse').hidden = false;
  dessinerParcelles();
  const unite = uniteFonciere(etat.parcelles);
  map.fitBounds(L.geoJSON(unite).getBounds().pad(0.6), { maxZoom: 19 });
  $('#urba').innerHTML = '<div class="charge">Lecture du PLU, du bâti et des prix…</div>';
  $('#resultat').innerHTML = '';

  const insee = etat.parcelles[0].properties.insee;
  const centre = turf.centroid(unite).geometry.coordinates;
  const bb = turf.bbox(turf.buffer(unite, 40, { units: 'meters' }));
  const [zones, rnu, doc, presc, bats, ventes] = await Promise.all([
    zonesUrba(unite.geometry).catch(() => null),
    communeRnu(insee),
    documentUrba(unite.geometry),
    prescriptions(unite.geometry),
    batimentsDans(bb).catch(() => null),
    ventesAutour(centre[1], centre[0], insee).catch(() => []),
  ]);
  if (my !== etat.seq) return;

  etat.zones = zones || [];
  etat.rnu = rnu;
  etat.document = doc;
  etat.prescriptions = presc;
  etat.batiments = bats || [];
  etat.batimentsIndispo = bats === null;
  etat.reperes = reperesTerrain(centre[1], centre[0], ventes);

  // Zone principale : celle qui couvre la plus grande part du terrain
  const total = turf.area(unite);
  for (const z of etat.zones) {
    try {
      const i = turf.intersect(turf.featureCollection([turf.feature(z.geometry), unite]));
      z.part = i ? turf.area(i) / total : 0;
    } catch { z.part = 0; }
  }
  etat.zones.sort((a, b) => b.part - a.part);
  const zp = etat.zones[0] || null;
  if (etat.reglesAuto || etat.zonePrincipale?.libelle !== zp?.libelle) {
    const r = reglesPourZone(zp?.typezone, !zp && rnu);
    $('#r-ces').value = r.ces;
    $('#r-recul').value = r.recul;
    $('#r-lotmin').value = r.lotMin;
    $('#r-lot').value = CONFIG.division.lotCibleM2;
    etat.reglesAuto = false;
  }
  etat.zonePrincipale = zp;
  rendreUrba(zones === null);
  calculer();
}

function rendreUrba(erreur) {
  const zp = etat.zonePrincipale;
  const ebc = etat.prescriptions.filter((p) => p.type === '01' || /bois/i.test(p.libelle));
  const autres = [...new Set(etat.prescriptions.filter((p) => !ebc.includes(p)).map((p) => p.libelle))].slice(0, 6);
  let html = '';
  if (zp) {
    html += `<p style="margin:0 0 6px"><span class="zone-tag">${esc(zp.libelle)}</span>${esc(zp.libelong || libTypeZone(zp.typezone))}</p>`;
    if (etat.zones.length > 1) html += `<p class="petit">Le terrain est à cheval sur ${etat.zones.length} zones : ${etat.zones.map((z) => `${esc(z.libelle)} (${Math.round(z.part * 100)} %)`).join(', ')}.</p>`;
    html += `<p class="petit">${esc(etat.document?.type || 'Document d’urbanisme')}${zp.dateAppro ? `, approuvé le ${esc(fmtDate(zp.dateAppro))}` : ''}.${zp.reglement ? ` <a href="${esc(zp.reglement)}" target="_blank" rel="noopener">Lire le règlement de zone</a>` : ''}</p>`;
  } else if (etat.rnu) {
    html += '<p><span class="zone-tag">RNU</span>Pas de PLU : c’est le règlement national d’urbanisme qui s’applique.</p>';
  } else if (erreur) {
    html += '<div class="encart ko"><p>Le Géoportail de l’urbanisme ne répond pas. Les règles par défaut d’une zone urbaine sont utilisées.</p></div>';
  } else {
    html += '<div class="encart info"><p>Aucune zone du PLU trouvée sur ce terrain. Le document n’est peut-être pas encore publié sur le Géoportail de l’urbanisme.</p></div>';
  }
  if (ebc.length) html += '<div class="encart ko"><h3>Espace boisé classé</h3><p>Une partie du terrain est protégée : les arbres ne peuvent pas être abattus pour construire à cet endroit.</p></div>';
  if (autres.length) html += `<p class="petit">Autres prescriptions : ${autres.map(esc).join(', ')}.</p>`;
  if (etat.batimentsIndispo) html += '<p class="petit">Les bâtiments n’ont pas pu être lus : la maison existante n’est pas déduite du calcul.</p>';
  $('#urba').innerHTML = html;
}

function libTypeZone(t) {
  return { U: 'Zone urbaine', AUc: 'Zone à urbaniser, ouverte', AUs: 'Zone à urbaniser, fermée', A: 'Zone agricole', N: 'Zone naturelle' }[t] || '';
}
function fmtDate(d) {
  const s = String(d);
  if (/^\d{8}$/.test(s)) return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  const x = new Date(s);
  return Number.isNaN(x.getTime()) ? s : x.toLocaleDateString('fr-FR');
}

function regles() {
  const zp = etat.zonePrincipale;
  const base = reglesPourZone(zp?.typezone, !zp && etat.rnu);
  return { ces: Number($('#r-ces').value), recul: Number($('#r-recul').value), lotMin: Number($('#r-lotmin').value), constructible: base.constructible };
}

function calculer() {
  if (!etat.parcelles.length) return;
  const a = analyserDivision({
    parcelles: etat.parcelles,
    batiments: etat.batiments,
    regles: regles(),
    options: { frontRue: $('#r-front').checked, lotCible: Number($('#r-lot').value) },
    reperes: etat.reperes,
  });
  etat.analyse = a;

  calqueBati.clearLayers();
  calqueLibre.clearLayers();
  for (const b of a.batiments) L.geoJSON(b, { style: { color: '#0e3b43', weight: 1, fillColor: '#0e3b43', fillOpacity: 0.55 } }).addTo(calqueBati);
  if (a.libre && a.verdict !== 'non') L.geoJSON(a.libre, { style: { color: '#7fd18f', weight: 2, dashArray: '5 4', fillColor: '#7fd18f', fillOpacity: 0.3 } }).addTo(calqueLibre);

  const pastille = { oui: '✓', peutetre: '?', non: '×' }[a.verdict];
  const R = etat.reperes;
  const v = a.valo;
  $('#resultat').innerHTML = `
    <div class="verdict ${a.verdict}"><div class="pastille" aria-hidden="true">${pastille}</div><div><h3>${esc(a.titre)}</h3><p>${esc(a.texte)}</p></div></div>
    <div class="chiffres">
      <div><b>${nombre(a.surface)} m²</b><span>surface cadastrale</span></div>
      <div><b>${nombre(a.emprise)} m²</b><span>bâti au sol (${Math.round(a.cesActuel * 100)} %)</span></div>
      <div><b>${nombre(a.detachable)} m²</b><span>détachables</span></div>
    </div>
    <div class="legende">
      <span style="--c:#c98a12">Votre terrain</span>
      <span style="--c:#0e3b43">Bâti existant</span>
      ${a.libre && a.verdict !== 'non' ? '<span style="--c:#7fd18f">Où une maison peut tenir</span>' : ''}
    </div>
    <ul class="ajust">
      <li><span>À garder pour la maison actuelle</span><span>${nombre(a.aGarder)} m²</span></li>
      <li><span>Accès à créer</span><span>${a.acces ? `${nombre(a.acces)} m²` : 'aucun'}</span></li>
      <li><span>Lots possibles</span><span>${a.lots ? `${a.lots} de ${nombre(a.surfLot)} m²` : 'aucun'}</span></li>
    </ul>
    ${v ? `
      <h3>Ce que ça peut rapporter</h3>
      <ul class="ajust">
        <li><span>Prix d’un lot de ${nombre(a.surfLot)} m² dans le secteur</span><span>${euro(v.prixLot)}</span></li>
        <li><span>Vente de ${a.lots > 1 ? `${a.lots} lots` : 'ce lot'}</span><span class="plus">+${euro(v.brut)}</span></li>
        <li><span>Géomètre, viabilisation${a.acces ? ', accès' : ''}</span><span class="moins">−${euro(v.couts)}</span></li>
        ${v.perteMaison ? `<li><span>Valeur perdue par la maison (jardin réduit)</span><span class="moins">−${euro(v.perteMaison)}</span></li>` : ''}
        <li><span><b>Gain estimé de la division</b></span><span class="${v.net >= 0 ? 'plus' : 'moins'}"><b>${v.net >= 0 ? '+' : ''}${euro(v.net)}</b></span></li>
      </ul>
      <p class="petit">D’après ${R.n} ventes de terrains${R.tabSeulement ? ' à bâtir' : ''} à moins de ${nombre(R.rayon / 1000, 1)} km (médiane ${nombre(R.m2)} €/m²). Avant impôt sur la plus-value éventuelle.</p>`
    : a.lots && !R ? '<p class="petit">Pas assez de ventes de terrains autour pour chiffrer le lot. Lancez « npm run data » si ce n’est pas fait.</p>' : ''}
  `;
}

['#r-ces', '#r-recul', '#r-lotmin', '#r-lot', '#r-front'].forEach((s) => $(s).addEventListener('input', calculer));

// Formulaire de contact
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
    bien: { adresse: etat.adresse?.label, insee: etat.parcelles[0]?.properties.insee, parcelles: etat.parcelles.map((p) => p.properties.idu) },
    resultat: a ? { zone: etat.zonePrincipale?.libelle || (etat.rnu ? 'RNU' : null), surface: a.surface, emprise: a.emprise, detachable: a.detachable, lots: a.lots, verdict: a.verdict, gain: a.valo?.net ?? null } : null,
  });
  $('#form-lead').innerHTML = `<h2 style="font-size:1.5rem">Demande enregistrée</h2><p>Merci ${esc(nom.split(' ')[0])}. Vous recevez l’étude détaillée sous 48 h, après lecture complète du règlement de zone.</p>`;
});

// Pré-remplissage par l'URL
if (params.lat && params.lon) {
  const it = { label: params.adresse || 'Adresse indiquée', lat: Number(params.lat), lon: Number(params.lon), insee: params.insee };
  adr.definir(it);
  partirDe(it);
} else if (params.adresse) {
  $('#adresse').value = params.adresse;
  adr.premier().then((it) => it && partirDe(it)).catch(() => {});
}
