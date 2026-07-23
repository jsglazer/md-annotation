import { describe, expect, it } from 'vitest';
import {
	AMBIGUITY_MARGIN,
	CONTEXT_LENGTH,
	HIGH_CONFIDENCE,
	captureSelector,
	diceSimilarity,
	resolveSelector,
	resolveSelectors,
} from '../src/core/matcher';
import type { TextQuoteSelector } from '../src/core/types';

const DOC =
	'The quick brown fox jumps over the lazy dog. ' +
	'A second sentence provides more context for matching. ' +
	'The final sentence closes the paragraph with unique words.';

function selectorFor(doc: string, target: string): TextQuoteSelector {
	const start = doc.indexOf(target);
	expect(start).toBeGreaterThanOrEqual(0);
	return captureSelector(doc, start, start + target.length);
}

describe('captureSelector', () => {
	it('captures the exact quote with fixed-length context on both sides', () => {
		const sel = selectorFor(DOC, 'second sentence');
		expect(sel.exact).toBe('second sentence');
		expect(sel.prefix.length).toBe(CONTEXT_LENGTH);
		expect(sel.suffix.length).toBe(CONTEXT_LENGTH);
		expect(DOC.indexOf(sel.prefix + sel.exact + sel.suffix)).toBeGreaterThanOrEqual(0);
	});

	it('clamps context at document boundaries', () => {
		const sel = captureSelector(DOC, 0, 3);
		expect(sel.exact).toBe('The');
		expect(sel.prefix).toBe('');
		const tail = captureSelector(DOC, DOC.length - 6, DOC.length);
		expect(tail.suffix).toBe('');
	});
});

describe('resolveSelector — exact matching', () => {
	it('resolves an unedited document with confidence 1 and no refresh', () => {
		const sel = selectorFor(DOC, 'second sentence');
		const result = resolveSelector(DOC, sel);
		expect(result).toMatchObject({
			status: 'matched',
			start: DOC.indexOf('second sentence'),
			end: DOC.indexOf('second sentence') + 'second sentence'.length,
			confidence: 1,
			refreshedSelector: null,
		});
	});

	it('disambiguates a repeated quote by its context', () => {
		// 'sentence' appears twice; context must pick the second occurrence.
		const target = DOC.lastIndexOf('sentence');
		const sel = captureSelector(DOC, target, target + 'sentence'.length);
		const result = resolveSelector(DOC, sel);
		expect(result.status).toBe('matched');
		if (result.status === 'matched') expect(result.start).toBe(target);
	});

	it('tracks a single-character highlight through its context', () => {
		const target = DOC.indexOf('q'); // the 'q' in 'quick'
		const sel = captureSelector(DOC, target, target + 1);
		const result = resolveSelector(DOC, sel);
		expect(result.status).toBe('matched');
		if (result.status === 'matched') {
			expect(result.start).toBe(target);
			expect(result.confidence).toBe(1);
		}
	});

	it('orphans as ambiguous when two occurrences have identical context', () => {
		const doc = 'alpha WORD omega ... alpha WORD omega';
		const sel: TextQuoteSelector = { exact: 'WORD', prefix: 'alpha ', suffix: ' omega' };
		const result = resolveSelector(doc, sel);
		expect(result).toEqual({ status: 'orphaned', reason: 'ambiguous' });
	});

	it('orphans an empty quote', () => {
		expect(resolveSelector(DOC, { exact: '', prefix: 'a', suffix: 'b' })).toEqual({
			status: 'orphaned',
			reason: 'not-found',
		});
	});
});

describe('resolveSelector — partial matching (edited context)', () => {
	it('matches a unique quote whose context was edited, refreshing the selector', () => {
		const sel = selectorFor(DOC, 'provides more context');
		const edited = DOC.replace('A second sentence', 'An additional line');
		const result = resolveSelector(edited, sel);
		expect(result.status).toBe('matched');
		if (result.status === 'matched') {
			expect(edited.slice(result.start, result.end)).toBe('provides more context');
			expect(result.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
			expect(result.confidence).toBeLessThan(1);
			expect(result.refreshedSelector).not.toBeNull();
			// The refreshed selector resolves exactly in the edited document.
			if (result.refreshedSelector) {
				const again = resolveSelector(edited, result.refreshedSelector);
				expect(again).toMatchObject({ status: 'matched', confidence: 1 });
			}
		}
	});

	it('picks the occurrence whose context survived when a duplicate appears', () => {
		const original = 'intro text here. keyword sits in original context. tail words.';
		const sel = selectorFor(original, 'keyword');
		const edited = 'keyword pasted at top. intro text here. keyword sits in original context. tail words.';
		const result = resolveSelector(edited, sel);
		expect(result.status).toBe('matched');
		if (result.status === 'matched') {
			expect(result.start).toBe(edited.lastIndexOf('keyword'));
		}
	});
});

describe('resolveSelector — fuzzy matching (edited quote)', () => {
	it('re-anchors via context when the quote text itself was edited', () => {
		const sel = selectorFor(DOC, 'provides more context');
		const edited = DOC.replace('provides more context', 'provides much more context');
		const result = resolveSelector(edited, sel);
		expect(result.status).toBe('matched');
		if (result.status === 'matched') {
			expect(edited.slice(result.start, result.end)).toBe('provides much more context');
			expect(result.refreshedSelector?.exact).toBe('provides much more context');
		}
	});

	it('finds a similar quote by fuzzy scan when quote AND context changed', () => {
		const quote = 'jumps over the lazy dog';
		const sel = selectorFor(DOC, quote);
		// New document: same-length neighborhood, slightly edited quote,
		// entirely different context (prefix/suffix anchors gone).
		const edited = 'Totally new opening words here so jumps over the hazy dog while everything else differs.';
		const result = resolveSelector(edited, sel);
		expect(result.status).toBe('matched');
		if (result.status === 'matched') {
			expect(edited.slice(result.start, result.end)).toContain('over the');
			expect(result.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
		}
	});

	it('orphans when the quote is gone entirely', () => {
		const sel = selectorFor(DOC, 'jumps over the lazy dog');
		const result = resolveSelector('Completely unrelated text with nothing shared at all.', sel);
		expect(result).toEqual({ status: 'orphaned', reason: 'not-found' });
	});

	it('never guesses between two equally similar fuzzy candidates', () => {
		const doc = 'first copy: jumps over the hazy dog. second copy: jumps over the hazy dog.';
		const sel: TextQuoteSelector = {
			exact: 'jumps over the lazy dog',
			prefix: 'this prefix does not exist here ',
			suffix: ' nor does this suffix appear',
		};
		const result = resolveSelector(doc, sel);
		expect(result.status).toBe('orphaned');
		if (result.status === 'orphaned') expect(result.reason).toBe('ambiguous');
	});
});

describe('resolveSelectors', () => {
	it('resolves a batch and reports each outcome by id', () => {
		const a = selectorFor(DOC, 'quick brown fox');
		const b: TextQuoteSelector = { exact: 'not in the document at all', prefix: 'xx', suffix: 'yy' };
		const out = resolveSelectors(DOC, [
			{ id: 'a', selector: a },
			{ id: 'b', selector: b },
		]);
		expect(out.get('a')?.status).toBe('matched');
		expect(out.get('b')).toEqual({ status: 'orphaned', reason: 'not-found' });
	});
});

describe('diceSimilarity', () => {
	it('is 1 for identical strings and 0 for disjoint strings', () => {
		expect(diceSimilarity('abcdef', 'abcdef')).toBe(1);
		expect(diceSimilarity('aaaa', 'zzzz')).toBe(0);
	});

	it('scores near-identical strings above the ambiguity margin apart from distant ones', () => {
		const near = diceSimilarity('jumps over the lazy dog', 'jumps over the hazy dog');
		const far = diceSimilarity('jumps over the lazy dog', 'entirely different words');
		expect(near).toBeGreaterThan(0.8);
		expect(near - far).toBeGreaterThan(AMBIGUITY_MARGIN);
	});
});
