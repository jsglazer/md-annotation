import { describe, expect, it } from 'vitest';
import { matchTableGrid, overlapsAny, tableGrids, tableRanges } from '../src/core/tables';

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

describe('tableGrids', () => {
	const TABLE = ['| One   | Two | Three                 |',
		'| ----- | --- | --------------------- |',
		'| Three | bob | Highlight here please |'].join('\n');

	it('excludes the delimiter row, so row 0 is the header', () => {
		const grids = tableGrids(TABLE);
		expect(grids).toHaveLength(1);
		expect(grids[0]?.rows).toHaveLength(2);
		expect(grids[0]?.rows[0]?.map((c) => c.text)).toEqual(['One', 'Two', 'Three']);
		expect(grids[0]?.rows[1]?.map((c) => c.text)).toEqual(['Three', 'bob', 'Highlight here please']);
	});

	it('gives each cell the span of its trimmed text, excluding padding', () => {
		const grids = tableGrids(TABLE);
		const cell = grids[0]?.rows[1]?.[2];
		expect(cell).toBeDefined();
		expect(TABLE.slice(cell?.start, cell?.end)).toBe('Highlight here please');
	});

	it('keeps a genuinely empty cell but drops the outer pipe artifacts', () => {
		const grids = tableGrids(['|     |     |', '| --- | --- |', '|     | b   |'].join('\n'));
		expect(grids[0]?.rows[1]?.map((c) => c.text)).toEqual(['', 'b']);
	});

	it('does not split on an escaped pipe', () => {
		const grids = tableGrids(['| a | b |', '| - | - |', '| x \\| y | z |'].join('\n'));
		expect(grids[0]?.rows[1]?.map((c) => c.text)).toEqual(['x \\| y', 'z']);
	});
});

describe('matchTableGrid', () => {
	const TWO = [
		'| One | Two |', '| --- | --- |', '| a | b |',
		'', 'text between', '',
		'| P | Q | R |', '| - | - | - |', '| 1 | 2 | 3 |',
	].join('\n');

	it('identifies a table by its shape when that is unique', () => {
		const grid = matchTableGrid(tableGrids(TWO), [['P', 'Q', 'R'], ['1', '2', '3']]);
		expect(grid?.rows[0]?.map((c) => c.text)).toEqual(['P', 'Q', 'R']);
	});

	// A cell holding **bold** renders as "bold", so texts differ while the
	// shape does not — shape has to be enough on its own.
	it('still identifies a table whose rendered text differs from its source', () => {
		const grid = matchTableGrid(tableGrids(TWO), [['P', 'Q', 'R'], ['one', 'two', 'three']]);
		expect(grid?.rows[0]?.map((c) => c.text)).toEqual(['P', 'Q', 'R']);
	});

	it('breaks a shape tie using the cell text', () => {
		const same = ['| A |', '| - |', '| 1 |', '', 'gap', '', '| B |', '| - |', '| 2 |'].join('\n');
		const grid = matchTableGrid(tableGrids(same), [['B'], ['2']]);
		expect(grid?.rows[0]?.[0]?.text).toBe('B');
	});

	it('refuses to guess between two identical tables', () => {
		const same = ['| A |', '| - |', '| 1 |', '', 'gap', '', '| A |', '| - |', '| 1 |'].join('\n');
		expect(matchTableGrid(tableGrids(same), [['A'], ['1']])).toBeNull();
	});

	it('returns null when nothing matches', () => {
		expect(matchTableGrid(tableGrids(TWO), [['X', 'Y', 'Z', 'W']])).toBeNull();
	});
});
