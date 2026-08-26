/*
 * MD Annotation — Note Toolbar "Apply category" menu
 * --------------------------------------------------
 * Paste this into a Note Toolbar item of type **JavaScript**
 * (Note Toolbar → enable Other → Scripting → add a JavaScript item).
 *
 * Clicking the toolbar item opens a menu listing every annotation category
 * defined in MD Annotation. Picking one applies that category to the current
 * selection (as a highlight) or, with no selection, at the cursor (as a
 * comment). The menu stays in sync automatically as you add, rename, or delete
 * categories in the plugin settings — nothing here needs editing.
 *
 * How it works: MD Annotation registers one command per category
 * (`md-annotation:apply-<name>`). This script collects those commands and hands
 * them to ntb.menu(), which runs the chosen command against the active editor —
 * the same code path as the Command Palette, so the selection/cursor is honored.
 */

const PREFIX = 'md-annotation:apply-';

const items = Object.values(ntb.app.commands.commands)
  .filter((c) => c.id.startsWith(PREFIX))
  .map((c) => ({
    type: 'command',
    value: c.id,
    // Command name is "MD Annotation: Apply - <name>"; show just "<name>".
    label: c.name.replace(/^.*Apply - /, ''),
    icon: 'highlighter',
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

if (items.length === 0) {
  new Notice('MD Annotation: no categories defined');
} else {
  await ntb.menu(items, { position: 'cursor' });
}
