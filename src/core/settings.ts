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

export interface MdAnnotationSettings {
	author: string;
	// Keyed by format name. The annotation JSON "format" field stores the name.
	formatStyles: Record<string, FormatStyle>;

	// Visibility toggles (also driven by the show/hide commands).
	annotationFormattingEnabled: boolean;
	commentsFormattingEnabled: boolean;
	commentsHiddenEnabled: boolean;

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
		'syncTextAndSidebar',
		'sidebarClickJumpsToText',
		'textClickJumpsToSidebar',
	] as const;
	for (const key of booleanKeys) {
		if (typeof r[key] === 'boolean') s[key] = r[key];
	}

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
