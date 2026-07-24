// Sidebar panel: lists every annotation of the active note — matched
// highlights/comments, orphaned annotations flagged for repair, and
// unparseable block lines needing attention (e.g. after a sync conflict).

import type { App, WorkspaceLeaf } from 'obsidian';
import { ItemView, Modal } from 'obsidian';

import { lineNumberAt, numberComments } from '../core/ordering';
import { highlightClasses, highlightStyleVars } from '../core/settings';
import type { Annotation } from '../core/types';
import type { MatchResult } from '../core/matcher';
import type MdAnnotationPlugin from '../main';

export const SIDEBAR_VIEW_TYPE = 'md-annotation-sidebar';

const FLASH_MS = 1200;

export class AnnotationSidebarView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	// One card element per annotation id, rebuilt each render, so reveal/sync
	// can scroll to and highlight a specific entry.
	private cardEls = new Map<string, HTMLElement>();
	// True until the first render after opening, so we can scroll to the entry
	// nearest the cursor exactly once on open.
	private freshOpen = true;

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
		this.freshOpen = true;
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
		const prevScroll = root.scrollTop;
		root.empty();
		root.addClass('mdann-sidebar');
		this.cardEls.clear();

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

		const commentNumbers = numberComments(state.annotations, state.outcomes);
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
				this.renderCard(
					root,
					file.path,
					annotation,
					state.outcomes.get(annotation.id),
					commentNumbers.get(annotation.id),
					state.body,
				);
			}
		}
		if (orphaned.length > 0) {
			this.sectionHeader(root, `Orphaned (${orphaned.length})`);
			for (const annotation of orphaned) {
				this.renderCard(
					root,
					file.path,
					annotation,
					state.outcomes.get(annotation.id),
					commentNumbers.get(annotation.id),
					state.body,
				);
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

		this.applyRevealOrRestore(file.path, prevScroll);
	}

	// After a rebuild, either honor an explicit reveal request (click-from-text
	// or sync), scroll to the entry nearest the cursor on first open, or leave
	// the scroll position exactly where it was (so a status toggle, comment
	// edit, etc. never yanks the list — Update001 "Do not scroll SB on status
	// change").
	private applyRevealOrRestore(path: string, prevScroll: number): void {
		const reveal = this.plugin.consumePendingReveal(path);
		if (reveal) {
			this.scrollToCard(reveal.id, { flash: reveal.flash, focus: reveal.focus });
			this.freshOpen = false;
			return;
		}
		if (this.freshOpen) {
			this.freshOpen = false;
			const nearest = this.plugin.nearestToCursor(path);
			if (nearest) {
				this.scrollToCard(nearest, { flash: false, focus: false });
				return;
			}
		}
		this.contentEl.scrollTop = prevScroll;
	}

	private scrollToCard(id: string, opts: { flash: boolean; focus: boolean }): void {
		for (const el of this.cardEls.values()) el.removeClass('mdann-card-active');
		const card = this.cardEls.get(id);
		if (!card) return;
		card.addClass('mdann-card-active');
		card.scrollIntoView({ block: 'center' });
		if (opts.flash) {
			card.addClass('mdann-flash');
			this.contentEl.win.setTimeout(() => card.removeClass('mdann-flash'), FLASH_MS);
		}
		if (opts.focus) {
			const textarea = card.querySelector<HTMLTextAreaElement>('textarea');
			textarea?.focus();
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
		commentNumber: number | undefined,
		body: string,
	): void {
		const isOrphan = outcome === undefined || outcome.status === 'orphaned';
		const card = root.createDiv({ cls: 'mdann-card' + (isOrphan ? ' mdann-card-orphan' : '') });
		this.cardEls.set(annotation.id, card);

		// Clicking anywhere on a matched card (but not on its controls) jumps to
		// the annotation in the note.
		if (!isOrphan) {
			card.addClass('mdann-card-clickable');
			card.addEventListener('click', (event) => {
				const target = event.target as HTMLElement | null;
				if (target?.closest('button, select, textarea, input, a')) return;
				void this.plugin.jumpToAnnotation(path, annotation.id);
			});
		}

		const isPointComment = annotation.type === 'comment' && annotation.selector.exact === '';

		const quote = card.createDiv({ cls: 'mdann-quote' });
		if (isPointComment && commentNumber !== undefined) {
			quote.createEl('span', { text: String(commentNumber), cls: 'mdann-card-num' });
		}
		const excerpt =
			annotation.selector.exact.length > 120
				? annotation.selector.exact.slice(0, 120) + '…'
				: annotation.selector.exact;
		const chip = quote.createEl('span', {
			text: isPointComment ? 'comment marker' : excerpt === '' ? '(empty quote)' : excerpt,
			cls: highlightClasses(annotation.type, annotation.format, this.plugin.settings),
		});
		chip.setCssProps(highlightStyleVars(annotation.type, annotation.format, this.plugin.settings));

		if (isOrphan) {
			const reason =
				outcome && outcome.status === 'orphaned' && outcome.reason === 'ambiguous'
					? 'Multiple equally likely locations — select the right text and re-anchor.'
					: 'Original text not found — select the new text and re-anchor.';
			card.createEl('div', { text: reason, cls: 'mdann-orphan-reason' });
		}

		// Highlights and comments both get a format selector so an annotation can
		// be reassigned after creation (formats are keyed by name). Comments also
		// offer the dedicated "Comment" style (the empty format name).
		this.renderFormatSelector(card, path, annotation);

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
		let metaText = `${author} · ${created} · ${annotation.status}`;
		// Line number for a matched comment entry (Update001 "Show line number in
		// Comment SB entry").
		if (annotation.type === 'comment' && outcome?.status === 'matched') {
			metaText += ` · line ${lineNumberAt(body, outcome.start)}`;
		}
		meta.setText(metaText);

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
			this.confirmDelete(annotation, () => this.plugin.deleteAnnotation(path, annotation.id));
		});
	}

	// A format dropdown bound to one annotation. Comments lead with a "Comment"
	// option (the dedicated comment style, stored as the empty format name).
	private renderFormatSelector(card: HTMLElement, path: string, annotation: Annotation): void {
		const row = card.createDiv({ cls: 'mdann-format-select-row' });
		row.createEl('span', { text: 'Format', cls: 'mdann-format-select-label' });
		const select = row.createEl('select', { cls: 'dropdown mdann-format-select' });

		if (annotation.type === 'comment') {
			const def = select.createEl('option', { text: 'Comment', attr: { value: '' } });
			if (annotation.format === '') def.selected = true;
		}
		const names = Object.keys(this.plugin.settings.formatStyles);
		// Surface a stored-but-unknown format name so it is not silently dropped.
		if (annotation.format !== '' && !names.includes(annotation.format)) {
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

	private confirmDelete(annotation: Annotation, onConfirm: () => void): void {
		const isComment = annotation.type === 'comment';
		const label = isComment ? 'this comment' : 'this annotation';
		new SidebarConfirmModal(this.app, `Delete ${label}? This cannot be undone.`, onConfirm).open();
	}

	private renderUnparseable(root: HTMLElement, path: string, raw: string): void {
		const card = root.createDiv({ cls: 'mdann-card mdann-card-orphan' });
		card.createEl('code', { text: raw, cls: 'mdann-raw-line' });
		const buttons = card.createDiv({ cls: 'mdann-buttons' });
		const del = buttons.createEl('button', { text: 'Delete line', cls: 'mod-warning' });
		del.addEventListener('click', () => {
			new SidebarConfirmModal(
				this.app,
				'Delete this unreadable block line? This cannot be undone.',
				() => this.plugin.deleteUnparseableLine(path, raw),
			).open();
		});
	}
}

// Yes/No confirmation modal used before deleting a sidebar entry or block line.
class SidebarConfirmModal extends Modal {
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
