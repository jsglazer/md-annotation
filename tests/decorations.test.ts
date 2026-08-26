import { describe, expect, it } from 'vitest';
import { selectDecorationRanges } from '../src/core/decorations';
import type { MatchResult } from '../src/core/matcher';
import { defaultSettings } from '../src/core/settings';
import type { Annotation } from '../src/core/types';

function annotation(id: string, type: 'highlight' | 'comment'): Annotation {
	return {
		id,
		type,
		category: type === 'comment' ? '' : 'Yellow',
		selector: { exact: type === 'comment' ? '' : 'quoted', prefix: '', suffix: '' },
		comment: '',
		author: 'Josh',
		status: 'open',
		dateCreate: '2026-08-15T00:00:00.000Z',
		dateModified: '2026-08-15T00:00:00.000Z',
		dateClosed: null,
	};
}

function matched(start: number, end: number): MatchResult {
	return { status: 'matched', start, end, confidence: 1, refreshedSelector: null };
}

const BODY = 'Some plain note text with no tables in it whatsoever, just prose.';

describe('selectDecorationRanges', () => {
	it('decorates a highlight whose range fits the document', () => {
		const a = annotation('a', 'highlight');
		const ranges = selectDecorationRanges(
			BODY.length,
			BODY,
			[a],
			new Map([['a', matched(5, 10)]]),
			defaultSettings(),
		);
		expect(ranges).toHaveLength(1);
		expect(ranges[0]?.from).toBe(5);
		expect(ranges[0]?.to).toBe(10);
	});

	it('keeps a genuine point comment, whose range was empty to begin with', () => {
		const a = annotation('a', 'comment');
		const ranges = selectDecorationRanges(
			BODY.length,
			BODY,
			[a],
			new Map([['a', matched(12, 12)]]),
			defaultSettings(),
		);
		expect(ranges).toHaveLength(1);
		expect(ranges[0]?.from).toBe(12);
		expect(ranges[0]?.to).toBe(12);
	});

	// The table-cell regression: Obsidian gives a focused Live Preview table
	// cell its own EditorView holding only that cell's text. Every annotation
	// resolved against the real note then clamps past the end of that tiny
	// document, and a non-empty range collapsing to a point must NOT be drawn
	// as a comment marker — doing so stacked every annotation in the note at
	// one spot inside the cell.
	it('drops a highlight whose range collapses to a point through clamping', () => {
		const a = annotation('a', 'highlight');
		const ranges = selectDecorationRanges(
			8, // a tiny document, e.g. one table cell
			BODY,
			[a],
			new Map([['a', matched(400, 420)]]),
			defaultSettings(),
		);
		expect(ranges).toHaveLength(0);
	});

	it('drops a range comment that collapses to a point through clamping', () => {
		const a = annotation('a', 'comment');
		const ranges = selectDecorationRanges(
			8,
			BODY,
			[a],
			new Map([['a', matched(400, 420)]]),
			defaultSettings(),
		);
		expect(ranges).toHaveLength(0);
	});

	it('never stacks a whole note of annotations onto one position in a short document', () => {
		const annotations = ['a', 'b', 'c', 'd'].map((id) => annotation(id, 'comment'));
		const outcomes = new Map<string, MatchResult>([
			['a', matched(100, 120)],
			['b', matched(200, 230)],
			['c', matched(300, 340)],
			['d', matched(400, 450)],
		]);
		const ranges = selectDecorationRanges(8, BODY, annotations, outcomes, defaultSettings());
		expect(ranges).toHaveLength(0);
	});

	it('skips an annotation that did not match', () => {
		const a = annotation('a', 'highlight');
		const outcomes = new Map<string, MatchResult>([
			['a', { status: 'orphaned', reason: 'not-found' }],
		]);
		expect(selectDecorationRanges(BODY.length, BODY, [a], outcomes, defaultSettings())).toHaveLength(
			0,
		);
	});

	it('honors the visibility toggles', () => {
		const highlight = annotation('h', 'highlight');
		const settings = defaultSettings();
		settings.annotationFormattingEnabled = false;
		expect(
			selectDecorationRanges(
				BODY.length,
				BODY,
				[highlight],
				new Map([['h', matched(5, 10)]]),
				settings,
			),
		).toHaveLength(0);

		const comment = annotation('c', 'comment');
		const hidden = defaultSettings();
		hidden.commentsHiddenEnabled = true;
		expect(
			selectDecorationRanges(
				BODY.length,
				BODY,
				[comment],
				new Map([['c', matched(12, 12)]]),
				hidden,
			),
		).toHaveLength(0);
	});

	it('returns ranges sorted by position', () => {
		const annotations = ['a', 'b', 'c'].map((id) => annotation(id, 'highlight'));
		const outcomes = new Map<string, MatchResult>([
			['a', matched(30, 35)],
			['b', matched(5, 10)],
			['c', matched(18, 22)],
		]);
		const ranges = selectDecorationRanges(BODY.length, BODY, annotations, outcomes, defaultSettings());
		expect(ranges.map((r) => r.from)).toEqual([5, 18, 30]);
	});
});
