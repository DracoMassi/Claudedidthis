# Spec : site Séquentia (génération, relecture et bibliothèque de fiches)

Date : 2026-10-26
Statut : validée par Massinissa ; mise à jour le 2026-10-26 (mode sombre et thèmes modifiables)
Chemin recommandé : `docs/superpowers/specs/2026-10-26-sequentia-site-design.md` dans le dépôt `Fiches` (privé), tant que le dépôt du site n'existe pas.

## 1. Objectif et contexte

Le pipeline actuel (`orchestrate.py`, `render.py`, `template.html`, `validate.py`) tourne sur un ordinateur. Massinissa travaille surtout sur iPad, gratuitement, avec 30 minutes par jour au maximum. Il veut un **site hébergé sur GitHub** qui permet, depuis l'iPad, de :

1. **Générer** une fiche à partir d'un brief ;
2. **Relire** et corriger les fiches générées avant de les valider ;
3. **Parcourir et exporter** les fiches validées (bibliothèque) ;

et d'**importer ses cours** (PDF, images, texte) sous forme de fichiers Markdown qui servent de source à la génération.

Les trois usages ont le même poids. Ils manipulent un seul objet, la fiche JSON, qui suit le cycle : brief, brouillon (`a_verifier`), relue et validée (`verifie`), bibliothèque.

Critère de réussite : en moins de 30 minutes, passer d'un brief à une fiche relue, validée et exportée, depuis l'iPad, sans rien installer.

## 2. Ce qui a été dit et ce qui est supposé

**Dit par Massinissa :**
- site sur GitHub pour la suite du pipeline ; design propre proche de l'univers de ses fiches ;
- usage surtout sur iPad ; gratuit ; 30 minutes par jour ;
- les trois usages (générer, relire, bibliothèque) à parts égales ;
- peur du poids sur GitHub : les JSON temporaires lui conviendraient ;
- approche A retenue : tout dans le navigateur ;
- look temporaire : mélange A (quadrillé) et C (rose poudré) ;
- ses cours doivent pouvoir être envoyés pour devenir des `.md` ;
- pas de second avis automatique sur les QCM.

**Hypothèses (à corriger si besoin) :**
- le site est statique, sans serveur ni compte ;
- il réutilise le schéma JSON et le moteur de rendu (`template.html` et KaTeX) existants ;
- les images ne sont jamais enregistrées dans git ;
- la clé Gemini et le jeton GitHub restent sur l'appareil.

## 3. Hors périmètre (version 1)

- aucun serveur, aucun compte, aucun paiement ;
- pas de service worker : le site ne se recharge pas hors connexion ;
- pas d'export HD via GitHub Actions (approche C, éventuelle version 2) ;
- pas de vidéo, d'audio ni de génération d'images ;
- pas de partage public des fiches ;
- pas d'éditeur visuel complet : édition par bloc seulement ;
- pas de personnalisation des fiches elles-mêmes par le thème de l'app (les fiches gardent leur charte) ;
- pas de second avis automatique sur les QCM ;
- pas de lecture directe des fichiers Word (export préalable en PDF).

## 4. Architecture

### 4.1 Deux dépôts

| | `sequentia-site` (public, GitHub Pages) | `Fiches` (privé, existant) |
|---|---|---|
| Rôle | Code de l'app uniquement | Données et contenu |
| Contient | Interface, moteur de rendu, KaTeX local, copie du `schema.json` | `charte.md`, fiches validées, cours en Markdown, polices |
| Secrets | Aucun | Aucun dans le code |

Raison du découpage : avec un compte GitHub Free, un site Pages exige un dépôt public. Tout ce qui est privé (fiches, cours, polices dont la licence n'est pas vérifiée) reste donc dans `Fiches`, lu et écrit par l'API GitHub avec un jeton.

### 4.2 Stockage sur l'appareil

| Donnée | Lieu | Durée |
|---|---|---|
| Clé Gemini, jeton GitHub, réglages | `localStorage` | jusqu'à « Effacer mes clés » |
| Brouillons de fiches, file d'import des cours, cache de la bibliothèque | IndexedDB | jusqu'à validation ou suppression |

Sur iPad, Safari peut effacer ces données après une longue inactivité, sauf si le site est ajouté à l'écran d'accueil (à vérifier). Chaque brouillon propose donc « Exporter le JSON ».

### 4.3 Disposition du dépôt privé `Fiches`

```
charte.md
corpus/json/<matiere>/<slug>.json     fiches validées (statut verifie)
corpus/cours/<matiere>/<slug>.md      cours transcrits
fonts/                                Andaluz-Regular.otf, melbourne*.ttf
```

Les brouillons ne sont pas dans ce dépôt. Les images (PNG, PDF) n'y sont jamais.

### 4.4 Schéma général

```
        iPad / PC (Safari)
 ┌─────────────────────────────────────────────┐
 │ sequentia-site (GitHub Pages, public)       │
 │  Générer · Relire · Bibliothèque · Cours    │
 │  Moteur de rendu partagé · Export           │
 │  Appareil : clé Gemini, jeton, brouillons   │
 └────────┬─────────────────────────┬──────────┘
          │ génération              │ lecture / écriture
          ▼                         ▼
   API Gemini (gratuit)       Fiches (privé)
```

## 5. Modèle de données

### 5.1 Fiche JSON : évolutions du schéma

Le schéma actuel (`schema.json`, version `1.0`) est conservé. Ajouts, tous optionnels (`meta.format` vaut `fiche` par défaut) :

- `meta.format` : `fiche` (A4 portrait) ou `post` (4:5, 1080×1350) ;
- `meta.exemple` : booléen, marque une fiche comme exemple de style ;
- `meta.brief` : copie du brief utilisé, pour « Refaire à partir de ce brief » ;
- nouveau bloc `proprietes` : `titre`, puis une liste de `{ nom, enonce }` (Linéarité, Positivité, Chasles, etc.) ;
- nouveau bloc `figure` : `svg` (chaîne), `legende` (chaîne).

Règles inchangées : `formule.latex` ne contient jamais de `$` ; LaTeX avec les macros de la charte ; `statut` vaut `a_verifier` ou `verifie`. `schema_version` passe à `1.1`.

### 5.2 Cours en Markdown

```markdown
---
matiere: maths
niveau: mpsi
chapitre: Continuité
source: cours-continuite.pdf (p. 1-12)
statut: a_verifier
---
# Continuité
## Continuité en un point
> **Définition.** …
```

L'app découpe chaque cours selon ses titres `##`. Les sections sont les unités de sélection pour la génération.

### 5.3 Brief

Champs : `id`, `matiere`, `niveau`, `chapitre`, `sujet`, `format`, `contenu_obligatoire`, `pieges`, `exemples`, `nb_qcm`, `themes_qcm`, `exclure`, `consignes`. Le formulaire du module Générer produit ce JSON ; l'import d'un brief existant est possible.

### 5.4 Cycle de vie et statuts

```
brief → brouillon (appareil, a_verifier) → Valider → JSON verifie dans Fiches
```

Modifier une fiche validée la rouvre dans Relire ; Valider crée un nouveau commit.

## 6. Modules

Chaque module a un rôle unique et une interface claire.

| Module | Rôle | Entrées | Sorties | Dépend de |
|---|---|---|---|---|
| Réglages | Clés, jeton, modèle, plafonds, thème et mode, test de connexion | saisie | `localStorage` | aucun |
| Générer | Brief vers brouillon vérifié | brief, charte, exemples, cours | brouillon | Réglages, Moteur de rendu, Accès dépôt, API Gemini |
| Cours | Fichiers vers Markdown relu | PDF, images, texte | `.md` dans `Fiches` | Réglages, API Gemini, Accès dépôt |
| Relire | Édition et validation | brouillon ou fiche | JSON `verifie` | Moteur de rendu, Accès dépôt |
| Bibliothèque | Liste, filtres, ouverture, export | index du dépôt | actions | Accès dépôt, Export |
| Moteur de rendu | JSON vers pages (KaTeX, formats `fiche` et `post`), contrôles | JSON | DOM, erreurs KaTeX, débordement | KaTeX local, polices |
| Export | PDF et PNG | pages rendues | fichiers | Moteur de rendu |
| Accès dépôt | Lecture et écriture via l'API GitHub | jeton | fichiers, index | Réglages |

## 7. Flux

### 7.1 Générer

1. Le formulaire produit le brief.
2. L'app assemble le contexte, lu dans `Fiches` : `charte.md`, le schéma, **2 fiches validées** de la même matière (priorité à `meta.exemple`, puis proximité de mots-clés avec le sujet), et les **3 sections de cours** les plus proches du sujet (cours `verifie` en priorité).
3. Appel de Gemini ; le modèle est réglable dans Réglages, avec pour défaut celui de `orchestrate.py` actuel.
4. **Boucle de vérification**, 4 tours au maximum : JSON valide ; schéma (Ajv, JSON Schema 2020-12) ; lint LaTeX (mêmes règles que `orchestrate.py`) ; rendu et erreurs KaTeX ; débordement de page. À chaque échec, la liste des problèmes repart à Gemini.
5. Résultat : brouillon `a_verifier`. Si le 4ᵉ tour échoue, le dernier essai est conservé avec la liste des problèmes restants.

Un compteur local de requêtes protège le quota gratuit ; les plafonds se règlent dans Réglages.

### 7.2 Importer un cours

1. Envoi depuis « Choisir dans Fichiers » (plusieurs fichiers possibles) ou l'appareil photo. Les PDF restent sur l'appareil. Les `.md`, `.tex`, `.txt` et le texte collé sont enregistrés sans conversion.
2. Découpage des PDF en lots de quelques pages (taille réglable) dans le navigateur.
3. Gemini transcrit chaque lot en Markdown : formules en `$…$` avec les macros de la charte, aucune invention, `[illisible]` en cas de doute, figures remplacées par une légende entre crochets.
4. Contrôles automatiques : erreurs KaTeX, titres manquants, pages vides, nombre de `[illisible]`.
5. Relecture côte à côte (page source et rendu).
6. Enregistrement dans `corpus/cours/<matiere>/<slug>.md`.

La file d'import est reprenable : la progression est sauvegardée dans IndexedDB, un chapitre à la fois, avec un plafond quotidien local.

### 7.3 Relire et valider

- Deux colonnes sur iPad en paysage (édition par bloc, aperçu), deux onglets en portrait. Le JSON brut reste accessible.
- Bandeau de contrôles automatiques (schéma, KaTeX, débordement).
- « Corriger avec Gemini » : consigne libre, qui relance la boucle de vérification.
- **Checklist de relecture** : lue dans `charte.md` sous le titre `## Checklist de relecture` (liste à puces) ; à défaut, liste par défaut : hypothèses explicites (intervalle, `a ≤ b`), quantificateurs, notations et macros.
- **Valider n'est actif que lorsque toutes les cases sont cochées.**
- Valider écrit le JSON (statut `verifie`) dans `Fiches`. Si le fichier a changé entre-temps, l'app propose : comparer, écraser ou annuler.

### 7.4 Bibliothèque

- Un seul appel à l'API des arbres Git liste fiches et cours ; l'index est mis en cache.
- Filtres : matière, niveau, chapitre, statut ; recherche texte.
- Actions : ouvrir, exporter, modifier, refaire à partir du brief (`meta.brief`), marquer comme exemple de style.

### 7.5 Export

- **PDF** par l'impression de Safari (`@page` aux dimensions du format), puis « Enregistrer dans Fichiers ». Export principal.
- **PNG** page par page avec modern-screenshot. L'échelle est choisie pour que la surface du canevas reste sous la limite connue de Safari (4096 × 4096 pixels, valeur indicative qui dépend de la mémoire de l'appareil).
- Aucun export n'est enregistré dans git.

## 8. Design visuel (thèmes et mode sombre)

Le design doit pouvoir changer facilement : toutes les couleurs sont des variables, regroupées dans des **thèmes** (préréglages). Changer le look se fait dans Réglages, sans toucher au code, ou en modifiant un seul objet dans `src/theme/themes.ts`.

- **Préréglages :** `ac` (A+C, défaut), `a` (quadrillé sur fond blanc), `b` (épuré), `c` (rose poudré). Chacun existe en clair et en sombre.
- **Mode :** `auto` (suit le réglage de l'iPad, défaut), `clair` ou `sombre`.
- **Personnalisation :** dans Réglages, cinq couleurs modifiables pour le mode en cours (fond, cartes, accent, texte, logo), avec un avertissement de contraste faible et un bouton « Réinitialiser le thème ».
- **Les fiches ne changent pas :** l'aperçu et les exports des fiches gardent leur propre charte (fond blanc, rouges Séquentia), quels que soient le thème et le mode de l'app.

Variables (valeurs du préréglage `ac`) :

| Variable | Clair | Sombre | Usage |
|---|---|---|---|
| `--page-bg` | `#F8E8EC` | `#1F1418` | fond |
| `--grid-line` | `#EFCDD5` | `#2B1C22` | quadrillé (pas de 18 px) |
| `--card` | `#FFFFFF` | `#2A1B21` | cartes et panneaux |
| `--card-border` | `#E4B9C2` | `#4A2F38` | contour des cartes |
| `--accent` | `#DD0033` | `#DD0033` | boutons, onglet actif (texte blanc dessus) |
| `--accent-text` | `#DD0033` | `#FF6B85` | titres en rouge |
| `--accent-dark` | `#7C011D` | `#F3B7C4` | texte sur fond rose, pastilles |
| `--logo` | `#A8586B` | `#CB8593` | marque |
| `--badge-bg` | `#F3D9DF` | `#4A2230` | pastille « à vérifier » |
| `--ok-bg` | `#E3F0DC` | `#1F3A1A` | pastille « validée » |
| `--ok-text` | `#27500A` | `#A8D890` | texte de la pastille « validée » |
| `--text` | `#1B1B1B` | `#F3E6E9` | texte |

Écarts des autres préréglages (clair) : `a` a `--page-bg: #FFFFFF`, `--grid-line: #EBD2D8`, `--logo: #CB8593` ; `b` a `--page-bg: #FFFFFF`, `--grid-line: transparent`, `--card-border: #E6E6E6`, `--logo: #CB8593` ; `c` a `--grid-line: transparent`. En sombre, les quatre préréglages partagent les valeurs ci-dessus, `b` et `c` sans quadrillé (`--grid-line: transparent`).

Contraste mesuré (WCAG) : texte au moins 4,5:1, titres en rouge (`--accent-text`) au moins 3:1 ; le logo est décoratif et exempt. Préréglage `ac` en clair : texte/fond 14,55, titre rouge/fond 4,30, blanc/accent 5,09. En sombre : texte/fond 14,77, titre rouge/fond 6,57, pastille 7,92.

Règles : le quadrillé couvre le fond de Générer, Bibliothèque et Cours ; **la zone de relecture est faite de panneaux (`--card`), sans quadrillé derrière le texte**. Polices : Andaluz pour les titres, Melbourne ou Inter pour le reste (répartition à confirmer) ; Andaluz et Melbourne sont chargées depuis `Fiches` au lancement (API `FontFace`), avec Inter en repli.

## 9. Erreurs

| Situation | Message |
|---|---|
| Clé ou jeton absent ou expiré | « Ajoute ta clé Gemini dans Réglages », avec « Tester la connexion » |
| Quota gratuit atteint (429) | « Quota atteint. Réessaie dans N secondes » |
| Gemini ne répond pas (y compris erreur CORS masquant un 503) | « Gemini n'a pas répondu. Réessayer » (jamais « clé invalide » à tort) |
| Fiche modifiée ailleurs | « Cette fiche a changé. Comparer, écraser ou annuler » |
| Hors connexion | Données déjà chargées consultables ; l'enregistrement est refusé avec un message ; le brouillon est conservé |
| Données Safari effacées | Brouillons perdus ; « Exporter le JSON » disponible sur chaque brouillon |

Chaque message dit ce qui s'est passé puis quoi faire, sans jargon.

## 10. Sécurité

- La clé Gemini et le jeton ne quittent l'appareil que vers Google et GitHub.
- Le jeton est un jeton à granularité fine, limité au dépôt `Fiches` (permission Contents, lecture et écriture), avec une date d'expiration. « Effacer mes clés » est disponible dans Réglages.
- Une politique de sécurité du contenu (balise `meta`) limite les connexions à `api.github.com` et à l'API Gemini. Aucun script tiers : tout est dans le bundle.
- Le texte produit par Gemini est inséré comme texte, jamais comme HTML. Les SVG des blocs `figure` sont filtrés avant affichage.
- Le dépôt public ne contient aucune fiche, aucun cours, aucune police.

## 11. Tests

- **Parité avec `validate.py`** : sur toutes les fiches de `corpus/json/`, le validateur du site rend les mêmes verdicts.
- **Tests automatiques** (Node, jsdom) : schéma, lint LaTeX, découpage des cours, rendu KaTeX avec les macros, détection d'une commande LaTeX inconnue. Ils tournent à chaque envoi dans le dépôt public (GitHub Actions est gratuit pour les dépôts publics).
- **Contraste** : pour chaque préréglage et chaque mode, texte/fond et texte/carte au moins 4,5:1, titre rouge/fond au moins 3:1, blanc/accent au moins 4,5:1.
- **Contrôle manuel sur l'iPad** : export PDF, export PNG, chargement des polices, ajout à l'écran d'accueil, bascule clair/sombre (manuelle et avec le réglage du système).

## 12. Risques à vérifier tôt

1. **Export PNG sur Safari** : peut produire des images blanches. Premier essai technique de la construction ; repli : PDF seul.
2. **Appel de Gemini depuis le navigateur** : Google le réserve au prototypage (clé exposée au navigateur) ; acceptable ici car la clé est personnelle et reste sur l'appareil. Vérifier tôt que les appels fonctionnent depuis Safari.
3. **Pages gratuit public** : aucun contenu privé dans le dépôt du site.
4. **Licence des polices Melbourne** : non vérifiée, d'où le chargement depuis le dépôt privé.
5. **Précision des cours transcrits** : la transcription de formules par IA peut se tromper ; relecture obligatoire avant le statut `verifie`.

## 13. Décisions prises par défaut (à relire)

- Valider exige toutes les cases de la checklist cochées.
- La checklist est lue dans `charte.md` (section dédiée), avec une liste par défaut.
- `meta.brief` conserve le brief dans la fiche validée (quelques centaines d'octets).
- Les blocs `figure` sont ajoutés à la main (SVG collé) en version 1 ; Gemini produit `proprietes` mais pas `figure`.
- Pas de service worker : le site ne se recharge pas hors connexion.
- Mode `auto` par défaut (suit le système) ; préréglage `ac` par défaut.
- Les fiches (aperçu et exports) gardent leur charte, indépendante du thème de l'app.
- Personnalisation limitée à cinq couleurs ; « accent » règle `--accent` et `--accent-text` ensemble.
- Lots d'import de quelques pages (taille réglable), plafonds de requêtes réglables.

## 14. À fournir avant la construction

- le logo Séquentia (SVG ou PNG transparent) ;
- la répartition des polices : titre principal, titres de section, corps de texte ;
- les noms des deux dépôts (propriétaire et nom) ;
- un jeton GitHub à granularité fine (Contents, lecture et écriture, limité à `Fiches`), à créer au moment des essais.

## 15. Étape suivante

Après relecture de cette spec : plan d'implémentation (skill `writing-plans`), puis choix de la méthode d'exécution. Le skill `web-artifacts-builder` pourra intervenir à l'étape de construction de l'interface, selon ce plan.
