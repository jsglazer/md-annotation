// Detects the character ranges GFM tables occupy in a document. Pure module —
// no 'obsidian', no DOM.
//
// Why this exists: Obsidian's Live Preview renders a markdown table as one
// atomic block widget that replaces its raw source text. A CodeMirror mark or
// widget decoration whose range overlaps that widget crashes the editor's
// decoration pipeline — and since our decorations live in a single
// StateField, the crash takes every highlight in the file down with it, not
// just the one inside the table (all of them vanish until the next edit
// briefly recovers them, then the same crash wipes them again). The fix is to
// never hand CodeMirror a decoration that overlaps a table in the first
// place; this module is how the editor layer knows which ranges those are.
// Reading view is unaffected — it walks the rendered HTML <table> like any
// other block and never touches CodeMirror decorations — so tables are only
// ever excluded here, not from matching or the sidebar.

const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function looksLikeTableRow(line: string): boolean {
	return line.includes('|');
}

function isDelimiterRow(line: string): boolean {
	return line.includes('-') && DELIMITER_ROW.test(line);
}

export interface TextRange {
	start: number;
	end: number;
}

// [start, end) character ranges of every table in `text`: a header row
// immediately followed by a delimiter row (e.g. "| --- | --- |"), extending
// through however many further pipe rows follow with no blank line between —
// the same rule Obsidian/GFM use to recognize a table.
export function tableRanges(text: string): TextRange[] {
	const lines = text.split('\n');
	const lineStarts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineStarts.push(offset);
		offset += line.length + 1;
	}

	const ranges: TextRange[] = [];
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
			let endLine = i + 1;
			let j = i + 2;
			while (j < lines.length) {
				const row = lines[j];
				if (row === undefined || row.trim() === '' || !looksLikeTableRow(row)) break;
				endLine = j;
				j++;
			}
			const start = lineStarts[i] ?? 0;
			const lastLine = lines[endLine] ?? '';
			const end = (lineStarts[endLine] ?? 0) + lastLine.length;
			ranges.push({ start, end });
			i = j;
			continue;
		}
		i++;
	}
	return ranges;
}

// Whether [from, to) falls at least partly inside any of `ranges`. A point
// (from === to) counts only when it sits strictly inside one, not on its
// boundary — the same convention used by the interval test for non-empty
// ranges.
export function overlapsAny(ranges: ReadonlyArray<TextRange>, from: number, to: number): boolean {
	return ranges.some((r) => from < r.end && to > r.start);
}
