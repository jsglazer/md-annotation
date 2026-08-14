import { describe, expect, it } from 'vitest';
import { overlapsAny, tableRanges } from '../src/core/tables';

describe('tableRanges', () => {
	it('finds a simple table: header row + delimiter row + data rows', () => {
		const text = ['Intro text.', '', '| One | Two |', '| --- | --- |', '| a | b |', '', 'Outro.'].join(
			'\n',
		);
		const ranges = tableRanges(text);
		expect(ranges).toHaveLength(1);
		const table = text.slice(ranges[0]?.start, ranges[0]?.end);
		expect(table).toBe('| One | Two |\n| --- | --- |\n| a | b |');
	});

	it('finds multiple tables in the same document', () => {
		const text = ['| A |', '| - |', '| 1 |', '', 'text', '', '| B |', '| - |', '| 2 |'].join('\n');
		expect(tableRanges(text)).toHaveLength(2);
	});

	it('ignores a header row with no delimiter row (not a table)', () => {
		const text = ['| One | Two |', 'plain text with | a pipe'].join('\n');
		expect(tableRanges(text)).toHaveLength(0);
	});

	it('stops a table at a row with no pipe, treating what follows as separate', () => {
		const text = ['| A |', '| - |', '| 1 |', 'no pipe here', '| B |', '| - |', '| 2 |'].join('\n');
		const ranges = tableRanges(text);
		expect(ranges).toHaveLength(2);
		expect(text.slice(ranges[0]?.start, ranges[0]?.end)).toBe('| A |\n| - |\n| 1 |');
		expect(text.slice(ranges[1]?.start, ranges[1]?.end)).toBe('| B |\n| - |\n| 2 |');
	});

	it('recognizes alignment markers in the delimiter row', () => {
		const text = ['| L | C | R |', '| :-- | :-: | --: |', '| a | b | c |'].join('\n');
		expect(tableRanges(text)).toHaveLength(1);
	});

	it('finds nothing in a document with no tables', () => {
		expect(tableRanges('Just a normal note.\n\nWith paragraphs.')).toHaveLength(0);
	});
});

describe('overlapsAny', () => {
	const ranges = [{ start: 10, end: 20 }];

	it('detects a range fully inside a table range', () => {
		expect(overlapsAny(ranges, 12, 15)).toBe(true);
	});

	it('detects a range partially overlapping a table range', () => {
		expect(overlapsAny(ranges, 5, 12)).toBe(true);
		expect(overlapsAny(ranges, 18, 25)).toBe(true);
	});

	it('is false for a range entirely outside any table range', () => {
		expect(overlapsAny(ranges, 0, 5)).toBe(false);
		expect(overlapsAny(ranges, 25, 30)).toBe(false);
	});

	it('is false for a range that only touches the boundary', () => {
		expect(overlapsAny(ranges, 0, 10)).toBe(false);
		expect(overlapsAny(ranges, 20, 30)).toBe(false);
	});
});
