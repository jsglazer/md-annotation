// Which annotations get drawn in a given document, and over what range. Pure
// module — no 'obsidian', no DOM, no CodeMirror — so the rules that decide
// what appears in the editor are directly testable.
//
// The critical invariant here is that the offsets in a MatchResult describe
// ONE specific document (the note's body). Handing this function a different,
// shorter document must not produce decorations at made-up positions — see
// the clamping rule below.

import type { MatchResult } from './matcher';
import type { MdAnnotationSettings } from './settings';
import { overlapsAny, tableRanges } from './tables';
import type { Annotation } from './types';

export interface DecorationRange {
	from: number;
	to: number;
	annotation: Annotation;
}

export function selectDecorationRanges(
	docLength: number,
	body: string,
	annotations: ReadonlyArray<Annotation>,
	outcomes: ReadonlyMap<string, MatchResult>,
	settings: MdAnnotationSettings,
): DecorationRange[] {
	const tables = tableRanges(body);
	const ranges: DecorationRange[] = [];
	for (const annotation of annotations) {
		const outcome = outcomes.get(annotation.id);
		if (!outcome || outcome.status !== 'matched') continue;
		const from = Math.max(0, Math.min(outcome.start, docLength));
		const to = Math.min(outcome.end, docLength);
		if (from > to) continue;
		// Clamping only collapses a real range when the document being drawn is
		// shorter than the one the outcome was resolved against — i.e. it is not
		// the document these offsets describe. Drawing it anyway would put a
		// marker at an arbitrary position, and since every over-long range
		// clamps to the SAME position, they would all stack there. Obsidian
		// hands us exactly that situation for a focused Live Preview table cell,
		// whose editor holds only that one cell's text.
		if (from === to && outcome.start !== outcome.end) continue;
		// A range inside a table is skipped (see tables.ts): Obsidian renders a
		// table as its own block widget, and CodeMirror decorations placed
		// inside one are not displayed in Live Preview regardless — see
		// https://forum.obsidian.md/t/bug-adding-decorations-inside-tables-no-longer-works/75160.
		// Such an annotation still exists and is fully editable from the
		// sidebar; it simply draws nothing in the editor.
		if (overlapsAny(tables, from, to)) continue;
		if (from === to) {
			// Point comment marker.
			if (annotation.type !== 'comment' || settings.commentsHiddenEnabled) continue;
			ranges.push({ from, to, annotation });
			continue;
		}
		if (annotation.type === 'highlight' && !settings.annotationFormattingEnabled) continue;
		if (annotation.type === 'comment' && !settings.commentsFormattingEnabled) continue;
		ranges.push({ from, to, annotation });
	}
	ranges.sort((a, b) => a.from - b.from || a.to - b.to);
	return ranges;
}
