import { describe, expect, it } from 'vitest';
import {
	GUTTER_DEFAULT_WIDTH,
	GUTTER_MAX_WIDTH,
	GUTTER_MIN_WIDTH,
	GUTTER_STYLE_PROPS,
	clampGutterWidth,
	defaultSettings,
	exportFormats,
	firstUsedFormatName,
	formatClass,
	gutterStyleVars,
	highlightClasses,
	highlightStyleVars,
	isValidFontSize,
	makeFormatStyle,
	mergeFormats,
	normalizeHex,
	parseFormatsImport,
	normalizeSettings,
	partStyle,
	resolveStyle,
	themedColors,
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

describe('navigation toggles', () => {
	it('defaults every text ⇄ sidebar behaviour to on', () => {
		const s = defaultSettings();
		expect(s.syncTextAndSidebar).toBe(true);
		expect(s.sidebarClickJumpsToText).toBe(true);
		expect(s.textClickJumpsToSidebar).toBe(true);
	});

	it('reads stored values and ignores non-booleans', () => {
		const s = normalizeSettings({
			syncTextAndSidebar: false,
			sidebarClickJumpsToText: 'no',
			textClickJumpsToSidebar: false,
		});
		expect(s.syncTextAndSidebar).toBe(false);
		expect(s.sidebarClickJumpsToText).toBe(true);
		expect(s.textClickJumpsToSidebar).toBe(false);
	});
});

describe('gutter settings', () => {
	it('defaults both types to the right margin, switched on', () => {
		const s = defaultSettings();
		expect(s.gutterAnnotationsEnabled).toBe(true);
		expect(s.gutterCommentsEnabled).toBe(true);
		expect(s.gutterAnnotationsSide).toBe('right');
		expect(s.gutterCommentsSide).toBe('right');
		expect(s.gutterWidth).toBe(GUTTER_DEFAULT_WIDTH);
	});

	it('reads stored toggles and sides, ignoring junk', () => {
		const s = normalizeSettings({
			gutterAnnotationsEnabled: false,
			gutterCommentsEnabled: 'yes',
			gutterAnnotationsSide: 'left',
			gutterCommentsSide: 'middle',
		});
		expect(s.gutterAnnotationsEnabled).toBe(false);
		expect(s.gutterCommentsEnabled).toBe(true);
		expect(s.gutterAnnotationsSide).toBe('left');
		expect(s.gutterCommentsSide).toBe('right');
	});

	it('clamps a stored width into range and rejects non-numbers', () => {
		expect(normalizeSettings({ gutterWidth: 10 }).gutterWidth).toBe(GUTTER_MIN_WIDTH);
		expect(normalizeSettings({ gutterWidth: 9000 }).gutterWidth).toBe(GUTTER_MAX_WIDTH);
		expect(normalizeSettings({ gutterWidth: 231.6 }).gutterWidth).toBe(232);
		expect(normalizeSettings({ gutterWidth: '300' }).gutterWidth).toBe(GUTTER_DEFAULT_WIDTH);
		expect(clampGutterWidth(Number.NaN)).toBe(GUTTER_DEFAULT_WIDTH);
	});
});

describe('gutterStyleVars', () => {
	// Unlike highlightStyleVars, a disabled color is OMITTED rather than turned
	// into a keyword — styles.css needs the var() fallback to supply a usable
	// border color when the format sets no text color.
	it('omits disabled colors so the CSS fallback applies', () => {
		const s = defaultSettings();
		expect(gutterStyleVars('highlight', 'Yellow', s)).toEqual({
			'--mdann-g-light-bg': '#fff3a3',
			'--mdann-g-dark-bg': '#7a6f1f',
		});
	});

	it('emits the text color, which styles.css also uses as the border color', () => {
		const s = defaultSettings();
		const yellow = s.formatStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.fr = { enabled: true, color: '#aa0000' };
		const vars = gutterStyleVars('highlight', 'Yellow', s);
		expect(vars['--mdann-g-light-fg']).toBe('#aa0000');
		expect(vars['--mdann-g-dark-fg']).toBeUndefined();
	});

	it('never emits invalid color or size values', () => {
		const s = defaultSettings();
		const yellow = s.formatStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.bg.color = 'red; } body { display:none';
		yellow.fontSize = '12px; color: red';
		const vars = gutterStyleVars('highlight', 'Yellow', s);
		expect(vars['--mdann-g-light-bg']).toBeUndefined();
		expect(vars['font-size']).toBeUndefined();
		yellow.fontSize = '0.9em';
		expect(gutterStyleVars('highlight', 'Yellow', s)['font-size']).toBe('0.9em');
	});

	it('uses the dedicated comment style for comments', () => {
		const s = defaultSettings();
		expect(gutterStyleVars('comment', '', s)).toEqual({
			'--mdann-g-light-bg': '#c8e6c9',
			'--mdann-g-dark-bg': '#2e5d33',
		});
	});

	it('covers every property it can emit, so stale ones can be cleared', () => {
		const s = defaultSettings();
		const yellow = s.formatStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.fr = { enabled: true, color: '#111111' };
		yellow.dark.fr = { enabled: true, color: '#eeeeee' };
		yellow.fontSize = '11px';
		expect(Object.keys(gutterStyleVars('highlight', 'Yellow', s)).sort()).toEqual(
			[...GUTTER_STYLE_PROPS].sort(),
		);
	});
});

describe('format export / import', () => {
	it('round-trips formats and the comment style', () => {
		const s = defaultSettings();
		s.formatStyles['Key'] = makeFormatStyle();
		const parsed = parseFormatsImport(exportFormats(s));
		expect(parsed).not.toBeNull();
		expect(Object.keys(parsed?.formatStyles ?? {})).toEqual(['Yellow', 'Key']);
		expect(parsed?.commentStyle).toEqual(s.commentStyle);
	});

	it('accepts a bare name-keyed record and reports no comment style', () => {
		const parsed = parseFormatsImport(JSON.stringify({ Key: makeFormatStyle() }));
		expect(Object.keys(parsed?.formatStyles ?? {})).toEqual(['Key']);
		expect(parsed?.commentStyle).toBeNull();
	});

	it('rejects malformed, empty, or format-free payloads', () => {
		expect(parseFormatsImport('not json')).toBeNull();
		expect(parseFormatsImport('[]')).toBeNull();
		expect(parseFormatsImport('{"formatStyles":{}}')).toBeNull();
	});

	it('drops prototype-unsafe names on import', () => {
		const parsed = parseFormatsImport(
			'{"formatStyles":{"__proto__":{"use":true},"Key":{"use":true}}}',
		);
		expect(Object.keys(parsed?.formatStyles ?? {})).toEqual(['Key']);
	});

	it('merge keeps existing formats and appends only new names', () => {
		const current = { Key: makeFormatStyle() };
		const incoming = { Key: makeFormatStyle(), Define: makeFormatStyle() };
		const result = mergeFormats(current, incoming, 'merge');
		expect(result.added).toEqual(['Define']);
		expect(result.skipped).toEqual(['Key']);
		expect(result.formatStyles['Key']).toBe(current['Key']);
	});

	it('replace takes the imported set verbatim', () => {
		const result = mergeFormats({ Key: makeFormatStyle() }, { Define: makeFormatStyle() }, 'replace');
		expect(Object.keys(result.formatStyles)).toEqual(['Define']);
		expect(result.skipped).toEqual([]);
	});
});

describe('gutter toolbar highlight', () => {
	it('defaults to no target and a usable colour pair', () => {
		const s = defaultSettings();
		expect(s.gutterAnnotationsToolbar.toolbarUuid).toBe('');
		expect(s.gutterAnnotationsToolbar.itemUuid).toBe('');
		expect(s.gutterCommentsToolbar.toolbarUuid).toBe('');
		expect(themedColors(s.gutterAnnotationsToolbar.style, false).bg).toBe('#fff3a3');
		expect(themedColors(s.gutterCommentsToolbar.style, true).bg).toBe('#2e5d33');
	});

	it('reads a stored target and style back', () => {
		const s = normalizeSettings({
			gutterAnnotationsToolbar: {
				toolbarUuid: 'tb-1',
				itemUuid: 'item-7',
				style: {
					light: { fr: { enabled: true, color: '#112233' }, bg: { enabled: false, color: '' } },
					dark: { fr: { enabled: true, color: '#445566' }, bg: { enabled: false, color: '' } },
				},
			},
		});
		expect(s.gutterAnnotationsToolbar.toolbarUuid).toBe('tb-1');
		expect(s.gutterAnnotationsToolbar.itemUuid).toBe('item-7');
		expect(themedColors(s.gutterAnnotationsToolbar.style, false)).toEqual({
			fg: '#112233',
			bg: '',
		});
		expect(themedColors(s.gutterAnnotationsToolbar.style, true).fg).toBe('#445566');
	});

	it('falls back to defaults for malformed values without half-writing a target', () => {
		const s = normalizeSettings({
			gutterAnnotationsToolbar: 'nope',
			gutterCommentsToolbar: { toolbarUuid: 42, itemUuid: null, style: 'nope' },
		});
		expect(s.gutterAnnotationsToolbar).toEqual(defaultSettings().gutterAnnotationsToolbar);
		expect(s.gutterCommentsToolbar.toolbarUuid).toBe('');
		expect(s.gutterCommentsToolbar.itemUuid).toBe('');
		expect(s.gutterCommentsToolbar.style).toEqual(defaultSettings().gutterCommentsToolbar.style);
	});
});

describe('themedColors', () => {
	it('drops disabled and invalid colours', () => {
		const style = {
			light: { fr: { enabled: false, color: '#112233' }, bg: { enabled: true, color: 'zzz' } },
			dark: { fr: { enabled: true, color: '#abcdef' }, bg: { enabled: true, color: '#000000' } },
		};
		expect(themedColors(style, false)).toEqual({ fg: '', bg: '' });
		expect(themedColors(style, true)).toEqual({ fg: '#abcdef', bg: '#000000' });
	});
});
