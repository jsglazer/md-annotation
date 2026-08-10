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
import { numberComments } from '../core/ordering';
import type { MdAnnotationSettings } from '../core/settings';
import {
	ANCHOR_CLASS,
	HIGHLIGHT_CLASS,
	MARKER_CLASS,
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

interface TextSlice {
	node: Text;
	start: number;
	end: number;
}

// Concatenated text content of an element plus per-node offsets, so a match
// range in the flat string maps back onto the DOM.
function collectTextSlices(root: HTMLElement): { text: string; slices: TextSlice[] } {
	const doc = root.ownerDocument;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const slices: TextSlice[] = [];
	let text = '';
	let node = walker.nextNode();
	while (node) {
		const value = node.nodeValue ?? '';
		slices.push({ node: node as Text, start: text.length, end: text.length + value.length });
		text += value;
		node = walker.nextNode();
	}
	return { text, slices };
}

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
}

class HighlightRenderChild extends MarkdownRenderChild {
	private spans: HTMLElement[] = [];
	private markers: HTMLElement[] = [];

	get spanCount(): number {
		return this.spans.length + this.markers.length;
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
	): void {
		const { text, slices } = collectTextSlices(this.containerEl);
		if (text === '') return;
		const result = resolveSelector(text, selector);
		if (result.status !== 'matched') return;
		this.wrapRange(slices, result.start, result.end, classes, styleVars, annotationId, onClick);
	}

	// Insert an invisible, zero-width element at a point selector's position.
	// Used when the marker itself is deliberately not drawn but the Reading-view
	// gutter still needs somewhere to align that comment's card to.
	tryAnchor(selector: TextQuoteSelector, annotationId: string): void {
		const { text, slices } = collectTextSlices(this.containerEl);
		if (text === '') return;
		const result = resolveSelector(text, selector);
		if (result.status !== 'matched') return;
		const span = this.containerEl.ownerDocument.createElement('span');
		span.className = ANCHOR_CLASS;
		span.setAttribute('data-mdann-id', annotationId);
		if (this.insertAt(slices, result.start, span)) this.markers.push(span);
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
	): void {
		const { text, slices } = collectTextSlices(this.containerEl);
		if (text === '') return;
		const result = resolveSelector(text, selector);
		if (result.status !== 'matched') return;
		const pos = result.start;

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
	): void {
		const doc = this.containerEl.ownerDocument;
		for (const slice of slices) {
			const from = Math.max(start, slice.start);
			const to = Math.min(end, slice.end);
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

	onunload(): void {
		for (const span of this.spans) unwrapHighlightSpan(span);
		this.spans = [];
		for (const marker of this.markers) marker.remove();
		this.markers = [];
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
		if (range) {
			candidates = candidates.filter((a) => {
				const outcome = state.outcomes.get(a.id);
				return outcome?.status === 'matched' && inSection(outcome, range);
			});
			if (candidates.length === 0) return;
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

		for (const annotation of candidates) {
			const outcome = state.outcomes.get(annotation.id);
			if (outcome?.status !== 'matched') continue;
			// Re-capture from the body at the RESOLVED position so the quote
			// and context reflect the current text, then match that against
			// this block's rendered text.
			const selector = captureSelector(state.body, outcome.start, outcome.end);
			if (outcome.start === outcome.end) {
				// Point comment marker.
				if (annotation.type !== 'comment') continue;
				if (settings.commentsHiddenEnabled) {
					if (gutterWants(annotation)) child.tryAnchor(selector, annotation.id);
					continue;
				}
				const styled = settings.commentsFormattingEnabled;
				const number = commentNumbers.get(annotation.id);
				child.tryMarker(
					selector,
					markerClasses() + (styled ? '' : ' mdann-marker-plain'),
					styled ? highlightStyleVars(annotation.type, annotation.format, settings) : {},
					annotation.id,
					number !== undefined ? String(number) : '',
					() => host.revealAnnotation(ctx.sourcePath, annotation.id),
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
				);
				continue;
			}
			child.tryWrap(
				selector,
				`${highlightClasses(annotation.type, annotation.format, settings)} mdann-hl-clickable`,
				highlightStyleVars(annotation.type, annotation.format, settings),
				annotation.id,
				() => host.revealAnnotation(ctx.sourcePath, annotation.id),
			);
		}
		if (child.spanCount > 0) ctx.addChild(child);
		// Whatever was rendered here, the gutter's measurements are now stale.
		host.onReadingRendered(ctx.sourcePath);
	};
}
