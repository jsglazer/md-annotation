import { describe, expect, it } from 'vitest';
import {
	BLOCK_CLOSE,
	BLOCK_OPEN,
	composeDocument,
	findBlockRange,
	normalizeBlock,
	parseDocument,
	removeAnnotation,
	removeUnparseableLine,
	renameAnnotationCategory,
	serializeAnnotationLine,
	updateAnnotation,
	upsertAnnotation,
} from '../src/core/block';
import type { Annotation } from '../src/core/types';

function makeAnnotation(id: string, overrides: Partial<Annotation> = {}): Annotation {
	return {
		id,
		type: 'highlight',
		category: 'default',
		selector: { exact: 'quote', prefix: 'pre ', suffix: ' post' },
		comment: '',
		author: 'josh',
		status: 'open',
		dateCreate: '2026-07-22T00:00:00.000Z',
		dateModified: '2026-07-22T00:00:00.000Z',
		dateClosed: null,
		...overrides,
	};
}

const BODY = 'Line one.\nLine two with quote inside.\n';

function docWith(lines: string[]): string {
	return `${BODY}\n${BLOCK_OPEN}\n${lines.join('\n')}\n${BLOCK_CLOSE}\n`;
}

describe('parseDocument — valid input', () => {
	it('parses a well-formed block into annotations and body', () => {
		const a = makeAnnotation('a1');
		const b = makeAnnotation('b2', { type: 'comment', comment: 'note' });
		const doc = docWith([serializeAnnotationLine(a), serializeAnnotationLine(b)]);
		const parsed = parseDocument(doc);
		expect(parsed.annotations).toEqual([a, b]);
		expect(parsed.unparseable).toEqual([]);
		expect(parsed.body).toBe(BODY);
	});

	it('returns the whole document as body when no block exists', () => {
		const parsed = parseDocument(BODY);
		expect(parsed).toEqual({
			body: BODY,
			annotations: [],
			unparseable: [],
			legacyCategoryKey: false,
		});
	});

	it('skips blank lines inside the block', () => {
		const a = makeAnnotation('a1');
		const doc = docWith(['', serializeAnnotationLine(a), '   ']);
		expect(parseDocument(doc).annotations).toEqual([a]);
	});

	it('uses the LAST opening marker, so a literal in the body is not hijacked', () => {
		const a = makeAnnotation('a1');
		const bodyWithLiteral = `Discussing the ${BLOCK_OPEN} marker in prose.\nMore text.\n`;
		// The literal is inline (not alone on a line), so it stays body text.
		const doc = `${bodyWithLiteral}\n${BLOCK_OPEN}\n${serializeAnnotationLine(a)}\n${BLOCK_CLOSE}\n`;
		const parsed = parseDocument(doc);
		expect(parsed.annotations).toEqual([a]);
		expect(parsed.body).toContain('Discussing the %%md-annotation marker');
	});
});

describe('parseDocument — corrupt input (line-by-line resilience)', () => {
	it('isolates a syntactically corrupt line without losing valid neighbors', () => {
		const a = makeAnnotation('a1');
		const b = makeAnnotation('b2');
		const corrupt = '{"id":"broken", <<<<<<< HEAD merge conflict';
		const doc = docWith([serializeAnnotationLine(a), corrupt, serializeAnnotationLine(b)]);
		const parsed = parseDocument(doc);
		expect(parsed.annotations).toEqual([a, b]);
		expect(parsed.unparseable).toEqual([corrupt]);
	});

	it('treats valid JSON with an invalid shape as unparseable', () => {
		const wrongShape = '{"id":"x","type":"nonsense"}';
		const parsed = parseDocument(docWith([wrongShape]));
		expect(parsed.annotations).toEqual([]);
		expect(parsed.unparseable).toEqual([wrongShape]);
	});

	it('parses an unclosed block (e.g. truncated by sync) to end of file', () => {
		const a = makeAnnotation('a1');
		const doc = `${BODY}\n${BLOCK_OPEN}\n${serializeAnnotationLine(a)}`;
		const parsed = parseDocument(doc);
		expect(parsed.annotations).toEqual([a]);
		expect(parsed.body).toBe(BODY);
	});

	it('keeps user text found below the closing marker as body', () => {
		const a = makeAnnotation('a1');
		const doc = docWith([serializeAnnotationLine(a)]) + 'trailing user text\n';
		const parsed = parseDocument(doc);
		expect(parsed.annotations).toEqual([a]);
		expect(parsed.body).toContain('trailing user text');
	});
});

describe('composeDocument / round-trip', () => {
	it('round-trips a well-formed document byte-for-byte', () => {
		const doc = docWith([serializeAnnotationLine(makeAnnotation('a1'))]);
		const { body, annotations, unparseable } = parseDocument(doc);
		expect(composeDocument(body, annotations, unparseable)).toBe(doc);
	});

	it('preserves unparseable lines VERBATIM when rewriting', () => {
		const corrupt = '   {"id": broken json — conflict leftovers >>>>>>>';
		const doc = docWith([serializeAnnotationLine(makeAnnotation('a1')), corrupt]);
		const rewritten = upsertAnnotation(doc, makeAnnotation('b2'));
		expect(rewritten).toContain(`\n${corrupt}\n`);
	});

	it('removes the block entirely when nothing remains', () => {
		expect(composeDocument(BODY, [], [])).toBe(BODY);
	});

	it('serializes one compact JSON object per line', () => {
		const doc = composeDocument(BODY, [makeAnnotation('a1'), makeAnnotation('b2')], []);
		const lines = doc.split('\n');
		const open = lines.indexOf(BLOCK_OPEN);
		expect(open).toBeGreaterThan(0);
		const first = lines[open + 1];
		const second = lines[open + 2];
		expect(first && (JSON.parse(first) as { id: string }).id).toBe('a1');
		expect(second && (JSON.parse(second) as { id: string }).id).toBe('b2');
		expect(first).not.toContain('\n');
	});

	it('preserves unknown JSON keys on valid lines (forward compatibility)', () => {
		const line = serializeAnnotationLine(makeAnnotation('a1'));
		const withExtra = line.slice(0, -1) + ',"futureKey":{"nested":true}}';
		const doc = docWith([withExtra]);
		const parsed = parseDocument(doc);
		const roundTripped = parsed.annotations[0] && serializeAnnotationLine(parsed.annotations[0]);
		expect(roundTripped).toContain('"futureKey":{"nested":true}');
	});
});

describe('document edit helpers never touch the body', () => {
	const a = makeAnnotation('a1');
	const corrupt = '{corrupt line kept verbatim';
	const doc = docWith([serializeAnnotationLine(a), corrupt]);

	function bodyOf(text: string): string {
		return parseDocument(text).body;
	}

	it('upsertAnnotation adds and replaces without altering the body', () => {
		const added = upsertAnnotation(doc, makeAnnotation('b2'));
		expect(bodyOf(added)).toBe(BODY);
		expect(parseDocument(added).annotations.map((x) => x.id)).toEqual(['a1', 'b2']);

		const replaced = upsertAnnotation(doc, makeAnnotation('a1', { comment: 'edited' }));
		expect(bodyOf(replaced)).toBe(BODY);
		expect(parseDocument(replaced).annotations[0]?.comment).toBe('edited');
	});

	it('creates the block at end-of-file for a document without one', () => {
		const created = upsertAnnotation(BODY, a);
		expect(created.startsWith(BODY)).toBe(true);
		expect(parseDocument(created).annotations).toEqual([a]);
		// Full body is byte-identical after the round trip.
		expect(bodyOf(created)).toBe(BODY);
	});

	it('updateAnnotation patches fields in place', () => {
		const updated = updateAnnotation(doc, 'a1', { status: 'closed', dateClosed: '2026-07-23T00:00:00.000Z' });
		const ann = parseDocument(updated).annotations[0];
		expect(ann?.status).toBe('closed');
		expect(ann?.dateClosed).toBe('2026-07-23T00:00:00.000Z');
		expect(bodyOf(updated)).toBe(BODY);
		// Unknown id → document returned unchanged.
		expect(updateAnnotation(doc, 'nope', { comment: 'x' })).toBe(doc);
	});

	it('removeAnnotation drops only the targeted annotation', () => {
		const removed = removeAnnotation(doc, 'a1');
		expect(parseDocument(removed).annotations).toEqual([]);
		expect(removed).toContain(corrupt); // preserved lines survive removal
		expect(bodyOf(removed)).toBe(BODY);
	});

	it('removeUnparseableLine removes exactly the given raw line', () => {
		const removed = removeUnparseableLine(doc, corrupt);
		expect(parseDocument(removed).unparseable).toEqual([]);
		expect(parseDocument(removed).annotations).toEqual([a]);
		expect(removeUnparseableLine(doc, 'not present')).toBe(doc);
	});
});

describe('renameAnnotationCategory', () => {
	it('renames the format on every matching annotation and no others', () => {
		const a = makeAnnotation('a1', { category: 'Yellow' });
		const b = makeAnnotation('b2', { category: 'Red' });
		const c = makeAnnotation('c3', { category: 'Yellow' });
		const doc = docWith([a, b, c].map(serializeAnnotationLine));
		const renamed = renameAnnotationCategory(doc, 'Yellow', 'Key');
		const parsed = parseDocument(renamed);
		expect(parsed.annotations.map((x) => x.category)).toEqual(['Key', 'Red', 'Key']);
		expect(parsed.body).toBe(BODY);
	});

	it('returns the document unchanged when no annotation uses the old name', () => {
		const a = makeAnnotation('a1', { category: 'Red' });
		const doc = docWith([serializeAnnotationLine(a)]);
		expect(renameAnnotationCategory(doc, 'Yellow', 'Key')).toBe(doc);
	});

	it('preserves unparseable lines verbatim through a rename', () => {
		const a = makeAnnotation('a1', { category: 'Yellow' });
		const corrupt = '{"id":"broken", not json';
		const doc = docWith([serializeAnnotationLine(a), corrupt]);
		const renamed = renameAnnotationCategory(doc, 'Yellow', 'Key');
		expect(parseDocument(renamed).unparseable).toEqual([corrupt]);
	});
});

// ── v1.0.20 rename: "format" → "category" ─────────────────────────────────

describe('legacy "format" key', () => {
	const legacyLine = JSON.stringify({
		id: 'a1',
		type: 'highlight',
		format: 'Key',
		selector: { exact: 'quote', prefix: 'pre ', suffix: ' post' },
		comment: 'note',
		author: 'josh',
		status: 'open',
		dateCreate: '2026-07-22T00:00:00.000Z',
		dateModified: '2026-07-22T00:00:00.000Z',
		dateClosed: null,
	});

	it('reads a pre-1.0.20 line as a category and flags the document', () => {
		const parsed = parseDocument(docWith([legacyLine]));
		expect(parsed.annotations[0]?.category).toBe('Key');
		expect(parsed.unparseable).toEqual([]);
		expect(parsed.legacyCategoryKey).toBe(true);
	});

	it('does not keep the old key as an extra', () => {
		const parsed = parseDocument(docWith([legacyLine]));
		expect(parsed.annotations[0]?.extras).toBeUndefined();
		expect(serializeAnnotationLine(parsed.annotations[0]!)).not.toContain('"format"');
	});

	it('prefers "category" when a line carries both', () => {
		const both = JSON.parse(legacyLine) as Record<string, unknown>;
		both.category = 'Define';
		const parsed = parseDocument(docWith([JSON.stringify(both)]));
		expect(parsed.annotations[0]?.category).toBe('Define');
		expect(parsed.legacyCategoryKey).toBe(false);
	});

	it('normalizeBlock rewrites the block onto the new key, body untouched', () => {
		const doc = docWith([legacyLine]);
		const migrated = normalizeBlock(doc);
		expect(migrated).toContain('"category":"Key"');
		expect(migrated).not.toContain('"format"');
		expect(parseDocument(migrated).body).toBe(BODY);
		expect(parseDocument(migrated).annotations).toEqual(parseDocument(doc).annotations);
	});

	it('normalizeBlock leaves a document with no block alone', () => {
		expect(normalizeBlock(BODY)).toBe(BODY);
	});
});

describe('findBlockRange', () => {
	it('spans the open marker line through the close marker line', () => {
		const line = serializeAnnotationLine(makeAnnotation('a1'));
		const doc = docWith([line]);
		const range = findBlockRange(doc);
		expect(range).not.toBeNull();
		expect(doc.slice(range!.start, range!.end)).toBe(
			`${BLOCK_OPEN}\n${line}\n${BLOCK_CLOSE}`,
		);
	});

	it('runs to end-of-document when the block was never closed', () => {
		const line = serializeAnnotationLine(makeAnnotation('a1'));
		const doc = `${BODY}\n${BLOCK_OPEN}\n${line}`;
		const range = findBlockRange(doc);
		expect(doc.slice(range!.start, range!.end)).toBe(`${BLOCK_OPEN}\n${line}`);
	});

	it('is null for a document with no block', () => {
		expect(findBlockRange(BODY)).toBeNull();
	});

	it('ignores a stray marker earlier in the body', () => {
		const line = serializeAnnotationLine(makeAnnotation('a1'));
		const doc = `${BLOCK_OPEN} in prose\n${BODY}\n${BLOCK_OPEN}\n${line}\n${BLOCK_CLOSE}\n`;
		const range = findBlockRange(doc);
		expect(doc.slice(range!.start, range!.end)).toBe(
			`${BLOCK_OPEN}\n${line}\n${BLOCK_CLOSE}`,
		);
	});
});
