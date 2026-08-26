import { describe, expect, it } from 'vitest';
import { lineNumberAt, nearestAnnotationId, numberComments } from '../src/core/ordering';
import type { MatchResult } from '../src/core/matcher';
import type { Annotation } from '../src/core/types';

function makeAnnotation(id: string, overrides: Partial<Annotation> = {}): Annotation {
	return {
		id,
		type: 'comment',
		category: '',
		selector: { exact: '', prefix: '', suffix: '' },
		comment: '',
		author: '',
		status: 'open',
		dateCreate: '2026-01-01T00:00:00.000Z',
		dateModified: '2026-01-01T00:00:00.000Z',
		dateClosed: null,
		...overrides,
	};
}

function matched(start: number, end = start): MatchResult {
	return { status: 'matched', start, end, confidence: 1, refreshedSelector: null };
}

const orphaned: MatchResult = { status: 'orphaned', reason: 'not-found' };

describe('numberComments', () => {
	it('numbers matched comments by body position, 1-based', () => {
		const annotations = [
			makeAnnotation('c1'),
			makeAnnotation('c2'),
			makeAnnotation('c3'),
		];
		const outcomes = new Map<string, MatchResult>([
			['c1', matched(50)],
			['c2', matched(10)],
			['c3', matched(30)],
		]);
		const numbers = numberComments(annotations, outcomes);
		expect(numbers.get('c2')).toBe(1);
		expect(numbers.get('c3')).toBe(2);
		expect(numbers.get('c1')).toBe(3);
	});

	it('skips highlights and orphaned comments', () => {
		const annotations = [
			makeAnnotation('c1'),
			makeAnnotation('h1', { type: 'highlight', category: 'Yellow' }),
			makeAnnotation('c2'),
		];
		const outcomes = new Map<string, MatchResult>([
			['c1', matched(5)],
			['h1', matched(1)],
			['c2', orphaned],
		]);
		const numbers = numberComments(annotations, outcomes);
		expect(numbers.get('c1')).toBe(1);
		expect(numbers.has('h1')).toBe(false);
		expect(numbers.has('c2')).toBe(false);
	});
});

describe('lineNumberAt', () => {
	it('returns 1 for the first line', () => {
		expect(lineNumberAt('hello world', 0)).toBe(1);
		expect(lineNumberAt('hello world', 5)).toBe(1);
	});

	it('counts newlines before the offset', () => {
		const body = 'line one\nline two\nline three';
		expect(lineNumberAt(body, body.indexOf('two'))).toBe(2);
		expect(lineNumberAt(body, body.indexOf('three'))).toBe(3);
	});

	it('clamps out-of-range offsets', () => {
		const body = 'a\nb\nc';
		expect(lineNumberAt(body, -10)).toBe(1);
		expect(lineNumberAt(body, 999)).toBe(3);
	});
});

describe('nearestAnnotationId', () => {
	const annotations = [makeAnnotation('a'), makeAnnotation('b'), makeAnnotation('c')];
	const outcomes = new Map<string, MatchResult>([
		['a', matched(0, 5)],
		['b', matched(20, 30)],
		['c', matched(100, 100)],
	]);

	it('returns the annotation whose range contains the offset', () => {
		expect(nearestAnnotationId(annotations, outcomes, 25)).toBe('b');
	});

	it('returns the closest range when the offset is outside all of them', () => {
		expect(nearestAnnotationId(annotations, outcomes, 10)).toBe('a');
		expect(nearestAnnotationId(annotations, outcomes, 40)).toBe('b');
		expect(nearestAnnotationId(annotations, outcomes, 90)).toBe('c');
	});

	it('ignores orphaned annotations and returns null when none match', () => {
		const allOrphaned = new Map<string, MatchResult>([
			['a', orphaned],
			['b', orphaned],
		]);
		expect(nearestAnnotationId(annotations, allOrphaned, 5)).toBeNull();
	});
});
