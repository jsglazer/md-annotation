import { describe, expect, it } from 'vitest';
import {
	matchTableGrid,
	overlapsAny,
	placeInCell,
	sourceToRenderedOffsets,
	tableGrids,
	tableRanges,
} from '../src/core/tables';

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

	// Obsidian's editor (HyperMD mode, read from Obsidian 1.13.7's app.js) ends
	// a table at the first line that does not fit its style — GFM's lazy
	// continuation of a pipe-less line does not happen there.
	it('ends a piped table at a line that does not start with a pipe', () => {
		const text = ['| A |', '| - |', '| 1 |', 'no pipe here', '| B |', '| - |', '| 2 |'].join('\n');
		const ranges = tableRanges(text);
		expect(ranges).toHaveLength(2);
		expect(text.slice(ranges[0]?.start, ranges[0]?.end)).toBe('| A |\n| - |\n| 1 |');
	});

	it('ends a piped table even at a line that contains a pipe mid-line', () => {
		const text = ['| A | B |', '| - | - |', '| 1 | 2 |', 'x | y'].join('\n');
		expect(text.slice(tableRanges(text)[0]?.start, tableRanges(text)[0]?.end)).toBe(
			'| A | B |\n| - | - |\n| 1 | 2 |',
		);
	});

	it('continues a table with no outer pipes through lines that contain one', () => {
		const text = ['A | B', '- | -', '1 | 2', '3 | 4', 'plain'].join('\n');
		const grids = tableGrids(text);
		expect(grids).toHaveLength(1);
		expect(grids[0]?.rows.map((r) => r.map((c) => c.text))).toEqual([
			['A', 'B'],
			['1', '2'],
			['3', '4'],
		]);
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

	it('records each row\'s whole source line', () => {
		const grids = tableGrids(TABLE);
		const line = grids[0]?.rowLines[1];
		expect(TABLE.slice(line?.start, line?.end)).toBe(TABLE.split('\n')[2]);
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

describe('placeInCell', () => {
	const TEXT = ['| a | bb |', '| - | -- |', '| xy | z |'].join('\n');
	const grid = tableGrids(TEXT)[0]!;
	const at = (needle: string): number => TEXT.indexOf(needle);

	it('clips a highlight to the cell it overlaps', () => {
		const from = at('xy');
		expect(placeInCell(grid, 1, 0, from, from + 2)).toEqual({ start: 0, end: 2 });
		expect(placeInCell(grid, 1, 1, from, from + 2)).toBeNull();
	});

	it('splits a highlight across cells into per-cell pieces', () => {
		const from = at('y');
		const to = at('z') + 1;
		expect(placeInCell(grid, 1, 0, from, to)).toEqual({ start: 1, end: 2 });
		expect(placeInCell(grid, 1, 1, from, to)).toEqual({ start: 0, end: 1 });
	});

	it('gives a point in a cell to that cell only', () => {
		const p = at('xy') + 1;
		expect(placeInCell(grid, 1, 0, p, p)).toEqual({ start: 1, end: 1 });
		expect(placeInCell(grid, 1, 1, p, p)).toBeNull();
	});

	it('gives a point in trailing padding to the cell before it, clamped to its end', () => {
		const p = at('xy') + 3; // the space after "xy", before the pipe
		expect(placeInCell(grid, 1, 0, p, p)).toEqual({ start: 2, end: 2 });
	});

	it('gives a point at the very end of the row to the last cell', () => {
		const p = TEXT.length;
		expect(placeInCell(grid, 1, 1, p, p)).toEqual({ start: 1, end: 1 });
	});

	it('ignores a point on a different row', () => {
		const p = at('bb');
		expect(placeInCell(grid, 1, 1, p, p)).toBeNull();
	});
});

describe('sourceToRenderedOffsets', () => {
	it('maps across dropped inline markup', () => {
		const source = 'Set the **Imp** column — `P` / `R`.';
		const rendered = 'Set the Imp column — P / R.';
		const map = sourceToRenderedOffsets(source, rendered)!;
		expect(map).not.toBeNull();
		expect(map(source.length)).toBe(rendered.length);
		const s = source.indexOf('Imp');
		expect(rendered.slice(map(s), map(s + 3))).toBe('Imp');
	});

	it('gives up when the rendered text is not a subsequence of the source', () => {
		expect(sourceToRenderedOffsets('[[Page|alias]]', 'alias')).not.toBeNull();
		expect(sourceToRenderedOffsets('[[Ops#7. Z]]', 'Ops > 7. Z')).toBeNull();
	});
});
