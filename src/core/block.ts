// End-of-file annotation block: parsing, serialization, and whole-document
// edits. Pure module — no 'obsidian', no DOM, no I/O.
//
// Storage format (line-delimited JSON inside an Obsidian comment):
//
//   %%md-annotation
//   {"id":"…","type":"highlight",…}
//   {"id":"…","type":"comment",…}
//   %%
//
// Resilience rules (non-negotiable):
//   - The block is parsed line-by-line; a corrupt line loses only itself.
//   - Unparseable lines are preserved VERBATIM on every rewrite — data the
//     parser cannot read is never deleted (e.g. sync-conflict leftovers).
//   - The body text above the block is never modified by any function here;
//     edits only ever replace the block.

import type { Annotation } from './types';
import { ANNOTATION_KNOWN_KEYS, parseAnnotationValue } from './types';

export const BLOCK_OPEN = '%%md-annotation';
export const BLOCK_CLOSE = '%%';

export interface ParsedDocument {
	// Everything above the block, verbatim (line-based; rejoining bodyLines
	// with '\n' plus the block reproduces the original document exactly).
	body: string;
	annotations: Annotation[];
	// Raw lines inside the block that failed to parse, verbatim.
	unparseable: string[];
}

// ── Parsing ────────────────────────────────────────────────────────────────

function isMarkerLine(line: string, marker: string): boolean {
	return line.trimEnd() === marker;
}

export function parseDocument(doc: string): ParsedDocument {
	const lines = doc.split('\n');

	// Find the LAST opening marker so a stray literal earlier in the body
	// cannot hijack the real block at the bottom.
	let openIdx = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line !== undefined && isMarkerLine(line, BLOCK_OPEN)) {
			openIdx = i;
			break;
		}
	}
	if (openIdx === -1) return { body: doc, annotations: [], unparseable: [] };

	// First closing marker after the open. An unclosed block (e.g. truncated
	// by a sync conflict) extends to end-of-file rather than being dropped.
	let closeIdx = -1;
	for (let i = openIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line !== undefined && isMarkerLine(line, BLOCK_CLOSE)) {
			closeIdx = i;
			break;
		}
	}

	const contentEnd = closeIdx === -1 ? lines.length : closeIdx;
	const contentLines = lines.slice(openIdx + 1, contentEnd);

	// Any real content BELOW the closing marker is user text — keep it as
	// body (the rewritten block always moves back to true end-of-file).
	const tailLines = closeIdx === -1 ? [] : lines.slice(closeIdx + 1);
	const tail = tailLines.join('\n');
	const bodyLines = lines.slice(0, openIdx);
	const body = tail.trim() === '' ? bodyLines.join('\n') : bodyLines.join('\n') + '\n' + tail;

	const annotations: Annotation[] = [];
	const unparseable: string[] = [];
	for (const raw of contentLines) {
		const trimmed = raw.trim();
		if (trimmed === '') continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			unparseable.push(raw);
			continue;
		}
		const annotation = parseAnnotationValue(parsed);
		if (annotation) annotations.push(annotation);
		else unparseable.push(raw);
	}

	return { body, annotations, unparseable };
}

// ── Serialization ──────────────────────────────────────────────────────────

// One compact JSON line, keys in canonical order; unknown keys from `extras`
// re-emitted last so round-tripping foreign data loses nothing.
export function serializeAnnotationLine(a: Annotation): string {
	const out: Record<string, unknown> = {
		id: a.id,
		type: a.type,
		format: a.format,
		selector: { exact: a.selector.exact, prefix: a.selector.prefix, suffix: a.selector.suffix },
		comment: a.comment,
		author: a.author,
		status: a.status,
		dateCreate: a.dateCreate,
		dateModified: a.dateModified,
		dateClosed: a.dateClosed,
	};
	if (a.extras) {
		const known = new Set<string>(ANNOTATION_KNOWN_KEYS);
		for (const key of Object.keys(a.extras)) {
			if (!known.has(key)) out[key] = a.extras[key];
		}
	}
	return JSON.stringify(out);
}

// Reassemble the full document: body verbatim, then the block at end-of-file.
// With no annotations and no preserved lines the block is removed entirely.
export function composeDocument(
	body: string,
	annotations: ReadonlyArray<Annotation>,
	unparseable: ReadonlyArray<string>,
): string {
	if (annotations.length === 0 && unparseable.length === 0) return body;

	const bodyLines = body === '' ? [] : body.split('\n');
	// One separating blank line between body text and the block (stable on
	// round-trip: the blank line becomes part of the split body next parse).
	const last = bodyLines[bodyLines.length - 1];
	if (bodyLines.length > 0 && last !== undefined && last.trimEnd() !== '') bodyLines.push('');

	const blockLines = [
		BLOCK_OPEN,
		...annotations.map(serializeAnnotationLine),
		...unparseable,
		BLOCK_CLOSE,
		'',
	];
	return [...bodyLines, ...blockLines].join('\n');
}

// ── Whole-document edit helpers (used by the write queue's mutations) ──────

export function upsertAnnotation(doc: string, annotation: Annotation): string {
	const { body, annotations, unparseable } = parseDocument(doc);
	const idx = annotations.findIndex((a) => a.id === annotation.id);
	if (idx === -1) annotations.push(annotation);
	else annotations[idx] = annotation;
	return composeDocument(body, annotations, unparseable);
}

export function updateAnnotation(
	doc: string,
	id: string,
	patch: Partial<Omit<Annotation, 'id'>>,
): string {
	const { body, annotations, unparseable } = parseDocument(doc);
	const idx = annotations.findIndex((a) => a.id === id);
	if (idx === -1) return doc;
	const current = annotations[idx];
	if (!current) return doc;
	annotations[idx] = { ...current, ...patch, id };
	return composeDocument(body, annotations, unparseable);
}

export function removeAnnotation(doc: string, id: string): string {
	const { body, annotations, unparseable } = parseDocument(doc);
	const next = annotations.filter((a) => a.id !== id);
	if (next.length === annotations.length) return doc;
	return composeDocument(body, next, unparseable);
}

// Removes the first preserved line strictly equal to `raw` (a deliberate,
// user-initiated deletion from the sidebar — the only path that drops data).
export function removeUnparseableLine(doc: string, raw: string): string {
	const { body, annotations, unparseable } = parseDocument(doc);
	const idx = unparseable.indexOf(raw);
	if (idx === -1) return doc;
	const next = [...unparseable.slice(0, idx), ...unparseable.slice(idx + 1)];
	return composeDocument(body, annotations, next);
}
