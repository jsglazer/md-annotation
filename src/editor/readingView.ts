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
import type { TextRange } from '../core/tables';
import { matchTableGrid, tableGrids } from '../core/tables';
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

// The [start, end) span, in the note body, of the table cell this element
// renders — or null when it cannot be pinned down with certainty.
//
// Obsidian renders each unfocused Live Preview table cell through this same
// post-processor, but a cell is not a top-level block so it gets no section
// info: there is nothing to say where in the note it came from. The rendered
// table's own structure supplies that. Match its grid back to a table parsed
// from the body, then read off this cell's row and column.
//
// Everything here returns null rather than guessing. Without a definite span
// the caller falls back to skipping the element, which is the safe outcome —
// matching the note's whole annotation set against one cell's few words is how
// unrelated annotations end up drawn inside a table.
export function cellBodyRange(el: HTMLElement, body: string): TextRange | null {
	// Queried per tag rather than as a 'td, th' selector list, which infers only
	// as the base Element type.
	const cell = el.closest('td') ?? el.closest('th');
	const row = cell?.closest('tr') ?? null;
	const table = cell?.closest('table') ?? null;
	if (!cell || !row || !table) return null;
	if (typeof cell.cellIndex !== 'number' || typeof row.rowIndex !== 'number') return null;

	const rendered = Array.from(table.rows).map((r) =>
		Array.from(r.cells).map((c) => (c.textContent ?? '').trim()),
	);
	const grid = matchTableGrid(tableGrids(body), rendered);
	const match = grid?.rows[row.rowIndex]?.[cell.cellIndex];
	return match ? { start: match.start, end: match.end } : null;
}

export function createReadingPostProcessor(host: ReadingHost) {
	return async (el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> => {
		const state = await host.ensureFileState(ctx.sourcePath);
		if (!state || state.annotations.length === 0) return;

		let candidates: Annotation[] = state.annotations.filter(
			(a) => state.outcomes.get(a.id)?.status === 'matched',
		);
		if (candidates.length === 0) return;

		const section = ctx.getSectionInfo(el);
		const range = section ? sectionRange(section) : null;
		// A Live Preview table cell renders through this post-processor but is
		// not a top-level block, so it gets no section info. Its span in the note
		// comes from the table's structure instead; only annotations resolved
		// inside that one cell may be drawn here. Without a definite span there
		// is nothing safe to draw — matching the note's whole annotation set
		// against a few words of cell text is how unrelated annotations end up
		// stacked in a table.
		const cellRange = range ? null : cellBodyRange(el, state.body);
		const scope = range ?? cellRange;
		if (scope) {
			candidates = candidates.filter((a) => {
				const outcome = state.outcomes.get(a.id);
				return outcome?.status === 'matched' && inSection(outcome, scope);
			});
			if (candidates.length === 0) return;
		} else if (el.closest('td, th')) {
			return;
		}

		const settings = host.settings;
		const commentNumbers = numberComments(state.annotations, state.outcomes);
		const child = new HighlightRenderChild(el);
		// Whether this annotation's card is wanted in the Reading-view gutter.
		// When it is, something carrying its id has to end up in the rendered
		// note even if the annotation itself is not being drawn — otherwise the
		// gutter has nothing to align the card to.
		const gutterWants = (annotation: Annotation): boolean =>
			annotation.type === 'comment'
				? settings.gutterCommentsEnabled
				: settings.gutterAnnotationsEnabled;

		// Inside a table cell the selector's stored context is the raw row —
		// pipes, padding and all — which appears nowhere in the cell's rendered
		// text, so the matcher has little to anchor a point comment to. The
		// cell's exact span is already known, though, so when its source text
		// survives rendering unchanged (no inline markdown) the offset can be
		// used directly. Otherwise `at` stays null and the matcher decides, as
		// everywhere else.
		const cellText = cellRange ? state.body.slice(cellRange.start, cellRange.end) : null;
		const exactCell = cellRange !== null && cellText === child.renderedText();
		const offsetIn = (outcome: { start: number; end: number }): TextRange | null =>
			exactCell && cellRange
				? { start: outcome.start - cellRange.start, end: outcome.end - cellRange.start }
				: null;

		for (const annotation of candidates) {
			const outcome = state.outcomes.get(annotation.id);
			if (outcome?.status !== 'matched') continue;
			// Re-capture from the body at the RESOLVED position so the quote
			// and context reflect the current text, then match that against
			// this block's rendered text.
			const selector = captureSelector(state.body, outcome.start, outcome.end);
			const at = offsetIn(outcome);
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
					() => host.revealAnnotation(ctx.sourcePath, annotation.id),
					at,
				);
				continue;
			}
			const styled =
				annotation.type === 'highlight'
					? settings.annotationFormattingEnabled
					: settings.commentsFormattingEnabled;
			if (!styled) {
				// Formatting is off for this type: wrap the text in an unstyled
				// span so the gutter (and a click-to-sidebar) still has a
				// handle on it, or skip it entirely when neither is wanted.
				if (!gutterWants(annotation)) continue;
				child.tryWrap(
					selector,
					`${HIGHLIGHT_CLASS} ${ANCHOR_CLASS}`,
					{},
					annotation.id,
					() => host.revealAnnotation(ctx.sourcePath, annotation.id),
					at,
				);
				continue;
			}
			child.tryWrap(
				selector,
				`${highlightClasses(annotation.type, annotation.category, settings)} mdann-hl-clickable`,
				highlightStyleVars(annotation.type, annotation.category, settings),
				annotation.id,
				() => host.revealAnnotation(ctx.sourcePath, annotation.id),
				at,
			);
		}
		if (child.spanCount > 0) ctx.addChild(child);
		// Whatever was rendered here, the gutter's measurements are now stale.
		host.onReadingRendered(ctx.sourcePath);
	};
}
