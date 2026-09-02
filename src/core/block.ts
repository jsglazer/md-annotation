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
	// True when at least one line still spells the category field the
	// pre-1.0.20 way ("format"). Read transparently either way; the flag lets
	// the plugin rewrite the block once so the note ends up on the new key.
	legacyCategoryKey: boolean;
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
	if (openIdx === -1) {
		return { body: doc, annotations: [], unparseable: [], legacyCategoryKey: false };
	}

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
	let legacyCategoryKey = false;
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
		if (annotation) {
			annotations.push(annotation);
			if (usesLegacyCategoryKey(parsed)) legacyCategoryKey = true;
		} else unparseable.push(raw);
	}

	return { body, annotations, unparseable, legacyCategoryKey };
}

// A parsed line written before v1.0.20: it carries the old "format" key and
// not the new "category" one.
function usesLegacyCategoryKey(parsed: unknown): boolean {
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
	const r = parsed as Record<string, unknown>;
	return typeof r.category !== 'string' && typeof r.format === 'string';
}

// Byte range of the end-of-file block within `doc`, from the start of the
// %%md-annotation line to the end of its closing %% line (end-of-document when
// the block was never closed). Null when the document has no block. Used to
// collapse the block out of sight in the editor — see the
// "Hide the annotation block" setting.
export interface BlockRange {
	start: number;
	end: number;
}

export function findBlockRange(doc: string): BlockRange | null {
	const lines = doc.split('\n');
	let openIdx = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line !== undefined && isMarkerLine(line, BLOCK_OPEN)) {
			openIdx = i;
			break;
		}
	}
	if (openIdx === -1) return null;
	let closeIdx = lines.length - 1;
	for (let i = openIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line !== undefined && isMarkerLine(line, BLOCK_CLOSE)) {
			closeIdx = i;
			break;
		}
	}

	let start = 0;
	for (let i = 0; i < openIdx; i++) start += (lines[i]?.length ?? 0) + 1;
	let end = start;
	for (let i = openIdx; i <= closeIdx; i++) {
		end += lines[i]?.length ?? 0;
		if (i < closeIdx) end += 1;
	}
	return { start, end };
}

// ── Serialization ──────────────────────────────────────────────────────────

// One compact JSON line, keys in canonical order; unknown keys from `extras`
// re-emitted last so round-tripping foreign data loses nothing.
export function serializeAnnotationLine(a: Annotation): string {
	const out: Record<string, unknown> = {
		id: a.id,
		type: a.type,
		category: a.category,
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

// Removes every annotation whose id is in `ids`, in a single rewrite. Used by
// the sidebar's "Delete all orphans" button and by the orphan Notice's Delete
// action, so a batch cleanup is one queued edit rather than one per entry.
export function removeAnnotations(doc: string, ids: ReadonlyArray<string>): string {
	if (ids.length === 0) return doc;
	const drop = new Set(ids);
	const { body, annotations, unparseable } = parseDocument(doc);
	const next = annotations.filter((a) => !drop.has(a.id));
	if (next.length === annotations.length) return doc;
	return composeDocument(body, next, unparseable);
}

// Renames a category across every annotation in one document (settings-driven
// mass rename — dates are left untouched). Returns the document unchanged
// when no annotation uses `oldName`.
export function renameAnnotationCategory(doc: string, oldName: string, newName: string): string {
	const { body, annotations, unparseable } = parseDocument(doc);
	let changed = false;
	for (const a of annotations) {
		if (a.category === oldName) {
			a.category = newName;
			changed = true;
		}
	}
	if (!changed) return doc;
	return composeDocument(body, annotations, unparseable);
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

// Re-serialize the block exactly as it parses today, leaving the body verbatim.
// Used to migrate a note written with the pre-1.0.20 "format" key onto
// "category" — no field changes value, only the spelling on disk.
export function normalizeBlock(doc: string): string {
	const { body, annotations, unparseable } = parseDocument(doc);
	if (annotations.length === 0 && unparseable.length === 0) return doc;
	return composeDocument(body, annotations, unparseable);
}
