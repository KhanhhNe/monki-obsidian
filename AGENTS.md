# Monki Obsidian plugin

## Project overview

- Target: Obsidian community plugin written in TypeScript.
- Entry point: `src/main.ts`, bundled to the root-level `main.js`.
- Release artifacts: `main.js`, `manifest.json`, and `styles.css`.
- Features: a synchronized outline view for headings and page/folder links, plus editor checkbox typing shortcuts.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
obsidian plugin:reload id=monki-obsidian
```

The Obsidian CLI is available. After building a change, use it to reload and test the plugin in Obsidian before yielding.

## Structure

- `src/main.ts`: plugin lifecycle, registrations, and commands.
- `src/monki-outline-view.ts`: outline extraction, rendering, navigation, and source synchronization.
- `src/checkbox-shortcuts.ts`: CodeMirror checkbox input and deletion shortcuts.
- `styles.css`: outline view presentation.

## Conventions

- Keep source code in `src/` and do not commit generated `main.js` or `node_modules/`.
- Keep the plugin local and offline; do not add telemetry or network calls without explicit user-facing consent and documentation.
- Register events, DOM handlers, and cleanup callbacks through Obsidian's `register*` APIs.
- Keep command IDs and the manifest plugin ID stable after release.
- Preserve mobile compatibility unless a feature truly requires desktop APIs.
- Run `npm run build` and `npm run lint`, then use the Obsidian CLI to test changes before yielding.
