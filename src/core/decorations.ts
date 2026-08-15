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

// `skipTables` is set only for Live Preview, where Obsidian replaces a table
// with its own block widget and a decoration inside it is never displayed.
// Source mode renders the table as ordinary text, so its annotations decorate
// normally and must not be dropped.
export function selectDecorationRanges(
	docLength: number,
	body: string,
	annotations: ReadonlyArray<Annotation>,
	outcomes: ReadonlyMap<string, MatchResult>,
	settings: MdAnnotationSettings,
	skipTables: boolean,
): DecorationRange[] {
	const tables = skipTables ? tableRanges(body) : [];
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
		// In Live Preview the table is a block widget, so a decoration inside it
		// would never be displayed; the markdown post-processor draws those
		// annotations instead (see editor/readingView.ts). The annotation is
		// unaffected either way — it stays editable from the sidebar.
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
