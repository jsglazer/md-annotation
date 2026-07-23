// Plugin shell: wires the pure core (matching, block parsing, write queue)
// to Obsidian. All decision logic lives in src/core/; this file only injects
// App/Vault/Workspace, timers, and randomness at the boundary.

import type { Editor, MarkdownFileInfo, TFile } from 'obsidian';
import { MarkdownView, Notice, Plugin } from 'obsidian';
import type { EditorView } from '@codemirror/view';

import type { MdAnnotationAPI } from './api';
import { createApi } from './api';
import { createAnnotation, formatTimestamp, generateAnnotationId } from './core/annotation';
import {
	BLOCK_OPEN,
	parseDocument,
	removeAnnotation,
	removeUnparseableLine,
	renameAnnotationFormat,
	updateAnnotation,
	upsertAnnotation,
} from './core/block';
import { captureSelector, resolveSelectors } from './core/matcher';
import { WriteQueue } from './core/queue';
import type { MdAnnotationSettings } from './core/settings';
import { isUnsafeKey, normalizeSettings, usableFormatNames } from './core/settings';
import type { Annotation, AnnotationType, TextQuoteSelector } from './core/types';
import {
	applyEditorDecorations,
	buildEditorExtension,
	editorViewPath,
} from './editor/livePreview';
import { createReadingPostProcessor, sweepHighlightSpans } from './editor/readingView';
import { MdAnnotationSettingTab } from './settingsTab';
import type { FileAnnotationState } from './state';
import { FormatSuggestModal } from './ui/formatSuggest';
import { AnnotationSidebarView, SIDEBAR_VIEW_TYPE } from './ui/sidebar';

const WRITE_DEBOUNCE_MS = 500;
const DISK_REFRESH_DEBOUNCE_MS = 400;

export default class MdAnnotationPlugin extends Plugin {
	settings: MdAnnotationSettings = normalizeSettings(null);
	queue!: WriteQueue;
	// Public query API for dataviewjs / datacorejs blocks — see src/api.ts.
	api!: MdAnnotationAPI;

	private states = new Map<string, FileAnnotationState>();
	private editors = new Set<EditorView>();
	private editorTimers = new Map<EditorView, number>();
	private diskTimers = new Map<string, number>();
	private changeListeners = new Set<() => void>();

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.api = createApi(this.app.vault);

		this.queue = new WriteQueue(
			{
				process: async (path, mutate) => {
					const file = this.app.vault.getFileByPath(path);
					if (!file) return;
					await this.app.vault.process(file, mutate);
				},
			},
			WRITE_DEBOUNCE_MS,
			{
				set: (fn, ms) => window.setTimeout(fn, ms),
				clear: (handle) => window.clearTimeout(handle),
			},
			(key) => new Notice(`MD Annotation: failed to write ${key}`),
		);

		this.registerEditorExtension(buildEditorExtension(this));
		this.registerMarkdownPostProcessor(createReadingPostProcessor(this));
		this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new AnnotationSidebarView(leaf, this));
		this.addSettingTab(new MdAnnotationSettingTab(this.app, this));
		this.addRibbonIcon('highlighter', 'Open annotation sidebar', () => {
			void this.activateSidebar();
		});

		// One command covers both cases: with a selection it adds an annotation
		// (highlight), without one it inserts a comment marker at the cursor.
		this.addCommand({
			id: 'annotate',
			name: 'Annotate',
			editorCallback: (editor, ctx) => {
				this.annotateOrComment(editor, ctx);
			},
		});
		this.addCommand({
			id: 'open-sidebar',
			name: 'Open annotation sidebar',
			callback: () => {
				void this.activateSidebar();
			},
		});
		this.addCommand({
			id: 'toggle-annotation-formats',
			name: 'Show/hide annotation formats',
			callback: () => {
				this.settings.annotationFormattingEnabled = !this.settings.annotationFormattingEnabled;
				void this.saveSettings();
				new Notice(
					`Annotation formats ${this.settings.annotationFormattingEnabled ? 'shown' : 'hidden'}`,
				);
			},
		});
		this.addCommand({
			id: 'toggle-comment-formats',
			name: 'Show/hide comment formats',
			callback: () => {
				this.settings.commentsFormattingEnabled = !this.settings.commentsFormattingEnabled;
				void this.saveSettings();
				new Notice(
					`Comment formats ${this.settings.commentsFormattingEnabled ? 'shown' : 'hidden'}`,
				);
			},
		});

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, ctx) => {
				const hasSelection = editor.getSelection() !== '';
				menu.addItem((item) =>
					item
						.setTitle(hasSelection ? 'Annotate selection' : 'Insert comment')
						.setIcon(hasSelection ? 'highlighter' : 'message-square')
						.onClick(() => {
							this.annotateOrComment(editor, ctx);
						}),
				);
			}),
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!this.states.has(file.path)) return;
				this.scheduleDiskRefresh(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const state = this.states.get(oldPath);
				this.states.delete(oldPath);
				if (state) this.states.set(file.path, state);
				this.notifyChange();
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.states.delete(file.path);
				this.notifyChange();
			}),
		);
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file && file.extension === 'md') void this.ensureFileState(file.path);
				this.notifyChange();
			}),
		);
	}

	onunload(): void {
		for (const timer of this.editorTimers.values()) window.clearTimeout(timer);
		this.editorTimers.clear();
		for (const timer of this.diskTimers.values()) window.clearTimeout(timer);
		this.diskTimers.clear();
		// Persist anything still debouncing, then stop the queue.
		void this.queue.flush().finally(() => this.queue.dispose());
		// Remove any highlight spans/markers still in rendered previews (render
		// children belong to the renderer's lifecycle, not the plugin's, so
		// they would otherwise linger until the next re-render). Sweeping via
		// leaves also covers popout windows.
		this.app.workspace.iterateAllLeaves((leaf) => {
			sweepHighlightSpans(leaf.view.containerEl);
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const view of this.editors) this.decorate(view);
		this.rerenderPreviews();
		this.notifyChange();
	}

	// ── Per-file state ───────────────────────────────────────────────────────

	getState(path: string): FileAnnotationState | null {
		return this.states.get(path) ?? null;
	}

	async ensureFileState(path: string): Promise<FileAnnotationState | null> {
		const cached = this.states.get(path);
		if (cached) return cached;
		const file = this.app.vault.getFileByPath(path);
		if (!file || file.extension !== 'md') return null;
		const doc = await this.app.vault.cachedRead(file);
		return this.setStateFromDoc(path, doc);
	}

	// Parse + resolve one document snapshot, persist self-healed selectors,
	// and cache the result.
	private setStateFromDoc(path: string, doc: string): FileAnnotationState {
		const parsed = parseDocument(doc);
		const outcomes = resolveSelectors(
			parsed.body,
			parsed.annotations.map((a) => ({ id: a.id, selector: a.selector })),
		);

		// Self-healing: persist refreshed selectors from high-confidence
		// non-exact matches through the write queue. The in-memory selector is
		// updated first so re-resolution cannot re-enqueue the same refresh.
		for (const annotation of parsed.annotations) {
			const outcome = outcomes.get(annotation.id);
			if (outcome?.status === 'matched' && outcome.refreshedSelector) {
				const refreshed = outcome.refreshedSelector;
				annotation.selector = refreshed;
				this.queue.request(path, (text) =>
					updateAnnotation(text, annotation.id, { selector: refreshed }),
				);
			}
		}

		const state: FileAnnotationState = {
			body: parsed.body,
			annotations: parsed.annotations,
			unparseable: parsed.unparseable,
			outcomes,
		};
		this.states.set(path, state);
		this.notifyChange();
		return state;
	}

	private scheduleDiskRefresh(path: string): void {
		const existing = this.diskTimers.get(path);
		if (existing !== undefined) window.clearTimeout(existing);
		this.diskTimers.set(
			path,
			window.setTimeout(() => {
				this.diskTimers.delete(path);
				// An open editor is the source of truth for its own file; its
				// doc-change pipeline will re-resolve instead.
				if (this.hasEditorFor(path)) return;
				void (async () => {
					const file = this.app.vault.getFileByPath(path);
					if (!file) return;
					const doc = await this.app.vault.cachedRead(file);
					this.setStateFromDoc(path, doc);
				})();
			}, DISK_REFRESH_DEBOUNCE_MS),
		);
	}

	// ── Editor attachment (called by the CodeMirror ViewPlugin) ──────────────

	attachEditor(view: EditorView): void {
		this.editors.add(view);
	}

	detachEditor(view: EditorView): void {
		this.editors.delete(view);
		const timer = this.editorTimers.get(view);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.editorTimers.delete(view);
		}
	}

	scheduleEditorResolve(view: EditorView, delayMs: number): void {
		const existing = this.editorTimers.get(view);
		if (existing !== undefined) window.clearTimeout(existing);
		this.editorTimers.set(
			view,
			window.setTimeout(() => {
				this.editorTimers.delete(view);
				this.resolveEditor(view);
			}, delayMs),
		);
	}

	private resolveEditor(view: EditorView): void {
		const path = editorViewPath(view);
		if (path === null) return;
		this.setStateFromDoc(path, view.state.doc.toString());
		this.decorateAllFor(path);
	}

	private hasEditorFor(path: string): boolean {
		for (const view of this.editors) {
			if (editorViewPath(view) === path) return true;
		}
		return false;
	}

	private decorate(view: EditorView): void {
		const path = editorViewPath(view);
		if (path === null) return;
		const state = this.states.get(path);
		if (!state) return;
		applyEditorDecorations(view, state.annotations, state.outcomes, this.settings, () => {
			void this.activateSidebar();
		});
	}

	private decorateAllFor(path: string): void {
		for (const view of this.editors) {
			if (editorViewPath(view) === path) this.decorate(view);
		}
	}

	rerenderPreviews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.getMode() === 'preview') {
				view.previewMode.rerender(true);
			}
		}
	}

	// ── Annotation CRUD (used by commands and the sidebar) ───────────────────

	// Selection → annotation (highlight, format picked when several exist);
	// no selection → comment marker at the cursor.
	private annotateOrComment(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): void {
		const from = editor.posToOffset(editor.getCursor('from'));
		const to = editor.posToOffset(editor.getCursor('to'));
		if (from === to) {
			this.addAnnotationFromEditor(editor, ctx, 'comment', '');
			return;
		}
		const names = usableFormatNames(this.settings);
		const first = names[0];
		if (names.length === 0) {
			new Notice('No annotation formats are enabled — check the plugin settings');
			return;
		}
		if (names.length === 1 && first !== undefined) {
			this.addAnnotationFromEditor(editor, ctx, 'highlight', first);
			return;
		}
		new FormatSuggestModal(this.app, names, (name) => {
			this.addAnnotationFromEditor(editor, ctx, 'highlight', name);
		}).open();
	}

	private addAnnotationFromEditor(
		editor: Editor,
		ctx: MarkdownView | MarkdownFileInfo,
		type: AnnotationType,
		formatName: string,
	): void {
		const path = ctx.file?.path;
		if (path === undefined) return;
		const from = editor.posToOffset(editor.getCursor('from'));
		const to = editor.posToOffset(editor.getCursor('to'));
		if (from === to && type !== 'comment') {
			new Notice('Select some text to annotate');
			return;
		}
		const doc = editor.getValue();
		const { body } = parseDocument(doc);
		if (to > body.length) {
			new Notice('The annotation block itself cannot be annotated');
			return;
		}

		const selector = captureSelector(body, from, to);
		if (from === to && selector.prefix === '' && selector.suffix === '') {
			new Notice('Cannot anchor a comment in an empty note');
			return;
		}
		const annotation = createAnnotation({
			id: generateAnnotationId(Date.now(), Math.random()),
			type,
			format: formatName,
			selector,
			comment: '',
			author: this.settings.author,
			nowMs: Date.now(),
		});
		this.queue.request(path, (text) => upsertAnnotation(text, annotation));

		// Optimistic in-memory update so the highlight appears immediately.
		const state = this.states.get(path);
		if (state) {
			state.annotations.push(annotation);
			state.outcomes.set(annotation.id, {
				status: 'matched',
				start: from,
				end: to,
				confidence: 1,
				refreshedSelector: null,
			});
			this.decorateAllFor(path);
		}
		this.notifyChange();
		if (type === 'comment') void this.activateSidebar();
	}

	setComment(path: string, id: string, comment: string): void {
		this.patchAnnotation(path, id, { comment, dateModified: formatTimestamp(Date.now()) });
	}

	setStatus(path: string, id: string, status: 'open' | 'closed'): void {
		const now = formatTimestamp(Date.now());
		this.patchAnnotation(path, id, {
			status,
			dateClosed: status === 'closed' ? now : null,
			dateModified: now,
		});
	}

	// Reassign one annotation to a different format (sidebar dropdown).
	setFormat(path: string, id: string, formatName: string): void {
		this.patchAnnotation(path, id, {
			format: formatName,
			dateModified: formatTimestamp(Date.now()),
		});
		this.decorateAllFor(path);
		this.rerenderPreviews();
	}

	// Rename a format in settings AND rewrite the "format" field in every
	// annotated note that references the old name (they store the name).
	async renameFormat(oldName: string, newName: string): Promise<boolean> {
		const styles = this.settings.formatStyles;
		const current = styles[oldName];
		if (!current) return false;
		if (newName === '' || isUnsafeKey(newName) || styles[newName]) return false;

		// Move the key while preserving the display order.
		const next: Record<string, typeof current> = {};
		for (const [key, value] of Object.entries(styles)) {
			next[key === oldName ? newName : key] = value;
		}
		this.settings.formatStyles = next;
		await this.saveSettings();

		let fileCount = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const doc = await this.app.vault.cachedRead(file);
			if (!doc.includes(BLOCK_OPEN)) continue;
			const { annotations } = parseDocument(doc);
			if (!annotations.some((a) => a.format === oldName)) continue;
			this.queue.request(file.path, (text) => renameAnnotationFormat(text, oldName, newName));
			fileCount++;
			const state = this.states.get(file.path);
			if (state) {
				for (const a of state.annotations) {
					if (a.format === oldName) a.format = newName;
				}
			}
		}
		if (fileCount > 0) {
			new Notice(
				`MD Annotation: renamed format in ${fileCount} note${fileCount === 1 ? '' : 's'}`,
			);
			this.notifyChange();
		}
		return true;
	}

	reanchorFromSelection(path: string, id: string): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== path) {
			new Notice('Open the note in an editor and select the new text first');
			return;
		}
		const editor = view.editor;
		const from = editor.posToOffset(editor.getCursor('from'));
		const to = editor.posToOffset(editor.getCursor('to'));
		if (from === to) {
			new Notice('Select the text to re-anchor this annotation to');
			return;
		}
		const { body } = parseDocument(editor.getValue());
		if (to > body.length) {
			new Notice('The annotation block itself cannot be annotated');
			return;
		}
		const selector = captureSelector(body, from, to);
		this.patchAnnotation(path, id, { selector, dateModified: formatTimestamp(Date.now()) });
		const state = this.states.get(path);
		if (state) {
			state.outcomes.set(id, {
				status: 'matched',
				start: from,
				end: to,
				confidence: 1,
				refreshedSelector: null,
			});
			this.decorateAllFor(path);
			this.notifyChange();
		}
	}

	private patchAnnotation(
		path: string,
		id: string,
		patch: Partial<Omit<Annotation, 'id'>> & { selector?: TextQuoteSelector },
	): void {
		this.queue.request(path, (text) => updateAnnotation(text, id, patch));
		const state = this.states.get(path);
		if (state) {
			const idx = state.annotations.findIndex((a) => a.id === id);
			const current = state.annotations[idx];
			if (current) state.annotations[idx] = { ...current, ...patch, id };
			this.notifyChange();
		}
	}

	deleteAnnotation(path: string, id: string): void {
		this.queue.request(path, (text) => removeAnnotation(text, id));
		const state = this.states.get(path);
		if (state) {
			state.annotations = state.annotations.filter((a) => a.id !== id);
			state.outcomes.delete(id);
			this.decorateAllFor(path);
			this.notifyChange();
		}
	}

	deleteUnparseableLine(path: string, raw: string): void {
		this.queue.request(path, (text) => removeUnparseableLine(text, raw));
		const state = this.states.get(path);
		if (state) {
			const idx = state.unparseable.indexOf(raw);
			if (idx !== -1) state.unparseable.splice(idx, 1);
			this.notifyChange();
		}
	}

	// ── Navigation & sidebar ─────────────────────────────────────────────────

	async jumpToAnnotation(path: string, id: string): Promise<void> {
		const state = this.states.get(path);
		const outcome = state?.outcomes.get(id);
		if (!outcome || outcome.status !== 'matched') return;

		let view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== path) {
			await this.app.workspace.openLinkText(path, '', false);
			view = this.app.workspace.getActiveViewOfType(MarkdownView);
		}
		if (!view || view.file?.path !== path) return;
		const editor = view.editor;
		const from = editor.offsetToPos(outcome.start);
		const to = editor.offsetToPos(outcome.end);
		editor.setSelection(from, to);
		editor.scrollIntoView({ from, to }, true);
	}

	// ReadingHost surface (marker clicks open the sidebar).
	openSidebar(): void {
		void this.activateSidebar();
	}

	async activateSidebar(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	activeMarkdownFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		return file && file.extension === 'md' ? file : null;
	}

	// ── Change notification (sidebar refresh) ────────────────────────────────

	onStateChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	private notifyChange(): void {
		for (const listener of this.changeListeners) listener();
	}
}
