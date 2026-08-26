// Annotation construction helpers. Pure: time and randomness are inputs, so
// results are deterministic and testable.

import type { Annotation, AnnotationType, TextQuoteSelector } from './types';

// Compact unique id: base36 timestamp + 4 base36 chars of injected entropy.
export function generateAnnotationId(nowMs: number, random: number): string {
	const t = Math.max(0, Math.floor(nowMs)).toString(36);
	const clamped = Math.min(Math.max(random, 0), 0.9999999);
	const r = Math.floor(clamped * 36 ** 4)
		.toString(36)
		.padStart(4, '0');
	return `${t}-${r}`;
}

// ISO 8601 UTC timestamp for the metadata date fields.
export function formatTimestamp(nowMs: number): string {
	return new Date(nowMs).toISOString();
}

export interface CreateAnnotationInput {
	id: string;
	type: AnnotationType;
	category: string;
	selector: TextQuoteSelector;
	comment: string;
	author: string;
	nowMs: number;
}

export function createAnnotation(input: CreateAnnotationInput): Annotation {
	const created = formatTimestamp(input.nowMs);
	return {
		id: input.id,
		type: input.type,
		category: input.category,
		selector: input.selector,
		comment: input.comment,
		author: input.author,
		status: 'open',
		dateCreate: created,
		dateModified: created,
		dateClosed: null,
	};
}
