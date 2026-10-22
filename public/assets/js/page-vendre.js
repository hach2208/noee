// Noéé : assistant d'estimation en 7 étapes.
import { ventesAutour, geocode } from './api.js';
import { estimer } from './estimate.js';
import { V, distance } from './dvf-core.js';
import { montageCommun, creerCarte, marqueur, champAdresse, paramsUrl, euro, nombre, dateFr, esc, $, $$, toast, modePerso } from './ui.js';
import { enregistrerLead, telValide, emailValide } from './leads.js';

montageCommun();
const params = paramsUrl();
const modePro = params.pro === '1' || modePerso.actif;
const TOTAL = modePro ? 6 : 7;

const form = $('#assistant');
const btnSuiv = $('#suiv');
const btnPrec = $('#prec');
let etape = 1;
let adresse = null;
let ventesP = null;
let calques = null;
let confirmeSurf = null;

const { map } = creerCarte($('#carte'), { zoom: 13 });
let cible = null;

const adr = champAdresse($('#adresse'), { onChoix: choisirAdresse });
$('#adresse').addEventListener('input', () => { adresse = null; $('#adresse-ok').hidden = true; });

async function choisirAdresse(it) {
  adresse = it;
  $('#err-adresse').hidden = true;
  $('#adresse-ok').hidden = false;
  $('#adresse-lib').textContent = it.label;
  if (cible) cible.remove();
  cible = marqueur(it.lat, it.lon, 'mk cible').addTo(map);
  map.flyTo([it.lat, it.lon], it.type === 'municipality' ? 14 : 18, { duration: 0.8 });
  ventesP = ventesAutour(it.lat, it.lon, it.insee).catch(() => []);
  const rep = $('#repere-ventes');
  rep.hidden = false;
  rep.textContent = 'Lecture des ventes notariées autour…';
  const ventes = await ventesP;
  if (adresse !== it) return;
  const proches = ventes.filter((v) => distance(it.lat, it.lon, v[V.lat], v[V.lon]) <= 1000);
  const plusAncienne = proches.length ? proches[proches.length - 1][V.date] : null;
  rep.textContent = ventes.length
    ? `${nombre(proches.length)} ventes notariées à moins d’un kilomètre${plusAncienne ? ` depuis ${dateFr(plusAncienne)}` : ''}.`
    : 'Les ventes de ce secteur ne sont pas encore chargées. Lancez « npm run data » pour les préparer.';
}

const type = () => form.type.value;

function afficher(n) {
  etape = n;
  $$('.etape', form).forEach((el) => { el.hidden = Number(el.dataset.etape) !== n; });
  const t = type();
  $$('.si-bati', form).forEach((el) => { el.hidden = !(t === 'M' || t === 'A'); });
  $$('.si-maison', form).forEach((el) => { el.hidden = t !== 'M'; });
  $$('.si-appart', form).forEach((el) => { el.hidden = t !== 'A'; });
  $$('.si-terrain', form).forEach((el) => { el.hidden = !(t === 'M' || t === 'T'); });
  const affiche = modePro && n === 7 ? 6 : n;
  $('#prog').style.width = `${Math.round((affiche / TOTAL) * 100)}%`;
  $('#prog-num').textContent = n === 7 ? 'Résultat' : `Étape ${affiche} sur ${TOTAL}`;
  btnPrec.hidden = n === 1 || n === 7;
  $('#nav').hidden = n === 7;
  btnSuiv.textContent = n === 6 || (n === 5 && modePro) ? 'Voir mon estimation' : 'Continuer';
  const h = $(`.etape[data-etape="${n}"] h2`, form);
  if (n > 1 && h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  if (n > 1 && window.innerWidth < 980) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function valider(n) {
  if (n === 1) {
    const ok = Boolean(adresse) && adresse.type !== 'municipality';
    $('#err-adresse').hidden = ok;
    $('#err-adresse').textContent = adresse?.type === 'municipality' ? 'Précisez la rue pour une estimation fiable.' : 'Choisissez une adresse dans la liste.';
    return ok;
  }
  if (n === 2) { const ok = Boolean(type()); $('#err-type').hidden = ok; return ok; }
  if (n === 3) {
    const t = type();
    const s = Number($('#surf').value);
    const ter = Number($('#terrain').value);
    const err = $('#err-surf');
    const ok = t === 'T' ? ter >= 50 : s >= 9;
    err.hidden = ok;
    err.textContent = t === 'T' ? 'Indiquez la surface du terrain.' : 'Indiquez la surface habitable.';
    if (!ok) return false;
    // Surface habitable inhabituelle : on demande une confirmation (souvent la surface du terrain saisie au mauvais endroit)
    const seuil = t === 'A' ? 200 : 350;
    const cle = `${t}-${s}-${ter}`;
    if (t !== 'T' && s > seuil && confirmeSurf !== cle) {
      confirmeSurf = cle;
      err.hidden = false;
      err.textContent = `${s} m² habitables, c’est très grand. La surface du terrain se met dans la case « Surface du terrain ». Si ${s} m² est bien la surface habitable, appuyez à nouveau sur Continuer.`;
      $('#surf').focus();
      return false;
    }
    if (t === 'M' && ter && s > ter * 3) {
      if (confirmeSurf !== cle) {
        confirmeSurf = cle;
        err.hidden = false;
        err.textContent = 'La surface habitable dépasse largement celle du terrain. Les deux cases ne sont-elles pas inversées ? Appuyez à nouveau sur Continuer pour confirmer.';
        return false;
      }
    }
    return true;
  }
  if (n === 6) {
    const e = $('#err-contact');
    const nom = $('#nom').value.trim();
    const tel = $('#tel').value.trim();
    const mail = $('#email').value.trim();
    let msg = '';
    if (nom.length < 2) msg = 'Indiquez votre nom.';
    else if (!tel && !mail) msg = 'Indiquez un téléphone ou un e-mail.';
    else if (tel && !telValide(tel)) msg = 'Ce numéro de téléphone ne semble pas complet.';
    else if (mail && !emailValide(mail)) msg = 'Cette adresse e-mail ne semble pas valide.';
    else if (!$('#consent').checked) msg = 'Cochez la case pour que nous puissions vous recontacter.';
    e.textContent = msg;
    e.hidden = !msg;
    return !msg;
  }
  return true;
}

function lireBien() {
  return {
    adresse: adresse.label, insee: adresse.insee, lat: adresse.lat, lon: adresse.lon,
    type: type(),
    surf: Number($('#surf').value) || 0,
    pieces: Number($('#pieces').value) || 0,
    terrain: Number($('#terrain').value) || 0,
    etage: Number($('#etage').value) || 0,
    ascenseur: $('#ascenseur').checked,
    etat: form.etat.value,
    dpe: form.dpe.value,
    piscine: $('#piscine').checked,
    garage: $('#garage').checked,
    exterieur: $('#exterieur').checked,
    vue: $('#vue').checked,
    delai: form.delai.value,
    statut: $('#statut').value,
    precisions: $('#precisions').value.trim(),
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (etape === 1 && !adresse && $('#adresse').value.trim().length > 4) {
    try { const it = await adr.premier(); if (it) await choisirAdresse(it); } catch { /* message plus bas */ }
  }
  if (!valider(etape)) return;
  if (etape === 5 && modePro) return resultat();
  if (etape === 6) return resultat();
  afficher(etape + 1);
});
btnPrec.addEventListener('click', () => afficher(Math.max(1, etape - (etape === 7 && modePro ? 2 : 1))));

async function resultat() {
  afficher(7);
  const box = $('#resultat');
  box.innerHTML = '<div class="charge">Calcul à partir des ventes notariées…</div>';
  const bien = lireBien();
  const ventes = (await ventesP) || [];
  let r;
  try { r = estimer(bien, ventes); } catch (err) { r = { ok: false, raison: err.message }; }

  if (!modePro) {
    btnSuiv.disabled = true;
    const contact = { nom: $('#nom').value.trim(), telephone: $('#tel').value.trim(), email: $('#email').value.trim() };
    enregistrerLead({ type: 'estimation', contact, bien, resultat: r.ok ? { valeur: r.valeur, bas: r.bas, haut: r.haut, m2: r.m2, n: r.n, fiabilite: r.fiabilite } : { erreur: r.raison } })
      .catch(() => {}).finally(() => { btnSuiv.disabled = false; });
  }

  if (!r.ok) {
    box.innerHTML = `<h2>Estimation impossible pour l’instant</h2><p>${esc(r.raison)}</p>
      <div class="encart info"><p>Les ventes de ce secteur ne sont peut-être pas encore chargées. ${modePro ? 'Lancez <code>npm run data</code> pour les préparer.' : 'Nous vous rappelons pour un avis de valeur établi sur place.'}</p></div>
      <button type="button" class="btn ghost" id="recommencer">Modifier les informations</button>`;
    $('#recommencer').onclick = () => afficher(3);
    return;
  }
  rendreResultat(box, bien, r);
  dessinerComparables(bien, r);
}

function rendreResultat(box, bien, r) {
  const lib = { M: 'maison', A: 'appartement', T: 'terrain' }[bien.type];
  const taille = bien.type === 'T' ? bien.terrain : bien.surf;
  const cls = { 'élevée': 'elevee', moyenne: 'moyenne', faible: 'faible' }[r.fiabilite];
  const pos = Math.round(((r.valeur - r.bas) / Math.max(1, r.haut - r.bas)) * 100);
  const rayonTxt = r.rayon >= 1000 ? `${nombre(r.rayon / 1000, 1)} km` : `${r.rayon} m`;
  const ajust = r.ajustements.map((a) => {
    const val = a.pct !== undefined ? `${a.pct > 0 ? '+' : ''}${Math.round(a.pct * 100)} %` : `${a.eur > 0 ? '+' : ''}${euro(Math.round(a.eur / 1000) * 1000)}`;
    const signe = (a.pct ?? a.eur) >= 0 ? 'plus' : 'moins';
    return `<li><span>${esc(a.label)}</span><span class="${signe}">${val}</span></li>`;
  }).join('');
  const lignes = r.comparables.slice(0, 15).map((c) => `<tr>
      <td>${dateFr(c.date)}</td><td>${euro(c.prix)}</td>
      <td>${c.type === 'T' ? '' : `${nombre(c.surf)} m²`}</td>
      <td>${c.terrain ? `${nombre(c.terrain)} m²` : ''}</td>
      <td>${nombre(c.m2)} €</td><td>${c.d >= 1000 ? `${nombre(c.d / 1000, 1)} km` : `${c.d} m`}</td></tr>`).join('');
  const divisible = (bien.type === 'M' && bien.terrain >= 700) || (bien.type === 'T' && bien.terrain >= 800);
  const urlDiv = `/division/?adresse=${encodeURIComponent(bien.adresse)}&lat=${bien.lat}&lon=${bien.lon}&insee=${bien.insee}`;

  box.innerHTML = `
    <p class="petit" style="margin:0">Votre ${lib} de ${nombre(taille)} m², ${esc(bien.adresse)}</p>
    <h2 class="sr">Estimation</h2>
    <div class="fourchette"><span class="valeur">${euro(r.valeur)}</span></div>
    <span class="fiab ${cls}">Fiabilité ${r.fiabilite}</span>
    ${r.alerte ? `<div class="encart ko"><p>${esc(r.alerte)}</p></div>` : ''}
    <div class="jauge" role="img" aria-label="Fourchette de ${euro(r.bas)} à ${euro(r.haut)}"><i style="left:${pos}%"></i></div>
    <div class="jauge-lib"><span>Bas <b>${euro(r.bas)}</b></span><span>Haut <b>${euro(r.haut)}</b></span></div>
    <div class="chiffres">
      <div><b>${nombre(r.m2)} €</b><span>par m² pour votre bien</span></div>
      <div><b>${r.n}</b><span>ventes comparées</span></div>
      <div><b>${rayonTxt}</b><span>rayon de recherche</span></div>
    </div>
    <h3>Comment on arrive à ce prix</h3>
    <ul class="ajust">
      <li><span>Prix médian du marché (${bien.type === 'T' ? 'terrains' : `${lib}s de taille proche`})</span><span>${nombre(r.m2Marche)} €/m²</span></li>
      ${ajust}
    </ul>
    <details class="regles"><summary>Voir les ${Math.min(15, r.comparables.length)} ventes les plus proches de votre bien</summary>
      <div class="table-wrap"><table class="ventes"><thead><tr><th>Date</th><th>Prix</th><th>Habitable</th><th>Terrain</th><th>Prix/m²</th><th>Distance</th></tr></thead><tbody>${lignes}</tbody></table></div>
      <p class="petit">Ventes notariées (DVF) d’une seule ${lib} sur les ${r.mois} derniers mois. Les plus récentes et les plus proches comptent davantage.</p>
    </details>
    ${divisible ? `<div class="encart"><h3>Votre terrain de ${nombre(bien.terrain)} m² est peut-être divisible</h3><p>Détacher un lot à bâtir peut rapporter davantage qu’une vente en un seul bloc.</p><p><a class="btn petit-btn" href="${urlDiv}">Tester la division</a></p></div>` : ''}
    <div class="encart info">
      <p>${modePro ? 'Mode perso : aucun contact enregistré.' : `Merci ${esc($('#nom').value.trim().split(' ')[0])}. Nous vous rappelons pour affiner ce prix après une visite, qui tient compte de ce que les chiffres ne voient pas : luminosité, vis-à-vis, travaux.`}</p>
    </div>
    <div class="nav-etapes">
      <button type="button" class="btn ghost" id="modifier">Modifier les informations</button>
      <button type="button" class="btn" id="imprimer">Imprimer ou enregistrer en PDF</button>
    </div>`;
  $('#modifier').onclick = () => afficher(3);
  $('#imprimer').onclick = () => window.print();
}

function dessinerComparables(bien, r) {
  const L = window.L;
  if (calques) calques.remove();
  calques = L.layerGroup().addTo(map);
  const pts = [[bien.lat, bien.lon]];
  for (const c of r.comparables) {
    pts.push([c.lat, c.lon]);
    marqueur(c.lat, c.lon).bindPopup(`<b>${euro(c.prix)}</b><br>${dateFr(c.date)}<br>${c.type === 'T' ? `Terrain ${nombre(c.terrain)} m²` : `${nombre(c.surf)} m² habitables${c.terrain ? `, terrain ${nombre(c.terrain)} m²` : ''}`}<br>${nombre(c.m2)} €/m²`).addTo(calques);
  }
  map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 17 });
}

// ── Pré-remplissage par l'URL (?adresse=…&lat=…&lon=…&insee=…&type=M) ──
(async () => {
  if (params.type && ['M', 'A', 'T'].includes(params.type)) form.type.value = params.type;
  if (!params.adresse) { afficher(1); return; }
  $('#adresse').value = params.adresse;
  afficher(1);
  try {
    const r = await geocode(params.adresse, { limit: 1 });
    let it = r[0];
    if (params.lat && params.lon && (!it || it.type === 'municipality')) {
      it = { ...(it || {}), label: params.adresse, name: params.adresse, lat: Number(params.lat), lon: Number(params.lon), insee: params.insee || it?.insee, type: it?.type || 'municipality' };
    }
    if (!it) return;
    adr.definir(it);
    await choisirAdresse(it);
    if (it.type !== 'municipality') afficher(2);
    else { $('#adresse').focus(); $('#adresse').select(); toast('Précisez le numéro et la rue pour démarrer.'); }
  } catch { /* l'utilisateur saisit lui-même */ }
})();

if (location.hash === '#estimation') setTimeout(() => $('#estimation').scrollIntoView({ block: 'start' }), 50);
if (modePro) toast('Mode perso : pas d’étape coordonnées.');
