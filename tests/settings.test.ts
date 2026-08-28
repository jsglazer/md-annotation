import { describe, expect, it } from 'vitest';
import {
	GUTTER_DEFAULT_WIDTH,
	GUTTER_MAX_WIDTH,
	GUTTER_MIN_WIDTH,
	GUTTER_STYLE_PROPS,
	bodyEndLineColor,
	clampGutterWidth,
	defaultSettings,
	exportCategories,
	firstUsedCategoryName,
	categoryClass,
	gutterStyleVars,
	highlightClasses,
	highlightStyleVars,
	isValidFontSize,
	makeCategoryStyle,
	mergeCategories,
	normalizeHex,
	parseCategoriesImport,
	normalizeSettings,
	partStyle,
	resolveStyle,
	themedColors,
	toolbarHighlightColor,
	usableCategoryNames,
} from '../src/core/settings';

describe('normalizeSettings', () => {
	it('returns defaults for missing or malformed data', () => {
		expect(normalizeSettings(null)).toEqual(defaultSettings());
		expect(normalizeSettings('junk')).toEqual(defaultSettings());
		expect(normalizeSettings({ categoryStyles: 'nope' })).toEqual(defaultSettings());
	});

	it('reads the current name-keyed shape and drops unsafe/empty keys', () => {
		const s = normalizeSettings({
			author: 'Josh',
			annotationFormattingEnabled: false,
			categoryStyles: {
				Key: { use: true, fontSize: '12px', light: partStyle('#111111', ''), dark: partStyle() },
				'': makeCategoryStyle(),
				__proto__: makeCategoryStyle(),
			},
		});
		expect(s.author).toBe('Josh');
		expect(s.annotationFormattingEnabled).toBe(false);
		expect(Object.keys(s.categoryStyles)).toEqual(['Key']);
		expect(s.categoryStyles['Key']?.fontSize).toBe('12px');
		expect(s.categoryStyles['Key']?.light.fr).toEqual({ enabled: true, color: '#111111' });
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
		expect(Object.keys(s.categoryStyles)).toEqual(['Red', 'id-only']);
		const red = s.categoryStyles['Red'];
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
		expect(resolveStyle('highlight', 'gone', s)?.style).toBe(s.categoryStyles['Yellow']);
	});

	it('skips formats with Use unchecked', () => {
		const s = defaultSettings();
		s.categoryStyles['Red'] = makeCategoryStyle();
		const yellow = s.categoryStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.use = false;
		expect(firstUsedCategoryName(s)).toBe('Red');
		expect(usableCategoryNames(s)).toEqual(['Red']);
		expect(resolveStyle('highlight', 'Yellow', s)?.style).toBe(s.categoryStyles['Red']);
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
		const yellow = s.categoryStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.bg.enabled = false;
		expect(highlightStyleVars('highlight', 'Yellow', s)['--mdann-light-bg']).toBe('transparent');
	});

	it('never emits invalid color or size values (no CSS injection)', () => {
		const s = defaultSettings();
		const yellow = s.categoryStyles['Yellow'];
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
		const yellow = s.categoryStyles['Yellow'];
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
		expect(categoryClass('weird name!')).toBe('mdann-f-weird-name-');
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
		const yellow = s.categoryStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.fr = { enabled: true, color: '#aa0000' };
		const vars = gutterStyleVars('highlight', 'Yellow', s);
		expect(vars['--mdann-g-light-fg']).toBe('#aa0000');
		expect(vars['--mdann-g-dark-fg']).toBeUndefined();
	});

	it('never emits invalid color or size values', () => {
		const s = defaultSettings();
		const yellow = s.categoryStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.bg.color = 'red; } body { display:none';
		s.gutterAnnotationsFontSize = '12px; color: red';
		const vars = gutterStyleVars('highlight', 'Yellow', s);
		expect(vars['--mdann-g-light-bg']).toBeUndefined();
		expect(vars['font-size']).toBeUndefined();
		s.gutterAnnotationsFontSize = '0.9em';
		expect(gutterStyleVars('highlight', 'Yellow', s)['font-size']).toBe('0.9em');
	});

	it('uses the gutter font size, not the format\'s own fontSize — it never affects the sidebar', () => {
		const s = defaultSettings();
		const yellow = s.categoryStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.fontSize = '20px';
		expect(gutterStyleVars('highlight', 'Yellow', s)['font-size']).toBeUndefined();
		s.gutterAnnotationsFontSize = '13px';
		expect(gutterStyleVars('highlight', 'Yellow', s)['font-size']).toBe('13px');
		expect(gutterStyleVars('comment', '', s)['font-size']).toBeUndefined();
		s.gutterCommentsFontSize = '15px';
		expect(gutterStyleVars('comment', '', s)['font-size']).toBe('15px');
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
		const yellow = s.categoryStyles['Yellow'];
		if (!yellow) throw new Error('default format missing');
		yellow.light.fr = { enabled: true, color: '#111111' };
		yellow.dark.fr = { enabled: true, color: '#eeeeee' };
		s.gutterAnnotationsFontSize = '11px';
		expect(Object.keys(gutterStyleVars('highlight', 'Yellow', s)).sort()).toEqual(
			[...GUTTER_STYLE_PROPS].sort(),
		);
	});
});

describe('format export / import', () => {
	it('round-trips formats and the comment style', () => {
		const s = defaultSettings();
		s.categoryStyles['Key'] = makeCategoryStyle();
		const parsed = parseCategoriesImport(exportCategories(s));
		expect(parsed).not.toBeNull();
		expect(Object.keys(parsed?.categoryStyles ?? {})).toEqual(['Yellow', 'Key']);
		expect(parsed?.commentStyle).toEqual(s.commentStyle);
	});

	it('accepts a bare name-keyed record and reports no comment style', () => {
		const parsed = parseCategoriesImport(JSON.stringify({ Key: makeCategoryStyle() }));
		expect(Object.keys(parsed?.categoryStyles ?? {})).toEqual(['Key']);
		expect(parsed?.commentStyle).toBeNull();
	});

	it('rejects malformed, empty, or format-free payloads', () => {
		expect(parseCategoriesImport('not json')).toBeNull();
		expect(parseCategoriesImport('[]')).toBeNull();
		expect(parseCategoriesImport('{"categoryStyles":{}}')).toBeNull();
	});

	it('drops prototype-unsafe names on import', () => {
		const parsed = parseCategoriesImport(
			'{"categoryStyles":{"__proto__":{"use":true},"Key":{"use":true}}}',
		);
		expect(Object.keys(parsed?.categoryStyles ?? {})).toEqual(['Key']);
	});

	it('merge keeps existing formats and appends only new names', () => {
		const current = { Key: makeCategoryStyle() };
		const incoming = { Key: makeCategoryStyle(), Define: makeCategoryStyle() };
		const result = mergeCategories(current, incoming, 'merge');
		expect(result.added).toEqual(['Define']);
		expect(result.skipped).toEqual(['Key']);
		expect(result.categoryStyles['Key']).toBe(current['Key']);
	});

	it('replace takes the imported set verbatim', () => {
		const result = mergeCategories({ Key: makeCategoryStyle() }, { Define: makeCategoryStyle() }, 'replace');
		expect(Object.keys(result.categoryStyles)).toEqual(['Define']);
		expect(result.skipped).toEqual([]);
	});
});

describe('gutter toolbar highlight', () => {
	it('defaults to no target, an On colour, and no Off colour', () => {
		const s = defaultSettings();
		expect(s.gutterAnnotationsToolbar.toolbarUuid).toBe('');
		expect(s.gutterAnnotationsToolbar.itemUuid).toBe('');
		expect(s.gutterCommentsToolbar.toolbarUuid).toBe('');
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, true, false)).toBe('#fff3a3');
		expect(toolbarHighlightColor(s.gutterCommentsToolbar, true, true)).toBe('#2e5d33');
		// Off is unticked out of the box, so an item is left to Note Toolbar
		// while its toggle is off — same behaviour as before v1.0.22.
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, false, false)).toBe('');
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, false, true)).toBe('');
	});

	it('reads a stored target and both colour states back', () => {
		const s = normalizeSettings({
			gutterAnnotationsToolbar: {
				toolbarUuid: 'tb-1',
				itemUuid: 'item-7',
				on: {
					light: { enabled: true, color: '#112233' },
					dark: { enabled: true, color: '#445566' },
				},
				off: {
					light: { enabled: true, color: '#778899' },
					dark: { enabled: false, color: '#aabbcc' },
				},
			},
		});
		expect(s.gutterAnnotationsToolbar.toolbarUuid).toBe('tb-1');
		expect(s.gutterAnnotationsToolbar.itemUuid).toBe('item-7');
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, true, false)).toBe('#112233');
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, true, true)).toBe('#445566');
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, false, false)).toBe('#778899');
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, false, true)).toBe('');
	});

	it('migrates a pre-1.0.22 Fr/Bg style into the On colour, keeping only Bg', () => {
		const s = normalizeSettings({
			gutterAnnotationsToolbar: {
				toolbarUuid: 'tb-1',
				itemUuid: 'item-7',
				style: {
					light: { fr: { enabled: true, color: '#112233' }, bg: { enabled: true, color: '#eeeeee' } },
					dark: { fr: { enabled: true, color: '#445566' }, bg: { enabled: false, color: '' } },
				},
			},
		});
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, true, false)).toBe('#eeeeee');
		expect(toolbarHighlightColor(s.gutterAnnotationsToolbar, true, true)).toBe('');
		expect(s.gutterAnnotationsToolbar.off).toEqual(defaultSettings().gutterAnnotationsToolbar.off);
	});

	it('falls back to defaults for malformed values without half-writing a target', () => {
		const s = normalizeSettings({
			gutterAnnotationsToolbar: 'nope',
			gutterCommentsToolbar: { toolbarUuid: 42, itemUuid: null, on: 'nope', off: 'nope' },
		});
		expect(s.gutterAnnotationsToolbar).toEqual(defaultSettings().gutterAnnotationsToolbar);
		expect(s.gutterCommentsToolbar.toolbarUuid).toBe('');
		expect(s.gutterCommentsToolbar.itemUuid).toBe('');
		expect(s.gutterCommentsToolbar.on).toEqual(defaultSettings().gutterCommentsToolbar.on);
		expect(s.gutterCommentsToolbar.off).toEqual(defaultSettings().gutterCommentsToolbar.off);
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

// ── v1.0.20 rename + the two note-layout settings ─────────────────────────

describe('legacy formatStyles key', () => {
	it('reads a pre-1.0.20 formatStyles record as categoryStyles', () => {
		const s = normalizeSettings({
			formatStyles: { Key: { use: true, fontSize: '', light: {}, dark: {} } },
		});
		expect(Object.keys(s.categoryStyles)).toEqual(['Key']);
	});

	it('prefers categoryStyles when both are stored', () => {
		const s = normalizeSettings({
			categoryStyles: { New: { use: true, fontSize: '', light: {}, dark: {} } },
			formatStyles: { Old: { use: true, fontSize: '', light: {}, dark: {} } },
		});
		expect(Object.keys(s.categoryStyles)).toEqual(['New']);
	});

	it('imports a payload that still uses the formatStyles envelope key', () => {
		const parsed = parseCategoriesImport('{"version":1,"formatStyles":{"Key":{"use":true}}}');
		expect(Object.keys(parsed?.categoryStyles ?? {})).toEqual(['Key']);
	});
});

describe('note layout settings', () => {
	it('defaults both display aids off', () => {
		const s = defaultSettings();
		expect(s.hideAnnotationBlock).toBe(false);
		expect(s.bodyEndLineEnabled).toBe(false);
	});

	it('round-trips the toggles through normalization', () => {
		const s = normalizeSettings({ hideAnnotationBlock: true, bodyEndLineEnabled: true });
		expect(s.hideAnnotationBlock).toBe(true);
		expect(s.bodyEndLineEnabled).toBe(true);
	});

	it('ignores non-boolean toggle values', () => {
		const s = normalizeSettings({ hideAnnotationBlock: 'yes', bodyEndLineEnabled: 1 });
		expect(s.hideAnnotationBlock).toBe(false);
		expect(s.bodyEndLineEnabled).toBe(false);
	});

	it('resolves the end-of-text rule colour per theme', () => {
		const s = normalizeSettings({
			bodyEndLineColor: {
				light: { enabled: true, color: '#112233' },
				dark: { enabled: true, color: '#abcdef' },
			},
		});
		expect(bodyEndLineColor(s, false)).toBe('#112233');
		expect(bodyEndLineColor(s, true)).toBe('#abcdef');
	});

	it('returns no colour when a theme is switched off or the hex is invalid', () => {
		const s = normalizeSettings({
			bodyEndLineColor: {
				light: { enabled: false, color: '#112233' },
				dark: { enabled: true, color: 'nope' },
			},
		});
		expect(bodyEndLineColor(s, false)).toBe('');
		expect(bodyEndLineColor(s, true)).toBe('');
	});
});
