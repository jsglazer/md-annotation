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
import type { MdAnnotationSettings } from '../core/settings';
import {
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
	openSidebar(): void;
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

// Removes every highlight span and comment marker the plugin has ever added
// to `root` (used on plugin unload, when render children may already be
// detached). Wrap spans are unwrapped (their text belongs to the note);
// markers are removed outright (their icon content is ours).
export function sweepHighlightSpans(root: ParentNode): void {
	for (const span of Array.from(root.querySelectorAll(`span.${HIGHLIGHT_CLASS}`))) {
		unwrapHighlightSpan(span);
	}
	for (const marker of Array.from(root.querySelectorAll(`span.${MARKER_CLASS}`))) {
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
	): void {
		const { text, slices } = collectTextSlices(this.containerEl);
		if (text === '') return;
		const result = resolveSelector(text, selector);
		if (result.status !== 'matched') return;
		this.wrapRange(slices, result.start, result.end, classes, styleVars, annotationId);
	}

	// Resolve a point selector (empty quote) against the rendered text and
	// insert a marker icon at the matched position.
	tryMarker(
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
		const pos = result.start;

		const doc = this.containerEl.ownerDocument;
		const span = doc.createElement('span');
		span.className = classes;
		span.setAttribute('data-mdann-id', annotationId);
		span.setCssProps(styleVars);
		setIcon(span, 'message-square');
		span.addEventListener('click', (e) => {
			e.preventDefault();
			onClick();
		});

		// Find the text node containing the position and split it there.
		const slice = slices.find((s) => pos >= s.start && pos <= s.end);
		if (!slice) return;
		const local = pos - slice.start;
		const target = local > 0 && local < slice.node.length ? slice.node.splitText(local) : null;
		const anchor = target ?? (local === 0 ? slice.node : slice.node.nextSibling);
		slice.node.parentNode?.insertBefore(span, anchor);
		this.markers.push(span);
	}

	private wrapRange(
		slices: TextSlice[],
		start: number,
		end: number,
		classes: string,
		styleVars: Record<string, string>,
		annotationId: string,
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
		const child = new HighlightRenderChild(el);
		for (const annotation of candidates) {
			const outcome = state.outcomes.get(annotation.id);
			if (outcome?.status !== 'matched') continue;
			// Re-capture from the body at the RESOLVED position so the quote
			// and context reflect the current text, then match that against
			// this block's rendered text.
			const selector = captureSelector(state.body, outcome.start, outcome.end);
			if (outcome.start === outcome.end) {
				// Point comment marker.
				if (annotation.type !== 'comment' || settings.commentsHiddenEnabled) continue;
				const styled = settings.commentsFormattingEnabled;
				child.tryMarker(
					selector,
					markerClasses() + (styled ? '' : ' mdann-marker-plain'),
					styled ? highlightStyleVars(annotation.type, annotation.format, settings) : {},
					annotation.id,
					() => host.openSidebar(),
				);
				continue;
			}
			if (annotation.type === 'highlight' && !settings.annotationFormattingEnabled) continue;
			if (annotation.type === 'comment' && !settings.commentsFormattingEnabled) continue;
			child.tryWrap(
				selector,
				highlightClasses(annotation.type, annotation.format, settings),
				highlightStyleVars(annotation.type, annotation.format, settings),
				annotation.id,
			);
		}
		if (child.spanCount > 0) ctx.addChild(child);
	};
}
