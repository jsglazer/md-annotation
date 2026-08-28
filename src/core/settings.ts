// Settings model, defensive normalization, and style resolution. Pure module —
// no 'obsidian', no DOM.
//
// The model mirrors annotation-manager's settings (per-category grid with
// enable-checkbox colors, light/dark themes, font size, Use toggle) minus
// everything bracket-related — md-annotation has no in-text delimiters.
// Category styles are keyed by the category NAME (e.g. "Yellow", "Key"), and
// the annotation JSON "category" field stores that same name. Both were
// called "format" before v1.0.20; the old spellings are still read.

// One color plus its enable checkbox; a disabled color is not applied.
export interface ColorOption {
	enabled: boolean;
	color: string; // '#rrggbb' or ''
}

// One Fr/Bg pair (Fr = foreground/text color, Bg = background color).
export interface PartStyle {
	fr: ColorOption;
	bg: ColorOption;
}

// Light/dark halves shared by categories and the dedicated comment style.
export interface ThemedPartStyles {
	light: PartStyle;
	dark: PartStyle;
}

// A single colour per theme (no Fr/Bg pair) — used by the end-of-text rule,
// which draws one line and has nothing to fill.
export interface ThemedColorOption {
	light: ColorOption;
	dark: ColorOption;
}

// Per-category style: row-level Use toggle, font size, and Fr/Bg per theme.
export interface CategoryStyle extends ThemedPartStyles {
	use: boolean;
	fontSize: string;
}

// Which margin a gutter card sits in. Annotations and comments choose
// independently, so notes and highlights can occupy opposite margins.
export type GutterSide = 'left' | 'right';

export const GUTTER_MIN_WIDTH = 140;
export const GUTTER_MAX_WIDTH = 480;
export const GUTTER_DEFAULT_WIDTH = 220;

// One Note Toolbar item to recolour while a gutter is switched on. The two
// uuids identify the item (toolbar → item); the style is the colour pair
// applied while that gutter is showing — an item whose gutter is off is left
// entirely to Note Toolbar's own styling, so "on" reads as the exception.
export interface ToolbarHighlight {
	toolbarUuid: string;
	itemUuid: string;
	style: ThemedPartStyles;
}

export function makeToolbarHighlight(light: PartStyle, dark: PartStyle): ToolbarHighlight {
	return { toolbarUuid: '', itemUuid: '', style: { light, dark } };
}

export interface MdAnnotationSettings {
	author: string;
	// Keyed by category name. The annotation JSON "category" field stores it.
	categoryStyles: Record<string, CategoryStyle>;

	// Visibility toggles (also driven by the show/hide commands).
	annotationFormattingEnabled: boolean;
	commentsFormattingEnabled: boolean;
	commentsHiddenEnabled: boolean;
	// Collapse the %%md-annotation block out of Live Preview and Source mode,
	// so the JSON at the foot of the note stops competing with the text.
	// Reading view never showed it (Obsidian hides %% comments there).
	hideAnnotationBlock: boolean;

	// A rule drawn under the last line of body text — with the block hidden
	// there is otherwise nothing marking where the note actually ends.
	bodyEndLineEnabled: boolean;
	bodyEndLineColor: ThemedColorOption;

	// Margin gutter (Live Preview / Source mode). Each type is switched on
	// separately — also by the "Show/hide … in the gutter" commands — and picks
	// its own margin. The width applies to whichever margins are in use.
	gutterAnnotationsEnabled: boolean;
	gutterCommentsEnabled: boolean;
	gutterAnnotationsSide: GutterSide;
	gutterCommentsSide: GutterSide;
	gutterWidth: number;
	// Reserve the margin only on notes that actually have something to put in
	// it, rather than on every note the moment the gutter is switched on.
	gutterOnlyWhenAnnotated: boolean;
	// Font size for gutter cards only — deliberately separate from a category's
	// own fontSize (which governs the in-text highlight and the sidebar quote
	// chip) so the two surfaces can be sized independently. Blank uses the
	// theme's default.
	gutterAnnotationsFontSize: string;
	gutterCommentsFontSize: string;

	// Note Toolbar items that follow the two gutter toggles, so a toolbar shows
	// at a glance which gutters are on. Inert until an item is chosen.
	gutterAnnotationsToolbar: ToolbarHighlight;
	gutterCommentsToolbar: ToolbarHighlight;

	// Note Toolbar item that follows the "Text click jumps to sidebar" toggle.
	// Same mechanism as the two gutter ones, for a toggle that lives on the
	// General tab rather than the gutter.
	textClickJumpToolbar: ToolbarHighlight;

	// Off by default: an orphan is visible and fixable from the sidebar, and a
	// silent repair at the relaxed bar could move a highlight without you
	// noticing. On, the same pass the "Fix orphans" button runs is applied to
	// the active note as it is parsed.
	autoRepairOrphans: boolean;

	// Navigation toggles (General tab), all on by default. Each governs one
	// direction of the text ⇄ sidebar link; the "Sync text and sidebar" command
	// flips syncTextAndSidebar, so the command and the setting are one state.
	syncTextAndSidebar: boolean;
	sidebarClickJumpsToText: boolean;
	textClickJumpsToSidebar: boolean;

	// The single dedicated style for comments (point markers).
	commentStyle: ThemedPartStyles;
}

// ── Construction helpers ───────────────────────────────────────────────────

export function colorOption(color = ''): ColorOption {
	return { enabled: color !== '', color };
}

export function partStyle(fr = '', bg = ''): PartStyle {
	return { fr: colorOption(fr), bg: colorOption(bg) };
}

export function makeCategoryStyle(): CategoryStyle {
	return { use: true, fontSize: '', light: partStyle(), dark: partStyle() };
}

// Keys from settings data are used as object property names. Reject the ones
// that would mutate an object's prototype.
export function isUnsafeKey(key: string): boolean {
	return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

export function defaultSettings(): MdAnnotationSettings {
	return {
		author: '',
		categoryStyles: {
			Yellow: {
				use: true,
				fontSize: '',
				light: partStyle('', '#fff3a3'),
				dark: partStyle('', '#7a6f1f'),
			},
		},
		annotationFormattingEnabled: true,
		commentsFormattingEnabled: true,
		commentsHiddenEnabled: false,
		hideAnnotationBlock: false,
		bodyEndLineEnabled: false,
		bodyEndLineColor: { light: colorOption('#b0b0b0'), dark: colorOption('#5a5a5a') },
		gutterAnnotationsEnabled: true,
		gutterCommentsEnabled: true,
		gutterAnnotationsSide: 'right',
		gutterCommentsSide: 'right',
		gutterWidth: GUTTER_DEFAULT_WIDTH,
		gutterOnlyWhenAnnotated: true,
		gutterAnnotationsFontSize: '',
		gutterCommentsFontSize: '',
		gutterAnnotationsToolbar: makeToolbarHighlight(
			partStyle('', '#fff3a3'),
			partStyle('', '#7a6f1f'),
		),
		gutterCommentsToolbar: makeToolbarHighlight(
			partStyle('', '#c8e6c9'),
			partStyle('', '#2e5d33'),
		),
		textClickJumpToolbar: makeToolbarHighlight(
			partStyle('', '#fff3a3'),
			partStyle('', '#7a6f1f'),
		),
		autoRepairOrphans: false,
		syncTextAndSidebar: true,
		sidebarClickJumpsToText: true,
		textClickJumpsToSidebar: true,
		commentStyle: {
			light: partStyle('', '#c8e6c9'),
			dark: partStyle('', '#2e5d33'),
		},
	};
}

// ── Normalization (defensive read of data.json, with legacy migration) ─────

function asRecord(v: unknown): Record<string, unknown> | null {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

function readString(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

// Anything that is not literally 'left' falls back to the default margin.
function readGutterSide(v: unknown, fallback: GutterSide): GutterSide {
	return v === 'left' || v === 'right' ? v : fallback;
}

// The gutter has to stay wide enough to read and narrow enough to leave the
// note usable, so an out-of-range or non-finite stored width is clamped rather
// than trusted.
export function clampGutterWidth(value: number): number {
	if (!Number.isFinite(value)) return GUTTER_DEFAULT_WIDTH;
	return Math.min(GUTTER_MAX_WIDTH, Math.max(GUTTER_MIN_WIDTH, Math.round(value)));
}

function readColorOption(v: unknown): ColorOption {
	const r = asRecord(v);
	if (!r) return colorOption();
	return { enabled: r.enabled === true, color: readString(r.color) };
}

function readPartStyle(v: unknown): PartStyle {
	const r = asRecord(v);
	if (!r) return partStyle();
	return { fr: readColorOption(r.fr), bg: readColorOption(r.bg) };
}

// Legacy {fontColor, backgroundColor} → PartStyle (enabled when non-empty).
function legacyPartStyle(v: unknown): PartStyle {
	const r = asRecord(v);
	if (!r) return partStyle();
	return partStyle(readString(r.fontColor), readString(r.backgroundColor));
}

function readThemedPartStyles(v: unknown): ThemedPartStyles {
	const r = asRecord(v);
	if (!r) return { light: partStyle(), dark: partStyle() };
	return { light: readPartStyle(r.light), dark: readPartStyle(r.dark) };
}

// One stored Note Toolbar highlight. An unreadable value keeps the default
// colours but never a half-written target, so a corrupt uuid pair simply
// leaves the highlight switched off rather than pointing somewhere arbitrary.
function readToolbarHighlight(v: unknown, fallback: ToolbarHighlight): ToolbarHighlight {
	const r = asRecord(v);
	if (!r) return fallback;
	return {
		toolbarUuid: readString(r.toolbarUuid),
		itemUuid: readString(r.itemUuid),
		style: asRecord(r.style) ? readThemedPartStyles(r.style) : fallback.style,
	};
}

function readCategoryStyle(v: unknown): CategoryStyle {
	const r = asRecord(v);
	if (!r) return makeCategoryStyle();
	return {
		use: r.use !== false,
		fontSize: readString(r.fontSize),
		light: readPartStyle(r.light),
		dark: readPartStyle(r.dark),
	};
}

export function normalizeSettings(raw: unknown): MdAnnotationSettings {
	const s = defaultSettings();
	const r = asRecord(raw);
	if (!r) return s;

	if (typeof r.author === 'string') s.author = r.author;

	const booleanKeys = [
		'annotationFormattingEnabled',
		'commentsFormattingEnabled',
		'commentsHiddenEnabled',
		'hideAnnotationBlock',
		'bodyEndLineEnabled',
		'gutterAnnotationsEnabled',
		'gutterCommentsEnabled',
		'gutterOnlyWhenAnnotated',
		'autoRepairOrphans',
		'syncTextAndSidebar',
		'sidebarClickJumpsToText',
		'textClickJumpsToSidebar',
	] as const;
	for (const key of booleanKeys) {
		if (typeof r[key] === 'boolean') s[key] = r[key];
	}

	s.gutterAnnotationsSide = readGutterSide(r.gutterAnnotationsSide, s.gutterAnnotationsSide);
	s.gutterCommentsSide = readGutterSide(r.gutterCommentsSide, s.gutterCommentsSide);
	if (typeof r.gutterWidth === 'number') s.gutterWidth = clampGutterWidth(r.gutterWidth);
	if (typeof r.gutterAnnotationsFontSize === 'string') {
		s.gutterAnnotationsFontSize = r.gutterAnnotationsFontSize;
	}
	if (typeof r.gutterCommentsFontSize === 'string') {
		s.gutterCommentsFontSize = r.gutterCommentsFontSize;
	}
	s.gutterAnnotationsToolbar = readToolbarHighlight(
		r.gutterAnnotationsToolbar,
		s.gutterAnnotationsToolbar,
	);
	s.gutterCommentsToolbar = readToolbarHighlight(r.gutterCommentsToolbar, s.gutterCommentsToolbar);
	s.textClickJumpToolbar = readToolbarHighlight(r.textClickJumpToolbar, s.textClickJumpToolbar);

	// 'categoryStyles' since v1.0.20; 'formatStyles' is the same record under
	// its pre-1.0.20 name.
	const styles = asRecord(r.categoryStyles) ?? asRecord(r.formatStyles);
	if (styles) {
		// Current shape: name-keyed record.
		const next: Record<string, CategoryStyle> = {};
		for (const [name, value] of Object.entries(styles)) {
			if (name === '' || isUnsafeKey(name)) continue;
			const v = asRecord(value);
			if (!v) continue;
			next[name] = readCategoryStyle(v);
		}
		if (Object.keys(next).length > 0) s.categoryStyles = next;
	} else if (Array.isArray(r.formats)) {
		// Legacy shape: formats array of {id, name, style: {light/dark
		// {fontColor, backgroundColor}}} → name-keyed record (id as fallback
		// name), enabled flags derived from non-empty colors.
		const next: Record<string, CategoryStyle> = {};
		for (const item of r.formats) {
			const f = asRecord(item);
			if (!f) continue;
			const name = readString(f.name) !== '' ? readString(f.name) : readString(f.id);
			if (name === '' || isUnsafeKey(name) || next[name]) continue;
			const style = asRecord(f.style);
			next[name] = {
				use: true,
				fontSize: '',
				light: legacyPartStyle(style?.light),
				dark: legacyPartStyle(style?.dark),
			};
		}
		if (Object.keys(next).length > 0) s.categoryStyles = next;
	}

	const bel = asRecord(r.bodyEndLineColor);
	if (bel) {
		s.bodyEndLineColor = { light: readColorOption(bel.light), dark: readColorOption(bel.dark) };
	}

	const cs = asRecord(r.commentStyle);
	if (cs) {
		const light = asRecord(cs.light);
		// Current shape stores {fr, bg}; legacy stored {fontColor, backgroundColor}.
		if (light && ('fr' in light || 'bg' in light)) {
			s.commentStyle = readThemedPartStyles(cs);
		} else {
			s.commentStyle = { light: legacyPartStyle(cs.light), dark: legacyPartStyle(cs.dark) };
		}
	}

	return s;
}

// ── Category export / import (cross-vault sharing) ─────────────────────────
//
// Obsidian Sync replicates one vault to *itself* on other devices — it never
// bridges two different vaults, so a category created in vault A never reaches
// vault B no matter how the "Installed community plugins" toggle is set.
// These helpers move categories explicitly: export produces a JSON payload,
// import reads one back.

export const CATEGORIES_EXPORT_VERSION = 1;

export interface CategoriesPayload {
	version: number;
	categoryStyles: Record<string, CategoryStyle>;
	commentStyle: ThemedPartStyles;
}

export function exportCategories(settings: MdAnnotationSettings): string {
	const payload: CategoriesPayload = {
		version: CATEGORIES_EXPORT_VERSION,
		categoryStyles: settings.categoryStyles,
		commentStyle: settings.commentStyle,
	};
	return JSON.stringify(payload, null, '\t');
}

// Every valid, safely-named category in a name-keyed record, normalized.
function readCategoryStyleRecord(v: unknown): Record<string, CategoryStyle> {
	const styles = asRecord(v);
	const next: Record<string, CategoryStyle> = {};
	if (!styles) return next;
	for (const [name, value] of Object.entries(styles)) {
		if (name === '' || isUnsafeKey(name)) continue;
		if (!asRecord(value)) continue;
		next[name] = readCategoryStyle(value);
	}
	return next;
}

export interface ImportedCategories {
	categoryStyles: Record<string, CategoryStyle>;
	// Absent when the payload carried no comment style (e.g. a bare
	// categoryStyles object was pasted) — the current one is then kept.
	commentStyle: ThemedPartStyles | null;
}

// Parse a pasted payload. Accepts the full export envelope, a bare
// { categoryStyles: … } object (or its pre-1.0.20 { formatStyles: … } name),
// or a bare name-keyed record of categories, so a hand-trimmed paste still
// works. Returns null when no category survives — the caller reports that
// rather than wiping the user's categories.
export function parseCategoriesImport(text: string): ImportedCategories | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	const r = asRecord(raw);
	if (!r) return null;

	const source =
		'categoryStyles' in r ? r.categoryStyles : 'formatStyles' in r ? r.formatStyles : raw;
	const categoryStyles = readCategoryStyleRecord(source);
	if (Object.keys(categoryStyles).length === 0) return null;

	const commentStyle = asRecord(r.commentStyle) ? readThemedPartStyles(r.commentStyle) : null;
	return { categoryStyles, commentStyle };
}

// 'replace' takes the imported set verbatim; 'merge' keeps every existing
// category untouched and appends only names not already present.
export function mergeCategories(
	current: Record<string, CategoryStyle>,
	incoming: Record<string, CategoryStyle>,
	mode: 'merge' | 'replace',
): { categoryStyles: Record<string, CategoryStyle>; added: string[]; skipped: string[] } {
	if (mode === 'replace') {
		return { categoryStyles: { ...incoming }, added: Object.keys(incoming), skipped: [] };
	}
	const categoryStyles: Record<string, CategoryStyle> = { ...current };
	const added: string[] = [];
	const skipped: string[] = [];
	for (const [name, style] of Object.entries(incoming)) {
		if (name in categoryStyles) {
			skipped.push(name);
			continue;
		}
		categoryStyles[name] = style;
		added.push(name);
	}
	return { categoryStyles, added, skipped };
}

// ── Hex / font-size validation ─────────────────────────────────────────────

// Accepts hex with or without the # prefix; always returns WITH # (needed for
// CSS), or '' when invalid.
export function normalizeHex(value: string): string {
	const v = value.trim();
	if (v === '') return '';
	if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
	if (/^[0-9a-fA-F]{6}$/.test(v)) return '#' + v;
	return '';
}

function isValidHex(v: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(v);
}

// fontSize ends up in inline style attributes — restrict it to a plain CSS
// length (12px, 1.1em, 90%…) or a bare keyword (large, x-small…) so it cannot
// inject additional declarations/rules.
export function isValidFontSize(value: string): boolean {
	const v = value.trim();
	if (v === '') return false;
	return /^\d+(\.\d+)?(px|pt|em|rem|%|vh|vw)$/.test(v) || /^[a-zA-Z-]+$/.test(v);
}

// ── CSS classes & inline style resolution ──────────────────────────────────

export const HIGHLIGHT_CLASS = 'mdann-hl';
// Line decoration carrying the end-of-text rule (see bodyEndLineEnabled).
export const BODY_END_LINE_CLASS = 'mdann-body-end';
export const COMMENT_CLASS = 'mdann-comment';
export const MARKER_CLASS = 'mdann-marker';
// An element inserted purely so the Reading-view gutter has something to
// measure: it carries the annotation id but no visible styling of its own,
// used where the annotation itself is deliberately not being drawn (colouring
// switched off, or comment markers hidden) yet its card is still wanted.
export const ANCHOR_CLASS = 'mdann-anchor';
// Painted onto an element the plugin does not own — an Obsidian Live Preview
// widget, or a rendered math container in Reading view — when an annotation
// covers it. Deliberately NOT HIGHLIGHT_CLASS: teardown queries
// `span.mdann-hl` and unwraps what it finds, which would tear apart the
// foreign element. Its own rule in styles.css mirrors the highlight colours.
export const WIDGET_HL_CLASS = 'mdann-widget-hl';

export function categoryClass(categoryName: string): string {
	return 'mdann-f-' + categoryName.replace(/[^a-zA-Z0-9_-]/g, '-');
}

// First category whose Use box is checked ('' when none).
export function firstUsedCategoryName(settings: MdAnnotationSettings): string {
	for (const [name, style] of Object.entries(settings.categoryStyles)) {
		if (style.use) return name;
	}
	return '';
}

// Category names available for new annotations (Use checked), insertion order.
export function usableCategoryNames(settings: MdAnnotationSettings): string[] {
	return Object.entries(settings.categoryStyles)
		.filter(([, style]) => style.use)
		.map(([name]) => name);
}

export interface ResolvedCategory {
	style: ThemedPartStyles;
	fontSize: string;
}

// Resolve which style applies to one annotation. Comments (category '') use
// the dedicated comment style; highlights resolve their category name, falling
// back to the first Use-checked category when the name is unknown or unchecked
// (covers renamed/deleted categories until the user reassigns via the sidebar).
export function resolveStyle(
	annotationType: 'highlight' | 'comment',
	categoryName: string,
	settings: MdAnnotationSettings,
): ResolvedCategory | null {
	if (annotationType === 'comment' && categoryName === '') {
		return { style: settings.commentStyle, fontSize: '' };
	}
	const exact = settings.categoryStyles[categoryName];
	if (exact?.use) return { style: exact, fontSize: exact.fontSize };
	const fallback = settings.categoryStyles[firstUsedCategoryName(settings)];
	return fallback ? { style: fallback, fontSize: fallback.fontSize } : null;
}

function enabledColor(opt: ColorOption): string {
	return opt.enabled && isValidHex(opt.color) ? opt.color : '';
}

// The Fr/Bg pair a themed style contributes for the active theme. Both are ''
// when nothing is enabled or the stored hex is invalid, which callers read as
// "leave this element alone".
export function themedColors(style: ThemedPartStyles, dark: boolean): { fg: string; bg: string } {
	const part = dark ? style.dark : style.light;
	return { fg: enabledColor(part.fr), bg: enabledColor(part.bg) };
}

// The end-of-text rule's colour for the active theme, '' when the theme's
// colour is switched off or unreadable (callers then fall back to the theme's
// own border colour in styles.css).
export function bodyEndLineColor(settings: MdAnnotationSettings, dark: boolean): string {
	const opt = dark ? settings.bodyEndLineColor.dark : settings.bodyEndLineColor.light;
	return enabledColor(opt);
}

// Inline CSS custom properties for one highlight/marker. Static rules in
// styles.css consume these per theme, so colors follow light/dark switches.
// Only validated hex values (and a validated font-size) are ever emitted —
// invalid settings text degrades to defaults, no CSS injection.
export function highlightStyleVars(
	annotationType: 'highlight' | 'comment',
	categoryName: string,
	settings: MdAnnotationSettings,
): Record<string, string> {
	const resolved = resolveStyle(annotationType, categoryName, settings);
	if (!resolved) return {};
	const { style, fontSize } = resolved;
	const color = (opt: ColorOption, fallback: string): string => enabledColor(opt) || fallback;
	const vars: Record<string, string> = {
		'--mdann-light-fg': color(style.light.fr, 'inherit'),
		'--mdann-light-bg': color(style.light.bg, 'transparent'),
		'--mdann-dark-fg': color(style.dark.fr, 'inherit'),
		'--mdann-dark-bg': color(style.dark.bg, 'transparent'),
	};
	if (isValidFontSize(fontSize)) vars['font-size'] = fontSize.trim();
	return vars;
}

// The same properties as a style-attribute string (for CodeMirror decoration
// attributes).
export function highlightStyleText(
	annotationType: 'highlight' | 'comment',
	categoryName: string,
	settings: MdAnnotationSettings,
): string {
	return Object.entries(highlightStyleVars(annotationType, categoryName, settings))
		.map(([prop, value]) => `${prop}: ${value};`)
		.join(' ');
}

// Custom properties for one gutter card. Deliberately NOT the same set as
// highlightStyleVars: that one substitutes the keywords 'inherit'/'transparent'
// for disabled colors, which cannot serve as a border color. Here a disabled
// color is simply omitted so the CSS `var(--…, fallback)` in styles.css takes
// over — a card with no Fr color still gets a visible border from the theme.
// The card's border colour is the category's Fr (text) colour by design.
//
// Font size is deliberately NOT the category's own fontSize (that one governs
// the in-text highlight and the sidebar quote chip) — the gutter has its own
// dedicated size per type, set on the Gutter settings tab, so it never
// affects the sidebar.
export function gutterStyleVars(
	annotationType: 'highlight' | 'comment',
	categoryName: string,
	settings: MdAnnotationSettings,
): Record<string, string> {
	const resolved = resolveStyle(annotationType, categoryName, settings);
	if (!resolved) return {};
	const { style } = resolved;
	const vars: Record<string, string> = {};
	const put = (name: string, opt: ColorOption): void => {
		const color = enabledColor(opt);
		if (color !== '') vars[name] = color;
	};
	put('--mdann-g-light-fg', style.light.fr);
	put('--mdann-g-light-bg', style.light.bg);
	put('--mdann-g-dark-fg', style.dark.fr);
	put('--mdann-g-dark-bg', style.dark.bg);
	const gutterFontSize =
		annotationType === 'comment'
			? settings.gutterCommentsFontSize
			: settings.gutterAnnotationsFontSize;
	if (isValidFontSize(gutterFontSize)) vars['font-size'] = gutterFontSize.trim();
	return vars;
}

// Every property gutterStyleVars can emit — the card element is reused across
// renders, so stale ones must be cleared before the new set is applied.
export const GUTTER_STYLE_PROPS = [
	'--mdann-g-light-fg',
	'--mdann-g-light-bg',
	'--mdann-g-dark-fg',
	'--mdann-g-dark-bg',
	'font-size',
] as const;

// The CSS class list for one annotation's highlight span/decoration.
export function highlightClasses(
	annotationType: 'highlight' | 'comment',
	categoryName: string,
	settings: MdAnnotationSettings,
): string {
	if (annotationType === 'comment' && categoryName === '') {
		return `${HIGHLIGHT_CLASS} ${COMMENT_CLASS}`;
	}
	const known = settings.categoryStyles[categoryName]?.use;
	const name = known ? categoryName : firstUsedCategoryName(settings);
	return name === ''
		? HIGHLIGHT_CLASS
		: `${HIGHLIGHT_CLASS} ${categoryClass(name)}`;
}

// The CSS class list for a point-comment marker.
export function markerClasses(): string {
	return `${MARKER_CLASS} ${COMMENT_CLASS}`;
}
