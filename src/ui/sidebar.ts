// Sidebar panel: lists every annotation of the active note — matched
// highlights/comments, orphaned annotations flagged for repair, and
// unparseable block lines needing attention (e.g. after a sync conflict).

import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';

import { highlightClasses, highlightStyleVars } from '../core/settings';
import type { Annotation } from '../core/types';
import type { MatchResult } from '../core/matcher';
import type MdAnnotationPlugin from '../main';

export const SIDEBAR_VIEW_TYPE = 'md-annotation-sidebar';

export class AnnotationSidebarView extends ItemView {
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: MdAnnotationPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return SIDEBAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Annotations';
	}

	getIcon(): string {
		return 'highlighter';
	}

	onOpen(): Promise<void> {
		this.unsubscribe = this.plugin.onStateChange(() => this.render());
		this.render();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		return Promise.resolve();
	}

	private render(): void {
		// Don't rebuild the panel out from under an in-progress comment edit;
		// the next state change after blur re-renders.
		const active = this.contentEl.ownerDocument.activeElement;
		if (active && this.contentEl.contains(active) && active.tagName === 'TEXTAREA') return;

		const root = this.contentEl;
		root.empty();
		root.addClass('mdann-sidebar');

		const file = this.plugin.activeMarkdownFile();
		if (!file) {
			root.createEl('p', { text: 'Open a note to see its annotations.', cls: 'mdann-empty' });
			return;
		}
		const state = this.plugin.getState(file.path);
		root.createEl('div', { text: file.basename, cls: 'mdann-file-title' });
		if (!state || (state.annotations.length === 0 && state.unparseable.length === 0)) {
			root.createEl('p', { text: 'No annotations in this note yet.', cls: 'mdann-empty' });
			return;
		}

		const matched: Array<{ annotation: Annotation; start: number }> = [];
		const orphaned: Annotation[] = [];
		for (const annotation of state.annotations) {
			const outcome = state.outcomes.get(annotation.id);
			if (outcome?.status === 'matched') matched.push({ annotation, start: outcome.start });
			else orphaned.push(annotation);
		}
		matched.sort((a, b) => a.start - b.start);

		if (matched.length > 0) {
			this.sectionHeader(root, `Annotations (${matched.length})`);
			for (const { annotation } of matched) {
				this.renderCard(root, file.path, annotation, state.outcomes.get(annotation.id));
			}
		}
		if (orphaned.length > 0) {
			this.sectionHeader(root, `Orphaned (${orphaned.length})`);
			for (const annotation of orphaned) {
				this.renderCard(root, file.path, annotation, state.outcomes.get(annotation.id));
			}
		}
		if (state.unparseable.length > 0) {
			this.sectionHeader(root, `Needs attention (${state.unparseable.length})`);
			root.createEl('p', {
				text: 'These lines in the annotation block could not be read (often sync-conflict leftovers). They are preserved untouched until you delete them.',
				cls: 'mdann-hint',
			});
			for (const raw of state.unparseable) this.renderUnparseable(root, file.path, raw);
		}
	}

	private sectionHeader(root: HTMLElement, text: string): void {
		root.createEl('div', { text, cls: 'mdann-section' });
	}

	private renderCard(
		root: HTMLElement,
		path: string,
		annotation: Annotation,
		outcome: MatchResult | undefined,
	): void {
		const isOrphan = outcome === undefined || outcome.status === 'orphaned';
		const card = root.createDiv({ cls: 'mdann-card' + (isOrphan ? ' mdann-card-orphan' : '') });

		const quote = card.createDiv({ cls: 'mdann-quote' });
		const isPointComment = annotation.type === 'comment' && annotation.selector.exact === '';
		const excerpt =
			annotation.selector.exact.length > 120
				? annotation.selector.exact.slice(0, 120) + '…'
				: annotation.selector.exact;
		const chip = quote.createEl('span', {
			text: isPointComment ? '💬 comment marker' : excerpt === '' ? '(empty quote)' : excerpt,
			cls: highlightClasses(annotation.type, annotation.format, this.plugin.settings),
		});
		chip.setCssProps(highlightStyleVars(annotation.type, annotation.format, this.plugin.settings));
		if (!isOrphan) {
			chip.addClass('mdann-quote-clickable');
			chip.addEventListener('click', () => {
				void this.plugin.jumpToAnnotation(path, annotation.id);
			});
		}

		if (isOrphan) {
			const reason =
				outcome && outcome.status === 'orphaned' && outcome.reason === 'ambiguous'
					? 'Multiple equally likely locations — select the right text and re-anchor.'
					: 'Original text not found — select the new text and re-anchor.';
			card.createEl('div', { text: reason, cls: 'mdann-orphan-reason' });
		}

		// Highlights get a format selector so an annotation can be reassigned
		// to a different format after creation (formats are keyed by name).
		if (annotation.type === 'highlight') {
			const row = card.createDiv({ cls: 'mdann-format-select-row' });
			row.createEl('span', { text: 'Format', cls: 'mdann-format-select-label' });
			const select = row.createEl('select', { cls: 'dropdown mdann-format-select' });
			const names = Object.keys(this.plugin.settings.formatStyles);
			if (!names.includes(annotation.format)) {
				const missing = select.createEl('option', {
					text: `${annotation.format} (missing)`,
					attr: { value: annotation.format },
				});
				missing.selected = true;
			}
			for (const name of names) {
				const option = select.createEl('option', { text: name, attr: { value: name } });
				if (name === annotation.format) option.selected = true;
			}
			select.addEventListener('change', () => {
				this.plugin.setFormat(path, annotation.id, select.value);
			});
		}

		const comment = card.createEl('textarea', {
			cls: 'mdann-comment-input',
			attr: { rows: '2', placeholder: annotation.type === 'comment' ? 'Comment…' : 'Note…' },
		});
		comment.value = annotation.comment;
		comment.addEventListener('change', () => {
			this.plugin.setComment(path, annotation.id, comment.value);
		});

		const meta = card.createDiv({ cls: 'mdann-meta' });
		const author = annotation.author === '' ? 'unknown author' : annotation.author;
		const created = annotation.dateCreate.slice(0, 10);
		meta.setText(`${author} · ${created} · ${annotation.status}`);

		const buttons = card.createDiv({ cls: 'mdann-buttons' });
		if (isOrphan) {
			const reanchor = buttons.createEl('button', { text: 'Re-anchor to selection' });
			reanchor.addEventListener('click', () => {
				this.plugin.reanchorFromSelection(path, annotation.id);
			});
		} else {
			const toggle = buttons.createEl('button', {
				text: annotation.status === 'open' ? 'Close' : 'Reopen',
			});
			toggle.addEventListener('click', () => {
				this.plugin.setStatus(path, annotation.id, annotation.status === 'open' ? 'closed' : 'open');
			});
		}
		const del = buttons.createEl('button', { text: 'Delete', cls: 'mod-warning' });
		del.addEventListener('click', () => {
			this.plugin.deleteAnnotation(path, annotation.id);
		});
	}

	private renderUnparseable(root: HTMLElement, path: string, raw: string): void {
		const card = root.createDiv({ cls: 'mdann-card mdann-card-orphan' });
		card.createEl('code', { text: raw, cls: 'mdann-raw-line' });
		const buttons = card.createDiv({ cls: 'mdann-buttons' });
		const del = buttons.createEl('button', { text: 'Delete line', cls: 'mod-warning' });
		del.addEventListener('click', () => {
			this.plugin.deleteUnparseableLine(path, raw);
		});
	}
}
