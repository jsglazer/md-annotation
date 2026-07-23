// Settings tab, replicating annotation-manager's layout minus everything
// bracket-related: General / Annotations / Comments tabs, a per-format grid
// (Use toggle, editable name, Fr/Bg color cells with enable checkboxes per
// light/dark theme, font size, live sample text, delete-with-confirm), and
// the dedicated comment style grid. All persisted values are normalized by
// the pure core (normalizeHex / normalizeSettings); this file is
// presentation only.

import type { App } from 'obsidian';
import { Modal, Notice, PluginSettingTab, Setting } from 'obsidian';

import type { ColorOption, PartStyle, ThemedPartStyles } from './core/settings';
import {
	isUnsafeKey,
	isValidFontSize,
	makeFormatStyle,
	normalizeHex,
} from './core/settings';
import type MdAnnotationPlugin from './main';

function isValidHex(v: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(v);
}

function enabledColor(opt: ColorOption): string {
	return opt.enabled && isValidHex(opt.color) ? opt.color : '';
}

export class MdAnnotationSettingTab extends PluginSettingTab {
	private pendingFormatName = '';
	private activeTab: 'general' | 'annotations' | 'comments' = 'general';

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
		const tabs: Array<{ id: 'general' | 'annotations' | 'comments'; label: string }> = [
			{ id: 'general', label: 'General' },
			{ id: 'annotations', label: 'Annotations' },
			{ id: 'comments', label: 'Comments' },
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

// Simple Yes/No confirmation modal, used before destructive actions like
// deleting a format's configured style.
class ConfirmModal extends Modal {
	constructor(
		app: App,
		private message: string,
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl('p', { text: this.message });

		const buttonRow = this.contentEl.createDiv('mdann-confirm-buttons');
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = buttonRow.createEl('button', { text: 'Delete', cls: 'mod-warning' });
		confirmBtn.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
