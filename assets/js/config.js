// ─────────────────────────────────────────────────────────────
// Noéé : configuration centrale. Tout ce qui est propre à toi est ici.
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  marque: {
    nom: 'Noéé',
    signature: 'Le juste prix de la côte landaise.',
    telephone: '06 00 00 00 00',          // ← à remplacer
    telephoneIntl: '33600000000',          // ← pour WhatsApp (sans +)
    email: 'contact@noee.fr',              // ← à remplacer
    instagram: 'noee.immo',                // ← à remplacer
    ville: 'Capbreton',
    adresse: 'Capbreton, 40130',           // ← adresse affichée en pied de page
  },

  // Centre et zoom par défaut de la carte (Capbreton / Hossegor)
  carte: { lat: 43.6400, lon: -1.4280, zoom: 13 },

  // Départements couverts par le script de données (npm run data)
  departements: ['40', '64'],

  // Estimation
  estimation: {
    moisHistorique: 36,       // ventes des 36 derniers mois
    minComparables: 8,        // on élargit le rayon tant qu'on n'a pas ce nombre
    rayons: [400, 800, 1500, 3000, 6000, 12000], // mètres
    toleranceSurface: 0.35,   // ±35 % autour de la surface saisie
  },

  // Coefficients appliqués au prix médian au m² des ventes comparables
  coefficients: {
    etat: { renover: -0.17, rafraichir: -0.07, bon: 0, refait: 0.05, neuf: 0.10 },
    dpe: { A: 0.06, B: 0.04, C: 0.01, D: 0, E: -0.03, F: -0.08, G: -0.12, inconnu: 0 },
    piscine: 0.05,
    vue: 0.10,          // vue mer / lac / golf
    garage: 0.02,
    exterieurAppart: 0.04, // balcon / terrasse / jardin pour un appartement
    ascenseurManquantEtage3: -0.05,
  },

  // Division : coûts moyens indicatifs (à ajuster à ton secteur)
  division: {
    coutGeometre: 3500,          // bornage + plan de division
    coutViabilisationLot: 15000, // eau, élec, assainissement, télécom
    coutAccesM2: 60,             // création d'un accès (€/m²)
    largeurAcces: 3.5,           // mètres
    lotCibleM2: 450,             // surface visée d'un lot à bâtir
    // Règles par défaut selon le type de zone PLU (modifiables dans l'outil)
    reglesParZone: {
      U:   { ces: 40, lotMin: 300, recul: 3, constructible: true },
      AUc: { ces: 30, lotMin: 400, recul: 4, constructible: true },
      AUs: { ces: 0,  lotMin: 0,   recul: 4, constructible: false },
      A:   { ces: 0,  lotMin: 0,   recul: 5, constructible: false },
      N:   { ces: 0,  lotMin: 0,   recul: 5, constructible: false },
      RNU: { ces: 30, lotMin: 400, recul: 4, constructible: true },
    },
  },

  // Où envoyer les contacts (leads). Laisse vide ce que tu n'utilises pas :
  // sans rien de rempli, ils sont gardés dans le navigateur et visibles sur /admin/.
  leads: {
    supabaseUrl: '',      // ex. https://xxxx.supabase.co
    supabaseAnonKey: '',  // clé « anon public »
    webhookUrl: '',       // ex. scénario Make / n8n / Zapier qui t'envoie un mail
  },

  // Sources des données publiques (Géoplateforme IGN, data.gouv)
  api: {
    geocodage: [
      'https://data.geopf.fr/geocodage/search',
      'https://api-adresse.data.gouv.fr/search/',
    ],
    cadastre: 'https://apicarto.ign.fr/api/cadastre/parcelle',
    gpu: 'https://apicarto.ign.fr/api/gpu',
    wfs: 'https://data.geopf.fr/wfs/ows',
    wmts: 'https://data.geopf.fr/wmts',
    dvfLocal: '/noee/data/dvf',               // généré par npm run data
    dvfDistant: 'https://files.data.gouv.fr/geo-dvf/latest/csv', // secours, direct navigateur
  },
};
