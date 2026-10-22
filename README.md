# Noéé

Site d’estimation immobilière et de test de division de terrain, sur le modèle de Mansion Aquitaine, pour la côte landaise et le Pays basque.

Aucun framework ni abonnement : des pages HTML statiques, du JavaScript moderne et uniquement des données publiques et gratuites. Le site s’héberge sur Vercel, Firebase ou Netlify.

## Ce que fait le site

| Page | Rôle |
|---|---|
| `/` | Accueil : photo aérienne IGN en fond, recherche d’adresse, deux outils, sources, communes |
| `/vendre/` | **Estimateur en 7 étapes** : adresse, type, surfaces, état et DPE, projet, coordonnées, résultat |
| `/division/` | **Simulateur de division** : parcelle cadastrale, zone du PLU, bâtiments, surface détachable, lots, gain estimé |
| `/vendre/<commune>/` | Une page SEO par commune : prix médians par type et évolution par année (générée) |
| `/communes/` | Liste des communes couvertes |
| `/biens/` | Tes biens à vendre (fichier `public/data/biens.json`) |
| `/admin/` | Contacts reçus dans ce navigateur, export CSV (non indexé) |

### Liens de pub pré-remplis (comme leur campagne Instagram)

```
https://ton-site.fr/vendre/?adresse=Capbreton&lat=43.6388&lon=-1.4200&insee=40065&utm_source=instagram&utm_medium=organique&utm_campaign=division#estimation
https://ton-site.fr/division/?adresse=12%20rue%20des%20Pins%20Capbreton&utm_source=facebook&utm_campaign=terrains
```

Les paramètres `utm_*` sont enregistrés avec chaque contact. Ajoute `&pro=1` à `/vendre/` pour ton usage perso : l’étape coordonnées est sautée et rien n’est enregistré.

## En ligne

**https://hach2208.github.io/noee/** : publié automatiquement par GitHub Pages à chaque modification poussée sur `main`, et le 3 de chaque mois pour récupérer les nouvelles ventes DVF (`.github/workflows/publier.yml`). Pour relancer à la main : onglet **Actions**, puis **Publier Noéé**, puis **Run workflow**.

### Sur le téléphone

Ouvre **https://hach2208.github.io/noee/installer/**. La page explique l’installation sur iPhone (Safari, Partager, Sur l’écran d’accueil) et sur Android (bouton Installer). Elle propose aussi le **mode perso** : sur ce téléphone, l’estimation saute l’étape coordonnées et n’enregistre rien.

Un appui long sur l’icône (Android) donne trois raccourcis : Estimer, Division, Contacts.

## Démarrage en local

Il faut Node 18 ou plus récent.

```bash
npm run build      # télécharge les ventes DVF des Landes et des Pyrénées-Atlantiques, puis génère les pages communes
npm run dev        # http://localhost:5173
```

`npm run build` enchaîne deux étapes :

- `npm run data` télécharge les fichiers geo-dvf (data.gouv) des 5 dernières années et la liste des communes (geo.api.gouv.fr). Il écrit un JSON compact par commune dans `public/data/dvf/`. Autres départements : `npm run data -- --deps 40,64,33`.
- `npm run pages` génère `/vendre/<commune>/`, la liste des communes, le `sitemap.xml` et le `robots.txt`. Mets ton domaine avec `NOEE_SITE=https://ton-site.fr npm run pages`.

Relance `npm run build` tous les 6 mois, quand data.gouv publie un nouveau millésime DVF (avril et octobre).

## Personnaliser

Tout est dans **`public/assets/js/config.js`** :

- `marque` : nom, téléphone, WhatsApp, e-mail, Instagram, adresse
- `carte` : centre et zoom par défaut
- `departements` : départements couverts
- `estimation` et `coefficients` : période, rayons, et le poids de l’état, du DPE, de la piscine, de la vue…
- `division` : coûts (géomètre, viabilisation, accès) et règles par défaut par type de zone PLU
- `leads` : où envoyer les contacts

Les couleurs sont en haut de `public/assets/css/noee.css` (`--ocean`, `--resine`…). Les mentions légales sont à compléter dans `public/mentions-legales/index.html` (les champs entre crochets).

### Biens à vendre

`public/data/biens.json` :

```json
[
  { "titre": "Maison landaise avec piscine", "prix": 890000, "ville": "Capbreton", "surface": 140, "terrain": 900, "pieces": 6,
    "statut": "Nouveauté", "photo": "/img/biens/capbreton-1.jpg", "lien": "https://…" }
]
```

## Recevoir les contacts

Sans configuration, les contacts restent dans le navigateur de la personne. **Ce n’est utile qu’en test.** En production, active au moins une des deux options :

**Supabase** (gratuit) :

1. Crée un projet sur supabase.com.
2. Dans SQL Editor, colle `supabase/schema.sql` et exécute-le. Le site peut seulement ajouter des contacts, jamais les lire.
3. Dans `config.js`, renseigne `leads.supabaseUrl` et `leads.supabaseAnonKey` (Project Settings > API).
4. Les contacts arrivent dans la table `leads`. Le détail complet du bien et du calcul est dans la colonne `donnees`.

**Webhook** (Make, n8n, Zapier) : renseigne `leads.webhookUrl`. Chaque contact y est envoyé en JSON. Tu peux en faire un e-mail, un SMS ou une ligne Google Sheets.

## Mise en ligne

**Vercel** : `vercel.json` est fourni. Lance `npm run build` en local, puis publie avec `vercel --prod` ou pousse sur GitHub. Le dossier publié est `public/`.

**Firebase** : `firebase.json` est fourni. Lance `firebase deploy --only hosting`.

## Comment sont faits les calculs

### Estimation

1. **Ventes** : on garde les ventes d’une seule maison ou d’un seul appartement (dépendances tolérées), et les terrains nus. Sont exclus les ventes de plusieurs logements, les locaux commerciaux, les échanges et les valeurs aberrantes.
2. **Comparables** : même type de bien, surface à ±35 %, 36 derniers mois. Le rayon s’élargit (400 m, 800 m, 1,5 km, 3 km, 6 km, 12 km) jusqu’à trouver 8 ventes.
3. **Prix au m²** : médiane pondérée. Une vente compte davantage si elle est récente, proche et de surface voisine.
4. **Corrections** : état, DPE, piscine, garage, extérieur, vue, étage sans ascenseur (réglables dans `config.js`). Pour une maison, le terrain est comparé à la médiane des ventes comparables, et l’écart est valorisé à 35 % du prix local des terrains.
5. **Fourchette** : bornée à ±5–15 % selon la dispersion des prix. La fiabilité (élevée, moyenne, faible) dépend du nombre de ventes, du rayon et de la dispersion.

### Division

1. **Parcelle** : la parcelle cadastrale de l’adresse (API Carto IGN). On peut toucher les parcelles voisines pour former l’unité foncière.
2. **Urbanisme** : zone du PLU, lien vers le règlement, prescriptions dont les espaces boisés classés (Géoportail de l’urbanisme). La commune est aussi vérifiée au RNU.
3. **Bâtiments** : emprise au sol de la maison et des annexes (BD TOPO, WFS Géoplateforme).
4. **Surface à garder pour la maison** : la plus grande de quatre valeurs.
   - L’emprise au sol divisée par l’emprise maximale autorisée.
   - La surface d’une bande autour du bâti.
   - La surface minimale d’un lot.
   - 2,2 fois l’emprise au sol.
5. **Surface détachable** : la surface du terrain, moins la surface à garder, moins l’accès à créer.
6. **Forme du terrain** : on applique les retraits des limites et du bâti. On vérifie ensuite qu’un carré de 10 m tient dans ce qui reste. La zone en vert sur la carte montre où une maison peut tenir.
7. **Gain estimé** : la vente des lots, au prix des terrains à bâtir vendus autour.
   - Moins les frais de géomètre, de viabilisation et d’accès.
   - Moins la valeur perdue par la maison, dont le jardin est réduit.

Les règles de zone sont **préremplies par type de zone** (U, AU, A, N). Elles sont modifiables dans l’outil, au pas « Règles appliquées au calcul ». Pour une étude sérieuse, saisis l’emprise au sol et les reculs tirés du règlement PDF de la zone.

## Sources des données

| Donnée | Source | Accès |
|---|---|---|
| Ventes | DVF géolocalisées (Etalab, data.gouv.fr) | Fichiers préparés par `npm run data` |
| Adresses | BAN via la Géoplateforme (`data.geopf.fr/geocodage`) | Navigateur, ancienne API Adresse en secours |
| Parcelles | API Carto, module cadastre | Navigateur |
| PLU | API Carto, module GPU | Navigateur |
| Bâtiments | BD TOPO, WFS Géoplateforme | Navigateur |
| Fonds de carte | Orthophotos, plan IGN, cadastre (WMTS Géoplateforme) | Navigateur |

DVF : les conditions de réutilisation interdisent de rendre les ventes individuelles trouvables par les moteurs de recherche. C’est pourquoi les pages communes n’affichent que des médianes. La liste détaillée des ventes n’apparaît que dans le résultat d’estimation, qui n’est pas indexé.

## Structure

```
public/
  index.html, vendre/, division/, communes/, biens/, admin/, mentions-legales/, 404.html
  assets/css/noee.css
  assets/js/
    config.js         ← tes réglages
    api.js            accès aux données publiques
    dvf-core.js       lecture et agrégation DVF (partagé navigateur / Node)
    estimate.js       moteur d'estimation
    division-calc.js  moteur de division (Turf.js)
    page-vendre.js, page-division.js, ui.js, leads.js
  vendor/             Leaflet 1.9.4, Turf 7.1.0, police Archivo (hébergés localement)
  data/               généré par npm run data
scripts/              build-data.mjs, build-pages.mjs, serve.mjs
supabase/schema.sql
tests/                npm test
```
