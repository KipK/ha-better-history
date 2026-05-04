# Prompt d'implémentation — `ha-better-history`

Tu es un agent IA développeur. Tu dois créer **from scratch** un nouveau projet npm contenant un **web component autonome** d'affichage de graphiques d'historique Home Assistant. Ce document est ton plan complet : tout le contexte nécessaire est ici.

---

## 1. Mission

Créer un web component nommé `<ha-better-history>` :

- **Standalone** : aucun couplage à une carte Lovelace particulière, à un dialog, ou à un thème spécifique.
- **Réutilisable partout** : dans une page Lovelace, dans un `<div>`, dans un dialog, dans une more-info, dans une section custom.
- **Publiable sur npm** plus tard (la structure du repo et l'API publique doivent être prêtes pour ça dès le départ).
- **API déclarative** : configuration via propriétés / attributs / un objet `config`. Aucune méthode impérative obligatoire pour l'usage de base.
- **Reproduit par défaut le comportement actuel** du dialog historique d'Equinox quand aucune config explicite n'est fournie (sources auto, range 24h, échelles auto, tooltip ON, picker visible).

Ce composant remplacera à terme la partie graphique de :

1. `eq-history-dialog` dans Equinox (carte Lovelace pour Versatile Thermostat).
2. Les graphiques actuellement ouverts via la more-info HA pour les capteurs liés à un climate VT (température, humidité, puissance, ouverture de valve, `power_percent`, etc.).
3. Une future page de régulation Equinox qui devra présenter plusieurs graphiques d'attributs côte à côte.

---

## 2. Dossier de travail

Tout le code de ce projet vit dans :

```
/workspaces/workspace/ha-better-history/
```

L'arborescence existante (créée par l'utilisateur) :

```
ha-better-history/
└── plans/
    └── ha-better-history-implementation-prompt.md   ← ce fichier
```

Tu dois créer toute la structure restante.

---

## 3. Contraintes strictes (issues des règles projet utilisateur)

- **Ne jamais commiter toi-même.** L'utilisateur fait les commits.
- **Tous les commentaires de code en anglais.**
- **Ne jamais lancer `pytest`.** Si un test Python est nécessaire, demander à l'utilisateur.
- **Builds frontend autorisés** :
  - Node : `/home/vscode/.nvm/versions/node/v24.15.0/bin/node`
  - npm : `/home/vscode/.nvm/versions/node/v24.15.0/bin/npm`
- **Tokens minimaux** : pas de doc inutile, pas de commentaire évident, pas de section "nouveau / modifié".
- **Toujours supprimer le code mort** quand tu refactores.
- **Ne pas utiliser `git diff` sans `--no-pager`.**
- **Ne touche aucun fichier hors de `/workspaces/workspace/ha-better-history/`** sauf instruction explicite (ex. migration côté Equinox dans une étape ultérieure marquée comme telle).

---

## 4. Stack technique imposée

- **TypeScript strict** (cf. `tsconfig.json` calqué sur Equinox).
- **Lit 3** (`lit` ^3.3.2) pour le web component. Cohérent avec Equinox et avec les composants HA.
- **Vite** comme bundler (mode `lib`), comme Equinox.
- **Aucune dépendance de charting externe** (pas de Chart.js, pas d'ApexCharts). Le rendu reste un SVG maison, comme l'actuel `eq-history-dialog`. Raison : besoin de contrôle fin (axes par groupe, aire de chauffe, segments d'état non-numériques, tooltip multi-séries précis, downsampling en buckets).
- **`@kipk/load-ha-components`** pour charger à la demande `ha-entity-picker` et `ha-date-range-picker` quand le picker / date picker sont activés.

### Fichiers de configuration à créer

- `package.json` :
  - `"name": "ha-better-history"`
  - `"version": "0.1.0"`
  - `"type": "module"`
  - `"private": true` initialement (on retirera quand on publiera).
  - `"main"`, `"module"`, `"types"`, `"exports"` pointant sur `dist/`.
  - `"files": ["dist"]`.
  - `"scripts"`: `"build": "vite build"`, `"typecheck": "tsc --noEmit"`.
  - `"sideEffects"` : déclarer comme side-effect le fichier qui fait le `customElements.define` (l'import via `dist/define.js` doit auto-enregistrer).
  - `"peerDependencies"` : aucune pour l'instant.
  - `"dependencies"` : `lit`, `@kipk/load-ha-components`.
- `tsconfig.json` : copier celui d'Equinox (cf. `/workspaces/workspace/equinox/tsconfig.json`).
- `vite.config.ts` : build en mode `lib`, formats `["es"]`, deux entrées :
  - `src/index.ts` (export pur, sans `customElements.define`)
  - `src/define.ts` (import + `customElements.define`)
  - Marquer `lit` et `@kipk/load-ha-components` comme `external` dans `rollupOptions` (l'app hôte les fournit). En dev/standalone on pourra créer une variante `dist/standalone.js` qui les bundle.
- `.gitignore` : `node_modules`, `dist`.
- `README.md` minimal : nom, but, statut "WIP", lien vers ce plan, exemple de base. **Pas de doc exhaustive** tant que l'API n'est pas figée.

---

## 5. API publique du composant

### 5.1 Tag

```html
<ha-better-history></ha-better-history>
```

### 5.2 Propriétés

Toutes les propriétés sont en camelCase côté JS / kebab-case côté attribut HTML quand applicable. Les objets complexes ne passent que par propriété JS, pas par attribut.

| Prop JS            | Type                               | Attribut HTML        | Défaut                 | Description                                                                                  |
| ------------------ | ---------------------------------- | -------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `hass`             | `HomeAssistant`                    | —                    | requis                 | Instance HA injectée par l'hôte.                                                             |
| `config`           | `BetterHistoryConfig \| undefined` | —                    | `undefined`            | Configuration déclarative complète. Si absente, fallback sur les autres props.               |
| `entities`         | `string[] \| undefined`            | —                    | `undefined`            | Raccourci : liste d'entity_ids dont l'état est tracé. Ignoré si `config.series` est fourni.  |
| `hours`            | `number`                           | `hours`              | `24`                   | Range temporel par défaut (heures avant `endDate`). Ignoré si `startDate`/`endDate` fournis. |
| `startDate`        | `Date \| undefined`                | —                    | `undefined`            | Borne basse (override `hours`).                                                              |
| `endDate`          | `Date \| undefined`                | —                    | `undefined`            | Borne haute (défaut : maintenant).                                                           |
| `showDatePicker`   | `boolean`                          | `show-date-picker`   | `false`                | Affiche `ha-date-range-picker` au-dessus du graphe.                                          |
| `showEntityPicker` | `boolean`                          | `show-entity-picker` | `false`                | Affiche le sélecteur d'entité + browser d'attributs (idem dialog actuel).                    |
| `showLegend`       | `boolean`                          | `show-legend`        | `true`                 | Légende sous le graphe.                                                                      |
| `showTooltip`      | `boolean`                          | `show-tooltip`       | `true`                 | Active le tooltip multi-séries au survol.                                                    |
| `width`            | `string \| undefined`              | `width`              | `undefined`            | Ex. `"100%"`, `"720px"`. Si non défini → `100%`.                                             |
| `height`           | `string \| undefined`              | `height`             | `undefined`            | Ex. `"400px"`. Si non défini → hauteur calculée auto à partir des graphes empilés.           |
| `language`         | `string \| undefined`              | `language`           | `hass.locale.language` | Localisation des libellés.                                                                   |

### 5.3 `BetterHistoryConfig`

C'est le **cœur de l'API**. Chaque champ y est optionnel : un appel sans config doit faire un truc raisonnable.

```ts
export interface BetterHistoryConfig {
  // Window
  hours?: number;                       // default 24
  startDate?: Date;
  endDate?: Date;

  // Layout / chrome
  showDatePicker?: boolean;             // default false
  showEntityPicker?: boolean;           // default false
  showLegend?: boolean;                 // default true
  showTooltip?: boolean;                // default true
  width?: string;                       // CSS length, default "100%"
  height?: string;                      // CSS length, default auto

  // Data
  series?: SeriesConfig[];              // explicit list; if absent, derived from `entities` or empty
  defaultEntities?: string[];           // shown in entity picker; first attribute set may auto-fill series
}

export interface SeriesConfig {
  // What to plot
  entity: string;                       // entity_id
  attribute?: string | string[];        // dotted path or array; absent = entity.state
  label?: string;                       // legend label; default = friendly_name or path
  color?: string;                       // CSS color; default = automatic palette
  unit?: string;                        // override unit (used for grouping + axis label)

  // Scale grouping
  scaleGroup?: string;                  // series sharing a scaleGroup share the same Y axis
                                        // omitted = grouped by unit if numeric, else own scale
  scaleMode?: "auto" | "manual";        // default "auto"
  scaleMin?: number;                    // used when scaleMode = "manual"
  scaleMax?: number;                    // used when scaleMode = "manual"
}
```

#### Règles de regroupement / d'échelle

1. Si l'utilisateur ne précise rien :
   - les séries numériques avec **même unité** partagent la même échelle Y et **le même graphe**;
   - les séries numériques sans unité reconnaissable ou d'unités différentes vont chacune dans **leur propre graphe** (graphes empilés verticalement);
   - les séries non numériques (string / boolean) sont rendues comme **rubans de segments** sous les graphes numériques (comme aujourd'hui). Il faut que la couleur du segment change dans le ruban à chaque nouvelle entrée qui différe de la precedente.
2. Si l'utilisateur précise `scaleGroup` :
   - les séries partageant un `scaleGroup` partagent **un même graphe et une même échelle Y**, peu importe leur unité;
   - les autres conservent la règle 1 entre elles.
3. `scaleMode: "manual"` impose `[scaleMin, scaleMax]` pour la série, fusionné si la série partage un `scaleGroup` (le manual l'emporte sur l'auto, mais ne fait que **étendre** l'intervalle, pas le contracter).
4. Couleurs : si `color` non fournie, palette interne (cf. `sourceColor` actuel : `#ff9800`, `#42a5f5`, `#66bb6a`, `#ec407a`, `#ab47bc`, `#26a69a`).

### 5.4 Événements émis

Tous bubbles + composed.

- `range-changed` → `{ startDate: Date, endDate: Date }` quand le date picker change.
- `series-toggled` → `{ id: string, hidden: boolean }` quand l'utilisateur clique une entrée de légende.
- `series-added` / `series-removed` → quand l'entity picker ajoute/retire une source.
- `tooltip-changed` → `{ time: number, values: TooltipValue[] } | null` (utile pour synchroniser plusieurs charts).

### 5.5 Comportement par défaut sans config

Si `config` est `undefined` et `entities` est `undefined` :

- Si l'élément a un attribut/prop `entity` (string), tracer son `state`.
- Sinon, ne rien afficher — slot `<empty>` par défaut.

Si `entities` est un tableau non vide :

- Tracer `entity.state` pour chacun.
- Range = 24h.
- Picker date / entity OFF.
- Légende + tooltip ON.

Si on appelle `<ha-better-history>` avec **uniquement** `hass` + `config={ showDatePicker: true, showEntityPicker: true }` et qu'on lui injecte une climate VT comme entité de référence (champ `defaultEntities` + `series` initiales pointant `current_temperature`, `temperature`, `hvac_action`), on obtient **exactement** le comportement actuel du dialog historique Equinox (mêmes 3 sources par défaut, mêmes couleurs, aire de chauffe).

---

## 6. Architecture interne

### 6.1 Structure des fichiers

```
ha-better-history/
├── src/
│   ├── index.ts                 # public API: re-exports types + class (no define)
│   ├── define.ts                # imports class + customElements.define
│   ├── ha-better-history.ts     # the LitElement class
│   ├── controllers/
│   │   ├── data-controller.ts   # fetches & caches history series
│   │   └── tooltip-controller.ts
│   ├── data/
│   │   ├── history.ts           # ported from equinox/src/data/history.ts (cleaned up)
│   │   ├── format.ts            # asNumber/asString helpers (port from equinox)
│   │   └── value-type.ts
│   ├── render/
│   │   ├── chart.ts             # pure functions: scales, lines, segments, axes
│   │   ├── scales.ts            # NumericScale building, grouping, padding
│   │   ├── downsample.ts        # bucket-based reduction (LTTB-lite already in equinox)
│   │   └── colors.ts            # palette
│   ├── ui/
│   │   ├── entity-picker.ts     # optional sub-component, only if showEntityPicker
│   │   ├── date-picker.ts       # wrapper around ha-date-range-picker
│   │   ├── legend.ts
│   │   └── tooltip.ts
│   ├── styles/
│   │   └── chart.css.ts         # exported CSSResult, no theming dependency on equinox vars
│   ├── localize/
│   │   └── localize.ts          # tiny dict, en + fr to start
│   ├── types/
│   │   ├── config.ts            # BetterHistoryConfig, SeriesConfig
│   │   └── ha.ts                # HomeAssistant, HassEntity (port)
│   └── load-ha-components.ts    # ensure entity / date pickers, lazy
├── dev/
│   └── index.html               # standalone dev page mocking `hass`
├── plans/
│   └── ha-better-history-implementation-prompt.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
└── README.md
```

### 6.2 Découpage des responsabilités

- `ha-better-history.ts` reste un orchestrateur Lit minimal. Il :
  - normalise `config` + props en un état interne `ResolvedConfig`;
  - délègue le fetch à `DataController` (Lit `ReactiveController`);
  - délègue le calcul d'échelles / lignes / segments à des **fonctions pures** dans `render/`;
  - rend l'UI (chrome optionnel + SVG + tooltip + légende).
- **Les fonctions pures de `render/`** ne touchent ni au DOM ni à `hass`. Elles prennent `(visibleSeries, config, bounds)` et renvoient des données prêtes à mapper en `<polyline>`/`<rect>`/`<polygon>`.
- **Le cache de rendu** (équivalent `_chartRenderCache` actuel) vit dans le composant et est invalidé sur changement de `series` (référence), `hidden` set, `bounds`, `config`.

### 6.3 Portage depuis Equinox

Tu vas **réimplémenter** (pas symlinker) les pièces suivantes dans le nouveau projet :

| Source Equinox                                           | Destination                                              | Notes                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/data/history.ts`                                    | `src/data/history.ts`                                    | Tel quel, sans rien retirer.                                                                                |
| `src/data/format.ts`                                     | `src/data/format.ts`                                     | Ports `asNumber`, `asString` (lis-le d'abord pour confirmer la signature).                                  |
| `src/types/ha.ts` (parts utilisées)                      | `src/types/ha.ts`                                        | Garde uniquement `HassEntity`, `HomeAssistant`.                                                             |
| `src/components/eq-history-dialog.ts` (logique de rendu) | éclatée dans `src/render/*` + `src/ha-better-history.ts` | **Ne pas porter** la logique dialog (`open`, `_dispatchClose`, `_fullscreen`, `ha-dialog`, header buttons). |
| `src/ha/load-components.ts`                              | `src/load-ha-components.ts`                              | Adapter aux composants utilisés ici (entity-picker, date-range-picker).                                     |

**Ne pas porter** :
- la logique spécifique climate VT (heating area liée à `hvac_action`) **par défaut**. Elle reste réplicable côté hôte via `series` explicites + un futur hook `renderOverlay` (cf. §10). Pour la v0.1, **on l'inclut de manière paramétrable** : si l'utilisateur fournit `series` avec `entity` climate + attributs `current_temperature` ET `hvac_action`, on dessine l'aire `heating`. C'est détecté par convention, mais isolé dans `render/climate-overlay.ts` pour pouvoir être désactivé / étendu plus tard.

### 6.4 Styles

- Aucune référence à des variables `--equinox-*` dans le shadow DOM.
- Utiliser uniquement les variables HA standard (`--primary-text-color`, `--secondary-text-color`, `--card-background-color`, `--divider-color`, `--accent-color`, `--rgb-primary-text-color`).
- Exposer des **CSS Custom Properties** publiques pour permettre l'override depuis l'hôte :
  - `--better-history-bg`
  - `--better-history-text-color`
  - `--better-history-muted-color`
  - `--better-history-border-color`
  - `--better-history-accent-color`
  - `--better-history-radius`
  - `--better-history-font-family`
- Toutes ont des fallbacks vers les variables HA correspondantes.
- **Pas de logique fullscreen** (c'est à l'hôte de décider).
- **Pas de `ha-dialog`** dans le composant.

---

## 7. Étapes d'implémentation

Procède dans cet ordre. Après chaque étape, lance `npm run build` et `npm run typecheck`. Ne passe à l'étape suivante que si les deux passent.

### Étape 1 — Bootstrap

1. Créer `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `README.md` minimal.
2. `npm install`.
3. Créer `src/index.ts` qui exporte une classe vide `HaBetterHistory extends LitElement` rendant `<div>hello</div>`.
4. Créer `src/define.ts` qui fait `customElements.define("ha-better-history", HaBetterHistory)`.
5. `npm run build` → vérifier que `dist/` contient les deux entrées.

### Étape 2 — Types + data layer

1. Porter `src/types/ha.ts`, `src/data/format.ts`, `src/data/history.ts`, `src/data/value-type.ts` depuis Equinox.
2. Créer `src/types/config.ts` avec `BetterHistoryConfig`, `SeriesConfig`, `ResolvedConfig`, `ResolvedSeries`.
3. Créer `src/data/resolve-config.ts` : fonction pure qui prend `(config, props, hass)` et renvoie un `ResolvedConfig` normalisé (range absolu, sources résolues, groupes d'échelle calculés, couleurs assignées).
4. **Sortie attendue** : un `ResolvedConfig` immuable, totalement déterministe.

### Étape 3 — DataController

1. Créer `src/controllers/data-controller.ts` : `ReactiveController` Lit qui, sur changement de `(hass, sources, start, end)`, appelle `fetchHistory` et expose `series`, `loading`, `error`.
2. Le composant l'instancie et l'observe.
3. Test manuel via `dev/index.html` (mock minimal `hass.callWS` qui renvoie des points fake).

### Étape 4 — Render core (sans chrome)

1. Porter dans `src/render/scales.ts` la logique `_numericScalesFor`, `_paddedRange`, `_valuePrecision`, `_roundToPrecision`. **Adapter** : la clé de groupe vient d'abord de `series.scaleGroup` puis de `unit`, plus jamais d'une convention "climate".
2. Porter `_buildNumericLines`, `_buildSegments`, `_buildYAxisLabels` dans `src/render/chart.ts`. Fonctions pures.
3. Porter `src/render/downsample.ts` (`_displayNumericPoints`).
4. Porter `src/render/colors.ts` (palette).
5. Dans `ha-better-history.ts`, rendre le SVG complet avec axes / lignes / segments / labels Y. Pas encore de tooltip ni picker.
6. Vérifier : le composant rend correctement avec une config minimale (1 entité, state numérique, 24h).

### Étape 5 — Légende + toggle de séries

1. Porter la légende et l'état `_hiddenSourceIds` (renommer `hiddenSeriesIds`).
2. Émettre `series-toggled`.

### Étape 6 — Tooltip

1. Porter `tooltip-controller.ts` à partir de `_tooltipSeries`, `_updateTooltip`, `_applyTooltipUpdate`, `_renderTooltip`, `_renderTooltipGuide`.
2. Activable via `showTooltip` (default ON).
3. Émettre `tooltip-changed`.

### Étape 7 — Date picker (optionnel)

1. Si `showDatePicker`, charger `ha-date-range-picker` via `load-ha-components`.
2. Porter `_onDateRangeChanged`, émettre `range-changed`.

### Étape 8 — Entity picker (optionnel)

1. Si `showEntityPicker`, charger `ha-entity-picker` + `ha-md-list`.
2. Porter le browser d'attributs (`_renderBrowser`, `_renderTreeEntry`, `_renderStateEntry`).
3. Porter le menu d'attributs (`_attributeMenuOpen`, positioning).
4. Émettre `series-added` / `series-removed`.

### Étape 9 — Climate heating overlay (paramétrable)

1. Isoler dans `src/render/climate-overlay.ts` la logique `_buildClimateHeatingAreas`, `_temperatureAt`, `_stateRanges` (cette dernière est en réalité utilisée aussi par `_buildSegments`, donc déplace-la dans `chart.ts` et importe-la depuis `climate-overlay.ts`).
2. La détection se fait sur la config résolue : présence d'un `series` `climate.* / current_temperature` + un autre `climate.* / hvac_action` sur la **même entité**.
3. Cette détection doit pouvoir être désactivée via `BetterHistoryConfig.disableClimateOverlay: boolean`.

### Étape 10 — Page de dev

1. `dev/index.html` charge `dist/standalone.js` (build dédié qui bundle `lit`).
2. Mocke un `hass` avec `callWS` retournant des séries synthétiques (sinusoïdes, états on/off).
3. Teste tous les modes : sans config, avec entities, avec series multi-unités, avec scaleGroup, avec scaleMode manual, avec/sans pickers, avec/sans tooltip.

### Étape 11 — Migration Equinox (séparée, **demande validation utilisateur**)

**N'attaque pas cette étape sans accord explicite.** Quand on l'attaquera :

1. Ajouter `ha-better-history` en dépendance locale (`file:../ha-better-history`) dans Equinox.
2. Refactor `eq-history-dialog.ts` pour qu'il devienne un simple wrapper `ha-dialog` + `<ha-better-history>` à l'intérieur, avec `showDatePicker`, `showEntityPicker`, et la config climate par défaut.
3. Supprimer le code de chart maintenant porté dans le nouveau composant.
4. Réutiliser `ha-better-history` dans la more-info des capteurs et la future page de régulation.

---

## 8. Tests

Pour la v0.1, **pas de framework de test automatisé**. Tu valides via :

1. `npm run build` qui passe.
2. `npm run typecheck` qui passe.
3. La page `dev/index.html` qui rend correctement chaque mode listé à l'étape 10.

Si à un moment tu sens qu'un test unitaire est indispensable (typiquement pour `resolveConfig` ou `numericScalesFor`), demande à l'utilisateur avant d'introduire un runner.

---

## 9. Référence du code source à porter

Tous les chemins sont relatifs à `/workspaces/workspace/equinox/`.

**À lire intégralement avant de commencer :**

- `src/components/eq-history-dialog.ts` — comportement actuel à reproduire et logique de rendu à éclater.
- `src/data/history.ts` — couche data, à porter telle quelle.
- `src/types/ha.ts` (lignes 1–50) — types HA.
- `src/ha/load-components.ts` — pattern de chargement lazy (à adapter).
- `tsconfig.json`, `vite.config.ts`, `package.json` — base de configuration.

**Plans existants utiles pour le contexte :**

- `plans/history-performance-optimization-prompt.md` — explique les invariants de perf à conserver (downsampling, cache de rendu, RAF tooltip, labels Y en HTML positionnés en pixels).
- `plans/ha-components-ui-alignment-report.md` — section 8 sur le dialog historique et pourquoi le SVG maison reste retenu vs composants HA génériques.

---

## 10. Hooks d'extension prévus pour plus tard (ne pas implémenter en v0.1)

Mentionnés ici pour que l'architecture les laisse possibles sans rewrite :

- `renderOverlay?: (ctx) => SVGTemplateResult` : injection d'overlay custom (heating area étant la première instance).
- Slots Lit nommés : `<slot name="header">`, `<slot name="empty">`, `<slot name="footer">`.
- `onRangeQuickPick`: presets 1h/6h/24h/7j/30j.
- Mode "live" : refresh périodique avec range glissant.
- Export PNG / CSV de la fenêtre courante.

Garde le composant **suffisamment découplé** pour qu'aucun de ces ajouts ne demande de toucher à la couche data ou aux fonctions pures de `render/`.

---

## 11. Quand reporter à l'utilisateur

Reporte (et attend une réponse) dans ces cas :

- Tu hésites sur une décision d'API (nom, forme d'un type) qui ne peut pas être changée silencieusement plus tard.
- Tu as besoin d'installer une dépendance non listée en §4.
- Tu envisages de **toucher au repo Equinox** (autorisé seulement à l'étape 11, et avec accord explicite).
- Un build échoue pour une raison non triviale (ex. incompatibilité Vite 8 / Lit 3 dans ce contexte).
- Une partie de la spec est ambiguë et tu dois choisir : pose la question, ne devine pas.

À la fin de chaque étape, un message **court** suffit : "étape X done, build OK, voici ce qui reste".
