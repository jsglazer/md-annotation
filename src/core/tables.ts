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
//
// Where a table ENDS is not one fixed answer: Live Preview's editor widget
// boundary comes from the `@lezer/markdown` GFM parser CodeMirror is built on,
// which (verified directly against that package) keeps absorbing a table
// through any non-blank line that doesn't start a new block — even one with no
// pipe at all — as a further single-cell row. Reading View's separate HTML
// renderer does NOT do this (verified against an actual note rendered in
// Obsidian): a pipe-less line right after a table renders as an ordinary,
// separate line. Both are real, simultaneously, for the same source text —
// which line is skipped as "inside a table" for CM decorations, and which grid
// shape a rendered `<table>` is matched against, genuinely differ between the
// two views. `tableGrids` below returns BOTH candidate parses whenever they
// diverge (same start, different row count from the lazily-absorbed tail), so
// each caller's existing shape/text matching picks whichever one the view it
// is actually running in produced — never a guess, since the two candidates
// can never share a row count when they diverge.

const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

// A table needs a pipe to START — this applies to both boundary rules, and is
// only used to recognize the candidate header line before a delimiter row
// confirms it.
function looksLikeTableRow(line: string): boolean {
	return line.includes('|');
}

function isDelimiterRow(line: string): boolean {
	return line.includes('-') && DELIMITER_ROW.test(line);
}

// Block-starting lines that interrupt a table the same way they interrupt an
// ordinary paragraph under CommonMark's lazy-continuation rules — verified
// directly against `@lezer/markdown`'s GFM extension (heading/list/blockquote/
// fence all end the table there exactly as modeled here; a bare thematic break
// is a rarer edge case where Lezer instead reinterprets the whole preceding
// table as a Setext-heading paragraph, which this treats as "ends the table"
// too — a safe approximation of an already-pathological input).
const HEADING_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const THEMATIC_BREAK_LINE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
const BLOCKQUOTE_LINE = /^ {0,3}>/;
const LIST_LINE = /^ {0,3}(?:[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/;

// Whether `line` continues an already-open table under the LAZY (Live Preview
// / Lezer) rule: non-blank and not a block-starter, pipes or not.
function continuesTableLazily(line: string): boolean {
	if (line.trim() === '') return false;
	return (
		!HEADING_LINE.test(line) &&
		!THEMATIC_BREAK_LINE.test(line) &&
		!BLOCKQUOTE_LINE.test(line) &&
		!LIST_LINE.test(line) &&
		!FENCE_LINE.test(line)
	);
}

// Pad or truncate a parsed row to the header's column count — what a lazily
// absorbed row actually renders as (missing trailing cells empty, extra cells
// dropped) — so it lines up with the DOM's cell count for matchTableGrid's
// shape comparison.
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

// Parses every GFM table under one continuation rule: a header row immediately
// followed by a delimiter row (e.g. "| --- | --- |"), extending through
// however many further rows follow per `continues`. `lazy` additionally
// normalizes each row to the header's column count, matching how a lazily
// absorbed pipe-less row actually renders.
function parseTableGrids(
	text: string,
	continues: (line: string) => boolean,
	lazy: boolean,
): TableGrid[] {
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
				if (row === undefined || !continues(row)) break;
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
					const cells = splitRow(lineText, lineStart);
					return lazy ? normalizeRowLength(cells, columnCount, lineStart + lineText.length) : cells;
				}),
			});
			i = j;
			continue;
		}
		i++;
	}
	return grids;
}

// Every GFM table in `text`, as BOTH boundary candidates wherever they
// diverge — see the module comment above for why there are two. Most tables
// (nothing non-blank and pipe-less immediately follows) parse identically
// either way, so only one candidate is produced for them; a table followed
// with no blank line by ordinary text produces a second, longer candidate for
// exactly that table (same start, more rows) alongside the strict one.
export function tableGrids(text: string): TableGrid[] {
	const strict = parseTableGrids(text, looksLikeTableRow, false);
	const lazy = parseTableGrids(text, continuesTableLazily, true);
	const lazyByStart = new Map(lazy.map((g) => [g.start, g]));
	const grids: TableGrid[] = [];
	for (const s of strict) {
		grids.push(s);
		const l = lazyByStart.get(s.start);
		if (l && l.rows.length !== s.rows.length) grids.push(l);
	}
	return grids;
}

// [start, end) character ranges of every table in `text` — the widest
// (lazy-boundary) end wherever the two candidates diverge, since callers use
// this to decide what a Live Preview table widget covers.
export function tableRanges(text: string): TextRange[] {
	const byStart = new Map<number, TextRange>();
	for (const grid of tableGrids(text)) {
		const existing = byStart.get(grid.start);
		if (!existing || grid.end > existing.end) byStart.set(grid.start, { start: grid.start, end: grid.end });
	}
	return [...byStart.values()];
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
