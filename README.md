# Monki

Monki is an Obsidian plugin for navigating structured notes and writing checklists quickly.

## Features

- Opens a synchronized outline in the right sidebar with the **Open Monki Outline** command.
- Lists rendered headings and all internal links in source order, including links to pages that do not exist yet.
- Tracks the active outline item while the source note scrolls.
- Navigates to a heading or link when its outline item is selected.
- Opens a monthly mood calendar in the editor with the **Show mood calendar** command.
- Stores mood history as `#dd/mm/yyyy <mood icon> <text>` lines in `Mood Calendar.md`, preserving any detail text between records.
- Includes a **Clear** action that removes a day's mood while keeping its date marker.
- Provides six default moods that can be customized with the comma-separated `moodOptions` property.
- Navigates between months and returns to the current month with **Today**.
- Expands `x ` at the start of a line into an unchecked Markdown task.
- Removes an empty task marker with Backspace when the cursor is directly after it.

## Development

This project requires Node.js and npm.

```bash
npm install
npm run dev
```

Run a production build and lint check with:

```bash
npm run build
npm run lint
```

The build writes `main.js` to the project root. For manual installation, copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/monki-obsidian/`, then reload Obsidian and enable **Monki** under **Settings → Community plugins**.

## Privacy

Monki runs locally and does not collect telemetry or send vault data to external services.

## License

[0BSD](LICENSE)
