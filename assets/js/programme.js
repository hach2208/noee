// Noéé : « Que peut-on construire ? » (logique reprise d'Imoscope) et bilan promoteur simplifié.

export const TYPEZONE = {
  U: { nom: 'Zone urbaine', couleur: '#c0392b', constructible: true, note: 'Constructible, voir le règlement écrit de la zone.' },
  AUc: { nom: 'À urbaniser, ouverte', couleur: '#e67e22', constructible: true, note: 'Constructible sous condition d’aménagement d’ensemble.' },
  AUs: { nom: 'À urbaniser, fermée', couleur: '#d4ac0d', constructible: false, note: 'Bloquée en l’état : modification ou révision du PLU nécessaire.' },
  AU: { nom: 'À urbaniser', couleur: '#d68910', constructible: false, note: 'Selon l’ouverture à l’urbanisation : voir le règlement.' },
  A: { nom: 'Zone agricole', couleur: '#7fb239', constructible: false, note: 'Inconstructible, sauf bâtiments agricoles et extensions limitées.' },
  N: { nom: 'Zone naturelle', couleur: '#2e8b57', constructible: false, note: 'Inconstructible, sauf exceptions très limitées.' },
};

export function zoneInfo(typezone) {
  return TYPEZONE[typezone] || { nom: `Zone ${typezone || 'inconnue'}`, couleur: '#7f8c8d', constructible: false, note: 'Type de zone non reconnu : voir le règlement.' };
}

// Programmes types (hypothèses de départ, toutes modifiables).
// sdpParLogement : surface de plancher par logement, circulations comprises en collectif.
export const PROGRAMMES = {
  individuel: { nom: 'Maisons individuelles', emprise: 25, niveaux: 1, sdpParLogement: 110, shab: 0.92 },
  intermediaire: { nom: 'Intermédiaire (R+1)', emprise: 35, niveaux: 2, sdpParLogement: 85, shab: 0.88 },
  collectif: { nom: 'Petit collectif (R+2)', emprise: 40, niveaux: 3, sdpParLogement: 80, shab: 0.82 },
  collectifHaut: { nom: 'Collectif (R+3)', emprise: 45, niveaux: 4, sdpParLogement: 78, shab: 0.82 },
};

export const PART_SOCIALE_DEFAUT = 25; // loi SRU ; un secteur de mixité sociale peut imposer autre chose

const CLE_REGLES = 'noee.regles-plu.v1';
export function chargerRegles() {
  try { return JSON.parse(localStorage.getItem(CLE_REGLES) || '{}'); } catch { return {}; }
}
export function enregistrerRegle(cle, valeurs) {
  const r = chargerRegles();
  if (valeurs) r[cle] = valeurs; else delete r[cle];
  try { localStorage.setItem(CLE_REGLES, JSON.stringify(r)); } catch { /* navigation privée */ }
  return r;
}

export const niveauxDepuisHauteur = (h) => (Number(h) > 0 ? Math.max(1, Math.floor(Number(h) / 3)) : null);

/** Le collectif est-il plausible ? Orientation tirée du libellé de zone, jamais une autorisation. */
export function collectifPlausible(libelle, typezone) {
  if (!zoneInfo(typezone).constructible) return { niveau: 'non', texte: 'Non : zone inconstructible.' };
  const l = String(libelle || '').toUpperCase();
  if (/^U[AB]/.test(l)) return { niveau: 'oui', texte: 'Plausible : zone urbaine dense (centre, faubourg).' };
  if (/^U/.test(l)) return { niveau: 'peutetre', texte: 'À vérifier : zone urbaine souvent pavillonnaire.' };
  if (/^\d*AU/.test(l)) return { niveau: 'peutetre', texte: 'Selon l’OAP du secteur : le collectif est fréquent en zone AU.' };
  return { niveau: 'peutetre', texte: 'À vérifier au règlement.' };
}

/**
 * @param parcelles [{ insee, surface, zones:[{libelle, typezone, reglement}] , prescriptions:[...] }]
 * @param hyp       { emprise, niveaux, sdpParLogement, partSociale, shab }
 * @param regles    { 'insee|libelle': { emprise, hauteurM, niveaux, partSociale, source } }
 */
export function capacite(parcelles, hyp, regles = {}) {
  const total = parcelles.reduce((a, p) => a + p.surface, 0);
  const parZone = {};
  for (const p of parcelles) {
    const z = p.zones?.[0];
    const libelle = z?.libelle || '?';
    const cle = `${p.insee}|${libelle}`;
    parZone[cle] ||= { cle, libelle, typezone: z?.typezone || '?', insee: p.insee, surface: 0, reglement: z?.reglement || null };
    parZone[cle].surface += p.surface;
  }
  let surfaceConstructible = 0;
  let sdp = 0;
  let zonesReglees = 0;
  const parts = [];
  for (const info of Object.values(parZone)) {
    const r = regles[info.cle] || null;
    info.regle = r;
    info.constructible = zoneInfo(info.typezone).constructible;
    if (!info.constructible) continue;
    surfaceConstructible += info.surface;
    const emprise = r?.emprise ?? hyp.emprise;
    const niveaux = r?.niveaux ?? niveauxDepuisHauteur(r?.hauteurM) ?? hyp.niveaux;
    info.empriseUtilisee = emprise;
    info.niveauxUtilises = niveaux;
    sdp += info.surface * (Math.min(100, Math.max(0, Number(emprise) || 0)) / 100) * Math.max(0, Number(niveaux) || 0);
    if (r) zonesReglees++;
    if (r?.partSociale != null && r.partSociale !== '') parts.push(Number(r.partSociale));
  }
  const parLogement = Math.max(1, Number(hyp.sdpParLogement) || 1);
  const logements = Math.floor(sdp / parLogement);
  const partReglement = parts.length ? Math.max(...parts) : null;
  const part = Math.min(100, Math.max(0, Number(partReglement ?? hyp.partSociale) || 0));
  const sociaux = Math.round((logements * part) / 100);

  const vus = new Set();
  const mixite = [];
  for (const p of parcelles) {
    for (const pr of p.prescriptions || []) {
      if (!/mixit|socia/i.test(`${pr.libelle || ''} ${pr.txt || ''}`)) continue;
      const k = `${pr.libelle}|${pr.txt || ''}`;
      if (!vus.has(k)) { vus.add(k); mixite.push(pr); }
    }
  }
  let dominante = null;
  for (const info of Object.values(parZone)) if (!dominante || info.surface > dominante.surface) dominante = info;
  return {
    total, parZone: Object.values(parZone), surfaceConstructible, sdp: Math.round(sdp), logements, sociaux, part,
    partReglement, zonesReglees, mixite, collectif: dominante ? collectifPlausible(dominante.libelle, dominante.typezone) : null,
  };
}

/**
 * Bilan promoteur à rebours : ce qu'un promoteur peut payer le terrain.
 * CA = surface habitable vendue × prix au m² ; sociaux vendus à un bailleur (prix plafonné).
 */
export function bilanPromoteur({ sdp, logements, sociaux, shab = 0.82, prixLibreM2, prixSocialM2 = 2600, coutConstructionM2 = 2100, fraisAnnexes = 0.12, fraisVente = 0.08, marge = 0.10 }) {
  if (!sdp || !prixLibreM2) return null;
  const shabTotale = sdp * shab;
  const partSociale = logements ? sociaux / logements : 0;
  const caLibre = shabTotale * (1 - partSociale) * prixLibreM2;
  const caSocial = shabTotale * partSociale * prixSocialM2;
  const ca = caLibre + caSocial;
  const construction = sdp * coutConstructionM2;
  const annexes = construction * fraisAnnexes;
  const vente = ca * fraisVente;
  const margeEur = ca * marge;
  const chargeFonciere = ca - construction - annexes - vente - margeEur;
  const r = (x) => Math.round(x / 1000) * 1000;
  return { shab: Math.round(shabTotale), ca: r(ca), caLibre: r(caLibre), caSocial: r(caSocial), construction: r(construction), annexes: r(annexes), vente: r(vente), marge: r(margeEur), chargeFonciere: r(chargeFonciere) };
}
