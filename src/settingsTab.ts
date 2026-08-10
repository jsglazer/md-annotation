// Settings tab, replicating annotation-manager's layout minus everything
// bracket-related: General / Annotations / Comments tabs, a per-format grid
// (Use toggle, editable name, Fr/Bg color cells with enable checkboxes per
// light/dark theme, font size, live sample text, delete-with-confirm), and
// the dedicated comment style grid. All persisted values are normalized by
// the pure core (normalizeHex / normalizeSettings); this file is
// presentation only.

import type { App } from 'obsidian';
import { Modal, Notice, PluginSettingTab, Setting } from 'obsidian';

import type {
	ColorOption,
	GutterSide,
	PartStyle,
	ThemedPartStyles,
	ToolbarHighlight,
} from './core/settings';
import {
	GUTTER_MAX_WIDTH,
	GUTTER_MIN_WIDTH,
	clampGutterWidth,
	exportFormats,
	isUnsafeKey,
	isValidFontSize,
	makeFormatStyle,
	mergeFormats,
	normalizeHex,
	parseFormatsImport,
} from './core/settings';
import type MdAnnotationPlugin from './main';
import {
	isNoteToolbarAvailable,
	itemDisplayName,
	listHighlightableItems,
	listToolbars,
} from './ui/toolbarHighlight';

type TabId = 'general' | 'annotations' | 'comments' | 'gutter';

// A slider reports every step of a drag; persist once the drag settles.
const SLIDER_SAVE_DEBOUNCE_MS = 250;

function isValidHex(v: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(v);
}

function enabledColor(opt: ColorOption): string {
	return opt.enabled && isValidHex(opt.color) ? opt.color : '';
}

export class MdAnnotationSettingTab extends PluginSettingTab {
	private pendingFormatName = '';
	private activeTab: TabId = 'general';
	private saveTimer: number | null = null;

	constructor(
		app: App,
		private plugin: MdAnnotationPlugin,
	) {
		super(app, plugin);
	}

	private isDarkTheme(): boolean {
		return this.containerEl.ownerDocument.body.classList.contains('theme-dark');
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('mdann-settings');

		containerEl.createDiv({
			cls: 'mdann-settings-version',
			text: `MD Annotation v${this.plugin.manifest.version}`,
		});

		const tabBar = containerEl.createDiv('mdann-tab-bar');
		const tabs: Array<{ id: TabId; label: string }> = [
			{ id: 'general', label: 'General' },
			{ id: 'annotations', label: 'Annotations' },
			{ id: 'comments', label: 'Comments' },
			{ id: 'gutter', label: 'Gutter' },
		];
		for (const tab of tabs) {
			const btn = tabBar.createEl('button', {
				text: tab.label,
				cls: 'mdann-tab-btn' + (this.activeTab === tab.id ? ' mdann-tab-btn-active' : ''),
			});
			btn.addEventListener('click', () => {
				this.activeTab = tab.id;
				this.display();
			});
		}

		if (this.activeTab === 'annotations') {
			this.renderAnnotationsTab(containerEl);
			return;
		}
		if (this.activeTab === 'comments') {
			this.renderCommentsTab(containerEl);
			return;
		}
		if (this.activeTab === 'gutter') {
			this.renderGutterTab(containerEl);
			return;
		}
		this.renderGeneralTab(containerEl);
	}

	private async saveAndRefresh(): Promise<void> {
		await this.plugin.saveSettings();
	}

	// ── General tab ──────────────────────────────────────────────────────────

	private renderGeneralTab(containerEl: HTMLElement): void {
		const infoPanel = containerEl.createDiv({ cls: 'mdann-info-panel' });
		const p1 = infoPanel.createEl('p');
		p1.appendText('If you encounter errors or have questions, please submit an Issue on the ');
		p1.createEl('a', {
			text: 'GitHub page',
			href: 'https://github.com/jsglazer/md-annotation',
			attr: { target: '_blank', rel: 'noopener' },
		});
		p1.appendText('.');
		const p2 = infoPanel.createEl('p');
		p2.appendText(
			'Annotations and comments are queryable from dataviewjs / datacorejs via ',
		);
		p2.createEl('code', { text: "app.plugins.plugins['md-annotation'].api" });
		p2.appendText('.');

		new Setting(containerEl)
			.setName('Author')
			.setDesc('Name recorded on every annotation and comment you create')
			.addText((text) =>
				text.setValue(this.plugin.settings.author).onChange(async (value) => {
					this.plugin.settings.author = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		this.renderNavigationSection(containerEl);
		this.renderFormatTransferSection(containerEl);
	}

	// ── Gutter tab ───────────────────────────────────────────────────────────

	// Everything about the margin gutter in one place: what it shows, which
	// margin each type uses, how wide it is, and the optional Note Toolbar
	// items that light up while it is on.
	private renderGutterTab(containerEl: HTMLElement): void {
		containerEl.createEl('p', {
			text:
				'Notes can be shown as cards in the margin, level with the line they are ' +
				'anchored to, and edited in place — in Live Preview, Source mode and Reading ' +
				'view. A gutter is dropped automatically while a pane is too narrow to give ' +
				'up the space.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl).setName('Annotation gutter').setHeading();
		this.renderToggle(
			containerEl,
			'Show annotations in the gutter',
			'Show each annotation\'s note as a card in the margin beside its line (also toggled by the "Show/hide annotations in the gutter" command)',
			() => this.plugin.settings.gutterAnnotationsEnabled,
			(v) => {
				this.plugin.settings.gutterAnnotationsEnabled = v;
			},
		);
		this.renderGutterSide(
			containerEl,
			'Annotation gutter side',
			'Which margin annotation cards sit in',
			() => this.plugin.settings.gutterAnnotationsSide,
			(v) => {
				this.plugin.settings.gutterAnnotationsSide = v;
			},
		);

		new Setting(containerEl).setName('Comment gutter').setHeading();
		this.renderToggle(
			containerEl,
			'Show comments in the gutter',
			'Show each comment as a card in the margin beside its marker (also toggled by the "Show/hide comments in the gutter" command)',
			() => this.plugin.settings.gutterCommentsEnabled,
			(v) => {
				this.plugin.settings.gutterCommentsEnabled = v;
			},
		);
		this.renderGutterSide(
			containerEl,
			'Comment gutter side',
			'Which margin comment cards sit in',
			() => this.plugin.settings.gutterCommentsSide,
			(v) => {
				this.plugin.settings.gutterCommentsSide = v;
			},
		);

		new Setting(containerEl).setName('Size').setHeading();
		new Setting(containerEl)
			.setName('Gutter width')
			.setDesc('Room each gutter takes from the note, in pixels')
			.addSlider((slider) =>
				slider
					.setLimits(GUTTER_MIN_WIDTH, GUTTER_MAX_WIDTH, 10)
					.setValue(clampGutterWidth(this.plugin.settings.gutterWidth))
					.setDynamicTooltip()
					.onChange((value) => {
						// Sliders fire continuously; saving on every step would
						// redecorate every editor mid-drag.
						this.plugin.settings.gutterWidth = clampGutterWidth(value);
						this.saveDebounced();
					}),
			);

		this.renderToolbarHighlightSection(containerEl);
	}

	// Note Toolbar has no API for third-party styling, so the section simply
	// disappears when it is not installed — there is nothing to point at.
	private renderToolbarHighlightSection(containerEl: HTMLElement): void {
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- 'Note Toolbar' is the plugin's own name
		new Setting(containerEl).setName('Note Toolbar buttons').setHeading();

		if (!isNoteToolbarAvailable(this.app)) {
			containerEl.createEl('p', {
				text:
					'Install and enable the Note Toolbar plugin to have one of its buttons change ' +
					'colour while a gutter is showing.',
				cls: 'setting-item-description',
			});
			return;
		}

		containerEl.createEl('p', {
			text:
				'Pick the toolbar button that runs each "Show/hide … in the gutter" command and ' +
				'it will take the colours below while that gutter is on, so the toolbar reads ' +
				'as pressed. A gutter that is off leaves its button to Note Toolbar.',
			cls: 'setting-item-description',
		});

		this.renderToolbarItemPicker(
			containerEl,
			'Annotations button',
			this.plugin.settings.gutterAnnotationsToolbar,
		);
		this.renderToolbarItemPicker(
			containerEl,
			'Comments button',
			this.plugin.settings.gutterCommentsToolbar,
		);

		this.renderToolbarHighlightGrid(containerEl);
	}

	// Toolbar + item dropdowns for one of the two buttons. Changing the toolbar
	// clears the item, since item uuids belong to a single toolbar.
	private renderToolbarItemPicker(
		containerEl: HTMLElement,
		name: string,
		highlight: ToolbarHighlight,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc('Toolbar, then the button within it')
			.addDropdown((dropdown) => {
				dropdown.addOption('', 'None');
				for (const toolbar of listToolbars(this.app)) {
					dropdown.addOption(toolbar.uuid, toolbar.name);
				}
				dropdown.setValue(highlight.toolbarUuid).onChange(async (value) => {
					highlight.toolbarUuid = value;
					highlight.itemUuid = '';
					await this.saveAndRefresh();
					this.display();
				});
			})
			.addDropdown((dropdown) => {
				const items = highlight.toolbarUuid
					? listHighlightableItems(this.app, highlight.toolbarUuid)
					: [];
				dropdown.addOption('', items.length === 0 ? 'No buttons' : 'None');
				for (const item of items) dropdown.addOption(item.uuid, itemDisplayName(item));
				dropdown.setDisabled(items.length === 0);
				dropdown.setValue(highlight.itemUuid).onChange(async (value) => {
					highlight.itemUuid = value;
					await this.saveAndRefresh();
				});
			});
	}

	// The two colour rows, laid out like the format grid so Fr/Bg per theme
	// read the same way here as everywhere else in these settings.
	private renderToolbarHighlightGrid(containerEl: HTMLElement): void {
		const wrap = containerEl.createDiv('mdann-grid-wrap');
		const table = wrap.createEl('table', { cls: 'mdann-grid-table' });
		const thead = table.createEl('thead');

		const r1 = thead.createEl('tr');
		r1.createEl('th', { text: 'Button', attr: { rowspan: '2' }, cls: 'mdann-grid-name-h' });
		r1.createEl('th', { text: 'Light', attr: { colspan: '2' }, cls: 'mdann-grid-sep' });
		r1.createEl('th', { text: 'Dark', attr: { colspan: '2' }, cls: 'mdann-grid-sep' });
		r1.createEl('th', { text: 'Example', attr: { rowspan: '2' }, cls: 'mdann-grid-sep' });

		const r2 = thead.createEl('tr');
		for (let i = 0; i < 4; i++) {
			r2.createEl('th', { text: i % 2 === 0 ? 'Fr' : 'Bg', cls: i % 2 === 0 ? 'mdann-grid-sep' : '' });
		}

		const tbody = table.createEl('tbody');
		this.renderToolbarHighlightRow(tbody, 'Annotations', this.plugin.settings.gutterAnnotationsToolbar);
		this.renderToolbarHighlightRow(tbody, 'Comments', this.plugin.settings.gutterCommentsToolbar);
	}

	private renderToolbarHighlightRow(
		tbody: HTMLElement,
		label: string,
		highlight: ToolbarHighlight,
	): void {
		const tr = tbody.createEl('tr');
		tr.createEl('td', { text: label, cls: 'mdann-grid-name' });

		let exampleTd: HTMLElement | null = null;
		const refreshExample = (): void => {
			if (!exampleTd) return;
			exampleTd.empty();
			const part: PartStyle = highlight.style[this.isDarkTheme() ? 'dark' : 'light'];
			this.appendExampleSpan(exampleTd, label, enabledColor(part.fr), enabledColor(part.bg), '');
		};

		for (const theme of ['light', 'dark'] as const) {
			for (const field of ['fr', 'bg'] as const) {
				const td = tr.createEl('td', { cls: field === 'fr' ? 'mdann-grid-sep' : '' });
				this.renderColorCell(td, highlight.style[theme][field], refreshExample);
			}
		}

		exampleTd = tr.createEl('td', { cls: 'mdann-grid-example mdann-grid-sep' });
		refreshExample();
	}

	private saveDebounced(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveAndRefresh();
		}, SLIDER_SAVE_DEBOUNCE_MS);
	}

	// Left/right chooser for one annotation type's gutter cards.
	private renderGutterSide(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		getValue: () => GutterSide,
		setValue: (v: GutterSide) => void,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('left', 'Left')
					.addOption('right', 'Right')
					.setValue(getValue())
					.onChange(async (value) => {
						setValue(value === 'left' ? 'left' : 'right');
						await this.saveAndRefresh();
					}),
			);
	}

	// The three text ⇄ sidebar navigation behaviours, each independently
	// switchable. All default on.
	private renderNavigationSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Navigation').setHeading();

		this.renderToggle(
			containerEl,
			'Sync text and sidebar',
			'Moving the cursor in the note scrolls the sidebar to the nearest entry (also toggled by the "Sync text and sidebar" command)',
			() => this.plugin.settings.syncTextAndSidebar,
			(v) => {
				this.plugin.settings.syncTextAndSidebar = v;
			},
		);
		this.renderToggle(
			containerEl,
			'Sidebar click jumps to text',
			'Clicking an annotation or comment entry in the sidebar selects and scrolls to that text in the note',
			() => this.plugin.settings.sidebarClickJumpsToText,
			(v) => {
				this.plugin.settings.sidebarClickJumpsToText = v;
			},
		);
		this.renderToggle(
			containerEl,
			'Text click jumps to sidebar',
			'Clicking annotated text or a comment marker opens the sidebar, scrolls to that entry and puts the cursor in its comment box',
			() => this.plugin.settings.textClickJumpsToSidebar,
			(v) => {
				this.plugin.settings.textClickJumpsToSidebar = v;
			},
		);
	}

	// Formats are stored in this vault's own data.json. Obsidian Sync replicates
	// a vault to itself on other devices — it never bridges two different vaults
	// — so moving formats between vaults is an explicit copy/paste.
	private renderFormatTransferSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Share formats between vaults').setHeading();
		containerEl.createEl('p', {
			text:
				'Formats live in this vault only. Obsidian Sync copies a vault to your other ' +
				'devices, not to your other vaults, so formats added in one vault never appear ' +
				'in another. Export them here and import the result in the other vault.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Export formats')
			.setDesc('Copy every format (and the comment style) to the clipboard as JSON')
			.addButton((btn) =>
				btn.setButtonText('Copy to clipboard').onClick(() => {
					const json = exportFormats(this.plugin.settings);
					void navigator.clipboard.writeText(json).then(
						() => {
							const count = Object.keys(this.plugin.settings.formatStyles).length;
							new Notice(`Copied ${count} format${count === 1 ? '' : 's'} to the clipboard`);
						},
						() => new Notice('Could not write to the clipboard'),
					);
				}),
			);

		new Setting(containerEl)
			.setName('Import formats')
			.setDesc('Paste an exported payload to add its formats to this vault')
			.addButton((btn) =>
				btn
					.setButtonText('Paste and import')
					.setCta()
					.onClick(() => {
						new ImportFormatsModal(this.app, (text, mode) => this.importFormats(text, mode)).open();
					}),
			);
	}

	// Returns an outcome message for the modal; null means the import ran and
	// the modal can close.
	private importFormats(text: string, mode: 'merge' | 'replace'): string | null {
		const parsed = parseFormatsImport(text);
		if (!parsed) return 'That does not look like an exported format payload.';

		const result = mergeFormats(this.plugin.settings.formatStyles, parsed.formatStyles, mode);
		this.plugin.settings.formatStyles = result.formatStyles;
		if (parsed.commentStyle) this.plugin.settings.commentStyle = parsed.commentStyle;

		void this.saveAndRefresh().then(() => this.display());

		const added = result.added.length;
		const skipped = result.skipped.length;
		new Notice(
			mode === 'replace'
				? `Replaced formats with ${added} imported format${added === 1 ? '' : 's'}`
				: `Imported ${added} format${added === 1 ? '' : 's'}` +
					(skipped > 0 ? `, kept ${skipped} already here` : ''),
		);
		return null;
	}

	// ── Annotations tab ──────────────────────────────────────────────────────

	private renderAnnotationsTab(containerEl: HTMLElement): void {
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- heading text specified by design
		new Setting(containerEl).setName('Annotation Visibility').setHeading();
		this.renderToggle(
			containerEl,
			'Annotation formatting',
			'Apply format colors to annotated text (also toggled by the "Show/hide annotation formats" command)',
			() => this.plugin.settings.annotationFormattingEnabled,
			(v) => {
				this.plugin.settings.annotationFormattingEnabled = v;
			},
		);

		containerEl.createEl('p', {
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- 'Gutter' names a tab in this settings pane
			text: 'Margin cards for annotations live on the Gutter tab.',
			cls: 'setting-item-description',
		});

		// eslint-disable-next-line obsidianmd/ui/sentence-case -- heading text specified by design
		new Setting(containerEl).setName('Annotation Formats').setHeading();
		containerEl.createEl('p', {
			text:
				'Per-format colors for annotations. Fr = text color, Bg = background. ' +
				'Each checkbox controls whether that color is applied. Uncheck Use to disable ' +
				'a row without deleting it. Renaming a format also updates every note that ' +
				'references the old name.',
			cls: 'setting-item-description',
		});

		this.renderFormatGrid(containerEl);

		new Setting(containerEl)
			.setName('Add format')
			.setDesc('Name shown in the format picker and stored on each annotation')
			.addText((text) =>
				text.setPlaceholder('Key').onChange((v) => {
					this.pendingFormatName = v.trim();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText('Add')
					.setCta()
					.onClick(async () => {
						const name = this.pendingFormatName;
						if (!name || isUnsafeKey(name) || this.plugin.settings.formatStyles[name]) return;
						this.plugin.settings.formatStyles[name] = makeFormatStyle();
						await this.saveAndRefresh();
						this.display();
					}),
			);
	}

	private renderFormatGrid(containerEl: HTMLElement): void {
		const names = Object.keys(this.plugin.settings.formatStyles).sort();
		if (names.length === 0) {
			containerEl.createEl('p', {
				text: 'No formats configured yet — add one below.',
				cls: 'setting-item-description',
			});
			return;
		}

		const wrap = containerEl.createDiv('mdann-grid-wrap');
		const table = wrap.createEl('table', { cls: 'mdann-grid-table' });
		const thead = table.createEl('thead');

		const r1 = thead.createEl('tr');
		r1.createEl('th', { text: 'Use', attr: { rowspan: '2' } });
		r1.createEl('th', { text: 'Name', attr: { rowspan: '2' }, cls: 'mdann-grid-name-h' });
		r1.createEl('th', { text: 'Light', attr: { colspan: '2' }, cls: 'mdann-grid-sep' });
		r1.createEl('th', { text: 'Dark', attr: { colspan: '2' }, cls: 'mdann-grid-sep' });
		r1.createEl('th', { text: 'Size', attr: { rowspan: '2' }, cls: 'mdann-grid-sep' });
		r1.createEl('th', { text: 'Example', attr: { rowspan: '2' } });
		r1.createEl('th', { text: '', attr: { rowspan: '2' } });

		const r2 = thead.createEl('tr');
		for (let i = 0; i < 4; i++) {
			r2.createEl('th', {
				text: i % 2 === 0 ? 'Fr' : 'Bg',
				cls: i % 2 === 0 ? 'mdann-grid-sep' : '',
			});
		}

		const tbody = table.createEl('tbody');
		for (const name of names) this.renderFormatRow(tbody, name);
	}

	private renderFormatRow(tbody: HTMLElement, name: string): void {
		const style = this.plugin.settings.formatStyles[name];
		if (!style) return;

		const tr = tbody.createEl('tr');
		tr.toggleClass('mdann-grid-row-unused', !style.use);

		const useTd = tr.createEl('td');
		const useCheck = useTd.createEl('input', {
			attr: { type: 'checkbox' },
			cls: 'mdann-grid-check',
		});
		useCheck.checked = style.use;
		useCheck.addEventListener('change', () => {
			style.use = useCheck.checked;
			tr.toggleClass('mdann-grid-row-unused', !style.use);
			void this.saveAndRefresh();
		});

		this.renderFormatNameCell(tr, name);

		let exampleTd: HTMLElement | null = null;
		const refreshExample = () => {
			if (exampleTd) this.renderFormatExample(exampleTd, name);
		};

		for (const theme of ['light', 'dark'] as const) {
			for (const field of ['fr', 'bg'] as const) {
				const td = tr.createEl('td', { cls: field === 'fr' ? 'mdann-grid-sep' : '' });
				this.renderColorCell(td, style[theme][field], refreshExample);
			}
		}

		const sizeTd = tr.createEl('td', { cls: 'mdann-grid-sep' });
		const sizeInput = sizeTd.createEl('input', {
			cls: 'mdann-grid-size-input',
			attr: { type: 'text', placeholder: '—' },
		});
		sizeInput.value = style.fontSize;
		sizeInput.addEventListener('change', () => {
			style.fontSize = sizeInput.value.trim();
			void this.saveAndRefresh();
			refreshExample();
		});

		exampleTd = tr.createEl('td', { cls: 'mdann-grid-example' });
		refreshExample();

		const delTd = tr.createEl('td');
		const delBtn = delTd.createEl('button', { text: 'Del', cls: 'mdann-grid-del' });
		delBtn.addEventListener('click', () => {
			if (Object.keys(this.plugin.settings.formatStyles).length <= 1) {
				new Notice('At least one format must remain');
				return;
			}
			new ConfirmModal(this.app, `Delete the format "${name}"? This cannot be undone.`, () => {
				delete this.plugin.settings.formatStyles[name];
				void this.saveAndRefresh().then(() => this.display());
			}).open();
		});
	}

	// Editable name cell: renaming a format moves its style to the new key AND
	// rewrites the stored name in every annotated note (plugin.renameFormat).
	// Validates against blanks, prototype-unsafe keys, and existing names; on
	// a bad name the input reverts to the original and a Notice explains why.
	private renderFormatNameCell(tr: HTMLElement, name: string): void {
		const td = tr.createEl('td', { cls: 'mdann-grid-name' });
		const input = td.createEl('input', {
			cls: 'mdann-grid-name-input',
			attr: { type: 'text', spellcheck: 'false' },
		});
		input.value = name;

		const commit = () => {
			const next = input.value.trim();
			if (next === name) {
				input.value = name;
				return;
			}
			const styles = this.plugin.settings.formatStyles;
			if (!next || isUnsafeKey(next) || styles[next]) {
				new Notice(
					!next
						? 'Format name cannot be empty'
						: styles[next]
							? `Format "${next}" already exists`
							: `"${next}" is not a valid format name`,
				);
				input.value = name;
				return;
			}
			void this.plugin.renameFormat(name, next).then((ok) => {
				if (!ok) input.value = name;
				this.display();
			});
		};

		input.addEventListener('change', commit);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			} else if (e.key === 'Escape') {
				input.value = name;
				input.blur();
			}
		});
	}

	private renderFormatExample(td: HTMLElement, name: string): void {
		td.empty();
		const style = this.plugin.settings.formatStyles[name];
		if (!style) return;
		const theme = this.isDarkTheme() ? 'dark' : 'light';
		this.appendExampleSpan(
			td,
			'Sample text',
			enabledColor(style[theme].fr),
			enabledColor(style[theme].bg),
			isValidFontSize(style.fontSize) ? style.fontSize.trim() : '',
		);
	}

	private appendExampleSpan(
		td: HTMLElement,
		text: string,
		color: string,
		backgroundColor: string,
		fontSize: string,
	): void {
		const span = td.createEl('span', { text });
		span.setCssStyles({ color, backgroundColor, fontSize });
	}

	// One cell bound to a ColorOption: a checkbox, a swatch (native picker), and
	// an editable hex field. The hex field is the primary way to read/set the
	// color — type or paste #rrggbb (the # is optional) and the swatch follows.
	// Setting a color by either control auto-enables the checkbox; the checkbox
	// alone toggles whether the stored color is applied.
	private renderColorCell(td: HTMLElement, opt: ColorOption, onChanged: () => void): void {
		const wrap = td.createDiv('mdann-grid-cell');
		const check = wrap.createEl('input', { attr: { type: 'checkbox' }, cls: 'mdann-grid-check' });
		check.checked = opt.enabled;
		const picker = wrap.createEl('input', { attr: { type: 'color' }, cls: 'mdann-grid-color' });
		picker.value = isValidHex(opt.color) ? opt.color : '#888888';
		const hex = wrap.createEl('input', {
			cls: 'mdann-grid-hex',
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- '#hex' is a hex-notation placeholder, not prose
			attr: { type: 'text', maxlength: '7', placeholder: '#hex', spellcheck: 'false' },
		});
		hex.value = isValidHex(opt.color) ? opt.color : '';

		const autoEnable = () => {
			if (!opt.enabled) {
				opt.enabled = true;
				check.checked = true;
			}
		};

		check.addEventListener('change', () => {
			opt.enabled = check.checked;
			if (opt.enabled && !isValidHex(opt.color)) {
				opt.color = picker.value;
				hex.value = picker.value;
			}
			void this.saveAndRefresh();
			onChanged();
		});
		// 'input' fires continuously while dragging in the color dialog — update
		// the example/hex live but only persist on 'change' (dialog closed).
		picker.addEventListener('input', () => {
			opt.color = picker.value;
			hex.value = picker.value;
			autoEnable();
			onChanged();
		});
		picker.addEventListener('change', () => {
			opt.color = picker.value;
			hex.value = picker.value;
			void this.saveAndRefresh();
			onChanged();
		});
		// Update the swatch/example live as a valid hex is typed; persist on
		// 'change' (blur/Enter). An invalid or blank entry reverts on blur.
		hex.addEventListener('input', () => {
			const norm = normalizeHex(hex.value);
			if (!norm) return;
			opt.color = norm;
			picker.value = norm;
			autoEnable();
			onChanged();
		});
		hex.addEventListener('change', () => {
			const norm = normalizeHex(hex.value);
			if (norm) {
				hex.value = norm;
				opt.color = norm;
				picker.value = norm;
				autoEnable();
				void this.saveAndRefresh();
				onChanged();
			} else {
				hex.value = isValidHex(opt.color) ? opt.color : '';
			}
		});
	}

	// ── Comments tab ─────────────────────────────────────────────────────────

	private renderCommentsTab(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Comment visibility').setHeading();

		this.renderToggle(
			containerEl,
			'Hide comment markers',
			'Hide comment markers entirely in Live Preview and Reading view',
			() => this.plugin.settings.commentsHiddenEnabled,
			(v) => {
				this.plugin.settings.commentsHiddenEnabled = v;
			},
		);
		this.renderToggle(
			containerEl,
			'Comment formatting',
			'Apply the comment colors to markers (also toggled by the "Show/hide comment formats" command)',
			() => this.plugin.settings.commentsFormattingEnabled,
			(v) => {
				this.plugin.settings.commentsFormattingEnabled = v;
			},
		);

		containerEl.createEl('p', {
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- 'Gutter' names a tab in this settings pane
			text: 'Margin cards for comments live on the Gutter tab.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl).setName('Comment format').setHeading();
		containerEl.createEl('p', {
			text:
				'Colors for comment markers (comments are added with no text selected and ' +
				'render as a small icon at the insertion point). Fr = icon color, Bg = background.',
			cls: 'setting-item-description',
		});

		this.renderCommentGrid(containerEl, this.plugin.settings.commentStyle);
	}

	private renderCommentGrid(containerEl: HTMLElement, style: ThemedPartStyles): void {
		const wrap = containerEl.createDiv('mdann-grid-wrap');
		const table = wrap.createEl('table', { cls: 'mdann-grid-table' });
		const thead = table.createEl('thead');

		const r1 = thead.createEl('tr');
		r1.createEl('th', { text: 'Light', attr: { colspan: '2' } });
		r1.createEl('th', { text: 'Dark', attr: { colspan: '2' }, cls: 'mdann-grid-sep' });
		r1.createEl('th', { text: 'Example', attr: { rowspan: '2' }, cls: 'mdann-grid-sep' });

		const r2 = thead.createEl('tr');
		for (let i = 0; i < 4; i++) {
			r2.createEl('th', {
				text: i % 2 === 0 ? 'Fr' : 'Bg',
				cls: i > 0 && i % 2 === 0 ? 'mdann-grid-sep' : '',
			});
		}

		const tbody = table.createEl('tbody');
		const tr = tbody.createEl('tr');

		let exampleTd: HTMLElement | null = null;
		const refreshExample = () => {
			if (!exampleTd) return;
			exampleTd.empty();
			const theme = this.isDarkTheme() ? 'dark' : 'light';
			const part: PartStyle = style[theme];
			this.appendExampleSpan(exampleTd, '💬 comment', enabledColor(part.fr), enabledColor(part.bg), '');
		};

		for (const theme of ['light', 'dark'] as const) {
			for (const field of ['fr', 'bg'] as const) {
				const td = tr.createEl('td', {
					cls: theme === 'dark' && field === 'fr' ? 'mdann-grid-sep' : '',
				});
				this.renderColorCell(td, style[theme][field], refreshExample);
			}
		}

		exampleTd = tr.createEl('td', { cls: 'mdann-grid-example mdann-grid-sep' });
		refreshExample();
	}

	// ── Shared small controls ────────────────────────────────────────────────

	private renderToggle(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		getValue: () => boolean,
		setValue: (v: boolean) => void,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle((toggle) =>
				toggle.setValue(getValue()).onChange(async (v) => {
					setValue(v);
					await this.saveAndRefresh();
				}),
			);
	}
}

// Paste target for an exported format payload. Merge adds only names this
// vault does not already have (never touching a format you have tuned here);
// Replace swaps the whole set, so it is confirmed separately.
class ImportFormatsModal extends Modal {
	constructor(
		app: App,
		private onImport: (text: string, mode: 'merge' | 'replace') => string | null,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl('h3', { text: 'Import formats' });
		this.contentEl.createEl('p', {
			text: 'Paste the JSON copied by the export button in the other vault.',
			cls: 'setting-item-description',
		});

		const input = this.contentEl.createEl('textarea', {
			cls: 'mdann-import-input',
			attr: { rows: '10', placeholder: '{ "version": 1, "formatStyles": { … } }', spellcheck: 'false' },
		});
		const error = this.contentEl.createEl('p', { cls: 'mdann-import-error' });

		const run = (mode: 'merge' | 'replace') => {
			const message = this.onImport(input.value, mode);
			if (message === null) {
				this.close();
				return;
			}
			error.setText(message);
		};

		const buttonRow = this.contentEl.createDiv('mdann-confirm-buttons');
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const replaceBtn = buttonRow.createEl('button', { text: 'Replace all', cls: 'mod-warning' });
		replaceBtn.addEventListener('click', () => {
			new ConfirmModal(
				this.app,
				'Replace every format in this vault with the imported ones? Annotations using a format that is not in the payload will fall back to the first enabled format until you reassign them.',
				() => run('replace'),
				'Replace all',
			).open();
		});

		const mergeBtn = buttonRow.createEl('button', { text: 'Merge', cls: 'mod-cta' });
		mergeBtn.addEventListener('click', () => run('merge'));

		input.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// Simple Yes/No confirmation modal, used before destructive actions like
// deleting a format's configured style.
class ConfirmModal extends Modal {
	constructor(
		app: App,
		private message: string,
		private onConfirm: () => void,
		private confirmText = 'Delete',
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl('p', { text: this.message });

		const buttonRow = this.contentEl.createDiv('mdann-confirm-buttons');
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = buttonRow.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
		confirmBtn.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
