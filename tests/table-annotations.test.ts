// End-to-end check of placing an annotation inside a table cell, using the
// real note structure and the real stored selector that exposed the bug.
//
// The chain under test is the one the post-processor performs for an unfocused
// Live Preview table cell: resolve the annotation against the note body, find
// which table cell that lands in, then convert its body offset into an offset
// within that cell's rendered text.

import { describe, expect, it } from 'vitest';
import { resolveSelector } from '../src/core/matcher';
import { tableGrids, tableRanges, matchTableGrid, overlapsAny } from '../src/core/tables';
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
// user's actual note). Obsidian's two views disagree on whether that line is
// part of the table — verified against @lezer/markdown's GFM extension (Live
// Preview: yes, absorbed as a row) and an actual Obsidian screenshot (Reading
// View: no, it renders as a separate line) — so both must work from the one
// stored selector.
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
	});

	// A highlight covering the middle of the absorbed line is unambiguously
	// "inside" the widened (lazy) table range for the Live Preview skip-check.
	it('Live Preview: a highlight inside the absorbed line falls inside the widened table range', () => {
		const from = BODY2.indexOf('continued note') + 2;
		const to = from + 4;
		expect(overlapsAny(tableRanges(BODY2), from, to)).toBe(true);
	});

	// The real annotation is a POINT sitting exactly at the trailing edge of
	// the absorbed line (right after "continued note", before the newline) —
	// which is also exactly where the lazy table range's `end` falls.
	// overlapsAny's documented convention excludes a point sitting ON a
	// range's boundary, so this is currently NOT treated as "inside" for the
	// skip-check. Whether Obsidian's actual widget-replace decoration also
	// renders a marker at that exact edge normally, or swallows it the same
	// as anything strictly inside, is a CodeMirror boundary behavior this
	// static test cannot confirm — it needs verifying against a real Live
	// Preview render. Documented here rather than asserted either way.
	it('resolves to a point exactly at the lazy table range\'s end boundary (open question, not asserted)', () => {
		const result = resolveSelector(BODY2, SELECTOR);
		if (result.status !== 'matched') throw new Error('expected a match');
		const [range] = tableRanges(BODY2);
		expect(result.start).toBe(range?.end);
	});

	it("Reading View: the strict grid still has a separate, correctly-shaped table ending before \"continued note\", for a real Reading View <table> with 2 rows to match", () => {
		const grids = tableGrids(BODY2);
		const strict = grids.find((g) => g.rows.length === 2);
		expect(strict?.rows[1]?.map((c) => c.text)).toEqual(['5', 'Note the delta', 'Goes in the inventory.']);
	});

	it('the lazily-absorbed candidate places "continued note" in its own padded row, for a Live Preview unfocused-cell render that included it', () => {
		const grids = tableGrids(BODY2);
		const lazy = grids.find((g) => g.rows.length === 3);
		expect(lazy?.rows[2]?.map((c) => c.text)).toEqual(['continued note', '', '']);
	});
});
