// Noéé : calcul du potentiel de division d'un terrain (Turf.js, global window.turf).
import { CONFIG } from './config.js';

const D = CONFIG.division;
const T = () => window.turf;

export function reglesPourZone(typezone, rnu) {
  if (rnu) return { ...D.reglesParZone.RNU };
  const z = String(typezone || '').trim();
  if (D.reglesParZone[z]) return { ...D.reglesParZone[z] };
  if (z.startsWith('AU')) return { ...D.reglesParZone.AUc };
  if (z.startsWith('U')) return { ...D.reglesParZone.U };
  if (z.startsWith('A')) return { ...D.reglesParZone.A };
  if (z.startsWith('N')) return { ...D.reglesParZone.N };
  return { ...D.reglesParZone.U };
}

export function uniteFonciere(parcelles) {
  const t = T();
  if (parcelles.length === 1) return t.feature(parcelles[0].geometry);
  try {
    return t.union(t.featureCollection(parcelles.map((p) => t.feature(p.geometry)))) || t.feature(parcelles[0].geometry);
  } catch {
    return t.feature(parcelles[0].geometry);
  }
}

function aire(f) { return f ? T().area(f) : 0; }
function inter(a, b) { try { return T().intersect(T().featureCollection([a, b])); } catch { return null; } }
function diff(a, b) { try { return T().difference(T().featureCollection([a, b])); } catch { return a; } }
function tampon(f, m) { try { return T().buffer(f, m, { units: 'meters' }); } catch { return null; } }
function unir(fs) {
  const t = T();
  if (!fs.length) return null;
  if (fs.length === 1) return fs[0];
  try { return t.union(t.featureCollection(fs)); } catch { return fs[0]; }
}

/**
 * @param {object} p
 *  parcelles  : features cadastre (properties.contenance)
 *  batiments  : features BD TOPO
 *  regles     : { ces, lotMin, recul, constructible }
 *  options    : { frontRue, lotCible, largeurAcces }
 *  reperes    : { m2, prixLot, surfLot } prix des terrains à bâtir autour (peut être null)
 */
export function analyserDivision({ parcelles, batiments, regles, options = {}, reperes }) {
  const t = T();
  const unite = uniteFonciere(parcelles);
  const contenance = parcelles.reduce((a, p) => a + (p.properties.contenance || 0), 0);
  const surface = Math.round(contenance || aire(unite));

  // Bâtiments réellement sur le terrain
  const surTerrain = [];
  for (const b of batiments) {
    const i = inter(t.feature(b.geometry), unite);
    const a = aire(i);
    if (i && a >= 8) surTerrain.push(i);
  }
  const emprise = Math.round(surTerrain.reduce((a, b) => a + aire(b), 0));
  const cesActuel = surface ? emprise / surface : 0;

  const ces = Math.max(0, Number(regles.ces) || 0) / 100;
  const recul = Math.max(0, Number(regles.recul) || 0);
  const lotMin = Math.max(0, Number(regles.lotMin) || 0);
  const lotCible = Math.max(150, Number(options.lotCible) || D.lotCibleM2, lotMin);
  const largeurAcces = Number(options.largeurAcces) || D.largeurAcces;

  // Surface à garder autour de la maison existante
  const batiUni = unir(surTerrain);
  const batiTampon = batiUni ? inter(tampon(batiUni, recul + 2), unite) : null;
  let aGarder = 0;
  if (emprise) {
    aGarder = Math.max(ces > 0 ? emprise / ces : emprise * 3, aire(batiTampon), lotMin, emprise * 2.2);
    aGarder = Math.min(aGarder, surface);
  }

  // Accès au lot détaché quand il n'est pas en bordure de rue
  const acces = options.frontRue ? 0 : Math.round(largeurAcces * Math.sqrt(surface) * 0.55);
  const detachable = Math.max(0, Math.round(surface - aGarder - acces));

  // Zone libre géométrique : retrait des limites, retrait autour du bâti
  let libre = tampon(unite, -recul);
  if (libre && batiUni) {
    const b = tampon(batiUni, Math.max(recul, 4));
    if (b) libre = diff(libre, b);
  }
  const morceaux = libre ? t.flatten(libre).features.filter((f) => aire(f) > 40) : [];
  // Un carré de 10 m tient-il dans le morceau ? (érosion de 5 m)
  const constructibles = morceaux.filter((f) => {
    const er = tampon(f, -5);
    return er && aire(er) > 1;
  });
  const surfaceLibre = Math.round(constructibles.reduce((a, f) => a + aire(f), 0));
  const formeOk = constructibles.length > 0;

  let lots = Math.floor(detachable / lotCible);
  if (lots === 0 && detachable >= Math.max(lotMin, lotCible * 0.7)) lots = 1;
  if (!formeOk) lots = 0;
  if (!regles.constructible || ces === 0) lots = 0;
  const surfLot = lots ? Math.round(detachable / lots) : 0;

  // Valorisation
  let valo = null;
  if (reperes && lots) {
    const prixLotUnitaire = reperes.prixLot && reperes.surfLot
      ? reperes.prixLot * (surfLot / reperes.surfLot) ** 0.6
      : reperes.m2 * surfLot;
    const brut = Math.round(prixLotUnitaire * lots / 1000) * 1000;
    const couts = D.coutGeometre + lots * D.coutViabilisationLot + (options.frontRue ? 0 : acces * D.coutAccesM2);
    // La maison perd une partie de son jardin : on en retire la valeur
    const perteMaison = emprise ? Math.round(((surface - aGarder) * reperes.m2 * 0.35) / 1000) * 1000 : 0;
    valo = {
      prixLot: Math.round(prixLotUnitaire / 1000) * 1000,
      brut,
      couts: Math.round(couts / 100) * 100,
      perteMaison,
      net: Math.round((brut - couts - perteMaison) / 1000) * 1000,
    };
  }

  // Verdict
  let verdict = 'non';
  let titre = 'Division peu probable';
  let texte = '';
  if (!regles.constructible || ces === 0) {
    titre = 'Division non constructible';
    texte = 'La zone ne permet pas, en principe, de nouvelles maisons. Une division reste possible pour vendre du terrain nu, sans droit à bâtir.';
  } else if (lots >= 1) {
    verdict = 'oui';
    titre = lots > 1 ? `Division probable en ${lots} lots` : 'Division probable';
    texte = `On peut détacher environ ${surfLot.toLocaleString('fr-FR')} m² par lot tout en laissant ${Math.round(aGarder).toLocaleString('fr-FR')} m² à la maison.`;
  } else if (detachable >= lotCible * 0.45 || (formeOk && detachable > 150)) {
    verdict = 'peutetre';
    titre = 'À étudier de près';
    texte = !formeOk
      ? 'La surface existe, mais la forme du terrain laisse peu de place à une maison une fois les retraits appliqués.'
      : 'La surface détachable est juste. Tout dépend des règles exactes de la zone et de l’accès.';
  } else {
    texte = 'Une fois la surface nécessaire à la maison et à l’accès retirée, il ne reste pas assez de place pour un lot.';
  }

  return {
    unite, surface, emprise, cesActuel, aGarder: Math.round(aGarder), acces, detachable, lots, surfLot,
    libre: constructibles.length ? t.featureCollection(constructibles) : null,
    surfaceLibre, formeOk, verdict, titre, texte, valo, batiments: surTerrain, lotCible,
  };
}

/** Une parcelle touche-t-elle l'unité foncière ? (tolérance 1 m) */
export function estContigue(parcelle, unite) {
  const b = tampon(T().feature(parcelle.geometry), 1);
  return Boolean(b && inter(b, unite));
}
