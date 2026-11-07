# Site Séquentia : plan d'implémentation

> **Pour les agents d'exécution :** utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** construire un site statique (GitHub Pages) qui génère, relit, valide et exporte des fiches JSON, et transcrit des cours en Markdown, depuis un iPad.

**Architecture :** application navigateur seule (React + TypeScript), sans serveur. Elle lit et écrit dans le dépôt privé `Fiches` par l'API GitHub, appelle Gemini avec la clé de l'utilisateur, et réutilise le moteur de rendu du `template.html` actuel (KaTeX).

**Stack :** React 18, TypeScript, Vite, Tailwind (ossature du skill `web-artifacts-builder`), Ajv (`ajv/dist/2020`), KaTeX 0.16.9, modern-screenshot, pdf-lib, pdfjs-dist, Vitest + jsdom.

**Spec :** `docs/superpowers/specs/2026-10-26-sequentia-site-design.md`

## Contraintes globales

- Site statique sans serveur, déployé sur GitHub Pages depuis le dépôt public `sequentia-site`. **Aucune fiche, aucun cours, aucune police réels dans ce dépôt** : les fixtures de test sont synthétiques.
- Données dans le dépôt privé `Fiches` : `corpus/json/<matiere>/<slug>.json`, `corpus/cours/<matiere>/<slug>.md`, `charte.md`, `fonts/`.
- La clé Gemini et le jeton ne quittent l'appareil que vers Google et GitHub. Jeton à granularité fine, permission Contents lecture et écriture, limité à `Fiches`.
- Politique de sécurité du contenu (balise `meta`) : `connect-src https://api.github.com https://generativelanguage.googleapis.com`. Aucun script tiers.
- Le texte produit par Gemini est inséré comme texte, jamais comme HTML ; les SVG sont filtrés.
- Statuts : `a_verifier`, `verifie`. **Valider n'est actif que si toutes les cases de la checklist sont cochées.**
- Boucle de vérification : 4 tours au maximum ; le dernier essai est conservé en cas d'échec.
- Formats : `fiche` (A4 portrait), `post` (1080×1350). Surface du canevas PNG au plus 4096 × 4096 pixels. Export principal : PDF par impression.
- Thème : douze variables de la spec §8 ; quatre préréglages (`ac` par défaut, `a`, `b`, `c`), chacun en clair et en sombre ; mode `auto` (suit le système), `clair` ou `sombre` ; cinq couleurs modifiables dans Réglages ; quadrillé de 18 px ; zone de relecture en panneaux sans quadrillé. **Les fiches (aperçu et exports) gardent leur charte propre, indépendante du thème et du mode.** Contraste : texte au moins 4,5:1, titres rouges au moins 3:1.
- Pas de service worker, pas de second avis QCM, aucune image enregistrée dans git.
- Messages d'erreur : textes exacts de la spec §9.
- KaTeX 0.16.9 en local. Macros : `\R \N \Z \Q \C \K \dd \e \i \abs \norm \ps \ent \inte \card \eps` (définitions du `template.html` actuel).
- Polices chargées au lancement depuis `Fiches/fonts/` : `Andaluz-Regular.otf`, `melbourne.ttf`, `melbournebold.ttf` ; Inter en repli.

**Décisions du plan, sans objet dans la spec (à relire) :** page A4 = 1240×1754 pixels CSS ; `schema_version` accepte `1.0` et `1.1` (les fiches existantes restent valides) ; plafonds par défaut 5 requêtes/minute, 100/jour, lots de 5 pages (réglables) ; déploiement par build Vite standard (pas de fichier unique), car KaTeX et les polices se servent plus simplement en fichiers séparés ; `pdfjs-dist` pour afficher la page source d'un PDF pendant la relecture d'un cours ; `accent` dans la personnalisation règle `--accent` et `--accent-text` ensemble ; en sombre, `--accent-dark` vaut `#F3B7C4`.

## Points de vigilance (Review Focus)

1. **Accents et symboles à l'écriture dans GitHub** (`∀ε`, `é`) : l'encodage base64 doit passer par UTF-8. Test épinglé en tâche 5.
2. **Réponse de Gemini enveloppée dans des balises de code, ou tronquée.** Test épinglé en tâche 9.
3. **Dépôt sans exemples ni cours** (l'état actuel de `Fiches`) : la génération doit fonctionner. Test épinglé en tâche 9.
4. **IndexedDB indisponible** (navigation privée, stockage vidé) : l'app ne plante pas. Test épinglé en tâche 4.
5. **Quota atteint (429) au milieu d'un import de cours** : reprise exacte après la pause. Test épinglé en tâche 12.

---

## Structure des fichiers

```
sequentia-site/
  index.html                       CSP, point d'entrée
  vite.config.ts, tsconfig.json, package.json
  .github/workflows/ci.yml         tests à chaque envoi
  .github/workflows/deploy.yml     build puis Pages
  src/
    main.tsx, App.tsx              navigation à 5 entrées
    theme/theme.css                valeurs par défaut (clair) et charte des fiches
    theme/themes.ts, applyTheme.ts, contrast.ts   préréglages, mode, contraste
    lib/types.ts, errors.ts
    lib/schema/schema.json, validate.ts, lint.ts
    lib/render/macros.ts, rich.ts, renderFiche.ts, sanitizeSvg.ts, formats.ts
    lib/storage/settings.ts, db.ts
    lib/github/repo.ts, fonts.ts
    lib/library/index.ts
    lib/export/pdf.ts, png.ts
    lib/gemini/client.ts, json.ts, budget.ts
    lib/generate/context.ts, loop.ts, sections.ts
    lib/relire/checklist.ts, valider.ts
    lib/cours/chunk.ts, transcribe.ts, checks.ts, queue.ts
    ui/messages.ts, Settings.tsx, ThemeSettings.tsx, Generate.tsx, Review.tsx, Library.tsx, Cours.tsx
  tests/                           un fichier par module + fixtures synthétiques
  scripts/parity.mjs               comparaison locale avec validate.py (jamais en CI)
```

---

### Tâche 1 : ossature, thème, CI

**Files:**
- Create: `package.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/theme/theme.css`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- Test: `tests/theme.test.ts`, `tests/csp.test.ts`

**Interfaces:**
- Produces : `App` avec cinq entrées de navigation (Générer, Relire, Bibliothèque, Cours, Réglages) ; variables CSS `--page-bg --grid-line --card --card-border --accent --accent-text --accent-dark --logo --badge-bg --ok-bg --ok-text --text` (valeurs claires du préréglage `ac`) ; script npm `test` (Vitest, environnement jsdom).

- [ ] **Step 1 : écrire les tests qui échouent.** `theme.css` contient `--page-bg: #F8E8EC`, `--grid-line: #EFCDD5`, `--accent: #DD0033`, `--accent-text: #DD0033`, `--accent-dark: #7C011D`, `--logo: #A8586B`, `--text: #1B1B1B` (les douze variables de la spec §8). `index.html` contient une balise CSP dont `connect-src` vaut exactement `https://api.github.com https://generativelanguage.googleapis.com` et aucun `<script src="http`.
- [ ] **Step 2 : vérifier l'échec** : `npm test` → FAIL (fichiers absents).
- [ ] **Step 3 : créer l'ossature** avec le script d'initialisation du skill `web-artifacts-builder`, puis `npm i ajv katex@0.16.9 modern-screenshot pdf-lib pdfjs-dist` et `npm i -D vitest jsdom`. Ajouter `theme.css`, la CSP dans `index.html`, `base: './'` dans `vite.config.ts`, le quadrillé en fond d'écran (SVG de 18 px) pour toutes les entrées sauf Relire.
- [ ] **Step 4 : vérifier** : `npm test` → PASS ; `npm run build` produit `dist/`.
- [ ] **Step 5 : workflows.** `ci.yml` lance `npm ci && npm test` ; `deploy.yml` construit et publie `dist/` sur Pages.
- [ ] **Step 6 : commit** `feat: ossature, thème A+C, CSP, CI`.

---

### Tâche 2 : types, erreurs, schéma et lint

**Files:**
- Create: `src/lib/types.ts`, `src/lib/errors.ts`, `src/lib/schema/schema.json`, `src/lib/schema/validate.ts`, `src/lib/schema/lint.ts`, `scripts/parity.mjs`
- Test: `tests/schema.test.ts`, `tests/lint.test.ts`, `tests/fixtures/fiche-v10.json`, `tests/fixtures/fiche-v11.json`

**Interfaces:**
- Produces (`types.ts`) : `Problem = { code: 'json'|'schema'|'lint'|'katex'|'overflow'; message: string; path?: string }`, `Statut = 'a_verifier'|'verifie'`, `Fiche`, `Brief`, `Format = 'fiche'|'post'`.
- Produces (`errors.ts`) : `RateLimitError(retryAfterSec: number)`, `AuthError`, `NetworkError`, `ConflictError`, `NotFoundError`.
- Produces : `validateFiche(data: unknown): Problem[]` ; `lintLatex(fiche: Fiche): Problem[]`.

- [ ] **Step 1 : tests.** `validateFiche(ficheV11)` et `validateFiche(ficheV10)` valent `[]` (la v1.0 n'a pas de `meta.format`). Une formule `"latex": "$2^n$"` donne un problème `schema` dont le chemin contient `latex`. `statut: 'brouillon'` donne un problème. Un bloc `proprietes` valide passe ; un bloc `figure` sans `svg` échoue. `lintLatex` signale chacun de `\usepackage`, `\begin{align}`, `\[`, `\tikz`, `\textbf`.
- [ ] **Step 2 : vérifier l'échec** : `npx vitest run tests/schema.test.ts tests/lint.test.ts` → FAIL.
- [ ] **Step 3 : implémenter.** Copier le `schema.json` actuel de `Fiches`, puis : `schema_version` ∈ {`1.0`,`1.1`} ; `meta.format` (défaut `fiche`), `meta.exemple`, `meta.brief` optionnels ; blocs `proprietes` (`titre`, `items[{nom, enonce}]`) et `figure` (`svg`, `legende`) ; `formule.latex` avec motif `^[^$]+$`. Ajv avec `ajv/dist/2020`. Les règles de lint sont celles d'`orchestrate.py`.
- [ ] **Step 4 : vérifier** : mêmes commandes → PASS.
- [ ] **Step 5 : `scripts/parity.mjs <dossier>`** affiche `OK`/`ERREUR` par fichier comme `validate.py`. Exécution manuelle sur `Fiches/corpus/json`, jamais en CI.
- [ ] **Step 6 : commit** `feat: schéma 1.1, validation, lint`.

---

### Tâche 3 : moteur de rendu

**Files:**
- Create: `src/lib/render/macros.ts`, `rich.ts`, `renderFiche.ts`, `sanitizeSvg.ts`, `formats.ts`
- Modify: `src/theme/theme.css` (bloc `[data-fiche]` : charte des fiches, fond blanc et rouges Séquentia, sans variable de l'app)
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes : `Fiche`, `Format` (tâche 2).
- Produces : `FORMATS = { fiche: { width: 1240, height: 1754 }, post: { width: 1080, height: 1350 } }` ; `renderFiche(root: HTMLElement, fiche: Fiche): { katexErrors: string[] }` ; `checkOverflow(root: HTMLElement): number[]` (numéros de pages, à partir de 1) ; `sanitizeSvg(svg: string): string` ; `renderRich(text: string, errors: string[]): DocumentFragment` (texte avec `$…$`, erreurs KaTeX ajoutées à `errors`).

- [ ] **Step 1 : tests (jsdom).** Un texte contenant `$\dd x$`, `$\e^{x}$`, `$\R$`, `$\inte{1}{n}$`, `$\abs{x}$`, `$\card(E)$` donne `katexErrors` vide. `$\commandeinconnue{x}$` donne un message contenant `Undefined control sequence`. Le texte `<img src=x onerror=alert(1)>` ne crée aucun élément `img`. `sanitizeSvg` retire `<script>`, `<foreignObject>` et tout attribut `on*`. Le titre d'un bloc théorème vaut `nom` (« Théorème fondamental »). La racine rendue porte l'attribut `data-fiche`, et le bloc `[data-fiche]` de `theme.css` ne contient aucun `var(--page-bg)`, `var(--card)` ni `var(--text)` (charte des fiches indépendante du thème de l'app). Un bloc `proprietes` affiche chaque `nom`. `checkOverflow` renvoie `[1]` quand on simule `scrollHeight > clientHeight` sur la première page.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.** Porter `rich()` et `renderFiche` du `template.html` actuel : `katex.render` par segment avec `throwOnError: true` et `strict: "error"`, macros de `macros.ts`, tout le texte inséré par `textContent`. Mise en page `fiche` : en-tête (logo, matière et niveau), titre, sections à titres ; `post` : pages 1080×1350.
- [ ] **Step 4 : vérifier** → PASS. La mesure réelle du débordement se contrôle à la main sur iPad (jsdom n'a pas de mise en page).
- [ ] **Step 5 : commit** `feat: moteur de rendu KaTeX, formats fiche et post`.

---

### Tâche 4 : réglages et stockage

**Files:**
- Create: `src/lib/storage/settings.ts`, `src/lib/storage/db.ts`, `src/ui/Settings.tsx`
- Test: `tests/settings.test.ts`, `tests/db.test.ts`

**Interfaces:**
- Produces : `Settings = { geminiKey; githubToken; owner; repo; model; maxPerMinute; maxPerDay; lotPages; theme: ThemeId; mode: Mode; themeOverrides: { light?: Partial<Tokens>; dark?: Partial<Tokens> } }` (`ThemeId`, `Mode`, `Tokens` sont définis en tâche 4 bis ; en tâche 4, ils sont des alias de `string`) ; `getSettings(): Settings` ; `saveSettings(patch: Partial<Settings>): void` ; `clearKeys(): void`.
- Produces : `Draft = { id: string; fiche: Fiche|null; raw?: string; brief?: Brief; problems: Problem[]; updatedAt: number }` ; `openDb(): Promise<Db>` ; `Db` expose `putDraft`, `getDraft`, `listDrafts`, `deleteDraft`, `put(key, value)`, `get(key)` ; `exportDraft(d: Draft): string`.

- [ ] **Step 1 : tests.** Défauts : `maxPerMinute === 5`, `maxPerDay === 100`, `lotPages === 5`, `theme === 'ac'`, `mode === 'auto'`, `themeOverrides` vide, `model` égal à la valeur du `MODEL` par défaut lue dans `Fiches/orchestrate.py`. `clearKeys()` vide `geminiKey` et `githubToken` mais garde `model`. **`openDb()` sans `indexedDB` défini renvoie une base en mémoire fonctionnelle** (point de vigilance 4). `exportDraft` renvoie du JSON identique au brouillon.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** (`localStorage` pour les réglages, IndexedDB pour le reste, repli mémoire). L'écran Réglages propose « Tester la connexion » (GitHub et Gemini) et « Effacer mes clés ».
- [ ] **Step 4 : vérifier** → PASS.
- [ ] **Step 5 : commit** `feat: réglages et stockage local`.

---

### Tâche 4 bis : thèmes, mode sombre et personnalisation

**Files:**
- Create: `src/theme/themes.ts`, `src/theme/applyTheme.ts`, `src/theme/contrast.ts`, `src/ui/ThemeSettings.tsx`
- Modify: `src/ui/Settings.tsx`, `src/main.tsx`
- Test: `tests/themes.test.ts`

**Interfaces:**
- Consumes : `getSettings`, `saveSettings` (tâche 4).
- Produces : `TokenName` (les douze variables) ; `Tokens = Record<TokenName, string>` ; `ThemeId = 'ac'|'a'|'b'|'c'` ; `Mode = 'auto'|'clair'|'sombre'` ; `THEMES: Record<ThemeId, { label: string; light: Tokens; dark: Tokens }>` ; `resolveMode(mode: Mode, prefersDark: boolean): 'light'|'dark'` ; `applyTheme(root: HTMLElement, s: { theme: ThemeId; mode: Mode; overrides: Settings['themeOverrides'] }, prefersDark: boolean): void` ; `contrastRatio(fg: string, bg: string): number` ; `contrastWarnings(t: Tokens): TokenName[]`.

- [ ] **Step 1 : tests.**
  - Chaque préréglage, en clair et en sombre, définit les douze variables avec une valeur `#RRGGBB` ou `transparent`.
  - Valeurs sombres du préréglage `ac` : `--page-bg: #1F1418`, `--card: #2A1B21`, `--text: #F3E6E9`, `--accent-text: #FF6B85`, `--accent-dark: #F3B7C4`, `--badge-bg: #4A2230`, `--ok-bg: #1F3A1A`, `--ok-text: #A8D890`, `--logo: #CB8593`, `--card-border: #4A2F38`, `--grid-line: #2B1C22`.
  - Contraste, pour chaque préréglage et chaque mode : `contrastRatio(text, pageBg) >= 4.5`, `(text, card) >= 4.5`, `(accentText, pageBg) >= 3`, `('#FFFFFF', accent) >= 4.5`, `(accentDark, badgeBg) >= 4.5`, `(okText, okBg) >= 4.5`. `contrastRatio('#FFFFFF', '#DD0033')` vaut 5,09 à 0,01 près.
  - `resolveMode('auto', true)` vaut `'dark'` ; `('auto', false)` → `'light'` ; `('clair', true)` → `'light'` ; `('sombre', false)` → `'dark'`.
  - `applyTheme` pose `--accent` sur la racine et `data-mode="dark"` quand le mode résolu est sombre. Une surcharge `{ light: { '--accent': '#112233' } }` s'applique en clair mais pas en sombre.
  - `contrastWarnings` renvoie `['--accent-text']` quand `--accent-text` a moins de 3:1 sur `--page-bg`.
- [ ] **Step 2 : vérifier l'échec** : `npx vitest run tests/themes.test.ts` → FAIL.
- [ ] **Step 3 : implémenter.** Les valeurs sont celles de la spec §8 (tableau et écarts des préréglages `a`, `b`, `c`). `applyTheme` écrit les variables en style direct sur la racine ; elle est appelée au démarrage, à chaque changement de réglage et sur l'événement `change` de `prefers-color-scheme`.
- [ ] **Step 4 : écran de réglage du thème.** Choix du préréglage (quatre aperçus), contrôle Auto / Clair / Sombre, cinq sélecteurs de couleur pour le mode en cours (fond → `--page-bg`, cartes → `--card`, accent → `--accent` et `--accent-text`, texte → `--text`, logo → `--logo`), avertissement quand `contrastWarnings` n'est pas vide, bouton « Réinitialiser le thème » (vide `themeOverrides`).
- [ ] **Step 5 : vérifier** : `npm test` → PASS ; contrôle manuel sur iPad : bascule du réglage système, les fiches restent blanches dans l'aperçu.
- [ ] **Step 6 : commit** `feat: thèmes, mode sombre et personnalisation`.

---

### Tâche 5 : accès au dépôt GitHub

**Files:**
- Create: `src/lib/github/repo.ts`
- Test: `tests/repo.test.ts`

**Interfaces:**
- Consumes : erreurs de la tâche 2.
- Produces : `TreeEntry = { path: string; type: 'blob'|'tree'; sha: string }` ; `class GithubRepo { constructor(owner: string, name: string, token: string, fetchImpl?: typeof fetch); listTree(): Promise<TreeEntry[]>; readFile(path: string): Promise<{ content: string; sha: string }>; readBinary(path: string): Promise<ArrayBuffer>; writeFile(path: string, content: string, opts: { message: string; sha?: string }): Promise<{ sha: string }> }`.

- [ ] **Step 1 : tests (fetch simulé).** **L'écriture de `"Continuité ∀ε"` envoie un contenu base64 qui, décodé en UTF-8, redonne exactement ce texte** (point de vigilance 1). Une mise à jour envoie `sha` dans le corps. Réponse 409 → `ConflictError` ; 401 → `AuthError` ; 404 en lecture → `NotFoundError` ; `listTree` fait un seul appel (arbre récursif) ; chaque requête porte l'en-tête `Authorization`.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** avec l'API Contents pour les fichiers et l'API des arbres pour l'index ; encodage par `TextEncoder`, pas par `btoa` sur la chaîne brute.
- [ ] **Step 4 : vérifier** → PASS.
- [ ] **Step 5 : commit** `feat: accès au dépôt GitHub`.

---

### Tâche 6 : polices au lancement

**Files:**
- Create: `src/lib/github/fonts.ts`
- Test: `tests/fonts.test.ts`

**Interfaces:**
- Consumes : `GithubRepo`, `AuthError`.
- Produces : `loadFonts(repo: GithubRepo): Promise<{ loaded: string[]; fallback: boolean }>`.

- [ ] **Step 1 : tests (`FontFace` simulé).** Avec un dépôt qui répond, `loaded` contient `Andaluz` et `Melbourne` et `fallback` vaut `false`. Avec un dépôt qui lève `AuthError`, la promesse se résout avec `loaded: []` et `fallback: true` (jamais de rejet).
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** : lire `fonts/Andaluz-Regular.otf` (poids 400), `fonts/melbourne.ttf` (400), `fonts/melbournebold.ttf` (700) via `readBinary`, enregistrer avec `new FontFace(...)` puis `document.fonts.add`. Inter reste la police de repli du thème.
- [ ] **Step 4 : vérifier** → PASS.
- [ ] **Step 5 : commit** `feat: chargement des polices depuis le dépôt privé`.

---

### Tâche 7 : bibliothèque (index, filtres, exemples, PDF)

**Files:**
- Create: `src/lib/library/index.ts`, `src/lib/export/pdf.ts`, `src/ui/Library.tsx`
- Test: `tests/library.test.ts`

**Interfaces:**
- Consumes : `TreeEntry`, `GithubRepo`, `Statut`.
- Produces : `LibraryItem = { kind: 'fiche'|'cours'; matiere: string; slug: string; path: string; statut?: Statut }` ; `buildIndex(tree: TreeEntry[]): LibraryItem[]` ; `loadIndex(repo: GithubRepo, db: Db): Promise<LibraryItem[]>` (un appel d'arbre, résultat mis en cache dans `db` sous la clé `library-index`, cache servi si le réseau échoue) ; `filterItems(items: LibraryItem[], f: { matiere?: string; statut?: Statut; text?: string }): LibraryItem[]` ; `setExemple(repo: GithubRepo, path: string, value: boolean): Promise<void>` ; `printPages(format: Format): void`.

- [ ] **Step 1 : tests.** `corpus/json/maths/x.json` donne `{ kind: 'fiche', matiere: 'maths', slug: 'x', statut: 'verifie' }` ; `corpus/cours/maths/y.md` donne `kind: 'cours'` sans `statut` (lu à l'ouverture). `filterItems` filtre par matière, statut et texte. `setExemple(repo, path, true)` lit le fichier, positionne `meta.exemple = true` et réécrit avec le `sha` lu. `loadIndex` renvoie l'index mis en cache quand `listTree` lève `NetworkError`.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.** `printPages` injecte une règle `@page` aux dimensions de `FORMATS[format]` puis appelle `window.print()`. L'écran Bibliothèque : filtres, recherche, ouvrir, exporter, modifier (ouvre Relire), refaire à partir du brief (`meta.brief`), marquer comme exemple.
- [ ] **Step 4 : vérifier** → PASS.
- [ ] **Step 5 : commit** `feat: bibliothèque et export PDF`.

---

### Tâche 8 : export PNG

**Files:**
- Create: `src/lib/export/png.ts`
- Test: `tests/png.test.ts`

**Interfaces:**
- Produces : `MAX_PIXELS = 16_777_216` ; `pickScale(width: number, height: number, wanted?: number): number` ; `exportPng(pages: HTMLElement[], scale?: number): Promise<Blob[]>`.

- [ ] **Step 1 : tests.** `pickScale(1240, 1754)` vaut `2` (2480×3508 ≈ 8,7 millions de pixels, sous `MAX_PIXELS`). Pour `pickScale(3000, 4000)`, la surface obtenue (`(3000·s)·(4000·s)`) est au plus `MAX_PIXELS`.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** `pickScale` (réduire `wanted`, 2 par défaut, tant que la surface dépasse `MAX_PIXELS`) et `exportPng` avec modern-screenshot, une page à la fois.
- [ ] **Step 4 : vérifier** → PASS.
- [ ] **Step 5 : contrôle manuel sur iPad (premier essai technique).** Ouvrir une fiche de test, exporter le PNG. Attendu : image non blanche, formules et polices visibles. En cas d'échec, désactiver le bouton PNG et ne garder que le PDF (spec §12).
- [ ] **Step 6 : commit** `feat: export PNG avec échelle sûre`.

---

### Tâche 9 : génération, logique

**Files:**
- Create: `src/lib/generate/sections.ts`, `src/lib/generate/context.ts`, `src/lib/generate/loop.ts`, `src/lib/gemini/json.ts`, `src/lib/gemini/client.ts`, `src/lib/gemini/budget.ts`
- Test: `tests/generate.test.ts`, `tests/gemini.test.ts`

**Interfaces:**
- Consumes : `validateFiche`, `lintLatex`, `renderFiche`, `checkOverflow`, `Problem`, erreurs (tâches 2 et 3).
- Produces : `Section = { titre: string; texte: string }` ; `splitSections(md: string): Section[]` ; `pickExamples(fiches: Fiche[], brief: Brief, k?: number): Fiche[]` ; `pickCourseSections(cours: { md: string; statut: Statut }[], brief: Brief, k?: number): string[]` ; `buildPrompt(i: { charte: string; schema: object; examples: Fiche[]; sections: string[]; brief: Brief }): { system: string; user: string }`.
- Produces : `extractJson(text: string): unknown` ; `callGemini(o: { key: string; model: string; system: string; messages: { role: 'user'|'model'; text: string }[]; fetchImpl?: typeof fetch }): Promise<string>` ; `class RequestBudget { constructor(limits: { perMinute: number; perDay: number }, now?: () => number); canSend(): boolean; record(): void }`.
- Produces : `GenerateDeps = { llm(messages: { role: 'user'|'model'; text: string }[]): Promise<string>; validate(d: unknown): Problem[]; lint(f: Fiche): Problem[]; render(f: Fiche): { katexErrors: string[]; overflow: number[] } }` ; `GenerateResult = { ok: boolean; tours: number; fiche?: Fiche; last?: string; problems: Problem[] }` ; `generateFiche(brief: Brief, prompt: { system: string; user: string }, deps: GenerateDeps, maxTours?: number): Promise<GenerateResult>` (`maxTours` vaut 4 par défaut).

- [ ] **Step 1 : tests.**
  - `extractJson('```json\n{"a":1}\n```')` vaut `{ a: 1 }` ; **`extractJson('{"a": 1, "b": [')` lève une erreur de code `json`** (point de vigilance 2).
  - `splitSections` découpe selon `## ` et ignore le contenu avant le premier titre.
  - `pickExamples` place d'abord les fiches avec `meta.exemple === true`, puis par proximité de mots-clés avec `brief.sujet`, au plus `k` (2 par défaut).
  - `pickCourseSections` place les cours `verifie` avant `a_verifier`, au plus 3 sections.
  - **`buildPrompt` avec `examples: []` et `sections: []` renvoie un prompt valide qui contient la charte et le schéma** (point de vigilance 3).
  - `callGemini` : réponse 429 → `RateLimitError` avec `retryAfterSec` ; échec réseau → `NetworkError` ; jamais d'`AuthError` sur une simple erreur CORS ; 401 ou 403 → `AuthError`.
  - `RequestBudget({ perMinute: 5, perDay: 100 })` : `canSend()` devient faux après 5 `record()` dans la même minute et redevient vrai 61 secondes plus tard (horloge simulée).
  - `generateFiche` : s'arrête au tour 1 si aucun problème ; le message du tour 2 contient le texte du problème du tour 1 ; après 4 tours en échec, `ok === false`, `tours === 4` et `last` est conservé.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** (même logique que `orchestrate.py` : schéma, lint, rendu, débordement ; l'historique de messages s'allonge à chaque tour). `callGemini` utilise l'API REST de Gemini avec la clé en paramètre de requête.
- [ ] **Step 4 : vérifier** → PASS.
- [ ] **Step 5 : commit** `feat: génération, client Gemini, budget de requêtes`.

---

### Tâche 10 : écran Générer et brouillons

**Files:**
- Create: `src/ui/messages.ts`, `src/ui/Generate.tsx`
- Test: `tests/messages.test.ts`

**Interfaces:**
- Consumes : `generateFiche`, `buildPrompt`, `RequestBudget`, `Db`, `GithubRepo`, `Settings`.
- Produces : `messageFor(err: unknown, ctx?: { offline?: boolean }): string`.

- [ ] **Step 1 : tests.** `messageFor(new RateLimitError(12))` vaut `« Quota atteint. Réessaie dans 12 secondes »` ; `NetworkError` → `« Gemini n'a pas répondu. Réessayer »` ; `AuthError` → `« Ajoute ta clé Gemini dans Réglages »` ; `ConflictError` → `« Cette fiche a changé. Comparer, écraser ou annuler »` ; `messageFor(new NetworkError(), { offline: true })` → `« Hors connexion. Enregistrement impossible, ton brouillon est conservé »`.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** `messageFor` et l'écran : formulaire du brief (champs de la spec §5.3), import d'un brief JSON, lecture dans `Fiches` de `charte.md`, des fiches exemples et des cours, lancement avec affichage de la progression par tour et des problèmes restants, copie du brief dans `meta.brief`, enregistrement du brouillon, bouton « Exporter le JSON », compteur de requêtes. `deps.render` rend la fiche dans un conteneur hors écran aux dimensions de `FORMATS[meta.format]`, attend le chargement des polices, puis appelle `checkOverflow`.
- [ ] **Step 4 : vérifier** : `npm test` → PASS ; contrôle manuel d'une génération réelle avec ta clé (une fiche de bout en bout).
- [ ] **Step 5 : commit** `feat: écran Générer`.

---

### Tâche 11 : relire et valider

**Files:**
- Create: `src/lib/relire/checklist.ts`, `src/lib/relire/valider.ts`, `src/ui/Review.tsx`
- Test: `tests/relire.test.ts`

**Interfaces:**
- Consumes : `GithubRepo`, `generateFiche`, `ConflictError`.
- Produces : `parseChecklist(charteMd: string): string[]` ; `canValidate(checked: boolean[]): boolean` ; `slugify(s: string): string` ; `validerFiche(repo: GithubRepo, fiche: Fiche): Promise<string>` (renvoie le chemin écrit) ; `correctFiche(fiche: Fiche, instruction: string, prompt: { system: string; user: string }, deps: GenerateDeps): Promise<GenerateResult>`.

- [ ] **Step 1 : tests.** `parseChecklist` lit les puces sous `## Checklist de relecture` ; sans cette section, elle renvoie les trois éléments par défaut (hypothèses explicites, quantificateurs, notations et macros). `canValidate([true, true, false])` vaut `false` ; `canValidate([])` vaut `false` ; toutes cochées → `true`. `slugify('Théorème des valeurs intermédiaires')` vaut `'theoreme-des-valeurs-intermediaires'`. `validerFiche` écrit `corpus/json/maths/<slug>.json` avec `meta.statut === 'verifie'` ; sur un conflit, `ConflictError` est propagée sans écrasement. `correctFiche` relance `generateFiche` avec l'instruction ajoutée au dernier message utilisateur.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** l'écran en deux colonnes (paysage) ou deux onglets (portrait) : édition par bloc, aperçu, JSON brut, bandeau de contrôles, checklist, « Corriger avec Gemini », Valider (actif selon `canValidate`). Sur conflit : comparer, écraser ou annuler.
- [ ] **Step 4 : vérifier** → PASS ; contrôle manuel : valider une fiche et la retrouver dans la bibliothèque.
- [ ] **Step 5 : commit** `feat: relecture et validation`.

---

### Tâche 12 : import de cours, logique

**Files:**
- Create: `src/lib/cours/chunk.ts`, `transcribe.ts`, `checks.ts`, `queue.ts`
- Test: `tests/cours.test.ts`

**Interfaces:**
- Consumes : `Db`, `RateLimitError`, `Problem`, `splitSections`.
- Produces : `Lot = { index: number; fromPage: number; toPage: number; data: Uint8Array }` ; `splitPdf(data: ArrayBuffer, pagesPerLot: number): Promise<Lot[]>` ; `transcribeLot(lot: Lot, deps: { llm(lot: Lot): Promise<string> }): Promise<string>` ; `checkMarkdown(md: string): Problem[]` ; `CoursMeta = { matiere: string; niveau: string; chapitre: string; source: string; statut: Statut }` ; `buildCoursMd(meta: CoursMeta, body: string): string` ; `class ImportQueue { constructor(db: Db, transcribe: (lot: Lot) => Promise<string>); enqueue(id: string, lots: Lot[]): Promise<void>; run(id: string): Promise<'done'|'paused'>; progress(id: string): Promise<{ done: number; total: number }> }`.

- [ ] **Step 1 : tests.** `splitPdf` d'un PDF de 12 pages avec `pagesPerLot = 5` renvoie 3 lots (pages 1-5, 6-10, 11-12). `checkMarkdown` signale : formule invalide, absence de titre `#`, page vide, et compte les `[illisible]`. `buildCoursMd` produit le front matter de la spec §5.2 (`matiere`, `niveau`, `chapitre`, `source`, `statut: a_verifier`). **Reprise après quota** : file de 4 lots dont le transcripteur lève `RateLimitError` au lot 3 → `run` renvoie `'paused'` avec `progress` à `2/4` ; après correction du transcripteur, un nouveau `run` ne retraite que les lots 3 et 4 (point de vigilance 5).
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.** Découpage avec pdf-lib ; consigne de transcription de la spec §7.2 (formules en `$…$` avec les macros de la charte, aucune invention, `[illisible]` en cas de doute, figures en légende entre crochets) ; progression sauvegardée dans la base locale après chaque lot.
- [ ] **Step 4 : vérifier** → PASS.
- [ ] **Step 5 : commit** `feat: import de cours (découpage, transcription, file reprenable)`.

---

### Tâche 13 : écran Cours

**Files:**
- Create: `src/ui/Cours.tsx`

**Interfaces:**
- Consumes : `splitPdf`, `ImportQueue`, `checkMarkdown`, `buildCoursMd`, `renderRich`, `GithubRepo`, `Settings`.

- [ ] **Step 1 : écran.** Sélecteur « Choisir dans Fichiers » (plusieurs fichiers) et appareil photo ; `.md`, `.tex`, `.txt` et texte collé enregistrés sans conversion ; liste de la file avec progression ; plafond quotidien appliqué par `RequestBudget`.
- [ ] **Step 2 : relecture côte à côte.** Page source à gauche (image pour une photo, page rendue par pdfjs-dist pour un PDF), rendu KaTeX du Markdown à droite, contrôles de `checkMarkdown` en bandeau.
- [ ] **Step 3 : enregistrement** dans `corpus/cours/<matiere>/<slug>.md` avec `statut: a_verifier` ; passage à `verifie` après la relecture.
- [ ] **Step 4 : contrôle manuel sur iPad** : importer un PDF de 3 pages, relire, enregistrer, retrouver le cours dans la bibliothèque.
- [ ] **Step 5 : commit** `feat: écran Cours`.

---

### Tâche 14 : livraison

**Files:**
- Create: `README.md`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1 : README en français** : création du jeton à granularité fine (dépôt `Fiches` seul, Contents lecture et écriture, date d'expiration), saisie dans Réglages, ajout à l'écran d'accueil de l'iPad.
- [ ] **Step 2 : checklist de contrôle manuel (spec §11)** : export PDF, export PNG, chargement des polices, ajout à l'écran d'accueil, bascule clair/sombre (manuelle et avec le système), génération puis relecture puis validation d'une fiche.
- [ ] **Step 3 : parité** : `node scripts/parity.mjs ../Fiches/corpus/json` donne les mêmes verdicts que `validate.py`.
- [ ] **Step 4 : activer Pages** (source : GitHub Actions) et vérifier que le site répond.
- [ ] **Step 5 : commit** `docs: README, checklist de livraison`.
