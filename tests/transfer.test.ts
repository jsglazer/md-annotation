import { describe, expect, it } from 'vitest';

import { createAnnotation } from '../src/core/annotation';
import type { AnnotationTransfer, PlacedAnnotation } from '../src/core/transfer';
import { buildTransfer, transferToAnnotations } from '../src/core/transfer';
import type { Annotation, AnnotationType } from '../src/core/types';

const BODY = 'The quick brown fox jumps over the lazy dog.';

function annotation(
	id: string,
	overrides: Partial<Annotation> = {},
	type: AnnotationType = 'highlight',
): Annotation {
	return {
		...createAnnotation({
			id,
			type,
			category: 'Yellow',
			selector: { exact: '', prefix: '', suffix: '' },
			comment: '',
			author: 'Josh',
			nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
		}),
		...overrides,
	};
}

function placed(id: string, start: number, end: number, over: Partial<Annotation> = {}): PlacedAnnotation {
	return { annotation: annotation(id, over), start, end };
}

describe('buildTransfer', () => {
	it('carries annotations fully inside the selection, rebased onto the copied text', () => {
		// 'quick brown' = [4, 15); copy 'quick brown fox' = [4, 19)
		const t = buildTransfer(BODY, [placed('a', 4, 15)], 4, 19);
		expect(t.text).toBe('quick brown fox');
		expect(t.annotations).toHaveLength(1);
		expect(t.annotations[0]?.start).toBe(0);
		expect(t.annotations[0]?.end).toBe(11);
	});

	it('drops annotations outside the selection', () => {
		const t = buildTransfer(BODY, [placed('a', 35, 39)], 4, 19);
		expect(t.annotations).toEqual([]);
	});

	it('clips an annotation the selection cuts in half rather than dropping it', () => {
		// 'brown fox' = [10, 19); copy [0, 15) stops mid-annotation.
		const t = buildTransfer(BODY, [placed('a', 10, 19)], 0, 15);
		expect(t.annotations[0]).toMatchObject({ start: 10, end: 15 });
	});

	it('carries a comment (point annotation) when the point is in range, edges included', () => {
		const inside = buildTransfer(BODY, [placed('c', 10, 10)], 4, 19);
		expect(inside.annotations).toHaveLength(1);
		const edge = buildTransfer(BODY, [placed('c', 19, 19)], 4, 19);
		expect(edge.annotations).toHaveLength(1);
		const outside = buildTransfer(BODY, [placed('c', 20, 20)], 4, 19);
		expect(outside.annotations).toHaveLength(0);
	});

	it('preserves author, category, comment, status and dateCreate', () => {
		const t = buildTransfer(
			BODY,
			[
				placed('a', 4, 15, {
					author: 'Ada',
					category: 'Key',
					comment: 'note text',
					status: 'closed',
					dateCreate: '2020-05-05T00:00:00.000Z',
					dateClosed: '2021-06-06T00:00:00.000Z',
				}),
			],
			0,
			BODY.length,
		);
		expect(t.annotations[0]).toMatchObject({
			author: 'Ada',
			category: 'Key',
			comment: 'note text',
			status: 'closed',
			dateCreate: '2020-05-05T00:00:00.000Z',
			dateClosed: '2021-06-06T00:00:00.000Z',
		});
	});

	it('sorts carried annotations by position and tolerates a reversed selection', () => {
		const t = buildTransfer(BODY, [placed('b', 16, 19), placed('a', 4, 9)], 19, 0);
		expect(t.text).toBe(BODY.slice(0, 19));
		expect(t.annotations.map((a) => a.start)).toEqual([4, 16]);
	});
});

describe('transferToAnnotations', () => {
	const transfer: AnnotationTransfer = {
		version: 1,
		text: 'quick brown fox',
		annotations: [
			{
				start: 0,
				end: 5,
				type: 'highlight',
				category: 'Yellow',
				comment: '',
				author: 'Josh',
				status: 'open',
				dateCreate: '2020-05-05T00:00:00.000Z',
				dateClosed: null,
			},
		],
	};

	it('captures selectors against the destination body, with fresh ids', () => {
		const dest = 'Before: quick brown fox :After';
		const [a] = transferToAnnotations(transfer, {
			body: dest,
			insertOffset: 8,
			ids: ['new-1'],
			nowIso: '2026-08-28T12:00:00.000Z',
		});
		expect(a?.id).toBe('new-1');
		expect(a?.selector.exact).toBe('quick');
		expect(a?.selector.prefix).toBe('Before: ');
		expect(a?.selector.suffix).toBe(' brown fox :After');
	});

	it('preserves dateCreate and stamps dateModified with the paste time', () => {
		const [a] = transferToAnnotations(transfer, {
			body: transfer.text,
			insertOffset: 0,
			ids: ['new-1'],
			nowIso: '2026-08-28T12:00:00.000Z',
		});
		expect(a?.dateCreate).toBe('2020-05-05T00:00:00.000Z');
		expect(a?.dateModified).toBe('2026-08-28T12:00:00.000Z');
	});

	it('skips an annotation with no id supplied or a range past the body', () => {
		expect(
			transferToAnnotations(transfer, {
				body: transfer.text,
				insertOffset: 0,
				ids: [],
				nowIso: '2026-08-28T12:00:00.000Z',
			}),
		).toEqual([]);
		expect(
			transferToAnnotations(transfer, {
				body: 'tiny',
				insertOffset: 0,
				ids: ['new-1'],
				nowIso: '2026-08-28T12:00:00.000Z',
			}),
		).toEqual([]);
	});

	it('round-trips a copy into a fresh note', () => {
		const t = buildTransfer(BODY, [placed('a', 4, 15)], 4, 19);
		const dest = `Intro. ${t.text} Outro.`;
		const [a] = transferToAnnotations(t, {
			body: dest,
			insertOffset: 7,
			ids: ['x'],
			nowIso: '2026-08-28T12:00:00.000Z',
		});
		expect(a?.selector.exact).toBe('quick brown');
		expect(dest.slice(7, 7 + t.text.length)).toBe(t.text);
	});
});
