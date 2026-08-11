// Settings model, defensive normalization, and style resolution. Pure module —
// no 'obsidian', no DOM.
//
// The model mirrors annotation-manager's settings (per-format grid with
// enable-checkbox colors, light/dark themes, font size, Use toggle) minus
// everything bracket-related — md-annotation has no in-text delimiters.
// Format styles are keyed by the format NAME (e.g. "Yellow", "Key"), and the
// annotation JSON "format" field stores that same name.

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

// Light/dark halves shared by formats and the dedicated comment style.
export interface ThemedPartStyles {
	light: PartStyle;
	dark: PartStyle;
}

// Per-format style: row-level Use toggle, font size, and Fr/Bg per theme.
export interface FormatStyle extends ThemedPartStyles {
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
	// Keyed by format name. The annotation JSON "format" field stores the name.
	formatStyles: Record<string, FormatStyle>;

	// Visibility toggles (also driven by the show/hide commands).
	annotationFormattingEnabled: boolean;
	commentsFormattingEnabled: boolean;
	commentsHiddenEnabled: boolean;

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

	// Note Toolbar items that follow the two gutter toggles, so a toolbar shows
	// at a glance which gutters are on. Inert until an item is chosen.
	gutterAnnotationsToolbar: ToolbarHighlight;
	gutterCommentsToolbar: ToolbarHighlight;

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

export function makeFormatStyle(): FormatStyle {
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
		formatStyles: {
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
		gutterAnnotationsEnabled: true,
		gutterCommentsEnabled: true,
		gutterAnnotationsSide: 'right',
		gutterCommentsSide: 'right',
		gutterWidth: GUTTER_DEFAULT_WIDTH,
		gutterOnlyWhenAnnotated: true,
		gutterAnnotationsToolbar: makeToolbarHighlight(
			partStyle('', '#fff3a3'),
			partStyle('', '#7a6f1f'),
		),
		gutterCommentsToolbar: makeToolbarHighlight(
			partStyle('', '#c8e6c9'),
			partStyle('', '#2e5d33'),
		),
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

function readFormatStyle(v: unknown): FormatStyle {
	const r = asRecord(v);
	if (!r) return makeFormatStyle();
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
		'gutterAnnotationsEnabled',
		'gutterCommentsEnabled',
		'gutterOnlyWhenAnnotated',
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
	s.gutterAnnotationsToolbar = readToolbarHighlight(
		r.gutterAnnotationsToolbar,
		s.gutterAnnotationsToolbar,
	);
	s.gutterCommentsToolbar = readToolbarHighlight(r.gutterCommentsToolbar, s.gutterCommentsToolbar);

	const styles = asRecord(r.formatStyles);
	if (styles) {
		// Current shape: name-keyed record.
		const next: Record<string, FormatStyle> = {};
		for (const [name, value] of Object.entries(styles)) {
			if (name === '' || isUnsafeKey(name)) continue;
			const v = asRecord(value);
			if (!v) continue;
			next[name] = readFormatStyle(v);
		}
		if (Object.keys(next).length > 0) s.formatStyles = next;
	} else if (Array.isArray(r.formats)) {
		// Legacy shape: formats array of {id, name, style: {light/dark
		// {fontColor, backgroundColor}}} → name-keyed record (id as fallback
		// name), enabled flags derived from non-empty colors.
		const next: Record<string, FormatStyle> = {};
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
		if (Object.keys(next).length > 0) s.formatStyles = next;
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

// ── Format export / import (cross-vault sharing) ───────────────────────────
//
// Obsidian Sync replicates one vault to *itself* on other devices — it never
// bridges two different vaults, so a format created in vault A never reaches
// vault B no matter how the "Installed community plugins" toggle is set.
// These helpers move formats explicitly: export produces a JSON payload, import
// reads one back.

export const FORMATS_EXPORT_VERSION = 1;

export interface FormatsPayload {
	version: number;
	formatStyles: Record<string, FormatStyle>;
	commentStyle: ThemedPartStyles;
}

export function exportFormats(settings: MdAnnotationSettings): string {
	const payload: FormatsPayload = {
		version: FORMATS_EXPORT_VERSION,
		formatStyles: settings.formatStyles,
		commentStyle: settings.commentStyle,
	};
	return JSON.stringify(payload, null, '\t');
}

// Every valid, safely-named format in a name-keyed record, normalized.
function readFormatStyleRecord(v: unknown): Record<string, FormatStyle> {
	const styles = asRecord(v);
	const next: Record<string, FormatStyle> = {};
	if (!styles) return next;
	for (const [name, value] of Object.entries(styles)) {
		if (name === '' || isUnsafeKey(name)) continue;
		if (!asRecord(value)) continue;
		next[name] = readFormatStyle(value);
	}
	return next;
}

export interface ImportedFormats {
	formatStyles: Record<string, FormatStyle>;
	// Absent when the payload carried no comment style (e.g. a bare
	// formatStyles object was pasted) — the current one is then kept.
	commentStyle: ThemedPartStyles | null;
}

// Parse a pasted payload. Accepts the full export envelope, a bare
// { formatStyles: … } object, or a bare name-keyed record of formats, so a
// hand-trimmed paste still works. Returns null when no format survives —
// the caller reports that rather than wiping the user's formats.
export function parseFormatsImport(text: string): ImportedFormats | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	const r = asRecord(raw);
	if (!r) return null;

	const source = 'formatStyles' in r ? r.formatStyles : raw;
	const formatStyles = readFormatStyleRecord(source);
	if (Object.keys(formatStyles).length === 0) return null;

	const commentStyle = asRecord(r.commentStyle) ? readThemedPartStyles(r.commentStyle) : null;
	return { formatStyles, commentStyle };
}

// 'replace' takes the imported set verbatim; 'merge' keeps every existing
// format untouched and appends only names not already present.
export function mergeFormats(
	current: Record<string, FormatStyle>,
	incoming: Record<string, FormatStyle>,
	mode: 'merge' | 'replace',
): { formatStyles: Record<string, FormatStyle>; added: string[]; skipped: string[] } {
	if (mode === 'replace') {
		return { formatStyles: { ...incoming }, added: Object.keys(incoming), skipped: [] };
	}
	const formatStyles: Record<string, FormatStyle> = { ...current };
	const added: string[] = [];
	const skipped: string[] = [];
	for (const [name, style] of Object.entries(incoming)) {
		if (name in formatStyles) {
			skipped.push(name);
			continue;
		}
		formatStyles[name] = style;
		added.push(name);
	}
	return { formatStyles, added, skipped };
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
export const COMMENT_CLASS = 'mdann-comment';
export const MARKER_CLASS = 'mdann-marker';
// An element inserted purely so the Reading-view gutter has something to
// measure: it carries the annotation id but no visible styling of its own,
// used where the annotation itself is deliberately not being drawn (formatting
// switched off, or comment markers hidden) yet its card is still wanted.
export const ANCHOR_CLASS = 'mdann-anchor';

export function formatClass(formatName: string): string {
	return 'mdann-f-' + formatName.replace(/[^a-zA-Z0-9_-]/g, '-');
}

// First format whose Use box is checked ('' when none).
export function firstUsedFormatName(settings: MdAnnotationSettings): string {
	for (const [name, style] of Object.entries(settings.formatStyles)) {
		if (style.use) return name;
	}
	return '';
}

// Format names available for new annotations (Use checked), insertion order.
export function usableFormatNames(settings: MdAnnotationSettings): string[] {
	return Object.entries(settings.formatStyles)
		.filter(([, style]) => style.use)
		.map(([name]) => name);
}

export interface ResolvedFormat {
	style: ThemedPartStyles;
	fontSize: string;
}

// Resolve which style applies to one annotation. Comments (format '') use the
// dedicated comment style; highlights resolve their format name, falling back
// to the first Use-checked format when the name is unknown or unchecked
// (covers renamed/deleted formats until the user reassigns via the sidebar).
export function resolveStyle(
	annotationType: 'highlight' | 'comment',
	formatName: string,
	settings: MdAnnotationSettings,
): ResolvedFormat | null {
	if (annotationType === 'comment' && formatName === '') {
		return { style: settings.commentStyle, fontSize: '' };
	}
	const exact = settings.formatStyles[formatName];
	if (exact?.use) return { style: exact, fontSize: exact.fontSize };
	const fallback = settings.formatStyles[firstUsedFormatName(settings)];
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

// Inline CSS custom properties for one highlight/marker. Static rules in
// styles.css consume these per theme, so colors follow light/dark switches.
// Only validated hex values (and a validated font-size) are ever emitted —
// invalid settings text degrades to defaults, no CSS injection.
export function highlightStyleVars(
	annotationType: 'highlight' | 'comment',
	formatName: string,
	settings: MdAnnotationSettings,
): Record<string, string> {
	const resolved = resolveStyle(annotationType, formatName, settings);
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
	formatName: string,
	settings: MdAnnotationSettings,
): string {
	return Object.entries(highlightStyleVars(annotationType, formatName, settings))
		.map(([prop, value]) => `${prop}: ${value};`)
		.join(' ');
}

// Custom properties for one gutter card. Deliberately NOT the same set as
// highlightStyleVars: that one substitutes the keywords 'inherit'/'transparent'
// for disabled colors, which cannot serve as a border color. Here a disabled
// color is simply omitted so the CSS `var(--…, fallback)` in styles.css takes
// over — a card with no Fr color still gets a visible border from the theme.
// The card's border colour is the format's Fr (text) colour by design.
export function gutterStyleVars(
	annotationType: 'highlight' | 'comment',
	formatName: string,
	settings: MdAnnotationSettings,
): Record<string, string> {
	const resolved = resolveStyle(annotationType, formatName, settings);
	if (!resolved) return {};
	const { style, fontSize } = resolved;
	const vars: Record<string, string> = {};
	const put = (name: string, opt: ColorOption): void => {
		const color = enabledColor(opt);
		if (color !== '') vars[name] = color;
	};
	put('--mdann-g-light-fg', style.light.fr);
	put('--mdann-g-light-bg', style.light.bg);
	put('--mdann-g-dark-fg', style.dark.fr);
	put('--mdann-g-dark-bg', style.dark.bg);
	if (isValidFontSize(fontSize)) vars['font-size'] = fontSize.trim();
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
	formatName: string,
	settings: MdAnnotationSettings,
): string {
	if (annotationType === 'comment' && formatName === '') {
		return `${HIGHLIGHT_CLASS} ${COMMENT_CLASS}`;
	}
	const known = settings.formatStyles[formatName]?.use;
	const name = known ? formatName : firstUsedFormatName(settings);
	return name === ''
		? HIGHLIGHT_CLASS
		: `${HIGHLIGHT_CLASS} ${formatClass(name)}`;
}

// The CSS class list for a point-comment marker.
export function markerClasses(): string {
	return `${MARKER_CLASS} ${COMMENT_CLASS}`;
}
