// GFM table structure: where tables sit in a document, and where each of their
// cells sits. Pure module — no 'obsidian', no DOM.
//
// Two callers need this, for opposite reasons:
//
//   - The Live Preview decoration pass, to SKIP table ranges. Obsidian renders
//     a table as its own block widget, and a CodeMirror decoration inside one
//     is not displayed — see
//     https://forum.obsidian.md/t/bug-adding-decorations-inside-tables-no-longer-works/75160.
//     (Source mode has no such widget, so it decorates tables normally.)
//   - The markdown post-processor, to PLACE annotations inside a cell. Obsidian
//     renders each unfocused Live Preview cell through that post-processor, but
//     gives it no section info — so the cell has to be identified structurally,
//     by matching the rendered table's grid back to one parsed from the note.

const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

// A table needs a pipe to START — this is only used to recognize the
// candidate header line before a delimiter row confirms it.
function looksLikeTableRow(line: string): boolean {
	return line.includes('|');
}

function isDelimiterRow(line: string): boolean {
	return line.includes('-') && DELIMITER_ROW.test(line);
}

// Block-starting lines that interrupt a table the same way they interrupt an
// ordinary paragraph under CommonMark's lazy-continuation rules. GFM tables
// reuse that mechanism (see the spec's tables extension: "The table is broken
// at the first empty line or beginning of another block-level structure") —
// verified against markdown-it's GFM table implementation.
const HEADING_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const THEMATIC_BREAK_LINE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
const BLOCKQUOTE_LINE = /^ {0,3}>/;
const LIST_LINE = /^ {0,3}(?:[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/;

// Whether `line` continues an already-open table. Unlike `looksLikeTableRow`
// (which requires a pipe to START one), GFM keeps swallowing lines — pipes or
// not — as further one-or-more-cell rows until a blank line or one of these
// block-starters appears. A table immediately followed by ordinary text with
// no blank line in between (a common typo) therefore renders as an extra row,
// not a separate paragraph — Obsidian does this too, so our parser has to
// agree or every cell/range calculation downstream drifts from what is
// actually on screen.
function continuesTable(line: string): boolean {
	if (line.trim() === '') return false;
	return (
		!HEADING_LINE.test(line) &&
		!THEMATIC_BREAK_LINE.test(line) &&
		!BLOCKQUOTE_LINE.test(line) &&
		!LIST_LINE.test(line) &&
		!FENCE_LINE.test(line)
	);
}

// Pad or truncate a parsed row to the header's column count — what GFM
// actually renders (missing trailing cells render empty; extra cells are
// dropped) — so a lazily-continued or short/long row still lines up with the
// DOM's cell count for matchTableGrid's shape comparison.
function normalizeRowLength(cells: TableCell[], columnCount: number, lineEnd: number): TableCell[] {
	if (cells.length === columnCount) return cells;
	if (cells.length > columnCount) return cells.slice(0, columnCount);
	const padded = cells.slice();
	while (padded.length < columnCount) padded.push({ text: '', start: lineEnd, end: lineEnd });
	return padded;
}

export interface TextRange {
	start: number;
	end: number;
}

// One cell's trimmed text and the [start, end) span that text occupies in the
// document — the span excludes the padding spaces, so it lines up with what a
// renderer shows.
export interface TableCell {
	text: string;
	start: number;
	end: number;
}

// One table: its overall span, and its rows of cells with the delimiter row
// removed — so row 0 is the header, matching how a renderer builds <table>.
export interface TableGrid {
	start: number;
	end: number;
	rows: TableCell[][];
}

// Split one row into cells on unescaped pipes. The pipes that open and close a
// row produce empty outer segments, which are dropped — but an genuinely empty
// cell between two pipes is kept.
function splitRow(line: string, lineStart: number): TableCell[] {
	const cells: TableCell[] = [];
	const push = (from: number, to: number): void => {
		const raw = line.slice(from, to);
		const lead = raw.length - raw.trimStart().length;
		const text = raw.trim();
		cells.push({ text, start: lineStart + from + lead, end: lineStart + from + lead + text.length });
	};

	let segStart = 0;
	let i = 0;
	while (i < line.length) {
		if (line[i] === '\\') {
			i += 2;
			continue;
		}
		if (line[i] === '|') {
			push(segStart, i);
			segStart = i + 1;
		}
		i++;
	}
	push(segStart, line.length);

	if (cells.length > 0 && cells[0]?.text === '' && line.trimStart().startsWith('|')) cells.shift();
	const last = cells[cells.length - 1];
	if (cells.length > 0 && last?.text === '' && line.trimEnd().endsWith('|')) cells.pop();
	return cells;
}

// Every GFM table in `text`: a header row immediately followed by a delimiter
// row (e.g. "| --- | --- |"), extending through however many further pipe rows
// follow with no blank line between.
export function tableGrids(text: string): TableGrid[] {
	const lines = text.split('\n');
	const lineStarts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineStarts.push(offset);
		offset += line.length + 1;
	}

	const grids: TableGrid[] = [];
	let i = 0;
	while (i < lines.length) {
		const header = lines[i];
		const delimiter = lines[i + 1];
		if (
			header !== undefined &&
			delimiter !== undefined &&
			looksLikeTableRow(header) &&
			isDelimiterRow(delimiter)
		) {
			const columnCount = splitRow(header, lineStarts[i] ?? 0).length;
			// The delimiter row is structure, not content, so it is left out of
			// `rows` — a renderer does not emit a <tr> for it either.
			const rowLines = [i];
			let endLine = i + 1;
			let j = i + 2;
			while (j < lines.length) {
				const row = lines[j];
				if (row === undefined || !continuesTable(row)) break;
				rowLines.push(j);
				endLine = j;
				j++;
			}
			grids.push({
				start: lineStarts[i] ?? 0,
				end: (lineStarts[endLine] ?? 0) + (lines[endLine] ?? '').length,
				rows: rowLines.map((ln) => {
					const lineText = lines[ln] ?? '';
					const lineStart = lineStarts[ln] ?? 0;
					return normalizeRowLength(
						splitRow(lineText, lineStart),
						columnCount,
						lineStart + lineText.length,
					);
				}),
			});
			i = j;
			continue;
		}
		i++;
	}
	return grids;
}

// [start, end) character ranges of every table in `text`.
export function tableRanges(text: string): TextRange[] {
	return tableGrids(text).map((grid) => ({ start: grid.start, end: grid.end }));
}

// Whether [from, to) falls at least partly inside any of `ranges`. A point
// (from === to) counts only when it sits strictly inside one, not on its
// boundary — the same convention used by the interval test for non-empty
// ranges.
export function overlapsAny(ranges: ReadonlyArray<TextRange>, from: number, to: number): boolean {
	return ranges.some((r) => from < r.end && to > r.start);
}

// Identify which parsed table a rendered one is, given the rendered table's
// grid of trimmed cell texts. Returns null rather than guessing whenever the
// answer is not unique — two identical tables in a note are genuinely
// indistinguishable this way, and placing an annotation in the wrong one is
// worse than not placing it at all.
//
// Shape (row and column counts) is tried first because it survives inline
// markdown: a cell holding `**bold**` renders as `bold`, so its texts differ
// while its shape does not. Text equality only has to break ties.
export function matchTableGrid(
	grids: ReadonlyArray<TableGrid>,
	rendered: ReadonlyArray<ReadonlyArray<string>>,
): TableGrid | null {
	const sameShape = grids.filter(
		(g) =>
			g.rows.length === rendered.length &&
			g.rows.every((row, r) => row.length === (rendered[r]?.length ?? -1)),
	);
	if (sameShape.length === 1) return sameShape[0] ?? null;
	if (sameShape.length === 0) return null;

	const sameText = sameShape.filter((g) =>
		g.rows.every((row, r) => row.every((cell, c) => cell.text === rendered[r]?.[c])),
	);
	return sameText.length === 1 ? (sameText[0] ?? null) : null;
}
