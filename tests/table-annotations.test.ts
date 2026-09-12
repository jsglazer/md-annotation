// End-to-end check of placing an annotation inside a table cell, using the
// real note structure and the real stored selector that exposed the bug.
//
// The chain under test is the one the post-processor performs for an unfocused
// Live Preview table cell: resolve the annotation against the note body, find
// which table cell that lands in, then convert its body offset into an offset
// within that cell's rendered text.

import { describe, expect, it } from 'vitest';
import { resolveSelector } from '../src/core/matcher';
import { matchTableGrid, overlapsAny, placeInCell, sourceToRenderedOffsets, tableGrids, tableRanges } from '../src/core/tables';
import type { TableCell } from '../src/core/tables';

// The note body from the reported case, trimmed to what matters.
const BODY = [
	'# One',
	'',
	'| One   | Two | Three                 |',
	'| ----- | --- | --------------------- |',
	'| Three | bob | Highlight here please |',
	'|       |     |                       |',
	'',
	'## Introduction',
	'If you write software for a living, a large language model has probably',
	'done part of your job today.',
].join('\n');

// Stored verbatim from the note's %%md-annotation block.
const HERE_SELECTOR = {
	exact: 'here',
	prefix: '--- |\n| Three | bob | Highlight ',
	suffix: ' please |\n|       |     |       ',
};

function cellContaining(body: string, start: number, end: number): TableCell | null {
	for (const grid of tableGrids(body)) {
		for (const row of grid.rows) {
			for (const cell of row) {
				if (start >= cell.start && end <= cell.end) return cell;
			}
		}
	}
	return null;
}

describe('annotation inside a table cell', () => {
	it('resolves to the text it was anchored to', () => {
		const result = resolveSelector(BODY, HERE_SELECTOR);
		expect(result.status).toBe('matched');
		if (result.status !== 'matched') return;
		expect(BODY.slice(result.start, result.end)).toBe('here');
	});

	it('lands inside the correct cell, and nowhere else', () => {
		const result = resolveSelector(BODY, HERE_SELECTOR);
		if (result.status !== 'matched') throw new Error('expected a match');
		const cell = cellContaining(BODY, result.start, result.end);
		expect(cell?.text).toBe('Highlight here please');
	});

	// The placement the fix relies on: the cell's own span converts the note
	// offset into an offset within that one cell's text, so the highlight can
	// be drawn without the matcher having to re-find it in a fragment whose
	// surrounding context (pipes, padding) no longer exists.
	it('converts the note offset into the right offset within the cell', () => {
		const result = resolveSelector(BODY, HERE_SELECTOR);
		if (result.status !== 'matched') throw new Error('expected a match');
		const cell = cellContaining(BODY, result.start, result.end);
		if (!cell) throw new Error('expected a cell');

		const cellText = BODY.slice(cell.start, cell.end);
		const from = result.start - cell.start;
		const to = result.end - cell.start;
		expect(cellText.slice(from, to)).toBe('here');
	});

	it('identifies that table from how it renders, header row included', () => {
		// What the DOM shows: the delimiter row is not rendered, so the grid is
		// the header followed by the data rows.
		const rendered = [
			['One', 'Two', 'Three'],
			['Three', 'bob', 'Highlight here please'],
			['', '', ''],
		];
		const grid = matchTableGrid(tableGrids(BODY), rendered);
		expect(grid).not.toBeNull();
		expect(grid?.rows[1]?.[2]?.text).toBe('Highlight here please');
	});

	it('places a point comment inside a cell at its exact offset', () => {
		// A comment dropped between "Highlight" and "here".
		const anchor = BODY.indexOf('here please');
		const cell = cellContaining(BODY, anchor, anchor);
		if (!cell) throw new Error('expected a cell');
		const cellText = BODY.slice(cell.start, cell.end);
		const pos = anchor - cell.start;
		expect(cellText.slice(0, pos)).toBe('Highlight ');
	});
});

// Reported case, reduced to what matters: a point comment on a line typed
// right after a table with no blank line in between (e.g. "test2" in the
// user's actual note). Obsidian ends the table before that line, in both
// views, so the comment is ordinary text and decorates normally.
describe('a point comment on a line right after a table, no blank line between', () => {
	const BODY2 = [
		'| # | Step | Instructions |',
		'| --- | --- | --- |',
		'| 5 | Note the delta | Goes in the inventory. |',
		'continued note',
		'# Next section',
	].join('\n');

	const SELECTOR = {
		exact: '',
		prefix: 'entory.|\ncontinued note',
		suffix: '\n# Next section',
	};

	it('resolves to the position right after "continued note"', () => {
		const result = resolveSelector(BODY2, SELECTOR);
		expect(result.status).toBe('matched');
		if (result.status !== 'matched') return;
		expect(BODY2.slice(0, result.start).endsWith('continued note')).toBe(true);
	});

	it('is outside the table, so Live Preview does not skip it', () => {
		const result = resolveSelector(BODY2, SELECTOR);
		if (result.status !== 'matched') throw new Error('expected a match');
		const [range] = tableRanges(BODY2);
		expect(result.start).toBeGreaterThan(range?.end ?? Infinity);
		expect(overlapsAny(tableRanges(BODY2), result.start, result.end)).toBe(false);
	});

	it('leaves the table itself with just its header and one row', () => {
		const grids = tableGrids(BODY2);
		expect(grids).toHaveLength(1);
		expect(grids[0]?.rows[1]?.map((c) => c.text)).toEqual(['5', 'Note the delta', 'Goes in the inventory.']);
	});
});

// Reported case: comments at the end of a cell whose text carries inline
// markdown. The rendered cell drops the markup, so the stored context never
// matches it; the offset is instead mapped from source to rendered text.
describe('a point comment at the end of a cell with inline markdown', () => {
	const BODY3 = [
		'| #   | Step | Instructions |',
		'| --- | ---- | ------------ |',
		'| 5   | Note | Set the **`Imp`** column here too — one letter, `P` / `B` / `R`.      |',
	].join('\n');
	const RENDERED = 'Set the Imp column here too — one letter, P / B / R.';

	it('lands at the end of the rendered cell text', () => {
		const point = BODY3.indexOf('R`.') + 3;
		const grid = tableGrids(BODY3)[0]!;
		const local = placeInCell(grid, 1, 2, point, point);
		expect(local).not.toBeNull();
		const cell = grid.rows[1]![2]!;
		const map = sourceToRenderedOffsets(BODY3.slice(cell.start, cell.end), RENDERED)!;
		expect(map(local!.start)).toBe(RENDERED.length);
	});
});
