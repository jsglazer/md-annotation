// Positional helpers shared by the sidebar and the editor/reading decorations:
// comment numbering, line numbers, and nearest-annotation lookup. Pure module —
// no 'obsidian', no DOM — so every rule here is deterministic and unit-testable.

import type { MatchResult } from './matcher';
import type { Annotation } from './types';

// Sequentially number every MATCHED comment by its position in the body
// (top-to-bottom). The same map drives the number shown in the text marker and
// the sidebar entry, so the two always agree. Orphaned comments (no position)
// get no number and are simply absent from the map.
export function numberComments(
	annotations: ReadonlyArray<Annotation>,
	outcomes: ReadonlyMap<string, MatchResult>,
): Map<string, number> {
	const matched: Array<{ id: string; start: number }> = [];
	for (const a of annotations) {
		if (a.type !== 'comment') continue;
		const outcome = outcomes.get(a.id);
		if (outcome?.status === 'matched') matched.push({ id: a.id, start: outcome.start });
	}
	matched.sort((x, y) => x.start - y.start);
	const map = new Map<string, number>();
	matched.forEach((m, i) => map.set(m.id, i + 1));
	return map;
}

// 1-based line number of a body offset (newlines before the offset + 1).
export function lineNumberAt(body: string, offset: number): number {
	const clamped = Math.max(0, Math.min(offset, body.length));
	let line = 1;
	for (let i = 0; i < clamped; i++) {
		if (body.charCodeAt(i) === 10) line++;
	}
	return line;
}

// The matched annotation whose resolved range is closest to `offset` (0 when the
// offset is inside a range). Null when nothing is matched. Used to sync the
// sidebar to the editor cursor.
export function nearestAnnotationId(
	annotations: ReadonlyArray<Annotation>,
	outcomes: ReadonlyMap<string, MatchResult>,
	offset: number,
): string | null {
	let best: string | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const a of annotations) {
		const outcome = outcomes.get(a.id);
		if (outcome?.status !== 'matched') continue;
		const dist =
			offset < outcome.start
				? outcome.start - offset
				: offset > outcome.end
					? offset - outcome.end
					: 0;
		if (dist < bestDist) {
			bestDist = dist;
			best = a.id;
		}
	}
	return best;
}
