# MD Annotation

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/md-annotation?logo=github)](https://github.com/jsglazer/md-annotation/releases) [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/md-annotation/blob/main/LICENSE) [![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai) [![Gemini Flash Antigravity](https://img.shields.io/badge/Gemini%20Flash-Antigravity-4f86f7?logo=google-gemini&logoColor=white)](https://github.com/google-gemini)

Delimiter-free annotations and comments for [Obsidian](https://obsidian.md). Highlight any text — down to a single character — and attach comments, without ever writing markers, tags, or delimiters into your note body. Notes stay clean for reading, printing, and exporting.

MD Annotation is the delimiter-free successor to [Annotation Manager](https://github.com/jsglazer/annotation-manager): the same highlighting and commenting workflow, with all anchoring moved out of the text.

## How it works

- **Anchoring** — every highlight is stored as a W3C-style [TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector): the exact quote plus ~32 characters of surrounding context on each side. A staged matcher (exact → context-anchored → fuzzy similarity) re-finds each highlight every time the note changes.
- **Storage** — annotations live in a comment block at the bottom of the note, one compact JSON object per line:

  ```
  %%md-annotation
  {"id":"…","type":"highlight","format":"default","selector":{…},…}
  {"id":"…","type":"comment","selector":{…},"comment":"…",…}
  %%
  ```

  Line-delimited JSON means a sync or Git merge conflict corrupts at most one line — every other annotation still loads, and the damaged line is preserved verbatim and flagged in the sidebar instead of being deleted.
- **Rendering** — highlights are applied transiently: CodeMirror decorations in Live Preview / Source mode, wrapped spans in Reading View. Nothing is ever written into the body text.
- **Self-healing** — when an edit shifts a highlight and it re-resolves with high confidence, the refreshed selector is saved back automatically. Low-confidence or ambiguous matches are flagged as *orphaned* — the plugin never guesses.

## Features

- **Highlights** with unlimited custom formats — font and background color per light/dark theme
- **Comments** anchored to text, edited in a dedicated sidebar panel, with a single comment format or reuse of the annotation formats
- **Sidebar** listing every annotation of the active note: jump to a highlight, edit comments, open/close status, delete
- **Orphan repair** — orphaned annotations are flagged; select the new text and re-anchor with one click
- **Metadata** on every annotation: author (from settings), status, created / modified / closed timestamps
- **Mobile support** — no desktop-only APIs

## Commands

| Command | Action |
| --- | --- |
| **Annotate selection** | Highlight the selected text (pick a format if more than one is defined) |
| **Comment on selection** | Anchor a comment to the selected text and open the sidebar |
| **Open annotation sidebar** | Open the annotations panel |

Both actions are also in the editor context menu for a selection.

## Settings

- **Author** — the name recorded on every annotation you create
- **Annotation formats** — add as many formats as you like; each has font/background colors for light and dark themes
- **Comments** — use one dedicated comment format, or pick from the annotation formats per comment

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
