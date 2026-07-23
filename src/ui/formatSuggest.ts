import type { App } from 'obsidian';
import { FuzzySuggestModal } from 'obsidian';

// Picker over format NAMES (formats are keyed by name in settings, and the
// annotation JSON "format" field stores that name).
export class FormatSuggestModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private names: string[],
		private onChoose: (name: string) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a format');
	}

	getItems(): string[] {
		return this.names;
	}

	getItemText(name: string): string {
		return name;
	}

	onChooseItem(name: string): void {
		this.onChoose(name);
	}
}
