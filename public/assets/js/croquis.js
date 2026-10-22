// Noéé : croquis de division. Découpe un terrain en lots dessinables sur la carte.
// Géométrie plane en mètres (projection locale), sans dépendance externe.
//
// Principe :
//  1. On trouve l'axe « profondeur » du terrain (perpendiculaire à la rue la plus proche,
//     sinon le grand côté du rectangle minimal), la rue étant au début de l'axe.
//  2. La maison existante garde une bande de terrain (au moins la surface à conserver).
//  3. Devant la maison (côté rue) : lots côte à côte, chacun avec sa façade sur rue.
//  4. Derrière la maison : lots en drapeau, desservis par un accès le long d'une limite.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function projection(lon0, lat0) {
  const kx = Math.cos(rad(lat0)) * rad(1) * R;
  const ky = rad(1) * R;
  return {
    local: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky],
    lonlat: ([x, y]) => [lon0 + x / kx, lat0 + y / ky],
  };
}

const dot = (p, d) => p[0] * d[0] + p[1] * d[1];
const neg = (d) => [-d[0], -d[1]];

export function aire(ring) {
  if (!ring || ring.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(s) / 2;
}

/** Garde la partie du polygone où dot(p, n) <= c (Sutherland-Hodgman, polygones concaves acceptés). */
export function couper(ring, n, c) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const da = dot(a, n) - c;
    const db = dot(b, n) - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 ? out : [];
}

/** Bande du polygone entre t0 et t1 le long de la direction d. */
export function bande(ring, d, t0, t1) {
  return couper(couper(ring, d, t1), neg(d), -t0);
}

const etendue = (ring, d) => {
  let mn = Infinity;
  let mx = -Infinity;
  for (const p of ring) { const s = dot(p, d); if (s < mn) mn = s; if (s > mx) mx = s; }
  return [mn, mx];
};

/** Position t telle que la bande [debut, t] le long de d ait l'aire visée. */
function coupeAire(ring, d, debut, fin, cible) {
  let lo = debut;
  let hi = fin;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (aire(bande(ring, d, debut, mid)) < cible) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function enveloppe(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas = [];
  for (const p of pts) { while (bas.length >= 2 && cross(bas[bas.length - 2], bas[bas.length - 1], p) <= 0) bas.pop(); bas.push(p); }
  const haut = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (haut.length >= 2 && cross(haut[haut.length - 2], haut[haut.length - 1], p) <= 0) haut.pop(); haut.push(p); }
  return bas.slice(0, -1).concat(haut.slice(0, -1));
}

/** Axes du rectangle d'emprise minimale : [grand axe, petit axe] (vecteurs unitaires). */
export function axes(ring) {
  const h = enveloppe(ring);
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const e = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const f = [-e[1], e[0]];
    const [e0, e1] = etendue(h, e);
    const [f0, f1] = etendue(h, f);
    const ar = (e1 - e0) * (f1 - f0);
    if (!best || ar < best.ar) best = { ar, e, f, le: e1 - e0, lf: f1 - f0 };
  }
  if (!best) return [[1, 0], [0, 1]];
  return best.le >= best.lf ? [best.e, best.f] : [best.f, best.e];
}

function distSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Orientation : u = profondeur (la rue est du côté des petites valeurs), v = largeur.
 * routes : polylignes en coordonnées locales (BD TOPO). rotation : 0..3 pour forcer un autre côté.
 */
export function orienter(ring, routes = [], rotation = 0) {
  const [g, p] = axes(ring);
  let u = g;
  let auto = false;
  if (routes.length) {
    // Segment de route le plus proche du terrain
    let best = null;
    for (const ligne of routes) {
      for (let i = 0; i < ligne.length - 1; i++) {
        const a = ligne[i];
        const b = ligne[i + 1];
        for (const q of ring) {
          const dd = distSegment(q, a, b);
          if (!best || dd < best.d) best = { d: dd, a, b, q };
        }
      }
    }
    if (best && best.d < 60) {
      const L = Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1]) || 1;
      const r = [(best.b[0] - best.a[0]) / L, (best.b[1] - best.a[1]) / L];
      // L'axe de profondeur est le plus perpendiculaire à la rue
      u = Math.abs(dot(g, r)) < Math.abs(dot(p, r)) ? g : p;
      const [s0, s1] = etendue(ring, u);
      const mid = [(best.a[0] + best.b[0]) / 2, (best.a[1] + best.b[1]) / 2];
      const sr = dot(mid, u);
      if (Math.abs(sr - s1) < Math.abs(sr - s0)) u = neg(u);
      auto = true;
    }
  }
  // Rotation manuelle : 1 = rue en face, 2 = rue sur un côté, 3 = rue sur l'autre côté
  const rot = ((rotation % 4) + 4) % 4;
  if (rot === 1) u = neg(u);
  else if (rot === 2) u = [-u[1], u[0]];
  else if (rot === 3) u = [u[1], -u[0]];
  const v = [-u[1], u[0]];
  return { u, v, auto };
}

/**
 * Découpe principale.
 * @param {object} o
 *  ring         contour du terrain (local, m)
 *  batiments    contours des bâtiments sur le terrain (local)
 *  routes       polylignes des routes proches (local)
 *  aGarder      surface minimale du lot de la maison (m²)
 *  lotCible     surface visée par lot (m²)
 *  lotMin       surface minimale d'un lot (m²)
 *  recul        retrait autour de la maison (m)
 *  largeurAcces largeur de l'accès (m)
 *  rotation     0..3
 */
export function decouper(o) {
  const essais = [];
  const ancrages = (o.batiments || []).length ? ['centre', 'avant', 'arriere'] : ['centre'];
  for (const ancrage of ancrages) {
    let r = calculer(o, false, ancrage);
    if (r.acces && r.aireMaison < (o.aGarder || 0) - 5) {
      const r2 = calculer(o, true, ancrage);
      if (r2.lots.length) r = r2;
    }
    essais.push(r);
  }
  if ((o.batiments || []).length) essais.push(lateral(o));
  const score = (r) => r.lots.length * 1e6 + r.lots.reduce((a, l) => a + l.aire, 0) - r.aireAcces * 2;
  essais.sort((x, y) => score(y) - score(x));
  return essais[0];
}

/** Division latérale : la maison garde une bande sur toute la profondeur, les lots sont à côté, sur rue. */
function lateral(o) {
  const ring = o.ring;
  const total = aire(ring);
  const { u, v, auto } = orienter(ring, o.routes || [], o.rotation || 0);
  const [w0, w1] = etendue(ring, v);
  const L = Math.max(150, o.lotCible || 450);
  const minLot = Math.max(o.lotMin || 0, L * 0.8);
  const minFacade = o.minFacade || 11;
  const recul = o.recul ?? 3;
  const bats = o.batiments.filter((b) => aire(b) >= 15);
  const res = { u, v, auto, total, maison: null, lots: [], acces: null, notes: [], aireAcces: 0 };
  const [hv0, hv1] = etendue(bats.flat(), v);
  let c0 = Math.max(w0, hv0 - recul);
  let c1 = Math.min(w1, hv1 + recul);
  // Agrandir vers le côté le plus étroit d'abord, pour garder le grand côté libre
  const gaucheEtroite = hv0 - w0 < w1 - hv1;
  const agrandir = () => {
    if (aire(bande(ring, v, c0, c1)) >= o.aGarder) return;
    if (gaucheEtroite) {
      if (aire(bande(ring, v, w0, c1)) >= o.aGarder) { c0 = chercher((m) => aire(bande(ring, v, m, c1)) >= o.aGarder, w0, c0); return; }
      c0 = w0; c1 = coupeAire(ring, v, w0, w1, o.aGarder);
    } else {
      if (aire(bande(ring, v, c0, w1)) >= o.aGarder) { c1 = chercher((m) => aire(bande(ring, v, c0, m)) < o.aGarder, c1, w1); return; }
      c1 = w1; c0 = chercherBas(ring, v, w0, w1, o.aGarder);
    }
  };
  agrandir();
  if (c0 - w0 < 6) c0 = w0;
  if (w1 - c1 < 6) c1 = w1;
  const cotes = [];
  if (c0 > w0) cotes.push(bande(ring, v, w0, c0));
  if (c1 < w1) cotes.push(bande(ring, v, c1, w1));
  for (const part of cotes) {
    const [x0, x1] = etendue(part, v);
    let pris = false;
    for (let n = Math.max(1, Math.round(aire(part) / L)); n >= 1 && !pris; n--) {
      const bornes = [x0];
      for (let i = 1; i < n; i++) bornes.push(coupeAire(part, v, x0, x1, (aire(part) * i) / n));
      bornes.push(x1);
      const lots = [];
      for (let i = 0; i < n; i++) lots.push(bande(part, v, bornes[i], bornes[i + 1]));
      if (lots.every((r) => aire(r) >= minLot && largeur(r, v) >= minFacade && profondeur(r, u) >= 10)) {
        for (const r of lots) res.lots.push({ ring: r, position: 'rue' });
        pris = true;
      }
    }
    if (!pris) { if (part === cotes[0] && c0 > w0) c0 = w0; else c1 = w1; }
  }
  res.maison = bande(ring, v, c0, c1);
  return finaliser(res, u, v);
}

function chercher(ok, lo, hi) {
  // plus grande valeur m dans [lo, hi] telle que ok(m) (ok décroissant)
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}
function chercherBas(ring, d, lo, hi, cible) {
  // position t telle que la bande [t, hi] ait l'aire visée
  let a = lo;
  let b = hi;
  for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (aire(bande(ring, d, m, hi)) >= cible) a = m; else b = m; }
  return a;
}

function calculer(o, maisonNette, ancrage = 'centre') {
  const ring = o.ring;
  const total = aire(ring);
  const { u, v, auto } = orienter(ring, o.routes || [], o.rotation || 0);
  const [s0, s1] = etendue(ring, u);
  const [w0, w1] = etendue(ring, v);
  const W = o.largeurAcces || 3.5;
  const L = Math.max(150, o.lotCible || 450);
  const minLot = Math.max(o.lotMin || 0, L * 0.8);
  const minFacade = o.minFacade || 11;
  const recul = o.recul ?? 3;
  const bats = (o.batiments || []).filter((b) => aire(b) >= 15);

  const res = { u, v, auto, total, maison: null, lots: [], acces: null, notes: [] };

  // Côté de l'accès : là où il reste le plus de place à côté de la maison
  let hv0 = w0;
  let hv1 = w0;
  if (bats.length) [hv0, hv1] = etendue(bats.flat(), v);
  const placeDroite = w1 - hv1;
  const placeGauche = hv0 - w0;
  const droite = !bats.length || placeDroite >= placeGauche;
  const placeAcces = bats.length ? Math.max(placeDroite, placeGauche) : Infinity;
  const horsAcces = (r) => (droite ? couper(r, v, w1 - W) : couper(r, neg(v), -(w0 + W)));
  const dansAcces = (r) => (droite ? couper(r, neg(v), -(w1 - W)) : couper(r, v, w0 + W));
  // Base de calcul du lot de la maison : terrain entier, ou terrain sans la bande d'accès
  const baseMaison = maisonNette && placeAcces >= W + 0.5 ? horsAcces(ring) : ring;

  // Partie à diviser devant / derrière la maison
  let devant = ring;
  let derriere = null;
  let maison = null;
  let a = s0;
  let b = s0;
  if (bats.length) {
    const [h0, h1] = etendue(bats.flat(), u);
    a = Math.max(s0, h0 - recul);
    b = Math.min(s1, h1 + recul);
    // Agrandir le lot de la maison jusqu'à la surface à conserver : vers la rue d'abord
    if (aire(bande(baseMaison, u, a, b)) < o.aGarder) {
      if (aire(bande(baseMaison, u, s0, b)) >= o.aGarder) {
        let lo = s0;
        let hi = a;
        for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (aire(bande(baseMaison, u, m, b)) >= o.aGarder) lo = m; else hi = m; }
        a = lo;
      } else {
        a = s0;
        b = coupeAire(baseMaison, u, s0, s1, o.aGarder);
      }
    }
    if (ancrage === 'avant') {
      a = s0;
      b = Math.max(b, coupeAire(baseMaison, u, s0, s1, o.aGarder));
    } else if (ancrage === 'arriere') {
      b = s1;
      a = Math.min(a, chercherBas(baseMaison, u, s0, s1, o.aGarder));
    }
    // Un reliquat de moins de 6 m côté rue est rattaché à la maison
    if (a - s0 < 6) a = s0;
    maison = bande(ring, u, a, b);
    devant = a > s0 ? bande(ring, u, s0, a) : null;
    derriere = s1 - b > 6 ? bande(ring, u, b, s1) : null;
    if (!derriere && s1 > b) maison = bande(ring, u, a, s1);
  }

  // 1) Derrière la maison : lots en drapeau
  let finAcces = null;
  if (derriere && aire(derriere) >= minLot) {
    if (placeAcces < W + 0.5) {
      res.notes.push('La maison occupe toute la largeur : pas de place pour créer un accès vers le fond du terrain.');
    } else {
      const net = horsAcces(derriere);
      const [d0, d1] = etendue(derriere, u);
      for (let n = Math.round(aire(net) / L) || (aire(net) >= minLot ? 1 : 0); n >= 1; n--) {
        const coupes = [];
        for (let i = 1; i < n; i++) coupes.push(coupeAire(net, u, d0, d1, (aire(net) * i) / n));
        const bornes = [d0, ...coupes, d1];
        const lots = [];
        for (let i = 0; i < n; i++) {
          const dernier = i === n - 1;
          const r = dernier ? bande(derriere, u, bornes[i], bornes[i + 1]) : bande(net, u, bornes[i], bornes[i + 1]);
          lots.push(r);
        }
        if (lots.every((r) => aire(r) >= minLot && profondeur(r, u) >= 10 && largeur(r, v) >= minFacade)) {
          for (const r of lots) res.lots.push({ ring: r, position: 'fond' });
          finAcces = bornes[n - 1];
          break;
        }
      }
    }
  }

  // 2) Devant (côté rue) : lots côte à côte avec façade sur rue
  const zoneDevant = devant && finAcces !== null ? horsAcces(devant) : devant;
  const lotsDevant = [];
  if (zoneDevant && aire(zoneDevant) >= minLot) {
    const [x0, x1] = etendue(zoneDevant, v);
    for (let n = Math.round(aire(zoneDevant) / L) || 1; n >= 1; n--) {
      const bornes = [x0];
      for (let i = 1; i < n; i++) bornes.push(coupeAire(zoneDevant, v, x0, x1, (aire(zoneDevant) * i) / n));
      bornes.push(x1);
      const lots = [];
      for (let i = 0; i < n; i++) lots.push(bande(zoneDevant, v, bornes[i], bornes[i + 1]));
      // Terrain nu et étroit : on préférera les lots en profondeur (plus bas)
      if (lots.every((r) => aire(r) >= minLot && largeur(r, v) >= minFacade && profondeur(r, u) >= 10)) {
        lotsDevant.push(...lots);
        break;
      }
    }
  }

  // Terrain nu trop étroit pour des lots côte à côte : lots en profondeur avec accès
  if (!bats.length && lotsDevant.length <= 1 && aire(ring) >= 2 * minLot) {
    const net = horsAcces(ring);
    let meilleur = null;
    for (let n = Math.round(aire(ring) / L); n >= 2; n--) {
      const bornes = [s0];
      for (let i = 1; i < n; i++) bornes.push(coupeAire(net, u, s0, s1, (aire(net) * i) / n));
      bornes.push(s1);
      const lots = [];
      for (let i = 0; i < n; i++) lots.push(i === n - 1 ? bande(ring, u, bornes[i], bornes[i + 1]) : bande(net, u, bornes[i], bornes[i + 1]));
      if (lots.every((r) => aire(r) >= minLot && profondeur(r, u) >= 10 && largeur(r, v) >= minFacade)) { meilleur = { lots, fin: bornes[n - 1] }; break; }
    }
    if (meilleur && meilleur.lots.length > lotsDevant.length) {
      lotsDevant.length = 0;
      meilleur.lots.forEach((r, i) => res.lots.push({ ring: r, position: i === 0 ? 'rue' : 'fond' }));
      finAcces = meilleur.fin;
    }
  }
  for (const r of lotsDevant) res.lots.unshift({ ring: r, position: 'rue' });

  // Accès : de la rue jusqu'au dernier lot en drapeau
  if (finAcces !== null) {
    res.acces = bande(dansAcces(ring), u, s0, finAcces);
    if (maison) maison = horsAcces(maison);
  }
  res.maison = maison && aire(maison) > 0 ? maison : null;
  // Reliquat devant la maison non loti : rattaché visuellement à la maison
  if (devant && !lotsDevant.length && res.maison) {
    res.maison = bande(finAcces !== null ? horsAcces(ring) : ring, u, s0, b);
  }

  return finaliser(res, u, v);
}

function finaliser(res, u, v) {
  // Façade (largeur côté rue) et numérotation
  res.lots.sort((p, q) => etendue(p.ring, u)[0] - etendue(q.ring, u)[0] || etendue(p.ring, v)[0] - etendue(q.ring, v)[0]);
  res.lots = res.lots.map((l, i) => ({
    ...l,
    nom: String.fromCharCode(65 + i),
    aire: Math.round(aire(l.ring)),
    facade: Math.round(largeur(l.ring, v)),
    profondeur: Math.round(profondeur(l.ring, u)),
  }));
  res.aireMaison = res.maison ? Math.round(aire(res.maison)) : 0;
  res.aireAcces = res.acces ? Math.round(aire(res.acces)) : 0;
  return res;
}

function largeur(r, v) { const [a, b] = etendue(r, v); return b - a; }
function profondeur(r, u) { const [a, b] = etendue(r, u); return b - a; }

/** Polygone (Polygon ou MultiPolygon GeoJSON) → plus grand anneau extérieur, sans point de fermeture. */
export function anneauPrincipal(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  let best = null;
  for (const p of polys) {
    const r = p[0].slice(0, -1);
    const a = aireLonLat(r);
    if (!best || a > best.a) best = { r, a };
  }
  return best ? best.r : [];
}

function aireLonLat(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(s);
}

/** Version complète en lon/lat : prend des géométries GeoJSON, rend des Features GeoJSON. */
export function croquisLonLat({ unite, batiments = [], routes = [], ...opts }) {
  const ext = anneauPrincipal(unite);
  if (ext.length < 3) return null;
  const lon0 = ext.reduce((a, p) => a + p[0], 0) / ext.length;
  const lat0 = ext.reduce((a, p) => a + p[1], 0) / ext.length;
  const P = projection(lon0, lat0);
  const loc = (r) => r.map(P.local);
  const ring = loc(ext);
  const bats = batiments.map((g) => loc(anneauPrincipal(g))).filter((r) => r.length >= 3);
  const rts = routes.map((l) => loc(l));
  const r = decouper({ ...opts, ring, batiments: bats, routes: rts });
  const poly = (rr) => ({ type: 'Polygon', coordinates: [[...rr.map(P.lonlat), P.lonlat(rr[0])]] });
  return {
    auto: r.auto,
    notes: r.notes,
    maison: r.maison ? { type: 'Feature', properties: { aire: r.aireMaison }, geometry: poly(r.maison) } : null,
    acces: r.acces && r.acces.length >= 3 ? { type: 'Feature', properties: { aire: r.aireAcces }, geometry: poly(r.acces) } : null,
    lots: r.lots.map((l) => ({ type: 'Feature', properties: { nom: l.nom, aire: l.aire, facade: l.facade, profondeur: l.profondeur, position: l.position }, geometry: poly(l.ring) })),
  };
}
