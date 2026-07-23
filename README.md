# MD Annotation

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/md-annotation?logo=github)](https://github.com/jsglazer/md-annotation/releases) [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/md-annotation/blob/main/LICENSE) [![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai) [![Gemini Flash Antigravity](https://img.shields.io/badge/Gemini%20Flash-Antigravity-4f86f7?logo=google-gemini&logoColor=white)](https://github.com/google-gemini)

Delimiter-free annotations and comments for [Obsidian](https://obsidian.md). Highlight any text — down to a single character — and attach comments, without ever writing markers, tags, or delimiters into your note body. Notes stay clean for reading, printing, and exporting.

MD Annotation is the delimiter-free successor to [Annotation Manager](https://github.com/jsglazer/annotation-manager): the same highlighting and commenting workflow, with all anchoring moved out of the text.

## How it works

- **Anchoring** — every highlight is stored as a W3C-style [TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector): the exact quote plus ~32 characters of surrounding context on each side. A staged matcher (exact → context-anchored → fuzzy similarity) re-finds each highlight every time the note changes.
- **Storage** — annotations live in a comment block at the bottom of the note, one compact JSON object per line. The `format` field stores the format's *name* from settings (e.g. `"Yellow"`, `"Key"`), so the block stays human-readable:

  ```
  %%md-annotation
  {"id":"…","type":"highlight","format":"Yellow","selector":{…},…}
  {"id":"…","type":"comment","format":"","selector":{"exact":"",…},"comment":"…",…}
  %%
  ```

  Line-delimited JSON means a sync or Git merge conflict corrupts at most one line — every other annotation still loads, and the damaged line is preserved verbatim and flagged in the sidebar instead of being deleted.
- **Rendering** — highlights are applied transiently: CodeMirror decorations in Live Preview / Source mode, wrapped spans in Reading View. Nothing is ever written into the body text.
- **Self-healing** — when an edit shifts a highlight and it re-resolves with high confidence, the refreshed selector is saved back automatically. Low-confidence or ambiguous matches are flagged as *orphaned* — the plugin never guesses.

## Annotations vs. comments

The two are distinguished by whether text is selected when you run the single **Annotate** command:

- **Annotation** — text is selected → the selection is highlighted in one of your formats.
- **Comment** — nothing is selected → a small 💬 marker icon is inserted at the cursor, anchored purely by its surrounding context (an empty-quote point selector). Click the marker to open the sidebar and write the comment.

## Features

- **Highlights** with unlimited custom formats — per-format Use toggle, font/background colors (each with its own enable checkbox) per light/dark theme, and an optional font size
- **Point comments** — a marker icon at any spot in the text, no selection needed; styled by the dedicated comment format
- **Sidebar** listing every annotation of the active note: jump to a highlight, edit comments, **reassign an annotation to a different format** via a dropdown, open/close status, delete
- **Show/hide formatting** on demand — commands and settings toggles to hide annotation colors, comment colors, or comment markers entirely
- **Format renames propagate** — rename a format in settings and every note referencing the old name is rewritten automatically
- **Queryable from Dataview / Datacore** — a public JS API for `dataviewjs` / `datacorejs` blocks (see below)
- **Orphan repair** — orphaned annotations are flagged; select the new text and re-anchor with one click
- **Metadata** on every annotation: author (from settings), status, created / modified / closed timestamps
- **Mobile support** — no desktop-only APIs

## Commands

| Command | Action |
| --- | --- |
| **Annotate** | Selection → highlight it (pick a format if more than one is enabled); no selection → insert a comment marker at the cursor |
| **Show/hide annotation formats** | Toggle highlight colors on annotated text |
| **Show/hide comment formats** | Toggle colors on comment markers |
| **Open annotation sidebar** | Open the annotations panel |

The Annotate action is also in the editor context menu — shown as *Annotate selection* or *Insert comment* depending on whether text is selected.

## Settings

Settings are organized into **General / Annotations / Comments** tabs:

- **General** — the author name recorded on every annotation you create
- **Annotations** — a formatting visibility toggle, plus a per-format grid: Use checkbox, editable name, Fr/Bg colors for light and dark themes (each color has its own enable checkbox), font size, and a live sample-text example. Renaming a format here also updates every annotated note.
- **Comments** — hide-markers and formatting toggles, plus the dedicated comment format's Fr/Bg colors per theme with a live example

## Querying with Dataview / Datacore

The annotation block is line-delimited JSON, so plain DQL can't read it — instead the plugin exposes a stable API for `dataviewjs` / `datacorejs` blocks:

```js
const api = app.plugins.plugins['md-annotation'].api;
const anns = await api.getAnnotations(dv.current().file.path); // one note
const all  = await api.getAllAnnotations();                    // whole vault

dv.table(['Quote', 'Format', 'Comment', 'Author', 'Created'],
  anns.filter(a => a.status === 'open')
      .map(a => [a.selector.exact, a.format, a.comment, a.author, a.dateCreate]));
```

Returned objects are deep copies — mutate them freely without touching plugin state or note data.

## Install (manual)

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/md-annotation/` and enable the plugin.

## Development

```bash
npm install
npm run build   # type-check + bundle main.js
npm test        # headless unit tests (Vitest)
npm run lint    # eslint src
```

The matching engine, block parser, and write queue are pure modules under `src/core/` with no dependency on Obsidian or the DOM, and are fully covered by headless tests.

## License

[MIT](LICENSE)
