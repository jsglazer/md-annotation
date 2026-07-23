// Reading View rendering: a markdown post-processor that wraps resolved
// highlights in styled spans by walking rendered text nodes. Highlights that
// span nested formatting (bold, italic, links…) are wrapped per text node, so
// the rendered structure is never broken. Teardown unwraps every span we
// created — the note's rendered content is restored exactly.
//
// Lifecycle safety: each processed element gets a MarkdownRenderChild
// registered through ctx.addChild, so Obsidian unloads it (and we unwrap)
// whenever the renderer discards the element. No global registries hold DOM
// references — nothing leaks when previews are re-rendered.

import type { MarkdownPostProcessorContext, MarkdownSectionInformation } from 'obsidian';
import { MarkdownRenderChild } from 'obsidian';

import { captureSelector, resolveSelector } from '../core/matcher';
import type { MdAnnotationSettings } from '../core/settings';
import { HIGHLIGHT_CLASS, highlightClasses, highlightStyleVars } from '../core/settings';
import type { Annotation, TextQuoteSelector } from '../core/types';
import type { FileAnnotationState } from '../state';

export interface ReadingHost {
	settings: MdAnnotationSettings;
	ensureFileState(path: string): Promise<FileAnnotationState | null>;
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

// Removes every highlight span the plugin has ever added to `root` (used on
// plugin unload, when render children may already be detached).
export function sweepHighlightSpans(root: ParentNode): void {
	for (const span of Array.from(root.querySelectorAll(`span.${HIGHLIGHT_CLASS}`))) {
		unwrapHighlightSpan(span);
	}
}

class HighlightRenderChild extends MarkdownRenderChild {
	private spans: HTMLElement[] = [];

	get spanCount(): number {
		return this.spans.length;
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
				return (
					outcome?.status === 'matched' && outcome.start < range.end && outcome.end > range.start
				);
			});
			if (candidates.length === 0) return;
		}

		const child = new HighlightRenderChild(el);
		for (const annotation of candidates) {
			const outcome = state.outcomes.get(annotation.id);
			if (outcome?.status !== 'matched') continue;
			// Re-capture from the body at the RESOLVED position so the quote
			// and context reflect the current text, then match that against
			// this block's rendered text.
			const selector = captureSelector(state.body, outcome.start, outcome.end);
			child.tryWrap(
				selector,
				highlightClasses(annotation.type, annotation.format, host.settings),
				highlightStyleVars(annotation.type, annotation.format, host.settings),
				annotation.id,
			);
		}
		if (child.spanCount > 0) ctx.addChild(child);
	};
}
