// Settings model, defensive normalization, and the CSS generator for the
// dynamic style element. Pure module — no 'obsidian', no DOM.
//
// Format/style definitions live in the plugin's settings (data.json),
// mirroring annotation-manager; annotation DATA never goes there.

export interface ThemeColors {
	fontColor: string; // '#rrggbb' or '' (not applied)
	backgroundColor: string;
}

export interface FormatStyle {
	light: ThemeColors;
	dark: ThemeColors;
}

export interface AnnotationFormat {
	id: string;
	name: string;
	style: FormatStyle;
}

export interface MdAnnotationSettings {
	author: string;
	formats: AnnotationFormat[];
	// true → comments pick from the annotation formats; false → all comments
	// use the single dedicated comment style below.
	commentUseAnnotationFormats: boolean;
	commentStyle: FormatStyle;
}

// ── Defaults ───────────────────────────────────────────────────────────────

function themeColors(fontColor = '', backgroundColor = ''): ThemeColors {
	return { fontColor, backgroundColor };
}

export function defaultSettings(): MdAnnotationSettings {
	return {
		author: '',
		formats: [
			{
				id: 'default',
				name: 'Yellow',
				style: {
					light: themeColors('', '#fff3a3'),
					dark: themeColors('', '#7a6f1f'),
				},
			},
		],
		commentUseAnnotationFormats: false,
		commentStyle: {
			light: themeColors('', '#c8e6c9'),
			dark: themeColors('', '#2e5d33'),
		},
	};
}

// ── Normalization (defensive read of data.json) ────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

function readString(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function readThemeColors(v: unknown): ThemeColors {
	const r = asRecord(v);
	if (!r) return themeColors();
	return themeColors(readString(r.fontColor), readString(r.backgroundColor));
}

function readFormatStyle(v: unknown): FormatStyle {
	const r = asRecord(v);
	if (!r) return { light: themeColors(), dark: themeColors() };
	return { light: readThemeColors(r.light), dark: readThemeColors(r.dark) };
}

export function normalizeSettings(raw: unknown): MdAnnotationSettings {
	const s = defaultSettings();
	const r = asRecord(raw);
	if (!r) return s;

	if (typeof r.author === 'string') s.author = r.author;
	if (typeof r.commentUseAnnotationFormats === 'boolean') {
		s.commentUseAnnotationFormats = r.commentUseAnnotationFormats;
	}
	if (r.commentStyle !== undefined) s.commentStyle = readFormatStyle(r.commentStyle);

	if (Array.isArray(r.formats)) {
		const formats: AnnotationFormat[] = [];
		const seen = new Set<string>();
		for (const item of r.formats) {
			const f = asRecord(item);
			if (!f) continue;
			const id = readString(f.id);
			if (id === '' || seen.has(id)) continue;
			seen.add(id);
			formats.push({ id, name: readString(f.name), style: readFormatStyle(f.style) });
		}
		if (formats.length > 0) s.formats = formats;
	}

	return s;
}

// ── Hex validation ─────────────────────────────────────────────────────────

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

// ── CSS classes & dynamic stylesheet ───────────────────────────────────────

export const HIGHLIGHT_CLASS = 'mdann-hl';
export const COMMENT_CLASS = 'mdann-comment';

export function formatClass(formatId: string): string {
	return 'mdann-f-' + formatId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

// Resolve which FormatStyle applies to one annotation.
export function resolveStyle(
	annotationType: 'highlight' | 'comment',
	formatId: string,
	settings: MdAnnotationSettings,
): FormatStyle {
	if (annotationType === 'comment' && !settings.commentUseAnnotationFormats) {
		return settings.commentStyle;
	}
	const found = settings.formats.find((f) => f.id === formatId) ?? settings.formats[0];
	return found ? found.style : settings.commentStyle;
}

// Inline CSS custom properties for one highlight. Static rules in styles.css
// consume these per theme, so colors follow light/dark switches without any
// dynamic stylesheet. Only validated hex values are ever emitted (invalid
// settings text degrades to the theme defaults — no CSS injection).
export function highlightStyleVars(
	annotationType: 'highlight' | 'comment',
	formatId: string,
	settings: MdAnnotationSettings,
): Record<string, string> {
	const style = resolveStyle(annotationType, formatId, settings);
	const color = (v: string, fallback: string): string => (isValidHex(v) ? v : fallback);
	return {
		'--mdann-light-fg': color(style.light.fontColor, 'inherit'),
		'--mdann-light-bg': color(style.light.backgroundColor, 'transparent'),
		'--mdann-dark-fg': color(style.dark.fontColor, 'inherit'),
		'--mdann-dark-bg': color(style.dark.backgroundColor, 'transparent'),
	};
}

// The same custom properties as a style-attribute string (for CodeMirror
// decoration attributes).
export function highlightStyleText(
	annotationType: 'highlight' | 'comment',
	formatId: string,
	settings: MdAnnotationSettings,
): string {
	return Object.entries(highlightStyleVars(annotationType, formatId, settings))
		.map(([prop, value]) => `${prop}: ${value};`)
		.join(' ');
}

// The CSS class list for one annotation's highlight span/decoration.
export function highlightClasses(
	annotationType: 'highlight' | 'comment',
	formatId: string,
	settings: MdAnnotationSettings,
): string {
	if (annotationType === 'comment' && !settings.commentUseAnnotationFormats) {
		return `${HIGHLIGHT_CLASS} ${COMMENT_CLASS}`;
	}
	const known = settings.formats.some((f) => f.id === formatId);
	const fallback = settings.formats[0];
	const id = known ? formatId : fallback ? fallback.id : formatId;
	return `${HIGHLIGHT_CLASS} ${formatClass(id)}`;
}
