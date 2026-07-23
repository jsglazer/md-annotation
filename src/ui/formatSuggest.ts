import type { App } from 'obsidian';
import { FuzzySuggestModal } from 'obsidian';
import type { AnnotationFormat } from '../core/settings';

export class FormatSuggestModal extends FuzzySuggestModal<AnnotationFormat> {
	constructor(
		app: App,
		private formats: AnnotationFormat[],
		private onChoose: (format: AnnotationFormat) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a format');
	}

	getItems(): AnnotationFormat[] {
		return this.formats;
	}

	getItemText(format: AnnotationFormat): string {
		return format.name === '' ? format.id : format.name;
	}

	onChooseItem(format: AnnotationFormat): void {
		this.onChoose(format);
	}
}
