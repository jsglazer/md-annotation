// Settings tab: author identity, unlimited annotation formats (font +
// background color per light/dark theme), and the comment format policy.
// All persisted values are normalized by the pure core (normalizeHex /
// normalizeSettings); this file is presentation only.

import type { App } from 'obsidian';
import { PluginSettingTab, Setting } from 'obsidian';

import { generateAnnotationId } from './core/annotation';
import type { AnnotationFormat, FormatStyle, ThemeColors } from './core/settings';
import { normalizeHex } from './core/settings';
import type MdAnnotationPlugin from './main';

function isValidHex(v: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(v);
}

export class MdAnnotationSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: MdAnnotationPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('mdann-settings');

		new Setting(containerEl)
			.setName('Author')
			.setDesc('Name recorded on every annotation and comment you create')
			.addText((text) =>
				text.setValue(this.plugin.settings.author).onChange(async (value) => {
					this.plugin.settings.author = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('Annotation formats').setHeading();
		containerEl.createEl('p', {
			text: 'Each format defines font and background colors for the light and dark themes. Leave a color empty to inherit the theme default.',
			cls: 'setting-item-description',
		});
		for (const format of this.plugin.settings.formats) this.renderFormatRow(containerEl, format);

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText('Add format')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.formats.push({
						id: generateAnnotationId(Date.now(), Math.random()),
						name: 'New format',
						style: {
							light: { fontColor: '', backgroundColor: '' },
							dark: { fontColor: '', backgroundColor: '' },
						},
					});
					await this.plugin.saveSettings();
					this.display();
				}),
		);

		new Setting(containerEl).setName('Comments').setHeading();
		new Setting(containerEl)
			.setName('Comments use annotation formats')
			.setDesc('On: pick one of the formats above when adding a comment. Off: all comments use the single comment format below.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.commentUseAnnotationFormats).onChange(async (value) => {
					this.plugin.settings.commentUseAnnotationFormats = value;
					await this.plugin.saveSettings();
					this.display();
				}),
			);
		if (!this.plugin.settings.commentUseAnnotationFormats) {
			this.renderStyleGrid(containerEl, 'Comment format', this.plugin.settings.commentStyle);
		}
	}

	private renderFormatRow(containerEl: HTMLElement, format: AnnotationFormat): void {
		const setting = new Setting(containerEl).setClass('mdann-format-row');
		setting.addText((text) =>
			text
				.setPlaceholder('Name')
				.setValue(format.name)
				.onChange(async (value) => {
					format.name = value.trim();
					await this.plugin.saveSettings();
				}),
		);
		this.addColorControls(setting.controlEl, format.style);
		setting.addButton((btn) =>
			btn.setButtonText('Delete').onClick(async () => {
				if (this.plugin.settings.formats.length <= 1) return; // keep at least one
				this.plugin.settings.formats = this.plugin.settings.formats.filter(
					(f) => f.id !== format.id,
				);
				await this.plugin.saveSettings();
				this.display();
			}),
		);
	}

	private renderStyleGrid(containerEl: HTMLElement, label: string, style: FormatStyle): void {
		const setting = new Setting(containerEl).setName(label);
		this.addColorControls(setting.controlEl, style);
	}

	// Four color cells: light font/background, dark font/background.
	private addColorControls(controlEl: HTMLElement, style: FormatStyle): void {
		const grid = controlEl.createDiv({ cls: 'mdann-color-grid' });
		const cells: Array<{ label: string; colors: ThemeColors; key: keyof ThemeColors }> = [
			{ label: 'Light font', colors: style.light, key: 'fontColor' },
			{ label: 'Light bg', colors: style.light, key: 'backgroundColor' },
			{ label: 'Dark font', colors: style.dark, key: 'fontColor' },
			{ label: 'Dark bg', colors: style.dark, key: 'backgroundColor' },
		];
		for (const cell of cells) this.renderColorCell(grid, cell.label, cell.colors, cell.key);
	}

	private renderColorCell(
		grid: HTMLElement,
		label: string,
		colors: ThemeColors,
		key: keyof ThemeColors,
	): void {
		const wrap = grid.createDiv({ cls: 'mdann-color-cell' });
		wrap.createEl('span', { text: label, cls: 'mdann-color-label' });
		const picker = wrap.createEl('input', { attr: { type: 'color' }, cls: 'mdann-color-picker' });
		picker.value = isValidHex(colors[key]) ? colors[key] : '#888888';
		picker.addEventListener('change', () => {
			colors[key] = picker.value;
			void this.plugin.saveSettings();
		});
		const clear = wrap.createEl('button', { text: '✕', cls: 'mdann-color-clear' });
		clear.setAttribute('aria-label', `Clear ${label.toLowerCase()} color`);
		clear.addEventListener('click', () => {
			colors[key] = '';
			picker.value = '#888888';
			void this.plugin.saveSettings();
		});
		const hex = wrap.createEl('input', {
			cls: 'mdann-color-hex',
			attr: { type: 'text', maxlength: '7', placeholder: '—', spellcheck: 'false' },
		});
		hex.value = colors[key];
		hex.addEventListener('change', () => {
			const norm = normalizeHex(hex.value);
			colors[key] = norm;
			hex.value = norm;
			if (norm !== '') picker.value = norm;
			void this.plugin.saveSettings();
		});
	}
}
