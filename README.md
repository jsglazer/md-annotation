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
- **Point comments** — a **numbered** marker icon at any spot in the text, no selection needed; styled by the dedicated comment format or any annotation format
- **Sidebar** listing every annotation of the active note: **click an entry to jump to it in the text**, edit comments, **reassign an annotation (or comment) to a different format** via a dropdown, open/close status, delete (with confirmation)
- **Two-way navigation** — click annotated text or a comment marker to jump to its sidebar entry (and focus its comment box); on open the sidebar scrolls to the entry nearest the cursor
- **Text ⇄ sidebar sync** — an optional mode (command **Sync text and sidebar**) that keeps the sidebar tracking the entry nearest the cursor as you move through the note
- **Show/hide formatting** on demand — commands and settings toggles to hide annotation colors, comment colors, or comment markers entirely
- **Format renames propagate** — rename a format in settings and every note referencing the old name is rewritten automatically
- **A command per format** — each format automatically gets its own **Apply - _name_** command (usable from the Command Palette, a hotkey, or a toolbar); adding, renaming, or deleting a format creates or removes its command instantly
- **Note Toolbar integration** — a paste-in script builds a live "apply format" menu from those commands, so you can highlight the selection (or drop a comment at the cursor) from a [Note Toolbar](https://github.com/chrisgurney/obsidian-note-toolbar) button (see below)
- **Queryable from Dataview / Datacore** — a public JS API for `dataviewjs` / `datacorejs` / `datacorejsx` blocks (see below)
- **Orphan repair** — orphaned annotations are flagged; select the new text and re-anchor with one click
- **Metadata** on every annotation: author (from settings), status, created / modified / closed timestamps
- **Mobile support** — no desktop-only APIs

## Commands

| Command | Action |
| --- | --- |
| **Annotate** | Selection → highlight it (pick a format if more than one is enabled); no selection → insert a comment marker at the cursor |
| **Apply - _name_** (one per format) | Apply that specific format directly: selection → highlight it; no selection → drop a comment marker in that format's color. Registered and removed automatically as formats change. |
| **Show/hide annotation formats** | Toggle highlight colors on annotated text |
| **Show/hide comment formats** | Toggle colors on comment markers |
| **Sync text and sidebar** | Toggle continuous syncing of the sidebar to the entry nearest the cursor |
| **Open annotation sidebar** | Open the annotations panel |

The Annotate action is also in the editor context menu — shown as *Annotate selection* or *Insert comment* depending on whether text is selected.

## Settings

Settings are organized into **General / Annotations / Comments** tabs:

- **General** — the author name recorded on every annotation you create
- **Annotations** — a formatting visibility toggle, plus a per-format grid: Use checkbox, editable name, Fr/Bg colors for light and dark themes (each color has its own enable checkbox), font size, and a live sample-text example. Renaming a format here also updates every annotated note.
- **Comments** — hide-markers and formatting toggles, plus the dedicated comment format's Fr/Bg colors per theme with a live example

## Note Toolbar: an "apply format" menu

Each format has its own `md-annotation:apply-<name>` command, so [Note Toolbar](https://github.com/chrisgurney/obsidian-note-toolbar) can present all your formats in one pop-up menu that stays in sync automatically — no manual toolbar editing when you add or rename a format.

1. In Note Toolbar, enable **Other → Scripting**, then add a toolbar item of type **JavaScript**.
2. Paste in the script from [`docs/note-toolbar-menu.js`](docs/note-toolbar-menu.js).

Clicking the item opens a menu of every format; picking one runs its command against the active editor — selection → highlight, bare cursor → comment. The script discovers formats from the live command list, so nothing needs updating as formats change.

Scripts can also read the format list directly from the plugin API:

```js
const api = app.plugins.plugins['md-annotation'].api;
api.getFormatNames();               // e.g. ['Yellow', 'Key', 'EditThis']
api.getFormatCommandId('EditThis'); // 'md-annotation:apply-EditThis' (or null)
```

## Querying with Dataview / Datacore

The annotation block is line-delimited JSON, so **plain DQL (` ```dataview ` ) can't read it** — there are no frontmatter or inline fields to query. Instead the plugin exposes a stable JS API reachable from any script block:

```js
const api = app.plugins.plugins['md-annotation'].api;
await api.getAnnotations(path);   // Annotation[] for one note
await api.getAllAnnotations();    // [{ path, annotations }] for the whole vault
```

Each `Annotation` has `id`, `type` (`'highlight'` | `'comment'`), `format`, `selector` (`{ exact, prefix, suffix }`), `comment`, `author`, `status` (`'open'` | `'closed'`), and `dateCreate` / `dateModified` / `dateClosed`. Returned objects are deep copies — mutate them freely without touching plugin state or note data.

### DataviewJS

```dataviewjs
const api = app.plugins.plugins['md-annotation'].api;
const anns = await api.getAnnotations(dv.current().file.path);
dv.table(['Quote', 'Format', 'Comment', 'Author', 'Created'],
  anns.filter(a => a.status === 'open')
      .map(a => [a.selector.exact || '(comment)', a.format || 'Comment', a.comment, a.author, a.dateCreate.slice(0, 10)]));
```

Vault-wide — every open annotation across all notes:

```dataviewjs
const api = app.plugins.plugins['md-annotation'].api;
const files = await api.getAllAnnotations();
dv.table(['Note', 'Type', 'Quote / Comment', 'Format'],
  files.flatMap(f => f.annotations
    .filter(a => a.status === 'open')
    .map(a => [dv.fileLink(f.path), a.type, a.selector.exact || a.comment, a.format || 'Comment'])));
```

### DatacoreJS

```datacorejs
const api = app.plugins.plugins['md-annotation'].api;
const anns = await api.getAnnotations(dc.currentPath());
return dc.table(
  ['Quote', 'Format', 'Comment', 'Status'],
  anns.map(a => [a.selector.exact || '(comment)', a.format || 'Comment', a.comment, a.status]),
);
```

### DatacoreJSX

```datacorejsx
function Annotations() {
  const api = app.plugins.plugins['md-annotation'].api;
  const [anns, setAnns] = dc.useState([]);
  dc.useEffect(() => { api.getAnnotations(dc.currentPath()).then(setAnns); }, []);
  return (
    <dc.Group>
      {anns.map(a => (
        <div key={a.id}>
          <b>{a.format || 'Comment'}</b>: {a.selector.exact || a.comment} <i>({a.status})</i>
        </div>
      ))}
    </dc.Group>
  );
}
return <Annotations />;
```

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
