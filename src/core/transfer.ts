// Carrying annotations across notes with the text they cover. Pure module —
// no 'obsidian', no DOM, no clock (time and ids are inputs).
//
// Copying text out of a note copies only the characters: the selectors stay
// behind in the source note's %%md-annotation block, so the highlights are
// simply absent at the destination. Obsidian's clipboard carries no
// provenance, so rather than guessing which note a pasted string came from,
// the plugin offers an explicit command pair — "Copy selection with
// annotations" builds an AnnotationTransfer here, "Paste with annotations"
// turns it back into annotations anchored in the destination note.

import { captureSelector } from './matcher';
import type { Annotation, AnnotationStatus, AnnotationType } from './types';

// One annotation travelling with the copied text. Offsets are relative to
// `AnnotationTransfer.text`, not to either note.
export interface TransferAnnotation {
	start: number;
	end: number;
	type: AnnotationType;
	category: string;
	comment: string;
	author: string;
	status: AnnotationStatus;
	dateCreate: string;
	dateClosed: string | null;
	extras?: Record<string, unknown>;
}

export interface AnnotationTransfer {
	// Bumped only if the shape changes in a way a reader must notice.
	version: 1;
	text: string;
	annotations: TransferAnnotation[];
}

// One annotation as it currently sits in the source note: the annotation plus
// the body offsets it resolved to.
export interface PlacedAnnotation {
	annotation: Annotation;
	start: number;
	end: number;
}

// Everything covering [from, to) in the source body, with offsets rebased onto
// the copied text.
//
// A selection that cuts an annotation in half carries the annotation with its
// range clipped to the copied portion; the matcher re-anchors on context at
// the destination anyway, so a truncated quote lands where a dropped one would
// have left nothing. Comments are point annotations (zero-length): they travel
// when the point falls inside the selection, including at either edge.
export function buildTransfer(
	body: string,
	placed: readonly PlacedAnnotation[],
	from: number,
	to: number,
): AnnotationTransfer {
	const start = Math.max(0, Math.min(from, to));
	const end = Math.min(body.length, Math.max(from, to));
	const annotations: TransferAnnotation[] = [];

	for (const { annotation, start: aStart, end: aEnd } of placed) {
		const point = aStart === aEnd;
		if (point) {
			if (aStart < start || aStart > end) continue;
		} else if (aEnd <= start || aStart >= end) {
			continue;
		}
		const clippedStart = Math.max(aStart, start) - start;
		const clippedEnd = Math.min(aEnd, end) - start;
		const carried: TransferAnnotation = {
			start: clippedStart,
			end: clippedEnd,
			type: annotation.type,
			category: annotation.category,
			comment: annotation.comment,
			author: annotation.author,
			status: annotation.status,
			// Preserved: when the highlight was first made is a fact about the
			// annotation, not about this copy. dateModified is set at paste.
			dateCreate: annotation.dateCreate,
			dateClosed: annotation.dateClosed,
		};
		if (annotation.extras) carried.extras = { ...annotation.extras };
		annotations.push(carried);
	}

	annotations.sort((a, b) => a.start - b.start || a.end - b.end);
	return { version: 1, text: body.slice(start, end), annotations };
}

export interface PasteContext {
	// The destination body AFTER the transfer text has been inserted — the
	// selectors are captured against it, so prefix/suffix pick up the
	// destination's own surrounding text rather than the source's.
	body: string;
	// Where the transfer text starts in that body.
	insertOffset: number;
	// One fresh id per carried annotation, in order. Two notes must never share
	// an id, so ids are never reused from the source.
	ids: readonly string[];
	nowIso: string;
}

// The transfer's annotations, re-anchored in the destination note.
export function transferToAnnotations(
	transfer: AnnotationTransfer,
	ctx: PasteContext,
): Annotation[] {
	const out: Annotation[] = [];
	for (const [i, carried] of transfer.annotations.entries()) {
		const id = ctx.ids[i];
		if (id === undefined || id === '') continue;
		const start = ctx.insertOffset + carried.start;
		const end = ctx.insertOffset + carried.end;
		if (start < 0 || end > ctx.body.length || end < start) continue;
		const annotation: Annotation = {
			id,
			type: carried.type,
			category: carried.category,
			selector: captureSelector(ctx.body, start, end),
			comment: carried.comment,
			author: carried.author,
			status: carried.status,
			dateCreate: carried.dateCreate,
			dateModified: ctx.nowIso,
			dateClosed: carried.dateClosed,
		};
		if (carried.extras) annotation.extras = { ...carried.extras };
		out.push(annotation);
	}
	return out;
}
