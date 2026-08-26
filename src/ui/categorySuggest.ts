import type { App } from 'obsidian';
import { FuzzySuggestModal } from 'obsidian';

// Picker over category NAMES (categories are keyed by name in settings, and
// the annotation JSON "category" field stores that name).
export class CategorySuggestModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private names: string[],
		private onChoose: (name: string) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a category');
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
