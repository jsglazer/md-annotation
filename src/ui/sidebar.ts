// Sidebar panel: lists every annotation of the active note — matched
// highlights/comments, orphaned annotations flagged for repair, and
// unparseable block lines needing attention (e.g. after a sync conflict).
//
// A toolbar at the top (modelled on the core Outline panel) narrows the list:
// a search box over the Note/Comment text, a format filter built from the
// identifiers actually present in the active note, and First/Last buttons that
// scroll the list to either end.

import type { App, WorkspaceLeaf } from 'obsidian';
import { ItemView, Modal } from 'obsidian';

import { lineNumberAt, numberComments } from '../core/ordering';
import { highlightClasses, highlightStyleVars } from '../core/settings';
import type { Annotation } from '../core/types';
import type { MatchResult } from '../core/matcher';
import type MdAnnotationPlugin from '../main';

export const SIDEBAR_VIEW_TYPE = 'md-annotation-sidebar';

const FLASH_MS = 1200;

// Filter identity for one annotation. Comments using the dedicated comment
// style carry no format name, so they get their own value; prefixes keep a
// format literally named "Comment" distinct from the comment style itself.
const COMMENT_FILTER = 'c:';

function filterValue(annotation: Annotation): string {
	return annotation.format === '' ? COMMENT_FILTER : `f:${annotation.format}`;
}

function filterLabel(annotation: Annotation): string {
	return annotation.format === '' ? 'Comment' : annotation.format;
}

export class AnnotationSidebarView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	// One card element per annotation id, rebuilt each render, so reveal/sync
	// can scroll to and highlight a specific entry.
	private cardEls = new Map<string, HTMLElement>();
	// Ids of the cards currently rendered, in display order — what First/Last
	// jump to, so they honor the active search/filter.
	private visibleOrder: string[] = [];
	// True until the first render after opening, so we can scroll to the entry
	// nearest the cursor exactly once on open.
	private freshOpen = true;
	// Toolbar state, kept across re-renders (the panel rebuilds on every change).
	private searchQuery = '';
	private formatFilter = '';

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
		// A rebuild while typing in the search box would drop the caret — note
		// where it was and restore it once the new toolbar exists.
		const searchCaret =
			active instanceof HTMLInputElement && active.hasClass('mdann-search-input')
				? active.selectionStart
				: null;
		root.empty();
		root.addClass('mdann-sidebar');
		this.cardEls.clear();
		this.visibleOrder = [];

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

		// The toolbar's filter list is built from the whole note, so an option
		// never disappears just because the current search hides its entries.
		this.renderToolbar(root, state.annotations);

		const visibleMatched = matched.filter((m) => this.passesFilters(m.annotation));
		const visibleOrphaned = orphaned.filter((a) => this.passesFilters(a));

		if (visibleMatched.length > 0) {
			this.sectionHeader(root, this.countLabel('Annotations', visibleMatched.length, matched.length));
			for (const { annotation } of visibleMatched) {
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
		if (visibleOrphaned.length > 0) {
			this.sectionHeader(root, this.countLabel('Orphaned', visibleOrphaned.length, orphaned.length));
			for (const annotation of visibleOrphaned) {
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
		if (
			visibleMatched.length === 0 &&
			visibleOrphaned.length === 0 &&
			state.annotations.length > 0
		) {
			root.createEl('p', {
				text: 'No entries match the current search or filter.',
				cls: 'mdann-empty',
			});
		}
		if (state.unparseable.length > 0) {
			this.sectionHeader(root, `Needs attention (${state.unparseable.length})`);
			root.createEl('p', {
				text: 'These lines in the annotation block could not be read (often sync-conflict leftovers). They are preserved untouched until you delete them.',
				cls: 'mdann-hint',
			});
			for (const raw of state.unparseable) this.renderUnparseable(root, file.path, raw);
		}

		this.restoreSearchFocus(searchCaret);
		this.applyRevealOrRestore(file.path, prevScroll);
	}

	// "Annotations (3)" normally; "Annotations (3 of 11)" while narrowed.
	private countLabel(name: string, shown: number, total: number): string {
		return shown === total ? `${name} (${shown})` : `${name} (${shown} of ${total})`;
	}

	private passesFilters(annotation: Annotation): boolean {
		if (this.formatFilter !== '' && filterValue(annotation) !== this.formatFilter) return false;
		if (this.searchQuery === '') return true;
		return annotation.comment.toLowerCase().includes(this.searchQuery);
	}

	// ── Toolbar ──────────────────────────────────────────────────────────────

	private renderToolbar(root: HTMLElement, annotations: ReadonlyArray<Annotation>): void {
		const bar = root.createDiv({ cls: 'mdann-toolbar' });

		// Row 1 — search over the Note/Comment text.
		const searchRow = bar.createDiv({ cls: 'mdann-toolbar-row' });
		const search = searchRow.createEl('input', {
			cls: 'mdann-search-input',
			attr: {
				type: 'search',
				placeholder: 'Search notes and comments…',
				spellcheck: 'false',
			},
		});
		search.value = this.searchQuery;
		search.addEventListener('input', () => {
			this.searchQuery = search.value.trim().toLowerCase();
			this.render();
		});

		// Row 2 — format filter (left), First / Last (center, right).
		const controlRow = bar.createDiv({ cls: 'mdann-toolbar-row' });
		this.renderFilterSelect(controlRow, annotations);

		const first = controlRow.createEl('button', {
			text: 'First',
			cls: 'mdann-jump-btn',
			attr: { 'aria-label': 'Scroll to the first entry' },
		});
		const last = controlRow.createEl('button', {
			text: 'Last',
			cls: 'mdann-jump-btn',
			attr: { 'aria-label': 'Scroll to the last entry' },
		});
		// Both scroll the sidebar only — the note view is deliberately left alone.
		first.addEventListener('click', () => this.jumpToEnd('first'));
		last.addEventListener('click', () => this.jumpToEnd('last'));
	}

	private renderFilterSelect(row: HTMLElement, annotations: ReadonlyArray<Annotation>): void {
		const select = row.createEl('select', { cls: 'dropdown mdann-filter-select' });
		select.createEl('option', { text: 'All formats', attr: { value: '' } });

		// Identifiers present in this note, comment style first, then names A→Z.
		const present = new Map<string, string>();
		for (const annotation of annotations) present.set(filterValue(annotation), filterLabel(annotation));
		const entries = [...present.entries()].sort(([a], [b]) => {
			if (a === COMMENT_FILTER) return -1;
			if (b === COMMENT_FILTER) return 1;
			return a.localeCompare(b);
		});
		for (const [value, label] of entries) {
			select.createEl('option', { text: label, attr: { value } });
		}

		// A filter whose format vanished from the note falls back to "All".
		if (this.formatFilter !== '' && !present.has(this.formatFilter)) this.formatFilter = '';
		select.value = this.formatFilter;
		select.addEventListener('change', () => {
			this.formatFilter = select.value;
			this.render();
		});
	}

	private jumpToEnd(end: 'first' | 'last'): void {
		const id = end === 'first' ? this.visibleOrder[0] : this.visibleOrder[this.visibleOrder.length - 1];
		if (id === undefined) return;
		this.scrollToCard(id, { flash: false, focus: false });
	}

	private restoreSearchFocus(caret: number | null): void {
		if (caret === null) return;
		const search = this.contentEl.querySelector<HTMLInputElement>('.mdann-search-input');
		if (!search) return;
		search.focus();
		search.setSelectionRange(caret, caret);
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
		// The target may be hidden by the active search/filter — then there is
		// nothing to scroll to and the list stays put.
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
		this.visibleOrder.push(annotation.id);

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

		// Head row: the quote on the left, the line number pinned top right.
		const head = card.createDiv({ cls: 'mdann-card-head' });
		const quote = head.createDiv({ cls: 'mdann-quote' });
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
		// Line number for a matched comment entry (Update001 "Show line number in
		// Comment SB entry"), top right of the box since Update003.
		if (annotation.type === 'comment' && outcome?.status === 'matched') {
			head.createEl('span', {
				text: `line ${lineNumberAt(body, outcome.start)}`,
				cls: 'mdann-card-line',
			});
		}

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
		// Clicking into the Note field flashes the annotation in the text, so you
		// can see what you are writing about without leaving the box (Update003).
		comment.addEventListener('focus', () => {
			this.plugin.flashAnnotationInText(annotation.id);
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
