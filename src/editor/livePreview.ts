// CodeMirror 6 integration: transient mark decorations for Live Preview and
// Source mode, plus widget decorations for point comments (comments added
// with no selection render as a small marker icon). Nothing is ever written
// into the document here — highlights exist only as decorations that map
// through edits between resolutions.
//
// The ViewPlugin below is also how the plugin obtains EditorView handles:
// CodeMirror instantiates it per editor, so no undocumented Obsidian
// internals are needed to reach the editor or dispatch effects.

import { StateEffect, StateField } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { editorInfoField, setIcon } from 'obsidian';

import { findBlockRange } from '../core/block';
import { selectDecorationRanges } from '../core/decorations';
import type { MatchResult } from '../core/matcher';
import { numberComments } from '../core/ordering';
import type { MdAnnotationSettings } from '../core/settings';
import {
	BODY_END_LINE_CLASS,
	WIDGET_HL_CLASS,
	bodyEndLineColor,
	highlightClasses,
	highlightStyleText,
	markerClasses,
} from '../core/settings';
import type { Annotation } from '../core/types';

// Replaces the current decoration set wholesale after a resolution pass.
export const setAnnotationDecorations = StateEffect.define<DecorationSet>({
	map: (value, mapping) => value.map(mapping),
});

// Between resolutions, existing decorations are mapped through document
// changes so highlights track the text the user is editing.
export const annotationDecoField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		let next = deco.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(setAnnotationDecorations)) next = effect.value;
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

// Minimal surface main.ts must offer the editor layer.
export interface EditorHost {
	attachEditor(view: EditorView): void;
	detachEditor(view: EditorView): void;
	scheduleEditorResolve(view: EditorView, delayMs: number): void;
	// Annotated text (highlight span or comment marker) was clicked in the
	// editor — reveal and focus the matching sidebar entry.
	revealAnnotation(path: string, id: string): void;
	// The cursor/selection moved — used by the "Sync text and sidebar" toggle.
	onEditorSelectionChange(view: EditorView): void;
	// The editor reflowed, resized, or scrolled a new stretch of document into
	// view — the margin gutter re-places its cards from the new geometry.
	onEditorGeometryChange(view: EditorView): void;
}

export const EDITOR_RESOLVE_DEBOUNCE_MS = 250;

// True for an EditorView that is nested inside another one — Obsidian gives a
// Live Preview table cell its own child CodeMirror instance the moment you
// click into it, and registered editor extensions are installed into that
// child as well as the note's real editor.
//
// Such a view must never be treated as the note: its document is ONLY that
// cell's text. Resolving from it parses a document with no %%md-annotation
// block, which replaces the whole file's cached state with an empty one —
// blanking the sidebar and every gutter until an edit in the real editor
// forces a genuine re-parse. (Its ranges also clamp to the cell's length,
// collapsing every annotation into a point comment stacked at one spot.)
//
// view.dom IS the .cm-editor element, so the search starts at its parent.
export function isEmbeddedEditorView(view: EditorView): boolean {
	return view.dom.parentElement?.closest('.cm-editor') != null;
}

export function buildEditorExtension(host: EditorHost): Extension {
	const watcher = ViewPlugin.fromClass(
		class {
			// Checked once here, but deliberately re-checked in the host's
			// resolve pass: a view's DOM may not be attached to its parent yet
			// while its plugins are being constructed, so this can read false
			// for a cell editor that a later, post-timeout check will catch.
			private readonly embedded: boolean;

			constructor(private view: EditorView) {
				this.embedded = isEmbeddedEditorView(view);
				if (this.embedded) return;
				host.attachEditor(view);
				host.scheduleEditorResolve(view, 0);
			}

			update(update: {
				docChanged: boolean;
				selectionSet: boolean;
				geometryChanged: boolean;
				viewportChanged: boolean;
				view: EditorView;
			}): void {
				if (this.embedded) return;
				if (update.docChanged) host.scheduleEditorResolve(update.view, EDITOR_RESOLVE_DEBOUNCE_MS);
				else if (update.selectionSet) host.onEditorSelectionChange(update.view);
				// Resolution is debounced, but the cards already on screen must
				// keep up with the text they point at, so this is not.
				if (update.geometryChanged || update.viewportChanged) {
					host.onEditorGeometryChange(update.view);
				}
			}

			destroy(): void {
				if (this.embedded) return;
				host.detachEditor(this.view);
			}
		},
	);
	// Clicking annotated text reveals its sidebar entry. Marker widgets carry
	// their own listener; this covers mark decorations (highlights/comments).
	const clickReveal = EditorView.domEventHandlers({
		click(event, view): boolean {
			const target = event.target as HTMLElement | null;
			const el = target?.closest('[data-mdann-id]');
			const id = el?.getAttribute('data-mdann-id');
			const path = id ? editorViewPath(view) : null;
			if (id && path) host.revealAnnotation(path, id);
			return false;
		},
	});
	// A mark decoration cannot reach content another extension has replaced
	// with a widget, so highlighted Live Preview widgets are painted from the
	// DOM instead (see paintWidgetHighlights). This hangs off docViewUpdate,
	// not update(): plugin update() methods run BEFORE CodeMirror redraws the
	// document, so they would see the previous set of widget elements.
	// docViewUpdate fires after every redraw, including the viewport-driven
	// ones that scrolling causes without any transaction.
	const widgetPainter = ViewPlugin.fromClass(
		class {
			constructor(private view: EditorView) {}

			docViewUpdate(view: EditorView): void {
				if (isEmbeddedEditorView(view)) return;
				paintWidgetHighlights(view);
			}

			// Belt and braces: docViewUpdate is a relatively recent addition to
			// @codemirror/view, and the copy Obsidian bundles is not ours to
			// pin. A measure-phase write runs after the redraw on every
			// version, so the paint still happens if the hook above is never
			// called. Repainting is idempotent, so doing both is only wasted
			// work, never wrong.
			update(update: { view: EditorView }): void {
				const view = update.view;
				if (isEmbeddedEditorView(view)) return;
				view.requestMeasure({ read: () => null, write: () => paintWidgetHighlights(view) });
			}

			destroy(): void {
				clearWidgetHighlights(this.view);
			}
		},
	);
	return [annotationDecoField, watcher, clickReveal, widgetPainter];
}

// ── Highlighting across Live Preview widgets ───────────────────────────────
//
// CodeMirror never applies a mark decoration to a range that another extension
// has replaced with a widget: it closes the mark span before the widget and
// reopens it after (verified against @codemirror/view 6.43.1 — true regardless
// of `inclusive`, precedence, or whether both decorations come from one set).
// In Live Preview that leaves everything Obsidian renders as an inline widget
// unhighlighted — most visibly inline math, where `$x > 0$` highlights fine in
// Source mode (ordinary text there) but not in Live Preview.
//
// So the widget element is painted directly. CodeMirror's DOMObserver ignores
// mutations whose nearest tile is a widget (`readMutation` returns null for
// them), so touching this DOM cannot feed back into the editor.

// Properties set on a painted widget, removed again when it stops being
// covered. Kept explicit so nothing else on the foreign element is disturbed.
const WIDGET_STYLE_PROPS = [
	'--mdann-light-fg',
	'--mdann-light-bg',
	'--mdann-dark-fg',
	'--mdann-dark-bg',
	'font-size',
];

// CodeMirror gives every non-editable widget contentEditable="false"; nothing
// else inside a line carries it. Our own comment markers are widgets too, and
// carry data-mdann-id — they style themselves and must not be repainted.
function collectWidgetElements(root: Element, out: HTMLElement[]): void {
	for (const child of Array.from(root.children)) {
		const el = child as HTMLElement;
		if (el.hasAttribute('data-mdann-id')) continue;
		if (el.getAttribute('contenteditable') === 'false') {
			out.push(el);
			continue;
		}
		collectWidgetElements(el, out);
	}
}

function unpaintWidget(el: HTMLElement): void {
	el.removeClass(WIDGET_HL_CLASS);
	el.removeAttribute('data-mdann-id');
	for (const prop of WIDGET_STYLE_PROPS) el.style.removeProperty(prop);
	if (el.getAttribute('style') === '') el.removeAttribute('style');
}

export function clearWidgetHighlights(view: EditorView): void {
	for (const el of Array.from(
		view.contentDOM.querySelectorAll<HTMLElement>('.' + WIDGET_HL_CLASS),
	)) {
		unpaintWidget(el);
	}
}

function paintWidgetHighlights(view: EditorView): void {
	clearWidgetHighlights(view);
	const deco = view.state.field(annotationDecoField, false);
	if (!deco) return;

	// The mark decorations, read back from the field so they arrive already
	// mapped through any edits since the last resolution pass.
	const marks: Array<{ from: number; to: number; id: string; style: string }> = [];
	const iter = deco.iter();
	while (iter.value) {
		const spec = iter.value.spec as { attributes?: Record<string, string> } | undefined;
		const id = spec?.attributes?.['data-mdann-id'];
		if (iter.to > iter.from && id !== undefined) {
			marks.push({ from: iter.from, to: iter.to, id, style: spec?.attributes?.style ?? '' });
		}
		iter.next();
	}
	if (marks.length === 0) return;

	const widgets: HTMLElement[] = [];
	collectWidgetElements(view.contentDOM, widgets);
	for (const el of widgets) {
		let pos: number;
		try {
			pos = view.posAtDOM(el);
		} catch {
			// The element is no longer part of the rendered document.
			continue;
		}
		const mark = marks.find((m) => pos >= m.from && pos < m.to);
		if (!mark) continue;
		el.addClass(WIDGET_HL_CLASS);
		// Lets a click on the widget reveal its sidebar entry, exactly as a
		// click on the surrounding highlighted text does.
		el.setAttribute('data-mdann-id', mark.id);
		for (const declaration of mark.style.split(';')) {
			const colon = declaration.indexOf(':');
			if (colon === -1) continue;
			const prop = declaration.slice(0, colon).trim();
			if (!WIDGET_STYLE_PROPS.includes(prop)) continue;
			el.style.setProperty(prop, declaration.slice(colon + 1).trim());
		}
	}
}

// The file path an EditorView is showing, via Obsidian's public state field.
export function editorViewPath(view: EditorView): string | null {
	return view.state.field(editorInfoField, false)?.file?.path ?? null;
}

// Inline marker rendered at a point comment's anchor position. The click
// callback is provided per-decoration pass and deliberately excluded from
// eq() so redraws only happen when the visible bits change.
class CommentMarkerWidget extends WidgetType {
	constructor(
		private annotationId: string,
		private classes: string,
		private styleText: string,
		private label: string,
		private onClick: () => void,
	) {
		super();
	}

	eq(other: CommentMarkerWidget): boolean {
		return (
			other.annotationId === this.annotationId &&
			other.classes === this.classes &&
			other.styleText === this.styleText &&
			other.label === this.label
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const doc = view.dom.ownerDocument;
		const span = doc.createElement('span');
		span.className = this.classes;
		span.setAttribute('data-mdann-id', this.annotationId);
		if (this.styleText !== '') span.setAttribute('style', this.styleText);
		setIcon(span, 'message-square');
		if (this.label !== '') {
			const num = doc.createElement('span');
			num.className = 'mdann-marker-num';
			num.textContent = this.label;
			span.appendChild(num);
		}
		span.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onClick();
		});
		return span;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

// Build and dispatch the decoration set for one editor from resolved matches.
// Range annotations become mark decorations; point comments (start === end)
// become marker widgets. Visibility toggles are applied here:
//   - annotationFormattingEnabled off → no highlight decorations
//   - commentsFormattingEnabled off → range comments undecorated, markers plain
//   - commentsHiddenEnabled on → no markers at all
//   - hideAnnotationBlock on → the %%md-annotation block is replaced away
//   - bodyEndLineEnabled on → a rule under the last line of the body
//
// Which annotations qualify, and over what range, lives in
// core/decorations.ts — including the table and clamping rules.
export function applyEditorDecorations(
	view: EditorView,
	body: string,
	annotations: ReadonlyArray<Annotation>,
	outcomes: ReadonlyMap<string, MatchResult>,
	settings: MdAnnotationSettings,
	onMarkerClick: (annotationId: string) => void,
): void {
	// Only Live Preview swaps a table for a block widget; in Source mode the
	// table is ordinary text and decorates like anything else.
	const livePreview =
		view.dom.closest('.markdown-source-view')?.classList.contains('is-live-preview') ?? false;
	const ranges = selectDecorationRanges(
		view.state.doc.length,
		body,
		annotations,
		outcomes,
		settings,
		livePreview,
	);

	const commentNumbers = numberComments(annotations, outcomes);
	// Collected rather than built in order: the block and end-of-text
	// decorations below are positioned from the document, not from the sorted
	// annotation ranges, so Decoration.set does the ordering.
	const items: Array<Range<Decoration>> = [];
	for (const r of ranges) {
		if (r.from === r.to) {
			const styled = settings.commentsFormattingEnabled;
			const number = commentNumbers.get(r.annotation.id);
			items.push(
				Decoration.widget({
					widget: new CommentMarkerWidget(
						r.annotation.id,
						markerClasses() + (styled ? '' : ' mdann-marker-plain'),
						styled
							? highlightStyleText(r.annotation.type, r.annotation.category, settings)
							: '',
						number !== undefined ? String(number) : '',
						() => onMarkerClick(r.annotation.id),
					),
					side: 1,
				}).range(r.from),
			);
			continue;
		}
		items.push(
			Decoration.mark({
				class: highlightClasses(r.annotation.type, r.annotation.category, settings),
				attributes: {
					'data-mdann-id': r.annotation.id,
					style: highlightStyleText(r.annotation.type, r.annotation.category, settings),
				},
			}).range(r.from, r.to),
		);
	}

	addBlockAndEndLine(view, items, settings);
	view.dispatch({
		effects: setAnnotationDecorations.of(Decoration.set(items, true)),
	});
}

// The two document-level decorations: the collapsed %%md-annotation block and
// the rule under the last line of the body. Both are derived from the block's
// position, so they are worked out together.
function addBlockAndEndLine(
	view: EditorView,
	items: Array<Range<Decoration>>,
	settings: MdAnnotationSettings,
): void {
	if (!settings.hideAnnotationBlock && !settings.bodyEndLineEnabled) return;
	const doc = view.state.doc;
	const block = findBlockRange(doc.toString());
	// The block always ends the note, so body text is everything above it.
	const bodyEnd = block ? block.start : doc.length;

	if (settings.bodyEndLineEnabled) {
		const line = lastBodyLineBefore(view, bodyEnd);
		if (line !== null) {
			const color = bodyEndLineColor(
				settings,
				view.dom.ownerDocument.body.classList.contains('theme-dark'),
			);
			items.push(
				Decoration.line({
					class: BODY_END_LINE_CLASS,
					...(color === '' ? {} : { attributes: { style: `--mdann-end-line: ${color};` } }),
				}).range(line),
			);
		}
	}

	// A block replacement has to cover whole lines, which findBlockRange
	// guarantees: it spans from the start of the %%md-annotation line to the
	// end of the closing %% line.
	if (settings.hideAnnotationBlock && block && block.end > block.start) {
		items.push(Decoration.replace({ block: true }).range(block.start, block.end));
	}
}

// Start offset of the very last body line at or before `bodyEnd` — where the
// end-of-text rule is drawn. Trailing blank lines COUNT: the rule marks where
// the note itself ends, so it sits under the last line before the
// %%md-annotation block (or the last line of the document when there is no
// block), blank or not. Null only for a note whose body is entirely empty —
// nothing has ended, so nothing is marked.
function lastBodyLineBefore(view: EditorView, bodyEnd: number): number | null {
	const doc = view.state.doc;
	let lineNumber = doc.lineAt(Math.max(0, Math.min(bodyEnd, doc.length))).number;
	// A block starts on its own line, so the line containing `bodyEnd` is the
	// block's first line rather than body text; step off it.
	if (bodyEnd < doc.length && doc.line(lineNumber).from === bodyEnd) lineNumber--;
	if (lineNumber < 1) return null;
	const line = doc.line(lineNumber);
	// A one-line body that is blank is no body at all.
	if (lineNumber === 1 && line.text.trim() === '') return null;
	return line.from;
}
