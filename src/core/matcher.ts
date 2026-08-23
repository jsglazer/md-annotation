// Pure quote-matching engine: resolves W3C TextQuoteSelectors against raw
// document text. Zero dependencies on 'obsidian' or the DOM — everything here
// is deterministic string work, fully unit-testable.
//
// Staged resolution (each stage only runs if the previous one found nothing):
//   1. Exact-quote occurrences, disambiguated by prefix/suffix context.
//   2. Context-anchored search: locate the prefix/suffix anchors and score the
//      text between them against the stored quote (quote was edited).
//   3. Fuzzy window scan: bigram-similarity sweep for heavily edited regions.
// Ambiguity (two candidates too close to call) always yields an orphan —
// never a guess.

import type { TextQuoteSelector } from './types';
import { selectorsEqual } from './types';

// Fixed-length context captured on each side of a quote at creation time.
// Matching relies on this context, not on quote length, which is what makes
// single-character highlights trackable.
export const CONTEXT_LENGTH = 32;

// Matches below this confidence are orphaned rather than rendered.
export const HIGH_CONFIDENCE = 0.75;

// The bar used by the deliberate orphan-repair pass instead of
// HIGH_CONFIDENCE. Everyday resolution stays strict — a highlight silently
// jumping to loosely similar text is worse than an orphan you can see. Repair
// is the opposite trade: the annotation is already broken, so a best guess is
// an improvement as long as it is not a coin toss. AMBIGUITY_MARGIN is
// deliberately NOT relaxed with it: two plausible sites still never resolve.
export const REPAIR_CONFIDENCE = 0.5;

// Two candidates whose scores differ by less than this are "too close to
// call" → ambiguous → orphan.
export const AMBIGUITY_MARGIN = 0.05;

// Fuzzy scanning needs enough signal to be meaningful; quotes shorter than
// this skip stage 3 entirely.
const FUZZY_MIN_QUOTE_LENGTH = 8;

// Anchor key length for stage 2: the innermost slice of the stored context
// (nearest the quote), so an edit far away inside the context still anchors.
const ANCHOR_KEY_LENGTH = 16;

export interface ResolvedMatch {
	status: 'matched';
	start: number;
	end: number;
	// 1.0 only for an exact quote with perfect context; anything accepted is
	// >= HIGH_CONFIDENCE.
	confidence: number;
	// Non-null when the selector drifted (context or quote changed): the
	// re-captured selector to persist (self-healing).
	refreshedSelector: TextQuoteSelector | null;
}

export interface OrphanedMatch {
	status: 'orphaned';
	reason: 'not-found' | 'ambiguous';
}

export type MatchResult = ResolvedMatch | OrphanedMatch;

interface Candidate {
	start: number;
	end: number;
	score: number;
}

// ── Selector capture ───────────────────────────────────────────────────────

export function captureSelector(
	text: string,
	start: number,
	end: number,
	contextLength: number = CONTEXT_LENGTH,
): TextQuoteSelector {
	return {
		exact: text.slice(start, end),
		prefix: text.slice(Math.max(0, start - contextLength), start),
		suffix: text.slice(end, Math.min(text.length, end + contextLength)),
	};
}

// ── Primitive scoring helpers ──────────────────────────────────────────────

function indicesOf(text: string, needle: string): number[] {
	const out: number[] = [];
	if (needle === '') return out;
	let i = text.indexOf(needle);
	while (i !== -1) {
		out.push(i);
		i = text.indexOf(needle, i + 1);
	}
	return out;
}

// How many trailing characters of `expected` match the text ending at `pos`.
function backwardOverlap(expected: string, text: string, pos: number): number {
	let n = 0;
	while (
		n < expected.length &&
		pos - n - 1 >= 0 &&
		text.charAt(pos - n - 1) === expected.charAt(expected.length - 1 - n)
	) {
		n++;
	}
	return n;
}

// How many leading characters of `expected` match the text starting at `pos`.
function forwardOverlap(expected: string, text: string, pos: number): number {
	let n = 0;
	while (
		n < expected.length &&
		pos + n < text.length &&
		text.charAt(pos + n) === expected.charAt(n)
	) {
		n++;
	}
	return n;
}

// 0..1 agreement between the stored context and the text around [start, end).
// An empty stored side counts as fully matching (nothing to disagree with).
function contextScore(
	text: string,
	start: number,
	end: number,
	selector: TextQuoteSelector,
): number {
	const prefixScore =
		selector.prefix === ''
			? 1
			: backwardOverlap(selector.prefix, text, start) / selector.prefix.length;
	const suffixScore =
		selector.suffix === ''
			? 1
			: forwardOverlap(selector.suffix, text, end) / selector.suffix.length;
	return (prefixScore + suffixScore) / 2;
}

function bigrams(s: string): Map<string, number> {
	const map = new Map<string, number>();
	for (let i = 0; i < s.length - 1; i++) {
		const bg = s.slice(i, i + 2);
		map.set(bg, (map.get(bg) ?? 0) + 1);
	}
	return map;
}

// Sørensen–Dice similarity over character bigrams, 0..1. Deterministic and
// cheap; strings shorter than 2 chars fall back to equality.
export function diceSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const aBigrams = bigrams(a);
	const bBigrams = bigrams(b);
	let overlap = 0;
	for (const [bg, countA] of aBigrams) {
		const countB = bBigrams.get(bg);
		if (countB !== undefined) overlap += Math.min(countA, countB);
	}
	return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

// ── Stage 1: exact-quote occurrences ───────────────────────────────────────

function resolveExact(
	text: string,
	selector: TextQuoteSelector,
	minConfidence: number,
): MatchResult | null {
	const occurrences = indicesOf(text, selector.exact);
	if (occurrences.length === 0) return null;

	const scored = occurrences
		.map((start) => ({
			start,
			end: start + selector.exact.length,
			ctx: contextScore(text, start, start + selector.exact.length, selector),
		}))
		.sort((a, b) => b.ctx - a.ctx || a.start - b.start);

	const perfect = scored.filter((s) => s.ctx === 1);
	if (perfect.length === 1) {
		const hit = perfect[0];
		if (!hit) return null;
		return { status: 'matched', start: hit.start, end: hit.end, confidence: 1, refreshedSelector: null };
	}
	if (perfect.length > 1) return { status: 'orphaned', reason: 'ambiguous' };

	const best = scored[0];
	if (!best) return null;

	// A unique occurrence of the exact quote is strong evidence on its own,
	// even with drifted context.
	if (occurrences.length === 1) {
		const confidence = 0.75 + 0.25 * best.ctx;
		return acceptWithRefresh(text, best.start, best.end, confidence, selector);
	}

	// Several occurrences: the context must clearly pick one.
	const second = scored[1];
	if (second && best.ctx - second.ctx < AMBIGUITY_MARGIN) {
		return { status: 'orphaned', reason: 'ambiguous' };
	}
	const confidence = 0.5 + 0.5 * best.ctx;
	if (confidence < minConfidence) return { status: 'orphaned', reason: 'ambiguous' };
	return acceptWithRefresh(text, best.start, best.end, confidence, selector);
}

// ── Stage 2: context-anchored search (the quote itself was edited) ─────────

function contextAnchoredCandidates(text: string, selector: TextQuoteSelector): Candidate[] {
	const exact = selector.exact;
	const prefixKey = selector.prefix.slice(-ANCHOR_KEY_LENGTH);
	const suffixKey = selector.suffix.slice(0, ANCHOR_KEY_LENGTH);
	const maxGap = exact.length * 2 + CONTEXT_LENGTH;

	const ranges: Array<{ start: number; end: number }> = [];
	const prefixEnds = prefixKey === '' ? [] : indicesOf(text, prefixKey).map((i) => i + prefixKey.length);
	const suffixStarts = suffixKey === '' ? [] : indicesOf(text, suffixKey);

	for (const p of prefixEnds) {
		// Both anchors present: candidate is whatever now sits between them.
		for (const s of suffixStarts) {
			if (s >= p && s - p <= maxGap) ranges.push({ start: p, end: s });
		}
		// Suffix drifted: assume the quote kept its length.
		ranges.push({ start: p, end: Math.min(text.length, p + exact.length) });
	}
	for (const s of suffixStarts) {
		// Prefix drifted.
		ranges.push({ start: Math.max(0, s - exact.length), end: s });
	}

	const seen = new Set<string>();
	const candidates: Candidate[] = [];
	for (const r of ranges) {
		if (r.end <= r.start) continue;
		const key = `${r.start}:${r.end}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const sim = diceSimilarity(text.slice(r.start, r.end), exact);
		candidates.push({ start: r.start, end: r.end, score: 0.5 + 0.5 * sim });
	}
	return candidates;
}

// ── Stage 3: fuzzy window scan ─────────────────────────────────────────────

function fuzzyScanCandidates(text: string, selector: TextQuoteSelector): Candidate[] {
	const exact = selector.exact;
	if (exact.length < FUZZY_MIN_QUOTE_LENGTH || text.length < exact.length) return [];

	// Coarse pass with a stride, then a fine pass around promising positions.
	const step = Math.max(1, Math.floor(exact.length / 4));
	const coarseHits: number[] = [];
	for (let i = 0; i + exact.length <= text.length; i += step) {
		if (diceSimilarity(text.slice(i, i + exact.length), exact) >= 0.6) coarseHits.push(i);
	}

	// Refine each coarse hit to the best position in its neighborhood, then
	// merge neighboring hits into distinct regions (one candidate per region).
	const refined: Array<{ start: number; sim: number }> = [];
	for (const hit of coarseHits) {
		let bestStart = hit;
		let bestSim = 0;
		const from = Math.max(0, hit - step);
		const to = Math.min(text.length - exact.length, hit + step);
		for (let i = from; i <= to; i++) {
			const sim = diceSimilarity(text.slice(i, i + exact.length), exact);
			if (sim > bestSim) {
				bestSim = sim;
				bestStart = i;
			}
		}
		const last = refined[refined.length - 1];
		if (last && Math.abs(bestStart - last.start) < exact.length) {
			if (bestSim > last.sim) {
				last.start = bestStart;
				last.sim = bestSim;
			}
		} else {
			refined.push({ start: bestStart, sim: bestSim });
		}
	}

	return refined.map((r) => ({
		start: r.start,
		end: r.start + exact.length,
		score: 0.85 * r.sim,
	}));
}

// ── Candidate selection ────────────────────────────────────────────────────

// Candidates covering mostly the same span are the same site, not rivals.
function sameSite(a: Candidate, b: Candidate): boolean {
	const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
	if (inter <= 0) return false;
	const shorter = Math.min(a.end - a.start, b.end - b.start);
	return inter >= shorter / 2;
}

function pickCandidate(
	text: string,
	candidates: Candidate[],
	selector: TextQuoteSelector,
	minConfidence: number,
): MatchResult | null {
	const sorted = [...candidates].sort((a, b) => b.score - a.score || a.start - b.start);
	const best = sorted[0];
	if (!best || best.score < minConfidence) return null;
	// The ambiguity check compares the best against the best candidate at a
	// DISTINCT location; overlapping variants of the same site don't count.
	const rival = sorted.slice(1).find((c) => !sameSite(best, c));
	if (rival && best.score - rival.score < AMBIGUITY_MARGIN) {
		// Two distinct, equally plausible locations → never guess.
		return { status: 'orphaned', reason: 'ambiguous' };
	}
	return acceptWithRefresh(text, best.start, best.end, Math.min(best.score, 0.99), selector);
}

function acceptWithRefresh(
	text: string,
	start: number,
	end: number,
	confidence: number,
	selector: TextQuoteSelector,
): ResolvedMatch {
	const captured = captureSelector(text, start, end);
	return {
		status: 'matched',
		start,
		end,
		confidence,
		refreshedSelector: selectorsEqual(captured, selector) ? null : captured,
	};
}

// ── Point resolution (empty quote: comment markers) ────────────────────────

// A point selector has exact === '' and anchors purely on its prefix/suffix
// context. Candidate positions come from occurrences of the innermost anchor
// keys; the full stored context then scores each position.
function resolvePoint(
	text: string,
	selector: TextQuoteSelector,
	minConfidence: number,
): MatchResult {
	const prefixKey = selector.prefix.slice(-ANCHOR_KEY_LENGTH);
	const suffixKey = selector.suffix.slice(0, ANCHOR_KEY_LENGTH);
	if (prefixKey === '' && suffixKey === '') return { status: 'orphaned', reason: 'not-found' };

	const positions = new Set<number>();
	for (const i of indicesOf(text, prefixKey)) positions.add(i + prefixKey.length);
	for (const i of indicesOf(text, suffixKey)) positions.add(i);

	const scored = [...positions]
		.map((pos) => ({ pos, score: contextScore(text, pos, pos, selector) }))
		.sort((a, b) => b.score - a.score || a.pos - b.pos);

	const best = scored[0];
	if (!best || best.score < minConfidence) return { status: 'orphaned', reason: 'not-found' };
	const rival = scored.slice(1).find((c) => c.pos !== best.pos);
	if (rival && best.score - rival.score < AMBIGUITY_MARGIN) {
		return { status: 'orphaned', reason: 'ambiguous' };
	}
	return acceptWithRefresh(text, best.pos, best.pos, Math.min(best.score, 1), selector);
}

// ── Public entry points ────────────────────────────────────────────────────

export function resolveSelector(
	text: string,
	selector: TextQuoteSelector,
	minConfidence: number = HIGH_CONFIDENCE,
): MatchResult {
	if (selector.exact === '') return resolvePoint(text, selector, minConfidence);

	const exactResult = resolveExact(text, selector, minConfidence);
	if (exactResult) return exactResult;

	const anchored = pickCandidate(
		text,
		contextAnchoredCandidates(text, selector),
		selector,
		minConfidence,
	);
	if (anchored) return anchored;

	const fuzzy = pickCandidate(text, fuzzyScanCandidates(text, selector), selector, minConfidence);
	if (fuzzy) return fuzzy;

	return { status: 'orphaned', reason: 'not-found' };
}

// The same staged resolution at the relaxed repair bar. Only ever run against
// an annotation that is ALREADY orphaned, on an explicit "Fix orphans" (or the
// opt-in automatic pass) — never as part of normal rendering.
export function repairSelector(text: string, selector: TextQuoteSelector): MatchResult {
	return resolveSelector(text, selector, REPAIR_CONFIDENCE);
}

export function resolveSelectors(
	text: string,
	selectors: ReadonlyArray<{ id: string; selector: TextQuoteSelector }>,
): Map<string, MatchResult> {
	const out = new Map<string, MatchResult>();
	for (const { id, selector } of selectors) {
		out.set(id, resolveSelector(text, selector));
	}
	return out;
}
