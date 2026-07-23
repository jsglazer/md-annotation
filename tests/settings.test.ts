import { describe, expect, it } from 'vitest';
import {
	defaultSettings,
	formatClass,
	highlightClasses,
	highlightStyleVars,
	normalizeHex,
	normalizeSettings,
	resolveStyle,
} from '../src/core/settings';

describe('normalizeSettings', () => {
	it('returns defaults for missing or malformed data', () => {
		expect(normalizeSettings(null)).toEqual(defaultSettings());
		expect(normalizeSettings('junk')).toEqual(defaultSettings());
		expect(normalizeSettings({ formats: 'nope' })).toEqual(defaultSettings());
	});

	it('keeps valid fields and drops duplicate or id-less formats', () => {
		const s = normalizeSettings({
			author: 'Josh',
			commentUseAnnotationFormats: true,
			formats: [
				{ id: 'a', name: 'Red', style: { light: { fontColor: '#ff0000', backgroundColor: '' } } },
				{ id: 'a', name: 'Dup' },
				{ name: 'NoId' },
			],
		});
		expect(s.author).toBe('Josh');
		expect(s.commentUseAnnotationFormats).toBe(true);
		expect(s.formats.map((f) => f.id)).toEqual(['a']);
		expect(s.formats[0]?.style.light.fontColor).toBe('#ff0000');
		expect(s.formats[0]?.style.dark).toEqual({ fontColor: '', backgroundColor: '' });
	});
});

describe('normalizeHex', () => {
	it('accepts hex with or without # and rejects everything else', () => {
		expect(normalizeHex('#aabbcc')).toBe('#aabbcc');
		expect(normalizeHex('aabbcc')).toBe('#aabbcc');
		expect(normalizeHex(' #AABBCC ')).toBe('#AABBCC');
		expect(normalizeHex('red')).toBe('');
		expect(normalizeHex('#abc')).toBe('');
		expect(normalizeHex('')).toBe('');
	});
});

describe('highlightStyleVars', () => {
	it('emits per-theme custom properties from the resolved format', () => {
		const s = defaultSettings();
		expect(highlightStyleVars('highlight', 'default', s)).toEqual({
			'--mdann-light-fg': 'inherit',
			'--mdann-light-bg': '#fff3a3',
			'--mdann-dark-fg': 'inherit',
			'--mdann-dark-bg': '#7a6f1f',
		});
	});

	it('never emits invalid color values (no CSS injection from settings)', () => {
		const s = defaultSettings();
		const fmt = s.formats[0];
		if (!fmt) throw new Error('default format missing');
		fmt.style.light.backgroundColor = 'red; } body { display:none';
		fmt.style.light.fontColor = '#123456';
		const vars = highlightStyleVars('highlight', 'default', s);
		expect(vars['--mdann-light-bg']).toBe('transparent');
		expect(vars['--mdann-light-fg']).toBe('#123456');
	});

	it('resolves the dedicated comment style unless comments share formats', () => {
		const s = defaultSettings();
		expect(resolveStyle('comment', '', s)).toBe(s.commentStyle);
		s.commentUseAnnotationFormats = true;
		expect(resolveStyle('comment', 'default', s)).toBe(s.formats[0]?.style);
		// Unknown format id falls back to the first format.
		expect(resolveStyle('highlight', 'gone', s)).toBe(s.formats[0]?.style);
	});
});

describe('highlightClasses', () => {
	it('uses the dedicated comment class when comments do not share formats', () => {
		const s = defaultSettings();
		expect(highlightClasses('comment', '', s)).toBe('mdann-hl mdann-comment');
		expect(highlightClasses('highlight', 'default', s)).toBe('mdann-hl mdann-f-default');
	});

	it('falls back to the first format for an unknown format id', () => {
		const s = defaultSettings();
		expect(highlightClasses('highlight', 'deleted-format', s)).toBe('mdann-hl mdann-f-default');
	});

	it('sanitizes format ids into safe class names', () => {
		expect(formatClass('weird id!')).toBe('mdann-f-weird-id-');
	});
});
