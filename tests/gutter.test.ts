import { describe, expect, it } from 'vitest';

import type { MatchResult } from '../src/core/matcher';
import type { MdAnnotationSettings } from '../src/core/settings';
import { defaultSettings } from '../src/core/settings';
import type { GutterTypes } from '../src/editor/gutterCards';
import { activeGutterSides, gutterContent, gutterOpenTypes } from '../src/editor/gutterCards';
import type { Annotation } from '../src/core/types';

function annotation(id: string, type: 'highlight' | 'comment'): Annotation {
	return {
		id,
		type,
		category: type === 'comment' ? '' : 'Yellow',
		selector: { exact: 'x', prefix: '', suffix: '' },
		comment: '',
		author: '',
		status: 'open',
		dateCreate: '2026-01-01 00:00',
		dateModified: '2026-01-01 00:00',
		dateClosed: null,
	};
}

const MATCHED: MatchResult = {
	status: 'matched',
	start: 0,
	end: 1,
	confidence: 1,
	refreshedSelector: null,
};
const ORPHANED: MatchResult = { status: 'orphaned', reason: 'not-found' };

const CLOSED: GutterTypes = { annotations: false, comments: false };

function settings(patch: Partial<MdAnnotationSettings> = {}): MdAnnotationSettings {
	return { ...defaultSettings(), ...patch };
}

describe('gutterContent', () => {
	it('reports matched and present separately, per type', () => {
		const annotations = [
			annotation('a', 'highlight'),
			annotation('b', 'comment'),
			annotation('c', 'comment'),
		];
		const outcomes = new Map<string, MatchResult>([
			['a', ORPHANED],
			['b', ORPHANED],
			['c', MATCHED],
		]);
		expect(gutterContent(annotations, outcomes)).toEqual({
			matched: { annotations: false, comments: true },
			present: { annotations: true, comments: true },
		});
	});

	it('is empty for a note with no annotations', () => {
		expect(gutterContent([], new Map())).toEqual({
			matched: { annotations: false, comments: false },
			present: { annotations: false, comments: false },
		});
	});
});

describe('gutterOpenTypes', () => {
	const empty = gutterContent([], new Map());
	const oneHighlight = gutterContent([annotation('a', 'highlight')], new Map([['a', MATCHED]]));
	const orphanOnly = gutterContent([annotation('a', 'highlight')], new Map([['a', ORPHANED]]));

	it('ignores note content when the preference is off', () => {
		const s = settings({ gutterOnlyWhenAnnotated: false });
		expect(gutterOpenTypes(s, empty, CLOSED)).toEqual({ annotations: true, comments: true });
	});

	it('stays shut on a note with nothing to show', () => {
		expect(gutterOpenTypes(settings(), empty, CLOSED)).toEqual(CLOSED);
	});

	it('opens only the type that has a matched annotation', () => {
		expect(gutterOpenTypes(settings(), oneHighlight, CLOSED)).toEqual({
			annotations: true,
			comments: false,
		});
	});

	it('never opens for orphans alone — they have no card', () => {
		expect(gutterOpenTypes(settings(), orphanOnly, CLOSED)).toEqual(CLOSED);
	});

	it('stays open while its only annotation is orphaned mid-edit', () => {
		const open: GutterTypes = { annotations: true, comments: false };
		expect(gutterOpenTypes(settings(), orphanOnly, open)).toEqual(open);
	});

	it('closes once the last annotation of that type is gone', () => {
		const open: GutterTypes = { annotations: true, comments: false };
		expect(gutterOpenTypes(settings(), empty, open)).toEqual(CLOSED);
	});

	it('closes whenever the type itself is switched off, however full the note', () => {
		const s = settings({ gutterAnnotationsEnabled: false });
		expect(gutterOpenTypes(s, oneHighlight, { annotations: true, comments: false })).toEqual(
			CLOSED,
		);
	});
});

describe('activeGutterSides', () => {
	it('maps each open type onto its configured margin', () => {
		const s = settings({ gutterAnnotationsSide: 'left', gutterCommentsSide: 'right' });
		expect(activeGutterSides(s, { annotations: true, comments: false })).toEqual({
			left: true,
			right: false,
		});
		expect(activeGutterSides(s, { annotations: true, comments: true })).toEqual({
			left: true,
			right: true,
		});
	});

	it('shares one margin when both types point at it', () => {
		const s = settings({ gutterAnnotationsSide: 'right', gutterCommentsSide: 'right' });
		expect(activeGutterSides(s, { annotations: true, comments: true })).toEqual({
			left: false,
			right: true,
		});
	});

	it('reserves nothing when no type is open', () => {
		expect(activeGutterSides(settings(), CLOSED)).toEqual({ left: false, right: false });
	});
});
