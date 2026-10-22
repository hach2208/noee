// Noéé : calcul du potentiel de division d'un terrain (Turf.js, global window.turf).
import { CONFIG } from './config.js';
import { croquisLonLat } from './croquis.js';

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

  // Croquis : lot de la maison, lots détachés, accès
  const constructible = regles.constructible && ces > 0;
  const croquis = constructible
    ? croquisLonLat({
      unite: unite.geometry,
      batiments: surTerrain.map((b) => b.geometry),
      routes: options.routes || [],
      rotation: options.rotation || 0,
      aGarder, lotCible, lotMin, recul, largeurAcces,
    })
    : null;
  const lotsCroquis = croquis?.lots || [];
  const lots = lotsCroquis.length;
  const detachable = lotsCroquis.reduce((a, l) => a + l.properties.aire, 0);
  const acces = croquis?.acces?.properties.aire || 0;
  const surfLot = lots ? Math.round(detachable / lots) : 0;
  const aireMaison = croquis?.maison?.properties.aire || (emprise ? Math.round(aGarder) : 0);

  // Valorisation, lot par lot
  let valo = null;
  if (reperes && lots) {
    const prix = (a) => (reperes.prixLot && reperes.surfLot ? reperes.prixLot * (a / reperes.surfLot) ** 0.6 : reperes.m2 * a);
    const parLot = lotsCroquis.map((l) => Math.round(prix(l.properties.aire) / 1000) * 1000);
    const brut = parLot.reduce((a, b) => a + b, 0);
    const couts = D.coutGeometre + lots * D.coutViabilisationLot + acces * D.coutAccesM2;
    // La maison perd une partie de son jardin : on en retire la valeur
    const perteMaison = emprise ? Math.round(((surface - aireMaison) * reperes.m2 * 0.35) / 1000) * 1000 : 0;
    valo = {
      parLot,
      prixLot: Math.round(brut / lots / 1000) * 1000,
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
  if (!constructible) {
    titre = 'Division non constructible';
    texte = 'La zone ne permet pas, en principe, de nouvelles maisons. Une division reste possible pour vendre du terrain nu, sans droit à bâtir.';
  } else if (lots >= 1) {
    verdict = 'oui';
    const enDrapeau = lotsCroquis.some((l) => l.properties.position === 'fond');
    titre = lots > 1 ? `Division probable en ${lots} lots` : 'Division probable en 1 lot';
    texte = `${lots > 1 ? 'Lots' : 'Lot'} de ${lotsCroquis.map((l) => l.properties.aire.toLocaleString('fr-FR')).join(', ')} m²${enDrapeau ? ', desservis par un accès de ' + largeurAcces + ' m' : ' avec façade sur rue'}. La maison garde ${aireMaison.toLocaleString('fr-FR')} m².`;
  } else if (surface - aGarder >= lotCible * 0.6) {
    verdict = 'peutetre';
    titre = 'À étudier de près';
    texte = croquis?.notes?.[0] || 'La surface existe, mais la forme du terrain ne permet pas de dessiner un lot correct avec les règles saisies.';
  } else {
    texte = 'Une fois la surface nécessaire à la maison retirée, il ne reste pas assez de place pour un lot.';
  }

  return {
    unite, surface, emprise, cesActuel, aGarder: Math.round(aGarder), aireMaison, acces, detachable, lots, surfLot,
    croquis, verdict, titre, texte, valo, batiments: surTerrain, lotCible,
  };
}

/** Une parcelle touche-t-elle l'unité foncière ? (tolérance 1 m) */
export function estContigue(parcelle, unite) {
  const b = tampon(T().feature(parcelle.geometry), 1);
  return Boolean(b && inter(b, unite));
}
