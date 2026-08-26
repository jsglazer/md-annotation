// Core data model for md-annotation. This module (like everything under
// src/core/) is pure: no imports from 'obsidian', no DOM, no I/O.

// W3C Annotation Model TextQuoteSelector (exact quote plus surrounding
// context). https://www.w3.org/TR/annotation-model/#text-quote-selector
export interface TextQuoteSelector {
	exact: string;
	prefix: string;
	suffix: string;
}

export type AnnotationType = 'highlight' | 'comment';
export type AnnotationStatus = 'open' | 'closed';

// One annotation, serialized as a single compact JSON line inside the
// end-of-file %%md-annotation block.
export interface Annotation {
	id: string;
	type: AnnotationType;
	// Category name from settings; '' means "the dedicated comment category"
	// for type 'comment'. Stored as the JSON key "category" since v1.0.20;
	// blocks written before that used "format" and are read transparently.
	category: string;
	selector: TextQuoteSelector;
	comment: string;
	author: string;
	status: AnnotationStatus;
	dateCreate: string;
	dateModified: string;
	dateClosed: string | null;
	// Unknown JSON keys found on an otherwise-valid line (e.g. written by a
	// newer plugin version). Preserved verbatim on rewrite, never interpreted.
	extras?: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isTextQuoteSelector(v: unknown): v is TextQuoteSelector {
	return (
		isRecord(v) &&
		typeof v.exact === 'string' &&
		typeof v.prefix === 'string' &&
		typeof v.suffix === 'string'
	);
}

export const ANNOTATION_KNOWN_KEYS = [
	'id',
	'type',
	'category',
	// Legacy alias for 'category' (pre-1.0.20). Listed as known so an old line
	// never round-trips its category into `extras` as well.
	'format',
	'selector',
	'comment',
	'author',
	'status',
	'dateCreate',
	'dateModified',
	'dateClosed',
] as const;

// Strict shape check for one parsed JSON line. Anything that fails this is
// treated as unparseable and preserved verbatim (never deleted).
export function parseAnnotationValue(v: unknown): Annotation | null {
	if (!isRecord(v)) return null;
	if (typeof v.id !== 'string' || v.id === '') return null;
	if (v.type !== 'highlight' && v.type !== 'comment') return null;
	// 'category' since v1.0.20; 'format' is the pre-1.0.20 spelling of the same
	// field, accepted on read so existing notes keep working untouched.
	const category = typeof v.category === 'string' ? v.category : v.format;
	if (typeof category !== 'string') return null;
	if (!isTextQuoteSelector(v.selector)) return null;
	if (typeof v.comment !== 'string') return null;
	if (typeof v.author !== 'string') return null;
	if (v.status !== 'open' && v.status !== 'closed') return null;
	if (typeof v.dateCreate !== 'string') return null;
	if (typeof v.dateModified !== 'string') return null;
	if (v.dateClosed !== null && typeof v.dateClosed !== 'string') return null;

	const known = new Set<string>(ANNOTATION_KNOWN_KEYS);
	let extras: Record<string, unknown> | undefined;
	for (const key of Object.keys(v)) {
		if (known.has(key)) continue;
		extras = extras ?? {};
		extras[key] = v[key];
	}

	const annotation: Annotation = {
		id: v.id,
		type: v.type,
		category,
		selector: {
			exact: v.selector.exact,
			prefix: v.selector.prefix,
			suffix: v.selector.suffix,
		},
		comment: v.comment,
		author: v.author,
		status: v.status,
		dateCreate: v.dateCreate,
		dateModified: v.dateModified,
		dateClosed: v.dateClosed,
	};
	if (extras) annotation.extras = extras;
	return annotation;
}

export function selectorsEqual(a: TextQuoteSelector, b: TextQuoteSelector): boolean {
	return a.exact === b.exact && a.prefix === b.prefix && a.suffix === b.suffix;
}
