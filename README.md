# MD Annotation

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/md-annotation?logo=github)](https://github.com/jsglazer/md-annotation/releases) [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/md-annotation/blob/main/LICENSE) [![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai) [![Gemini Flash Antigravity](https://img.shields.io/badge/Gemini%20Flash-Antigravity-4f86f7?logo=google-gemini&logoColor=white)](https://github.com/google-gemini)

Delimiter-free annotations and comments for [Obsidian](https://obsidian.md). Highlight any text — down to a single character — and attach comments, without ever writing markers, tags, or delimiters into your note body. Notes stay clean for reading, printing, and exporting.

MD Annotation is the delimiter-free successor to [Annotation Manager](https://github.com/jsglazer/annotation-manager): the same highlighting and commenting workflow, with all anchoring moved out of the text.

## How it works

- **Anchoring** — every highlight is stored as a W3C-style [TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector): the exact quote plus ~32 characters of surrounding context on each side. A staged matcher (exact → context-anchored → fuzzy similarity) re-finds each highlight every time the note changes.
- **Storage** — annotations live in a comment block at the bottom of the note, one compact JSON object per line. The `category` field stores the category's *name* from settings (e.g. `"Yellow"`, `"Key"`), so the block stays human-readable:

  ```
  %%md-annotation
  {"id":"…","type":"highlight","category":"Yellow","selector":{…},…}
  {"id":"…","type":"comment","category":"","selector":{"exact":"",…},"comment":"…",…}
  %%
  ```

  Line-delimited JSON means a sync or Git merge conflict corrupts at most one line — every other annotation still loads, and the damaged line is preserved verbatim and flagged in the sidebar instead of being deleted. The block can be **hidden from view** (see [Note layout](#note-layout)) without moving it out of the file.

  > Before v1.0.20 this field was called `format`. Both spellings are read, and a note still on the old key is rewritten onto `category` the first time the plugin parses it — no action needed, and nothing else in the line changes.
- **Rendering** — highlights are applied transiently: CodeMirror decorations in Live Preview / Source mode, wrapped spans in Reading View. Nothing is ever written into the body text.
- **Writing back** — when the plugin has to update the block (a self-healed selector, a comment you typed, a status change) and the note is open for editing, the edit goes **through that editor** rather than to disk behind it, outside the undo history. Obsidian therefore has nothing to merge, so editing near an annotation no longer raises *"File modified externally, merging changes automatically"*, and ⌘Z still undoes your own typing. Notes no editor holds are written to the vault as before.
- **Tables** — Obsidian renders a table as its own block, so annotations inside one are drawn through the same path Reading View uses rather than as editor decorations. The plugin works out which cell it is looking at by matching the rendered table's shape back to the table in the note, then places the annotation at its exact offset within that cell. If a note contains two structurally identical tables there is no way to tell them apart, so it leaves those annotations undrawn rather than risk putting them in the wrong table — they stay intact and editable in the sidebar.
- **Margin cards** — the optional gutter draws each note as a card in the margin, level with the line it belongs to. In the editor the positions come from CodeMirror's own geometry; in Reading View they are measured from the rendered spans. Both share the same card, so a note reads and edits identically wherever you are.
- **Self-healing** — when an edit shifts a highlight and it re-resolves with high confidence, the refreshed selector is saved back automatically. Low-confidence or ambiguous matches are flagged as *orphaned* — the plugin never guesses. **Fix orphans** searches again at a lower confidence bar when you ask it to (see below).
- **Maths** — an annotation covering inline LaTeX highlights the rendered formula, not just the text around it. Live Preview and Reading View each swap the source for something the ordinary highlight cannot reach — a CodeMirror widget in one, a MathJax container in the other — so the plugin styles those elements directly instead.

## Annotations vs. comments

The two are distinguished by whether text is selected when you run the single **Annotate** command:

- **Annotation** — text is selected → the selection is highlighted in one of your categories.
- **Comment** — nothing is selected → a small 💬 marker icon is inserted at the cursor, anchored purely by its surrounding context (an empty-quote point selector). Click the marker to open the sidebar and write the comment.

## Features

- **Highlights** with unlimited custom categories — per-category Use toggle, font/background colors (each with its own enable checkbox) per light/dark theme, and an optional font size for the highlighted text
- **Point comments** — a **numbered** marker icon at any spot in the text, no selection needed; styled by the dedicated comment category or any annotation category
- **Sidebar** listing every annotation of the active note: **click an entry to jump to it in the text**, edit comments, and **reassign an annotation (or comment) to a different category** via a dropdown — with open/closed status (an outlined square, filled once closed) and delete sitting beside it as icon buttons. Comment entries show their **line number in the top right** of the card.
- **Works inside tables** — highlights and comments anchor in table cells and render there in Live Preview, Source mode and Reading View, like anywhere else in the note
- **Sidebar toolbar** — **search** across both the **annotated text** and every note/comment box (so a phrase you highlighted is findable even with no note attached), a **category filter** built from the identifiers actually present in the open note (so you can show only your `Key` or `Define` entries), and **First / Last** buttons that scroll the list to either end. The toolbar is **pinned to the top** of the panel, so it stays reachable however far down the list you scroll.
- **Margin gutter** — show notes as **editable cards in the margin**, level with the line they're anchored to and joined to it by a leader line. Annotations and comments switch on separately and can occupy **opposite margins**; the width is yours to set. Works in **Live Preview, Source mode _and_ Reading View**. Click a card to scroll the sidebar to the same entry. A gutter drops itself automatically while a pane is too narrow to spare the room.
- **Two-way navigation** — click annotated text or a comment marker to jump to its sidebar entry (and focus its comment box); on open the sidebar scrolls to the entry nearest the cursor. Clicking into an entry's note box flashes that annotation in the text so you can see what you're writing about.
- **Text ⇄ sidebar sync** — the sidebar tracks the entry nearest the cursor as you move through the note. On by default; switchable from settings or the **Sync text and sidebar** command (the two are one state).
- **Share categories between vaults** — export every category to the clipboard as JSON and import it in another vault, merging into what's already there or replacing the set outright. Obsidian Sync replicates a vault to your *other devices*, never to your *other vaults*, so this is the way categories travel.
- **Copy and paste text with its annotations** — **Copy selection with annotations** takes the selected text *and* every highlight and comment covering it; **Paste with annotations** drops that text into another note and re-anchors them there. Ordinary copy/paste is untouched, so nothing happens by surprise.
- **Show/hide colors** on demand — commands and settings toggles to hide annotation colors, comment colors, or comment markers entirely
- **Hide the annotation block** — collapse the `%%md-annotation` JSON out of Live Preview and Source mode so the foot of the note reads as clean as it prints, with an optional **rule under the last line of text** (colour configurable per theme) marking where the note ends
- **Category renames propagate** — rename a category in settings and every note referencing the old name is rewritten automatically
- **A command per category** — each category automatically gets its own **Apply - _name_** command (usable from the Command Palette, a hotkey, or a toolbar); adding, renaming, or deleting a category creates or removes its command instantly
- **Note Toolbar integration** — a paste-in script builds a live "apply category" menu from those commands, so you can highlight the selection (or drop a comment at the cursor) from a [Note Toolbar](https://github.com/chrisgurney/obsidian-note-toolbar) button (see below). A toolbar button bound to a gutter toggle — or to *Text click jumps to sidebar* — can also **carry its own background color for the on and off state**, so the toolbar shows its state at a glance.
- **Queryable from Dataview / Datacore** — a public JS API for `dataviewjs` / `datacorejs` / `datacorejsx` blocks (see below)
- **Orphan repair** — orphaned annotations get their own sidebar section. **Fix orphans** searches the note again at a lower confidence bar and re-anchors everything it can place unambiguously; anything still in doubt waits for you to select the new text and re-anchor it with one click. Optionally automatic.
- **Highlights LaTeX** — annotations spanning inline maths (`$x > 0$`) are highlighted in Live Preview and Reading View as well as Source mode, formula included
- **Metadata** on every annotation: author (from settings), status, created / modified / closed timestamps
- **Mobile support** — no desktop-only APIs

## Commands

| Command | Action |
| --- | --- |
| **Annotate** | Selection → highlight it (pick a category if more than one is enabled); no selection → insert a comment marker at the cursor |
| **Copy selection with annotations** | Copy the selected text together with every annotation and comment covering it. The plain text also goes to the system clipboard, so an ordinary paste still works as usual |
| **Paste with annotations** | Insert the text from the last *Copy selection with annotations* at the cursor and re-anchor its annotations in this note |
| **Apply - _name_** (one per category) | Apply that specific category directly: selection → highlight it; no selection → drop a comment marker in that category's color. Registered and removed automatically as categories change. |
| **Show/hide annotation colors** | Toggle highlight colors on annotated text |
| **Show/hide comment colors** | Toggle colors on comment markers |
| **Show/hide the annotation block** | Collapse the `%%md-annotation` block at the foot of the note out of Live Preview and Source mode. Flips the same persisted setting shown on the General tab. |
| **Show/hide the end-of-text line** | Draw a rule at the very end of the note's text. Flips the same persisted setting shown on the General tab. |
| **Show/hide annotations in the gutter** | Toggle the margin cards for annotations. Flips the same persisted setting shown on the Gutter tab. |
| **Show/hide comments in the gutter** | Toggle the margin cards for comments. Flips the same persisted setting shown on the Gutter tab. |
| **Sync text and sidebar** | Toggle continuous syncing of the sidebar to the entry nearest the cursor. Flips the same persisted setting shown on the General tab. |
| **Text click jumps to sidebar** | Toggle whether clicking annotated text or a comment marker opens the sidebar. Flips the same persisted setting shown on the General tab — turn off if clicking into an annotation to select or copy text keeps distractingly popping the sidebar open. |
| **Toggle annotation sidebar** | Show the annotations panel if it's hidden, hide it if it's showing (also bound to the ribbon icon) |

The Annotate action is also in the editor context menu — shown as *Annotate selection* or *Insert comment* depending on whether text is selected.

## Settings

Settings are organized into **General / Annotations / Comments / Gutter / Note Toolbar** tabs:

- **General** — the author name recorded on every annotation you create; three **navigation** toggles (all on by default); the **note layout** options; the **orphaned annotations** toggle; and **category export / import**
- **Annotations** — a colour visibility toggle, plus a per-category grid: Use checkbox, editable name, Fr/Bg colors for light and dark themes (each color has its own enable checkbox), font size, and a live sample-text example. Renaming a category here also updates every annotated note.
- **Comments** — hide-markers and colour toggles, plus the dedicated comment category's Fr/Bg colors per theme with a live example
- **Gutter** — everything about the margin cards: show-toggles and left/right margin choice for annotations and for comments independently, the shared width, and a card font size per type
- **Note Toolbar** — the optional button highlight: bind a [Note Toolbar](https://github.com/chrisgurney/obsidian-note-toolbar) button to a toggle and give it a background color to wear while that toggle is on, and another for while it's off (see below)

### The margin gutter

Notes can be shown as cards in the page margin instead of (or as well as) in the sidebar — each level with the line it's anchored to, joined by a leader line, and editable in place. Cards that would overlap are pushed down, with the leader stretching back up to the right line.

| Setting | Effect |
| --- | --- |
| **Show annotations / comments in the gutter** | Switch each type on separately (also toggled by its command) |
| **Annotation / comment gutter side** | Which margin each type uses — they can sit in opposite margins |
| **Gutter width** | Room each gutter takes from the note, 140–480 px |
| **Annotation / comment card font size** | Text size inside the margin cards, set per type. Independent of a category's own Size, which styles the highlighted text and the sidebar — so the cards can be sized without touching either. Blank uses the theme default |
| **Only on notes with annotations** | Reserve the margin per note instead of vault-wide — on by default |

It works in Live Preview, Source mode and Reading View. Clicking a card scrolls the sidebar to the matching entry when the sidebar is already open. Orphaned annotations have no line to sit beside, so they stay in the sidebar where they can be re-anchored.

**Only on notes with annotations** keeps unannotated notes at their full width and opens the margin the first time a note has a card to put there — per type, so a note holding only comments opens only the comment margin. The reflow is animated, and a margin that is already open stays open while an annotation is temporarily orphaned, so editing the very text a highlight is anchored to never collapses the page under your cursor. Turn it off to keep a constant text width across every note.

### Note Toolbar button highlight

If [Note Toolbar](https://github.com/chrisgurney/obsidian-note-toolbar) is installed, the **Note Toolbar** tab can bind each of three toggle commands to one of its buttons: pick the toolbar and the button, then set the background color it wears while that toggle is **On** and while it is **Off**, per light and dark theme.

| Button | Follows |
| --- | --- |
| **Annotations** | *Show/hide annotations in the gutter* |
| **Comments** | *Show/hide comments in the gutter* |
| **Text click** | *Text click jumps to sidebar* |

Each has its own row of Light/Dark **On/Off** cells in the grid, so the three buttons can read differently. Either color can be left unticked, which hands that state back to Note Toolbar's own styling — **Off** starts unticked, so out of the box only "on" stands out. Backgrounds only: the button's icon and label color stay Note Toolbar's. The tab disappears into a one-line notice when Note Toolbar isn't installed — there's nothing to point at.

### Note layout

Two General-tab options control what the note itself looks like around the annotation data. Both are **off by default** and both have a command, so they can be flipped from a hotkey or a toolbar button.

| Setting / command | Effect |
| --- | --- |
| **Hide the annotation block** — *Show/hide the annotation block* | Collapses the whole `%%md-annotation` block (markers and JSON) out of Live Preview and Source mode. Reading View never showed it, since Obsidian hides `%%` comments there. The block is only hidden from view — it is still in the file, still written to, and still the source of truth |
| **Show a line at the end of the text** — *Show/hide the end-of-text line* | Draws a rule at the very end of the note's text, giving it a visible bottom edge once the block is hidden. It sits on the last line before the `%%md-annotation` block, or on the last line of the document when there is none — **trailing blank lines included**, so the rule marks where the note actually ends rather than where its last words are. A note with no body text at all draws no rule |

The rule's colour is set per theme, with the same checkbox / swatch / hex cells as the annotation categories. Uncheck a theme to fall back to whatever divider colour the theme itself uses.

### Navigation toggles

Each direction of the text ⇄ sidebar link can be switched off independently:

| Toggle | Effect when on |
| --- | --- |
| **Sync text and sidebar** | Moving the cursor in the note scrolls the sidebar to the nearest entry |
| **Sidebar click jumps to text** | Clicking a sidebar entry selects and scrolls to that text in the note |
| **Text click jumps to sidebar** | Clicking annotated text or a comment marker opens the sidebar, scrolls to that entry, and puts the cursor in its comment box |

### Orphaned annotations

An annotation is *orphaned* when the text it was anchored to has changed too much to be recognised, or when two places in the note are equally good matches. Orphans are listed in their own section of the sidebar with the reason, and are never drawn in the note — the plugin would rather show you a broken anchor than move a highlight onto the wrong words.

**Fix orphans**, at the top of that section, searches the note again at a lower confidence bar than everyday matching uses, and re-anchors each orphan that lands somewhere unambiguous — re-capturing its quote and context from where it actually landed. Two plausible sites are still never chosen between, at any bar: those stay orphaned for you to select the new text and press **Re-anchor to selection**.

**Fix orphans automatically** (General → Orphaned annotations) runs the same pass whenever a note is read, so orphans repair themselves without the button. It is **off by default** — a repair at the lower bar can move a highlight without you seeing it happen, and an orphan you can see and fix is easier to live with than one that quietly went somewhere else.

### Sharing categories between vaults

Categories are stored in the vault's own `data.json`. Obsidian Sync replicates one vault to that same vault on your other devices — it never bridges two different vaults — so categories added in one vault never show up in another on their own. To move them:

1. In the source vault: **Settings → MD Annotation → General → Export categories → Copy to clipboard**.
2. In the target vault: **Import categories → Paste and import**, then choose **Merge** or **Replace all**.

**Merge** adds only the categories the target vault doesn't already have, leaving any category you've tuned there untouched. **Replace all** swaps the whole set and is confirmed separately — annotations referencing a category that isn't in the payload fall back to the first enabled category until you reassign them.

## Copying annotated text between notes

Copying text the ordinary way copies only the characters — the selectors stay behind in the source note's block, so the highlights don't travel. Two commands close that gap without touching ordinary copy/paste:

1. Select the text and run **Copy selection with annotations**. The selection is stashed together with every highlight and comment covering it, and the plain text goes to the system clipboard as usual.
2. In the destination note, put the cursor where it belongs and run **Paste with annotations**. The text is inserted and its annotations are re-anchored against their new surroundings.

Details worth knowing:

- Each pasted annotation gets a **fresh id** — two notes never share one — while its **author, category, comment, status and created date** come across unchanged. The modified date is stamped at paste time.
- An annotation the selection **cuts in half** travels with its quote clipped to the copied portion; it re-anchors on context at the destination. Comments travel when their marker falls inside the selection.
- **Orphaned** annotations stay behind — there's no text to copy them from.
- The stash lives in memory for the session: it doesn't survive a restart, and it doesn't reach another Obsidian window. Copy again in the new session and paste as normal.

## Note Toolbar: an "apply category" menu

Each category has its own `md-annotation:apply-<name>` command, so [Note Toolbar](https://github.com/chrisgurney/obsidian-note-toolbar) can present all your categories in one pop-up menu that stays in sync automatically — no manual toolbar editing when you add or rename a category.

1. In Note Toolbar, enable **Other → Scripting**, then add a toolbar item of type **JavaScript**.
2. Paste in the script from [`docs/note-toolbar-menu.js`](docs/note-toolbar-menu.js).

Clicking the item opens a menu of every category; picking one runs its command against the active editor — selection → highlight, bare cursor → comment. The script discovers categories from the live command list, so nothing needs updating as categories change.

Scripts can also read the category list directly from the plugin API:

```js
const api = app.plugins.plugins['md-annotation'].api;
api.getCategoryNames();               // e.g. ['Yellow', 'Key', 'EditThis']
api.getCategoryCommandId('EditThis'); // 'md-annotation:apply-EditThis' (or null)
```

`getFormatNames()` and `getFormatCommandId()` are kept as aliases of these two, so scripts written before v1.0.20 keep working unchanged.

## Querying with Dataview / Datacore

The annotation block is line-delimited JSON, so **plain DQL (` ```dataview ` ) can't read it** — there are no frontmatter or inline fields to query. Instead the plugin exposes a stable JS API reachable from any script block:

```js
const api = app.plugins.plugins['md-annotation'].api;
await api.getAnnotations(path);   // Annotation[] for one note
await api.getAllAnnotations();    // [{ path, annotations }] for the whole vault
```

Each `Annotation` has `id`, `type` (`'highlight'` | `'comment'`), `category`, `selector` (`{ exact, prefix, suffix }`), `comment`, `author`, `status` (`'open'` | `'closed'`), and `dateCreate` / `dateModified` / `dateClosed`. Returned objects are deep copies — mutate them freely without touching plugin state or note data.

For compatibility with script blocks written before v1.0.20, each returned object **also** carries a `format` key holding the same value as `category`.

### DataviewJS

```dataviewjs
const api = app.plugins.plugins['md-annotation'].api;
const anns = await api.getAnnotations(dv.current().file.path);
dv.table(['Quote', 'Category', 'Comment', 'Author', 'Created'],
  anns.filter(a => a.status === 'open')
      .map(a => [a.selector.exact || '(comment)', a.category || 'Comment', a.comment, a.author, a.dateCreate.slice(0, 10)]));
```

Vault-wide — every open annotation across all notes:

```dataviewjs
const api = app.plugins.plugins['md-annotation'].api;
const files = await api.getAllAnnotations();
dv.table(['Note', 'Type', 'Quote / Comment', 'Category'],
  files.flatMap(f => f.annotations
    .filter(a => a.status === 'open')
    .map(a => [dv.fileLink(f.path), a.type, a.selector.exact || a.comment, a.category || 'Comment'])));
```

### DatacoreJS

```datacorejs
const api = app.plugins.plugins['md-annotation'].api;
const anns = await api.getAnnotations(dc.currentPath());
return dc.table(
  ['Quote', 'Category', 'Comment', 'Status'],
  anns.map(a => [a.selector.exact || '(comment)', a.category || 'Comment', a.comment, a.status]),
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
          <b>{a.category || 'Comment'}</b>: {a.selector.exact || a.comment} <i>({a.status})</i>
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
