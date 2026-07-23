import { describe, expect, it } from 'vitest';
import {
	defaultSettings,
	firstUsedFormatName,
	formatClass,
	highlightClasses,
	highlightStyleVars,
	isValidFontSize,
	makeFormatStyle,
	normalizeHex,
	normalizeSettings,
	partStyle,
	resolveStyle,
	usableFormatNames,
} from '../src/core/settings';

describe('normalizeSettings', () => {
	it('returns defaults for missing or malformed data', () => {
		expect(normalizeSettings(null)).toEqual(defaultSettings());
		expect(normalizeSettings('junk')).toEqual(defaultSettings());
		expect(normalizeSettings({ formatStyles: 'nope' })).toEqual(defaultSettings());
	});

	it('reads the current name-keyed shape and drops unsafe/empty keys', () => {
		const s = normalizeSettings({
			author: 'Josh',
			annotationFormattingEnabled: false,
			formatStyles: {
				Key: { use: true, fontSize: '12px', light: partStyle('#111111', ''), dark: partStyle() },
				'': makeFormatStyle(),
				__proto__: makeFormatStyle(),
			},
		});
		expect(s.author).toBe('Josh');
		expect(s.annotationFormattingEnabled).toBe(false);
		expect(Object.keys(s.formatStyles)).toEqual(['Key']);
		expect(s.formatStyles['Key']?.fontSize).toBe('12px');
		expect(s.formatStyles['Key']?.light.fr).toEqual({ enabled: true, color: '#111111' });
	});

	it('migrates the legacy formats array to a name-keyed record', () => {
		const s = normalizeSettings({
			formats: [
				{
					id: 'abc-123',
					name: 'Red',
					style: { light: { fontColor: '#ff0000', backgroundColor: '' } },
				},
				{ id: 'abc-123', name: 'Red' }, // duplicate name dropped
				{ id: 'id-only' }, // falls back to id as name
			],
		});
		expect(Object.keys(s.formatStyles)).toEqual(['Red', 'id-only']);
		const red = s.formatStyles['Red'];
		expect(red?.use).toBe(true);
		expect(red?.light.fr).toEqual({ enabled: true, color: '#ff0000' });
		expect(red?.light.bg).toEqual({ enabled: false, color: '' });
	});

	it('migrates the legacy commentStyle {fontColor, backgroundColor} shape', () => {
		const s = normalizeSettings({
			commentStyle: {
				light: { fontColor: '', backgroundColor: '#c8e6c9' },
				dark: { fontColor: '#ffffff', backgroundColor: '' },
			},
		});
		expect(s.commentStyle.light.bg).toEqual({ enabled: true, color: '#c8e6c9' });
		expect(s.commentStyle.dark.fr).toEqual({ enabled: true, color: '#ffffff' });
		expect(s.commentStyle.dark.bg).toEqual({ enabled: false, color: '' });
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

describe('isValidFontSize', () => {
	it('accepts plain CSS lengths and keywords only', () => {
		expect(isValidFontSize('12px')).toBe(true);
		expect(isValidFontSize('1.1em')).toBe(true);
		expect(isValidFontSize('90%')).toBe(true);
		expect(isValidFontSize('x-small')).toBe(true);
		expect(isValidFontSize('')).toBe(false);
		expect(isValidFontSize('12px; color: red')).toBe(false);
	});
});

describe('resolveStyle / format fallbacks', () => {
	it('resolves the dedicated comment style for format ""', () => {
		const s = defaultSettings();
		expect(resolveStyle('comment', '', s)?.style).toBe(s.commentStyle);
	});

	it('falls back to the first Use-checked format for unknown names', () => {
		const s = defaultSettings();
		expect(resolveStyle('highlight', 'gone', s)?.style).toBe(s.formatStyles['Yellow']);
	});

	it('skips formats with Use unchecked', () => {
		const s = defaultSettings();
		s.formatStyles['Red'] = makeFormatStyle();
		const yellow = s.formatStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.use = false;
		expect(firstUsedFormatName(s)).toBe('Red');
		expect(usableFormatNames(s)).toEqual(['Red']);
		expect(resolveStyle('highlight', 'Yellow', s)?.style).toBe(s.formatStyles['Red']);
	});
});

describe('highlightStyleVars', () => {
	it('emits per-theme custom properties from the resolved format', () => {
		const s = defaultSettings();
		expect(highlightStyleVars('highlight', 'Yellow', s)).toEqual({
			'--mdann-light-fg': 'inherit',
			'--mdann-light-bg': '#fff3a3',
			'--mdann-dark-fg': 'inherit',
			'--mdann-dark-bg': '#7a6f1f',
		});
	});

	it('ignores disabled colors even when a color is stored', () => {
		const s = defaultSettings();
		const yellow = s.formatStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.bg.enabled = false;
		expect(highlightStyleVars('highlight', 'Yellow', s)['--mdann-light-bg']).toBe('transparent');
	});

	it('never emits invalid color or size values (no CSS injection)', () => {
		const s = defaultSettings();
		const yellow = s.formatStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.bg.color = 'red; } body { display:none';
		yellow.light.fr = { enabled: true, color: '#123456' };
		yellow.fontSize = '12px; color: red';
		const vars = highlightStyleVars('highlight', 'Yellow', s);
		expect(vars['--mdann-light-bg']).toBe('transparent');
		expect(vars['--mdann-light-fg']).toBe('#123456');
		expect(vars['font-size']).toBeUndefined();
	});

	it('emits a validated font-size', () => {
		const s = defaultSettings();
		const yellow = s.formatStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.fontSize = '1.2em';
		expect(highlightStyleVars('highlight', 'Yellow', s)['font-size']).toBe('1.2em');
	});
});

describe('highlightClasses', () => {
	it('uses the dedicated comment class for format ""', () => {
		const s = defaultSettings();
		expect(highlightClasses('comment', '', s)).toBe('mdann-hl mdann-comment');
		expect(highlightClasses('highlight', 'Yellow', s)).toBe('mdann-hl mdann-f-Yellow');
	});

	it('falls back to the first used format for an unknown name', () => {
		const s = defaultSettings();
		expect(highlightClasses('highlight', 'deleted-format', s)).toBe('mdann-hl mdann-f-Yellow');
	});

	it('sanitizes format names into safe class names', () => {
		expect(formatClass('weird name!')).toBe('mdann-f-weird-name-');
	});
});
