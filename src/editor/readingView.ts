// Reading View rendering: a markdown post-processor that wraps resolved
// highlights in styled spans by walking rendered text nodes, and inserts
// marker icons for point comments. Highlights that span nested formatting
// (bold, italic, links…) are wrapped per text node, so the rendered structure
// is never broken. Teardown unwraps every wrap span and removes every marker
// we created — the note's rendered content is restored exactly.
//
// Lifecycle safety: each processed element gets a MarkdownRenderChild
// registered through ctx.addChild, so Obsidian unloads it (and we clean up)
// whenever the renderer discards the element. No global registries hold DOM
// references — nothing leaks when previews are re-rendered.

import type { MarkdownPostProcessorContext, MarkdownSectionInformation } from 'obsidian';
import { MarkdownRenderChild, setIcon } from 'obsidian';

import { captureSelector, resolveSelector } from '../core/matcher';
import type { TableGrid, TextRange } from '../core/tables';
import { matchTableGrid, placeInCell, sourceToRenderedOffsets, tableGrids } from '../core/tables';
import { numberComments } from '../core/ordering';
import type { MdAnnotationSettings } from '../core/settings';
import {
	ANCHOR_CLASS,
	HIGHLIGHT_CLASS,
	MARKER_CLASS,
	WIDGET_HL_CLASS,
	highlightClasses,
	highlightStyleVars,
	markerClasses,
} from '../core/settings';
import type { Annotation, TextQuoteSelector } from '../core/types';
import type { FileAnnotationState } from '../state';

export interface ReadingHost {
	settings: MdAnnotationSettings;
	ensureFileState(path: string): Promise<FileAnnotationState | null>;
	// Annotated text (highlight span or comment marker) was clicked in Reading
	// view — reveal and focus the matching sidebar entry.
	revealAnnotation(path: string, id: string): void;
	// A section of this note finished rendering, so the elements the Reading
	// view gutter measures now exist (or have moved) — re-place its cards.
	onReadingRendered(path: string): void;
}

// One run of the flat text, mapped back to what produced it: either a text
// node (splittable, so a highlight can start or end inside it) or an atom —
// an element whose internals must be left alone and highlighted as a unit.
type TextSlice =
	| { kind: 'text'; node: Text; start: number; end: number }
	| { kind: 'atom'; el: HTMLElement; start: number; end: number };

// Rendered elements treated as atoms. Obsidian renders inline and display
// maths through MathJax, which draws each glyph as a CSS-styled <mjx-c> with
// no text of its own and puts the only readable text in a visually hidden
// <mjx-assistive-mml> copy. Walking that naively wraps the HIDDEN text and
// leaves the visible formula unhighlighted — the Reading-view twin of the
// Live Preview widget problem (see editor/livePreview.ts). Taking the whole
// container as one unit contributes its text to the flat string exactly once
// and highlights the element itself.
const ATOM_SELECTOR = '.math, mjx-container';

// Maths delimiters in the markdown source. A MathJax build with assistive
// MathML switched off renders no readable text at all, so the formula leaves
// no trace in the flat text for the matcher to reach: an annotation written
// over `… for $x > 0$` resolves only as far as `… for `, stopping dead at an
// atom that contributed nothing. When the stored quote is known to contain
// maths, an empty atom sitting on either edge of the match is taken to BE
// that maths and highlighted with it.
const MATH_DELIMITERS = /\$|\\\(|\\\[/;

// Concatenated text content of an element plus per-node offsets, so a match
// range in the flat string maps back onto the DOM.
function collectTextSlices(root: HTMLElement): { text: string; slices: TextSlice[] } {
	const slices: TextSlice[] = [];
	let text = '';

	const visit = (node: Node): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			const value = node.nodeValue ?? '';
			slices.push({
				kind: 'text',
				node: node as Text,
				start: text.length,
				end: text.length + value.length,
			});
			text += value;
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const el = node as HTMLElement;
		if (el.matches(ATOM_SELECTOR)) {
			const value = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
			slices.push({ kind: 'atom', el, start: text.length, end: text.length + value.length });
			text += value;
			return;
		}
		for (const child of Array.from(node.childNodes)) visit(child);
	};

	for (const child of Array.from(root.childNodes)) visit(child);
	return { text, slices };
}

// Undo paintAtom. The listener goes with the element when Obsidian re-renders
// the section; what has to be cleared is the styling, so a stale highlight
// never survives on a formula no annotation covers any more.
export function restoreAtom(el: HTMLElement): void {
	el.removeClass(WIDGET_HL_CLASS);
	el.removeAttribute('data-mdann-id');
	for (const prop of ATOM_STYLE_PROPS) el.style.removeProperty(prop);
	if (el.getAttribute('style') === '') el.removeAttribute('style');
}

// Every property highlightStyleVars can set, so teardown removes exactly what
// was added and nothing MathJax put there itself.
const ATOM_STYLE_PROPS = [
	'--mdann-light-fg',
	'--mdann-light-bg',
	'--mdann-dark-fg',
	'--mdann-dark-bg',
	'font-size',
];

export function unwrapHighlightSpan(span: Element): void {
	const parent = span.parentNode;
	if (!parent) return;
	while (span.firstChild) parent.insertBefore(span.firstChild, span);
	parent.removeChild(span);
	parent.normalize();
}

// Removes every highlight span, comment marker and gutter anchor the plugin has
// ever added to `root` (used on plugin unload, when render children may already
// be detached). Wrap spans are unwrapped (their text belongs to the note);
// markers and anchors are removed outright (their content is ours).
export function sweepHighlightSpans(root: ParentNode): void {
	for (const span of Array.from(root.querySelectorAll(`span.${HIGHLIGHT_CLASS}`))) {
		unwrapHighlightSpan(span);
	}
	for (const marker of Array.from(
		root.querySelectorAll(`span.${MARKER_CLASS}, span.${ANCHOR_CLASS}:empty`),
	)) {
		marker.remove();
	}
	for (const atom of Array.from(root.querySelectorAll<HTMLElement>(`.${WIDGET_HL_CLASS}`))) {
		restoreAtom(atom);
	}
}

class HighlightRenderChild extends MarkdownRenderChild {
	private spans: HTMLElement[] = [];
	private markers: HTMLElement[] = [];
	// Elements we styled in place rather than wrapped (rendered maths). Their
	// internals belong to MathJax, so teardown restores them instead of
	// unwrapping them.
	private atoms: HTMLElement[] = [];

	get spanCount(): number {
		return this.spans.length + this.markers.length + this.atoms.length;
	}

	// The flat text this element renders — what a caller compares against the
	// markdown source to decide whether an exact offset can be used.
	renderedText(): string {
		return collectTextSlices(this.containerEl).text;
	}

	// Where an annotation goes within the rendered text. `at` is an already
	// known offset pair (used for a table cell, whose exact position in the
	// note is established structurally rather than by matching); without it the
	// staged matcher resolves the selector, which is what absorbs the
	// difference between markdown source and rendered text.
	private locate(
		text: string,
		selector: TextQuoteSelector,
		at: TextRange | null,
	): { start: number; end: number } | null {
		if (at) {
			if (at.start < 0 || at.end > text.length || at.start > at.end) return null;
			return { start: at.start, end: at.end };
		}
		const result = resolveSelector(text, selector);
		return result.status === 'matched' ? { start: result.start, end: result.end } : null;
	}

	// Resolve `selector` against this element's rendered text and wrap the
	// match. The rendered text differs from the markdown source (syntax is
	// stripped), which is exactly what the staged matcher tolerates.
	tryWrap(
		selector: TextQuoteSelector,
		classes: string,
		styleVars: Record<string, string>,
		annotationId: string,
		onClick: () => void,
		at: TextRange | null = null,
	): void {
		const { text, slices } = collectTextSlices(this.containerEl);
		if (text === '') return;
		const found = this.locate(text, selector, at);
		if (!found) return;
		this.wrapRange(
			slices,
			found.start,
			found.end,
			classes,
			styleVars,
			annotationId,
			onClick,
			MATH_DELIMITERS.test(selector.exact),
		);
	}

	// Insert an invisible, zero-width element at a point selector's position.
	// Used when the marker itself is deliberately not drawn but the Reading-view
	// gutter still needs somewhere to align that comment's card to.
	tryAnchor(selector: TextQuoteSelector, annotationId: string, at: TextRange | null = null): void {
		const { text, slices } = collectTextSlices(this.containerEl);
		if (text === '') return;
		const found = this.locate(text, selector, at);
		if (!found) return;
		const span = this.containerEl.ownerDocument.createElement('span');
		span.className = ANCHOR_CLASS;
		span.setAttribute('data-mdann-id', annotationId);
		if (this.insertAt(slices, found.start, span)) this.markers.push(span);
	}

	// Resolve a point selector (empty quote) against the rendered text and
	// insert a marker icon at the matched position.
	tryMarker(
		selector: TextQuoteSelector,
		classes: string,
		styleVars: Record<string, string>,
		annotationId: string,
		label: string,
		onClick: () => void,
		at: TextRange | null = null,
	): void {
		const { text, slices } = collectTextSlices(this.containerEl);
		if (text === '') return;
		const found = this.locate(text, selector, at);
		if (!found) return;
		const pos = found.start;

		const doc = this.containerEl.ownerDocument;
		const span = doc.createElement('span');
		span.className = classes;
		span.setAttribute('data-mdann-id', annotationId);
		span.setCssProps(styleVars);
		setIcon(span, 'message-square');
		if (label !== '') {
			const num = doc.createElement('span');
			num.className = 'mdann-marker-num';
			num.textContent = label;
			span.appendChild(num);
		}
		span.addEventListener('click', (e) => {
			e.preventDefault();
			onClick();
		});

		if (this.insertAt(slices, pos, span)) this.markers.push(span);
	}

	// Put `el` at flat-text offset `pos`, splitting the text node it lands
	// inside. False when the offset falls outside the collected slices, or the
	// node has already been detached.
	private insertAt(slices: TextSlice[], pos: number, el: HTMLElement): boolean {
		const slice = slices.find((s) => pos >= s.start && pos <= s.end);
		if (!slice) return false;
		// An atom is indivisible: the marker goes to whichever side of it the
		// offset is nearer.
		if (slice.kind === 'atom') {
			const parent = slice.el.parentNode;
			if (!parent) return false;
			parent.insertBefore(el, pos <= slice.start ? slice.el : slice.el.nextSibling);
			return true;
		}
		const local = pos - slice.start;
		const target = local > 0 && local < slice.node.length ? slice.node.splitText(local) : null;
		const anchor = target ?? (local === 0 ? slice.node : slice.node.nextSibling);
		const parent = slice.node.parentNode;
		if (!parent) return false;
		parent.insertBefore(el, anchor);
		return true;
	}

	private wrapRange(
		slices: TextSlice[],
		start: number,
		end: number,
		classes: string,
		styleVars: Record<string, string>,
		annotationId: string,
		onClick: () => void,
		absorbEdgeAtoms = false,
	): void {
		const doc = this.containerEl.ownerDocument;
		for (const slice of slices) {
			const from = Math.max(start, slice.start);
			const to = Math.min(end, slice.end);
			if (slice.kind === 'atom') {
				// Any overlap highlights the whole formula — there is no
				// sub-range of a rendered equation to highlight. An atom that
				// contributed no text at all counts when it sits inside the
				// range rather than at either edge of it.
				const covered =
					slice.end > slice.start
						? from < to
						: absorbEdgeAtoms
							? slice.start >= start && slice.start <= end
							: slice.start > start && slice.start < end;
				if (covered) this.paintAtom(slice.el, styleVars, annotationId, onClick);
				continue;
			}
			if (from >= to) continue;

			// Isolate the overlapping part of this text node, then wrap it.
			let target = slice.node;
			const localFrom = from - slice.start;
			const localTo = to - slice.start;
			if (localFrom > 0) target = target.splitText(localFrom);
			if (localTo - localFrom < target.length) target.splitText(localTo - localFrom);

			const span = doc.createElement('span');
			span.className = classes;
			span.setAttribute('data-mdann-id', annotationId);
			span.setCssProps(styleVars);
			span.addEventListener('click', () => onClick());
			target.parentNode?.insertBefore(span, target);
			span.appendChild(target);
			this.spans.push(span);
		}
	}

	// Style a rendered maths container in place. Deliberately not the ordinary
	// highlight class: teardown unwraps `span.mdann-hl`, which would dismantle
	// an element the plugin does not own.
	private paintAtom(
		el: HTMLElement,
		styleVars: Record<string, string>,
		annotationId: string,
		onClick: () => void,
	): void {
		if (el.hasClass(WIDGET_HL_CLASS)) return;
		el.addClass(WIDGET_HL_CLASS);
		el.setAttribute('data-mdann-id', annotationId);
		el.setCssProps(styleVars);
		el.addEventListener('click', () => onClick());
		this.atoms.push(el);
	}

	onunload(): void {
		for (const span of this.spans) unwrapHighlightSpan(span);
		this.spans = [];
		for (const marker of this.markers) marker.remove();
		this.markers = [];
		for (const atom of this.atoms) restoreAtom(atom);
		this.atoms = [];
	}
}

// Character range of this rendered section within the source text, used to
// only attempt annotations that actually live in this block.
function sectionRange(info: MarkdownSectionInformation): { start: number; end: number } | null {
	const lines = info.text.split('\n');
	if (info.lineStart >= lines.length) return null;
	let offset = 0;
	let start = 0;
	let end = info.text.length;
	for (let i = 0; i < lines.length; i++) {
		if (i === info.lineStart) start = offset;
		offset += (lines[i] ?? '').length + 1;
		if (i === info.lineEnd) {
			end = Math.min(offset - 1, info.text.length);
			break;
		}
	}
	return { start, end };
}

function inSection(
	outcome: { start: number; end: number },
	range: { start: number; end: number },
): boolean {
	if (outcome.start === outcome.end) {
		return outcome.start >= range.start && outcome.start <= range.end;
	}
	return outcome.start < range.end && outcome.end > range.start;
}

// What one annotation needs in order to be drawn into a rendered element: the
// annotation, and — when its exact spot in the element's rendered text is
// already known — that offset pair. With `at` null the matcher finds it.
interface DrawItem {
	annotation: Annotation;
	at: TextRange | null;
}

// Draw `items` into `child`'s element: markers for point comments, wrap spans
// for ranges, honouring every visibility setting. Shared by the Reading-view
// post-processor and the Live Preview table-cell painter.
function drawAnnotations(
	child: HighlightRenderChild,
	items: ReadonlyArray<DrawItem>,
	host: ReadingHost,
	path: string,
	state: FileAnnotationState,
): void {
	const settings = host.settings;
	const commentNumbers = numberComments(state.annotations, state.outcomes);
	// Whether this annotation's card is wanted in the gutter. When it is,
	// something carrying its id has to end up in the rendered note even if the
	// annotation itself is not being drawn — otherwise the gutter has nothing
	// to align the card to.
	const gutterWants = (annotation: Annotation): boolean =>
		annotation.type === 'comment' ? settings.gutterCommentsEnabled : settings.gutterAnnotationsEnabled;

	for (const { annotation, at } of items) {
		const outcome = state.outcomes.get(annotation.id);
		if (outcome?.status !== 'matched') continue;
		// Re-capture from the body at the RESOLVED position so the quote and
		// context reflect the current text, then match that against this
		// element's rendered text.
		const selector = captureSelector(state.body, outcome.start, outcome.end);
		const reveal = (): void => host.revealAnnotation(path, annotation.id);
		if (outcome.start === outcome.end) {
			// Point comment marker.
			if (annotation.type !== 'comment') continue;
			if (settings.commentsHiddenEnabled) {
				if (gutterWants(annotation)) child.tryAnchor(selector, annotation.id, at);
				continue;
			}
			const styled = settings.commentsFormattingEnabled;
			const number = commentNumbers.get(annotation.id);
			child.tryMarker(
				selector,
				markerClasses() + (styled ? '' : ' mdann-marker-plain'),
				styled ? highlightStyleVars(annotation.type, annotation.category, settings) : {},
				annotation.id,
				number !== undefined ? String(number) : '',
				reveal,
				at,
			);
			continue;
		}
		const styled =
			annotation.type === 'highlight'
				? settings.annotationFormattingEnabled
				: settings.commentsFormattingEnabled;
		if (!styled) {
			// Formatting is off for this type: wrap the text in an unstyled span
			// so the gutter (and a click-to-sidebar) still has a handle on it,
			// or skip it entirely when neither is wanted.
			if (!gutterWants(annotation)) continue;
			child.tryWrap(selector, `${HIGHLIGHT_CLASS} ${ANCHOR_CLASS}`, {}, annotation.id, reveal, at);
			continue;
		}
		child.tryWrap(
			selector,
			`${highlightClasses(annotation.type, annotation.category, settings)} mdann-hl-clickable`,
			highlightStyleVars(annotation.type, annotation.category, settings),
			annotation.id,
			reveal,
			at,
		);
	}
}

export function createReadingPostProcessor(host: ReadingHost) {
	return async (el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> => {
		// A Live Preview table cell also renders through this post-processor,
		// but only when Obsidian (re)builds the table — not when an annotation
		// is added or changed — and with no section info to say where it came
		// from. Those cells are painted by paintLivePreviewTables instead, which
		// runs on every decoration pass and knows exactly which table it is in.
		if (el.closest('td, th') && ctx.getSectionInfo(el) === null) return;

		const state = await host.ensureFileState(ctx.sourcePath);
		if (!state || state.annotations.length === 0) return;

		let candidates: Annotation[] = state.annotations.filter(
			(a) => state.outcomes.get(a.id)?.status === 'matched',
		);
		if (candidates.length === 0) return;

		const section = ctx.getSectionInfo(el);
		const range = section ? sectionRange(section) : null;
		if (range) {
			candidates = candidates.filter((a) => {
				const outcome = state.outcomes.get(a.id);
				return outcome?.status === 'matched' && inSection(outcome, range);
			});
			if (candidates.length === 0) return;
		}

		const child = new HighlightRenderChild(el);
		drawAnnotations(
			child,
			candidates.map((annotation) => ({ annotation, at: null })),
			host,
			ctx.sourcePath,
			state,
		);
		if (child.spanCount > 0) ctx.addChild(child);
		// Whatever was rendered here, the gutter's measurements are now stale.
		host.onReadingRendered(ctx.sourcePath);
	};
}

// ── Live Preview tables ───────────────────────────────────────────────────
//
// In Live Preview Obsidian replaces each table with a block widget
// (.cm-table-widget), and a CodeMirror decoration inside it is never shown.
// So its cells are painted directly, the same way the Reading view is.
//
// Each cell's content sits in a .table-cell-wrapper div. Which table a widget
// is comes from its document position (posAtDOM), and which cell from the
// <tr>/<td> indices — both exact, so nothing is inferred from cell text.
// A wrapper is repainted only when the decoration generation has moved on
// since it was last painted, so this is cheap to call after every redraw.

const tablePaints = new WeakMap<HTMLElement, { child: HighlightRenderChild; generation: number }>();

// Returns true when anything was (re)painted, so the caller knows the gutter's
// measurements are stale.
export function paintLivePreviewTables(
	root: HTMLElement,
	positionOf: (el: HTMLElement) => number | null,
	host: ReadingHost,
	path: string,
	state: FileAnnotationState,
	generation: number,
): boolean {
	const widgets = Array.from(root.querySelectorAll<HTMLElement>('.cm-table-widget'));
	if (widgets.length === 0) return false;
	let grids: TableGrid[] | null = null;
	let changed = false;

	for (const widget of widgets) {
		const table = widget.querySelector('table');
		if (!table) continue;
		const wrappers: Array<{ wrapper: HTMLElement; row: number; col: number }> = [];
		for (const tr of Array.from(table.rows)) {
			for (const td of Array.from(tr.cells)) {
				for (const wrapper of Array.from(td.children)) {
					if (!wrapper.instanceOf(HTMLElement) || !wrapper.hasClass('table-cell-wrapper')) continue;
					// The wrapper holding a focused cell's nested editor.
					if (wrapper.querySelector('.cm-editor')) continue;
					if (tablePaints.get(wrapper)?.generation === generation) continue;
					wrappers.push({ wrapper, row: tr.rowIndex, col: td.cellIndex });
				}
			}
		}
		if (wrappers.length === 0) continue;

		grids ??= tableGrids(state.body);
		// The widget starts at its header line, so its position names the table
		// exactly. Should that ever be off (a table nested in a callout or list
		// line), take the table containing the position, and failing that the
		// one whose rendered shape and text match uniquely.
		const start = positionOf(widget);
		const rendered = Array.from(table.rows).map((r) =>
			Array.from(r.cells).map((c) => (c.textContent ?? '').trim()),
		);
		const grid =
			grids.find((g) => g.start === start) ??
			grids.find((g) => start !== null && start >= g.start && start <= g.end) ??
			matchTableGrid(grids, rendered);

		for (const { wrapper, row, col } of wrappers) {
			const previous = tablePaints.get(wrapper);
			if (previous) {
				previous.child.unload();
				changed = true;
			}
			const child = new HighlightRenderChild(wrapper);
			// Loaded up front, so the unload before the next repaint always runs
			// its teardown — including for a cell that got nothing this time.
			child.load();
			tablePaints.set(wrapper, { child, generation });
			if (!grid) continue;
			const cell = grid.rows[row]?.[col];
			if (!cell) continue;

			const source = state.body.slice(cell.start, cell.end);
			const rendered = child.renderedText();
			const toRendered =
				source === rendered ? (offset: number) => offset : sourceToRenderedOffsets(source, rendered);
			const items: DrawItem[] = [];
			for (const annotation of state.annotations) {
				const outcome = state.outcomes.get(annotation.id);
				if (outcome?.status !== 'matched') continue;
				const local = placeInCell(grid, row, col, outcome.start, outcome.end);
				if (!local) continue;
				items.push({
					annotation,
					at: toRendered ? { start: toRendered(local.start), end: toRendered(local.end) } : null,
				});
			}
			if (items.length === 0) continue;
			drawAnnotations(child, items, host, path, state);
			if (child.spanCount > 0) changed = true;
		}
	}
	return changed;
}
