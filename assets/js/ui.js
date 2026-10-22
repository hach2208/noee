// Noéé : éléments communs (en-tête, pied, carte, recherche d'adresse, formats).
import { CONFIG } from './config.js';
import { geocode } from './api.js';

const M = CONFIG.marque;

export const euro = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
export const nombre = (n, d = 0) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n);
export const m2 = (n) => `${nombre(n)} m²`;
export const dateFr = (d) => new Date(d).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const logo = () => {
  const n = M.nom;
  return `${esc(n.slice(0, -1))}<i>${esc(n.slice(-1))}</i>`;
};

export function montageCommun() {
  const page = document.body.dataset.page || '';
  const lien = (href, txt, id) => `<a href="${href}"${page === id ? ' aria-current="page"' : ''}>${txt}</a>`;
  const entete = document.createElement('header');
  entete.className = 'entete';
  entete.innerHTML = `
    <a class="skip" href="#contenu">Aller au contenu</a>
    <div class="wrap">
      <a class="logo" href="/noee/" aria-label="${esc(M.nom)}, accueil">${logo()}</a>
      <nav class="nav" aria-label="Navigation principale">
        ${lien('/noee/vendre/', 'Estimer', 'vendre')}
        ${lien('/noee/division/', 'Terrain', 'division')}
        ${lien('/noee/biens/', 'Biens', 'biens')}
        ${lien('/noee/communes/', 'Communes', 'communes')}
      </nav>
      <a class="tel" href="tel:${M.telephone.replace(/\s/g, '')}">${esc(M.telephone)}</a>
      <a class="btn petit-btn" href="/noee/vendre/#estimation">Estimer mon bien</a>
    </div>`;
  document.body.prepend(entete);

  const pied = document.createElement('footer');
  pied.className = 'pied';
  pied.innerHTML = `
    <div class="wrap grille">
      <div>
        <div class="logo">${logo()}</div>
        <p>${esc(M.signature)}</p>
        <p class="petit">Estimations établies à partir des ventes enregistrées par les notaires (DVF, données publiques de l’État). Elles ne remplacent pas un avis de valeur établi après visite.</p>
      </div>
      <div>
        <ul>
          <li><a href="/noee/vendre/">Estimer un bien</a></li>
          <li><a href="/noee/division/">Terrain : division, logements</a></li>
          <li><a href="/noee/biens/">Biens à vendre</a></li>
          <li><a href="/noee/communes/">Prix par commune</a></li>
        </ul>
      </div>
      <div>
        <ul>
          <li>${esc(M.adresse)}</li>
          <li><a href="tel:${M.telephone.replace(/\s/g, '')}">${esc(M.telephone)}</a></li>
          <li><a href="mailto:${esc(M.email)}">${esc(M.email)}</a></li>
          <li><a href="https://www.instagram.com/${esc(M.instagram)}/" rel="noopener">Instagram</a></li>
          <li><a href="/noee/installer/">Installer l’application</a></li>
          <li><a href="/noee/maj/">Mettre à jour l’application</a></li>
          <li><a href="/noee/mentions-legales/">Mentions légales et confidentialité</a></li>
        </ul>
      </div>
    </div>`;
  document.body.append(pied);

  const barre = document.createElement('nav');
  barre.className = 'barre-mobile';
  barre.setAttribute('aria-label', 'Actions rapides');
  barre.innerHTML = `
    <a class="principal" href="/noee/vendre/#estimation">Estimer</a>
    <a href="tel:${M.telephone.replace(/\s/g, '')}">Appeler</a>
    <a href="https://wa.me/${M.telephoneIntl}" rel="noopener">WhatsApp</a>`;
  document.body.append(barre);

  if ('serviceWorker' in navigator) {
    // Une nouvelle version prend la main : on recharge une fois pour l'afficher
    const avait = Boolean(navigator.serviceWorker.controller);
    let recharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (avait && !recharge) { recharge = true; location.reload(); }
    });
    navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url), { updateViaCache: 'none' })
      .then((r) => r.update()).catch(() => {});
  }
}

// Invite d'installation (Android, Chrome, Edge). Sur iPhone : Partager > Sur l'écran d'accueil.
let invite = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  invite = e;
  document.dispatchEvent(new CustomEvent('noee:installable'));
});
export const installable = () => Boolean(invite);
export async function installer() {
  if (!invite) return false;
  invite.prompt();
  const r = await invite.userChoice;
  invite = null;
  return r.outcome === 'accepted';
}
export const estApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const modePerso = {
  get actif() { try { return localStorage.getItem('noee_pro') === '1'; } catch { return false; } },
  set actif(v) { try { if (v) localStorage.setItem('noee_pro', '1'); else localStorage.removeItem('noee_pro'); } catch { /* rien */ } },
};

export function toast(msg, ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ── Carte Leaflet avec fonds IGN (orthophoto, plan, cadastre) ──
const wmts = (layer, format, style = 'normal') =>
  `${CONFIG.api.wmts}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${encodeURIComponent(style)}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`;

export function creerCarte(el, { lat = CONFIG.carte.lat, lon = CONFIG.carte.lon, zoom = CONFIG.carte.zoom, fond = 'ortho', cadastre = true, zonage = null, interactive = true, selecteur = true } = {}) {
  const L = window.L;
  const map = L.map(el, {
    zoomControl: interactive, attributionControl: interactive, dragging: interactive, scrollWheelZoom: interactive,
    doubleClickZoom: interactive, touchZoom: interactive, keyboard: interactive, boxZoom: interactive,
  }).setView([lat, lon], zoom);
  const attr = '© <a href="https://www.ign.fr/">IGN</a> Géoplateforme';
  const fonds = {
    ortho: L.tileLayer(wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxNativeZoom: 19, maxZoom: 21, attribution: attr }),
    plan: L.tileLayer(wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxNativeZoom: 19, maxZoom: 21, attribution: attr }),
  };
  const couchesCadastre = L.tileLayer(wmts('CADASTRALPARCELS.PARCELLAIRE_EXPRESS', 'image/png', 'PCI vecteur'), { maxNativeZoom: 19, maxZoom: 21, opacity: 0.85 });
  // Zonage du PLU (Géoportail de l'urbanisme), couleurs par type de zone
  const couchesZonage = L.tileLayer.wms('https://data.geopf.fr/wms-v/ows', {
    layers: 'du,zone_urba', format: 'image/png', transparent: true, version: '1.3.0', opacity: 0.4, maxZoom: 21,
    attribution: '© Géoportail de l’urbanisme',
  });
  if (zonage) couchesZonage.addTo(map);
  let actuel = fonds[fond];
  actuel.addTo(map);
  if (cadastre) couchesCadastre.addTo(map);

  const setFond = (nom) => {
    map.removeLayer(actuel);
    actuel = fonds[nom];
    actuel.addTo(map);
    actuel.bringToBack();
  };

  if (interactive && selecteur) {
    const Ctl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'couches');
        div.innerHTML = `<button type="button" data-f="ortho" aria-pressed="${fond === 'ortho'}">Photo</button><button type="button" data-f="plan" aria-pressed="${fond === 'plan'}">Plan</button><button type="button" data-c aria-pressed="${cadastre}">Cadastre</button>${zonage !== null ? `<button type="button" data-z aria-pressed="${Boolean(zonage)}">PLU</button>` : ''}`;
        L.DomEvent.disableClickPropagation(div);
        div.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.f) {
            setFond(b.dataset.f);
            div.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          } else if (b.dataset.z !== undefined) {
            const on = b.getAttribute('aria-pressed') !== 'true';
            if (on) couchesZonage.addTo(map); else map.removeLayer(couchesZonage);
            b.setAttribute('aria-pressed', String(on));
          } else {
            const on = b.getAttribute('aria-pressed') !== 'true';
            if (on) couchesCadastre.addTo(map); else map.removeLayer(couchesCadastre);
            b.setAttribute('aria-pressed', String(on));
          }
        });
        return div;
      },
    });
    new Ctl({ position: 'topright' }).addTo(map);
  }
  return { map, setFond };
}

export function marqueur(lat, lon, cls = 'mk') {
  const L = window.L;
  const size = cls.includes('cible') ? 20 : 14;
  return L.marker([lat, lon], { icon: L.divIcon({ className: '', html: `<div class="${cls}"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) });
}

// ── Champ d'adresse avec suggestions (clavier compris) ──
export function champAdresse(input, { onChoix, type } = {}) {
  const box = input.closest('.champ-adresse') || input.parentElement;
  const ul = document.createElement('ul');
  ul.className = 'suggestions';
  ul.id = `${input.id || 'adr'}-liste`;
  ul.setAttribute('role', 'listbox');
  ul.hidden = true;
  box.append(ul);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', ul.id);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');

  let items = [];
  let sel = -1;
  let timer;
  let seq = 0;
  let choisi = null;

  const fermer = () => { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const rendre = () => {
    if (!items.length) { ul.innerHTML = '<li class="vide">Aucune adresse trouvée. Essayez avec le numéro, la rue et la ville.</li>'; }
    else {
      ul.innerHTML = items.map((it, i) => `<li role="option" id="${ul.id}-${i}" aria-selected="${i === sel}" data-i="${i}">${esc(it.name)}<small>${esc(it.cp || '')} ${esc(it.ville || '')}</small></li>`).join('');
    }
    ul.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (sel >= 0) input.setAttribute('aria-activedescendant', `${ul.id}-${sel}`);
  };
  const choisir = (it) => {
    choisi = it;
    input.value = it.label;
    fermer();
    onChoix?.(it);
  };

  input.addEventListener('input', () => {
    choisi = null;
    clearTimeout(timer);
    const q = input.value;
    if (q.trim().length < 3) { fermer(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const r = await geocode(q, { type });
        if (my !== seq) return;
        items = r; sel = r.length ? 0 : -1; rendre();
      } catch {
        items = []; ul.innerHTML = '<li class="vide">La recherche d’adresse ne répond pas. Réessayez dans un instant.</li>'; ul.hidden = false;
      }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (ul.hidden || !items.length) {
      if (e.key === 'Enter' && !choisi) e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; rendre(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; rendre(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sel >= 0) choisir(items[sel]); }
    else if (e.key === 'Escape') fermer();
  });
  ul.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); choisir(items[Number(li.dataset.i)]); }
  });
  input.addEventListener('blur', () => setTimeout(fermer, 150));

  return {
    get valeur() { return choisi; },
    definir(it) { choisi = it; input.value = it.label; },
    async premier() {
      if (choisi) return choisi;
      const r = await geocode(input.value, { type });
      if (r[0]) choisir(r[0]);
      return r[0] || null;
    },
  };
}

/** Lit les paramètres d'URL (pré-remplissage depuis une pub ou un lien). */
export function paramsUrl() {
  const p = new URLSearchParams(location.search);
  const o = Object.fromEntries(p.entries());
  const utm = {};
  for (const [k, v] of p.entries()) if (k.startsWith('utm_')) utm[k] = v;
  if (Object.keys(utm).length) {
    try { sessionStorage.setItem('noee_utm', JSON.stringify(utm)); } catch { /* navigation privée */ }
  }
  return o;
}

export function utmSession() {
  try { return JSON.parse(sessionStorage.getItem('noee_utm') || '{}'); } catch { return {}; }
}
