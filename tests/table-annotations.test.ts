// End-to-end check of placing an annotation inside a table cell, using the
// real note structure and the real stored selector that exposed the bug.
//
// The chain under test is the one the post-processor performs for an unfocused
// Live Preview table cell: resolve the annotation against the note body, find
// which table cell that lands in, then convert its body offset into an offset
// within that cell's rendered text.

import { describe, expect, it } from 'vitest';
import { resolveSelector } from '../src/core/matcher';
import { tableGrids, matchTableGrid } from '../src/core/tables';
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
