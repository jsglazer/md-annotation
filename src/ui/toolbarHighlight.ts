// Recolours one Note Toolbar item with the state of the toggle it runs, so a
// toolbar button reads as "pressed" for as long as that toggle is on — and, if
// an Off colour is configured, as explicitly "not pressed" while it is off.
//
// Note Toolbar (https://github.com/chrisgurney/obsidian-note-toolbar) exposes no
// public API for third-party styling, so this reads its plugin instance and
// settings directly. That is an undocumented coupling: the shapes below are
// deliberately minimal (only the fields actually read) and every access is
// defensive, so a Note Toolbar release that changes its internals degrades to
// "the highlight stops applying", never a crash. Adapted from the equivalent
// module in the note-capture plugin.

import type { App } from 'obsidian';

import type { ToolbarHighlight } from '../core/settings';
import { toolbarHighlightColor } from '../core/settings';

// Item types that render as structure rather than a button, so there is nothing
// to colour.
const SKIP_ITEM_TYPES = new Set(['separator', 'break', 'spreader', 'group']);

// Marks an element this plugin has coloured, so the next refresh can find and
// undo its own work without knowing where the element came from.
const HIGHLIGHT_CLASS = 'mdann-toolbar-highlight';

export interface ToolbarItemInfo {
	uuid: string;
	label: string;
	tooltip: string;
	icon: string;
}

export interface ToolbarInfo {
	uuid: string;
	name: string;
}

interface NoteToolbarItemShape {
	uuid?: unknown;
	label?: unknown;
	tooltip?: unknown;
	icon?: unknown;
	linkAttr?: { type?: unknown };
}

interface NoteToolbarToolbarShape {
	uuid?: unknown;
	name?: unknown;
	items?: unknown;
}

interface NoteToolbarPluginShape {
	settings?: { toolbars?: unknown };
}

interface AppWithPlugins extends App {
	plugins?: {
		enabledPlugins?: Set<string>;
		plugins?: Record<string, unknown>;
	};
}

function getNoteToolbarPlugin(app: App): NoteToolbarPluginShape | null {
	const registry = (app as AppWithPlugins).plugins;
	if (!registry?.enabledPlugins?.has('note-toolbar')) return null;
	const plugin = registry.plugins?.['note-toolbar'];
	return plugin !== null && typeof plugin === 'object' ? plugin : null;
}

function rawToolbars(app: App): NoteToolbarToolbarShape[] {
	const toolbars = getNoteToolbarPlugin(app)?.settings?.toolbars;
	return Array.isArray(toolbars) ? (toolbars as NoteToolbarToolbarShape[]) : [];
}

function rawItems(toolbar: NoteToolbarToolbarShape): NoteToolbarItemShape[] {
	return Array.isArray(toolbar.items) ? (toolbar.items as NoteToolbarItemShape[]) : [];
}

// Is Note Toolbar installed and enabled? The settings tab hides the whole
// section when it is not, rather than offering dropdowns that cannot fill.
export function isNoteToolbarAvailable(app: App): boolean {
	return getNoteToolbarPlugin(app) !== null;
}

export function listToolbars(app: App): ToolbarInfo[] {
	return rawToolbars(app)
		.filter((t): t is NoteToolbarToolbarShape & { uuid: string } => typeof t.uuid === 'string')
		.map((t) => ({
			uuid: t.uuid,
			name: typeof t.name === 'string' && t.name !== '' ? t.name : '(untitled toolbar)',
		}));
}

// Items in `toolbarUuid` that can carry a visible colour.
export function listHighlightableItems(app: App, toolbarUuid: string): ToolbarItemInfo[] {
	const toolbar = rawToolbars(app).find((t) => t.uuid === toolbarUuid);
	if (!toolbar) return [];
	return rawItems(toolbar)
		.filter((i): i is NoteToolbarItemShape & { uuid: string } => typeof i.uuid === 'string')
		.filter((i) => {
			const type = i.linkAttr?.type;
			return typeof type === 'string' && !SKIP_ITEM_TYPES.has(type);
		})
		.filter(
			(i) =>
				(typeof i.label === 'string' && i.label !== '') ||
				(typeof i.icon === 'string' && i.icon !== ''),
		)
		.map((i) => ({
			uuid: i.uuid,
			label: typeof i.label === 'string' ? i.label : '',
			tooltip: typeof i.tooltip === 'string' ? i.tooltip : '',
			icon: typeof i.icon === 'string' ? i.icon : '',
		}));
}

export function itemDisplayName(item: ToolbarItemInfo): string {
	return item.label || item.tooltip || item.icon || '(untitled item)';
}

// One configured target and whether its toggle is currently on.
export interface HighlightTarget {
	highlight: ToolbarHighlight;
	active: boolean;
}

// Applies (and clears) the configured colours on Note Toolbar's rendered items.
// Note Toolbar renders each toolbar into a container whose DOM `id` equals the
// toolbar's uuid, with items as `<li data-index="N">` in the same order as
// `toolbar.items` — so a live element is found by index, which survives label
// and icon edits in Note Toolbar's own settings.
export class ToolbarHighlighter {
	constructor(
		private readonly app: App,
		private readonly getTargets: () => HighlightTarget[],
	) {}

	// Re-applies every target for the current toggle states. Cheap and
	// idempotent, so it is safe to call on any workspace event.
	refresh(): void {
		this.clear();
		// Both states are painted now, so an inactive target is no longer
		// filtered out here — an Off colour left switched off simply resolves
		// to '' below and the item is skipped.
		const targets = this.getTargets().filter(
			(t) => t.highlight.toolbarUuid !== '' && t.highlight.itemUuid !== '',
		);
		if (targets.length === 0) return;

		const containers = this.toolbarContainers();
		if (containers.length === 0) return;

		for (const { highlight, active } of targets) {
			const toolbar = rawToolbars(this.app).find((t) => t.uuid === highlight.toolbarUuid);
			if (!toolbar) continue;
			const index = rawItems(toolbar).findIndex((i) => i.uuid === highlight.itemUuid);
			if (index === -1) continue;

			for (const container of containers) {
				if (container.id !== highlight.toolbarUuid) continue;
				const target = container.querySelector<HTMLElement>(`li[data-index="${index}"]`)
					?.firstElementChild;
				if (!(target instanceof HTMLElement)) continue;
				// Read the theme off the element's own document so an item in a
				// popout window follows that window's theme.
				const dark = target.ownerDocument.body.classList.contains('theme-dark');
				const bg = toolbarHighlightColor(highlight, active, dark);
				if (bg === '') continue;
				target.addClass(HIGHLIGHT_CLASS);
				target.style.setProperty('background-color', bg);
			}
		}
	}

	// Removes every colour this plugin applied, wherever it currently lives.
	clear(): void {
		for (const container of this.toolbarContainers()) {
			for (const el of Array.from(
				container.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`),
			)) {
				el.removeClass(HIGHLIGHT_CLASS);
				el.style.removeProperty('background-color');
				el.style.removeProperty('color');
			}
		}
	}

	// Every rendered Note Toolbar container across the workspace. Walking the
	// leaves rather than one document means popout windows are covered too.
	private toolbarContainers(): HTMLElement[] {
		const containers: HTMLElement[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			containers.push(
				...Array.from(
					leaf.view.containerEl.querySelectorAll<HTMLElement>('.cg-note-toolbar-container'),
				),
			);
		});
		return containers;
	}
}
