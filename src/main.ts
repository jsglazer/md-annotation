// Plugin shell: wires the pure core (matching, block parsing, write queue)
// to Obsidian. All decision logic lives in src/core/; this file only injects
// App/Vault/Workspace, timers, and randomness at the boundary.

import type { App, Editor, MarkdownFileInfo, TFile } from 'obsidian';
import { MarkdownView, Notice, Plugin } from 'obsidian';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { MdAnnotationAPI } from './api';
import { createApi } from './api';
import { createAnnotation, formatTimestamp, generateAnnotationId } from './core/annotation';
import {
	BLOCK_OPEN,
	parseDocument,
	removeAnnotation,
	normalizeBlock,
	removeUnparseableLine,
	renameAnnotationCategory,
	updateAnnotation,
	upsertAnnotation,
} from './core/block';
import type { MatchResult } from './core/matcher';
import { captureSelector, repairSelector, resolveSelectors } from './core/matcher';
import { nearestAnnotationId } from './core/ordering';
import { WriteQueue } from './core/queue';
import type { MdAnnotationSettings } from './core/settings';
import { isUnsafeKey, normalizeSettings, usableCategoryNames } from './core/settings';
import type { Annotation, AnnotationType, TextQuoteSelector } from './core/types';
import { EditorGutter } from './editor/gutterLayer';
import {
	applyEditorDecorations,
	buildEditorExtension,
	editorViewPath,
	isEmbeddedEditorView,
} from './editor/livePreview';
import { ReadingGutter } from './editor/readingGutter';
import { createReadingPostProcessor, sweepHighlightSpans } from './editor/readingView';
import { MdAnnotationSettingTab } from './settingsTab';
import type { FileAnnotationState } from './state';
import { CategorySuggestModal } from './ui/categorySuggest';
import { AnnotationSidebarView, SIDEBAR_VIEW_TYPE } from './ui/sidebar';
import { ToolbarHighlighter } from './ui/toolbarHighlight';

const WRITE_DEBOUNCE_MS = 500;
const DISK_REFRESH_DEBOUNCE_MS = 400;
const SYNC_DEBOUNCE_MS = 150;
const TEXT_FLASH_MS = 1200;
// Reading view renders section by section, so a note produces a burst of
// post-processor calls; the gutter only needs one pass once they settle.
const READING_GUTTER_DEBOUNCE_MS = 60;
// Note Toolbar renders its own DOM per leaf/file/mode. A short delay lets that
// finish first — handler order across two separate plugins is not guaranteed.
const TOOLBAR_HIGHLIGHT_DELAY_MS = 50;

// app.commands isn't part of Obsidian's public API surface, so it has no
// typings — used only to invoke the core "Toggle the right sidebar" command
// from toggleSidebar() below (see that method for why).
type AppWithCommands = App & { commands: { executeCommandById(id: string): boolean } };
const TOGGLE_RIGHT_SIDEBAR_COMMAND_ID = 'app:toggle-right-sidebar';

export default class MdAnnotationPlugin extends Plugin {
	settings: MdAnnotationSettings = normalizeSettings(null);
	queue!: WriteQueue;
	// Public query API for dataviewjs / datacorejs blocks — see src/api.ts.
	api!: MdAnnotationAPI;

	private states = new Map<string, FileAnnotationState>();
	private editors = new Set<EditorView>();
	// One margin gutter per open editor, created and torn down with it.
	private gutters = new Map<EditorView, EditorGutter>();
	// The same cards for Reading view, one per markdown leaf currently in
	// preview mode (keyed by the view's own container element, which outlives
	// the preview DOM that Obsidian rebuilds on every re-render).
	private readingGutters = new Map<HTMLElement, ReadingGutter>();
	private readingGutterTimer: number | null = null;
	// Recolours the Note Toolbar items bound to the two gutter toggles and the
	// "Text click jumps to sidebar" toggle.
	private toolbarHighlighter!: ToolbarHighlighter;
	private editorTimers = new Map<EditorView, number>();
	private diskTimers = new Map<string, number>();
	private changeListeners = new Set<() => void>();
	// A one-shot request the sidebar consumes on its next render: scroll to
	// (and optionally flash/focus) the entry for `id`.
	private pendingReveal: { path: string; id: string; flash: boolean; focus: boolean } | null = null;
	// Paths whose already-rendered Reading view has been re-rendered once after
	// annotations first loaded (fixes formatting not appearing until a toggle).
	private initialRendered = new Set<string>();
	private syncTimer: number | null = null;
	// Category names that currently have a generated "Apply - <name>" command,
	// so syncCategoryCommands can diff against settings and add/remove as they
	// change.
	private categoryCommandNames = new Set<string>();

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.api = createApi(this.app.vault, () => Object.keys(this.settings.categoryStyles));

		this.queue = new WriteQueue(
			{
				process: async (path, mutate) => {
					// An editor that has the note open owns its text: writing to
					// disk underneath it is what makes Obsidian announce "File
					// modified externally, merging changes automatically" every
					// time a selector self-heals while you type near an
					// annotation. Applying the same edit through that editor is
					// the same result with nothing to merge.
					if (this.applyThroughEditor(path, mutate)) return;
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
		this.addRibbonIcon('highlighter', 'Toggle annotation sidebar', () => {
			void this.toggleSidebar();
		});

		// One command covers both cases: with a selection it adds an annotation
		// (highlight), without one it inserts a comment marker at the cursor.
		this.addCommand({
			id: 'annotate',
			name: 'Annotate',
			icon: 'highlighter',
			editorCallback: (editor, ctx) => {
				this.annotateOrComment(editor, ctx);
			},
		});
		this.addCommand({
			id: 'open-sidebar',
			name: 'Toggle annotation sidebar',
			icon: 'panel-right',
			callback: () => {
				void this.toggleSidebar();
			},
		});
		this.addCommand({
			id: 'toggle-sync',
			name: 'Sync text and sidebar',
			icon: 'arrow-left-right',
			callback: () => {
				// The command and the General-tab toggle are one persisted state.
				this.settings.syncTextAndSidebar = !this.settings.syncTextAndSidebar;
				void this.saveSettings();
				new Notice(`Text/sidebar sync ${this.settings.syncTextAndSidebar ? 'on' : 'off'}`);
				if (this.settings.syncTextAndSidebar && this.hasSidebar()) {
					const file = this.activeMarkdownFile();
					if (file) {
						const nearest = this.nearestToCursor(file.path);
						if (nearest) {
							void this.revealInSidebar(file.path, nearest, {
								flash: false,
								focus: false,
								activate: false,
							});
						}
					}
				}
			},
		});
		this.addCommand({
			id: 'toggle-text-click-jump',
			name: 'Text click jumps to sidebar',
			icon: 'mouse-pointer-click',
			callback: () => {
				// The command and the General-tab toggle are one persisted state.
				this.settings.textClickJumpsToSidebar = !this.settings.textClickJumpsToSidebar;
				void this.saveSettings();
				new Notice(
					`Text click jump to sidebar ${this.settings.textClickJumpsToSidebar ? 'on' : 'off'}`,
				);
			},
		});
		this.addCommand({
			// Command ids are what user hotkeys bind to, so they keep their
			// pre-1.0.20 spelling even though the visible names now say "colors".
			id: 'toggle-annotation-formats',
			name: 'Show/hide annotation colors',
			callback: () => {
				this.settings.annotationFormattingEnabled = !this.settings.annotationFormattingEnabled;
				void this.saveSettings();
				new Notice(
					`Annotation colors ${this.settings.annotationFormattingEnabled ? 'shown' : 'hidden'}`,
				);
			},
		});
		this.addCommand({
			id: 'toggle-comment-formats',
			name: 'Show/hide comment colors',
			callback: () => {
				this.settings.commentsFormattingEnabled = !this.settings.commentsFormattingEnabled;
				void this.saveSettings();
				new Notice(
					`Comment colors ${this.settings.commentsFormattingEnabled ? 'shown' : 'hidden'}`,
				);
			},
		});

		this.addCommand({
			id: 'toggle-annotation-block',
			name: 'Show/hide the annotation block',
			icon: 'code',
			callback: () => {
				this.settings.hideAnnotationBlock = !this.settings.hideAnnotationBlock;
				void this.saveSettings();
				new Notice(
					`Annotation block ${this.settings.hideAnnotationBlock ? 'hidden' : 'shown'}`,
				);
			},
		});
		this.addCommand({
			id: 'toggle-body-end-line',
			name: 'Show/hide the end-of-text line',
			icon: 'minus',
			callback: () => {
				this.settings.bodyEndLineEnabled = !this.settings.bodyEndLineEnabled;
				void this.saveSettings();
				new Notice(
					`End-of-text line ${this.settings.bodyEndLineEnabled ? 'shown' : 'hidden'}`,
				);
			},
		});

		// The two gutter toggles are persisted settings, so command and settings
		// dropdown are one state (as with the sync toggle above).
		this.addCommand({
			id: 'toggle-annotation-gutter',
			name: 'Show/hide annotations in the gutter',
			icon: 'panel-right',
			callback: () => {
				this.settings.gutterAnnotationsEnabled = !this.settings.gutterAnnotationsEnabled;
				void this.saveSettings();
				new Notice(
					`Annotations in the gutter ${this.settings.gutterAnnotationsEnabled ? 'shown' : 'hidden'}`,
				);
			},
		});
		this.addCommand({
			id: 'toggle-comment-gutter',
			name: 'Show/hide comments in the gutter',
			icon: 'message-square',
			callback: () => {
				this.settings.gutterCommentsEnabled = !this.settings.gutterCommentsEnabled;
				void this.saveSettings();
				new Notice(
					`Comments in the gutter ${this.settings.gutterCommentsEnabled ? 'shown' : 'hidden'}`,
				);
			},
		});

		// One "Apply - <name>" command per category, kept in sync as they change.
		this.syncCategoryCommands();

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

		// Reading-view gutters and the Note Toolbar highlight both follow the
		// workspace rather than any one file: a leaf switching between Reading
		// and editing modes, a new pane, or a popout window all change what
		// exists to decorate.
		this.toolbarHighlighter = new ToolbarHighlighter(this.app, () => [
			{
				highlight: this.settings.gutterAnnotationsToolbar,
				active: this.settings.gutterAnnotationsEnabled,
			},
			{
				highlight: this.settings.gutterCommentsToolbar,
				active: this.settings.gutterCommentsEnabled,
			},
			{
				highlight: this.settings.textClickJumpToolbar,
				active: this.settings.textClickJumpsToSidebar,
			},
		]);
		const onWorkspaceChange = (): void => {
			this.scheduleReadingGutterSync();
			window.setTimeout(() => this.toolbarHighlighter.refresh(), TOOLBAR_HIGHLIGHT_DELAY_MS);
		};
		this.registerEvent(this.app.workspace.on('layout-change', onWorkspaceChange));
		this.registerEvent(this.app.workspace.on('active-leaf-change', onWorkspaceChange));
		this.registerEvent(this.app.workspace.on('css-change', onWorkspaceChange));
		this.app.workspace.onLayoutReady(onWorkspaceChange);
	}

	onunload(): void {
		for (const timer of this.editorTimers.values()) window.clearTimeout(timer);
		this.editorTimers.clear();
		for (const timer of this.diskTimers.values()) window.clearTimeout(timer);
		this.diskTimers.clear();
		if (this.syncTimer !== null) {
			window.clearTimeout(this.syncTimer);
			this.syncTimer = null;
		}
		if (this.readingGutterTimer !== null) {
			window.clearTimeout(this.readingGutterTimer);
			this.readingGutterTimer = null;
		}
		// Gutter layers live in the editor's own DOM, so they outlive the plugin
		// unless torn down here (detachEditor covers the normal editor-close path).
		for (const gutter of this.gutters.values()) gutter.destroy();
		this.gutters.clear();
		for (const gutter of this.readingGutters.values()) gutter.destroy();
		this.readingGutters.clear();
		this.toolbarHighlighter?.clear();
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
		// A category may have been added, renamed, or deleted — reconcile commands.
		this.syncCategoryCommands();
		for (const view of this.editors) this.decorate(view);
		this.rerenderPreviews();
		this.toolbarHighlighter?.refresh();
		this.notifyChange();
	}

	// ── Per-category commands ("Apply - <name>", one per category) ───────────
	//
	// Registered dynamically so a category added in the settings tab immediately
	// gains its own command — which also lets a Note Toolbar JavaScript item
	// build a live "apply category" menu via ntb.menu() (see README). Removed or
	// renamed categories have their stale command torn down. addCommand prefixes
	// the id with the plugin id; removeCommand needs that full prefixed id.
	private categoryCommandId(categoryName: string): string {
		return `apply-${categoryName}`;
	}

	private syncCategoryCommands(): void {
		const current = new Set(Object.keys(this.settings.categoryStyles));
		for (const name of current) {
			if (this.categoryCommandNames.has(name)) continue;
			this.addCommand({
				id: this.categoryCommandId(name),
				name: `Apply - ${name}`,
				icon: 'highlighter',
				editorCheckCallback: (checking, editor, ctx) => {
					// Offered only while the category still exists (guards the brief
					// window between a delete and the next sync).
					if (!this.settings.categoryStyles[name]) return false;
					if (checking) return true;
					this.applyNamedCategory(editor, ctx, name);
					return true;
				},
			});
			this.categoryCommandNames.add(name);
		}
		for (const name of [...this.categoryCommandNames]) {
			if (current.has(name)) continue;
			this.removeCommand(`${this.manifest.id}:${this.categoryCommandId(name)}`);
			this.categoryCommandNames.delete(name);
		}
	}

	// Selection → highlight with this category; bare cursor → comment carrying it
	// (the marker then renders in that category's color).
	private applyNamedCategory(
		editor: Editor,
		ctx: MarkdownView | MarkdownFileInfo,
		categoryName: string,
	): void {
		const from = editor.posToOffset(editor.getCursor('from'));
		const to = editor.posToOffset(editor.getCursor('to'));
		const type: AnnotationType = from === to ? 'comment' : 'highlight';
		this.addAnnotationFromEditor(editor, ctx, type, categoryName);
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
		const state = this.setStateFromDoc(path, doc);
		// The Reading view's post-processor may have already rendered this note
		// before its annotations were parsed (so nothing was highlighted). Now
		// that state exists, re-render the preview once so formatting appears
		// without needing a manual toggle.
		this.scheduleInitialPreviewRender(path);
		return state;
	}

	private scheduleInitialPreviewRender(path: string): void {
		if (this.initialRendered.has(path)) return;
		this.initialRendered.add(path);
		window.setTimeout(() => this.rerenderPreviewsForPath(path), 0);
	}

	private rerenderPreviewsForPath(path: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.getMode() === 'preview' && view.file?.path === path) {
				view.previewMode.rerender(true);
			}
		}
	}

	// Parse + resolve one document snapshot, persist self-healed selectors,
	// and cache the result.
	private setStateFromDoc(path: string, doc: string): FileAnnotationState {
		const parsed = parseDocument(doc);

		// The category field was spelled "format" before v1.0.20. Reading is
		// transparent either way, so this only rewrites the block's spelling —
		// once, the first time the note is parsed — rather than leaving notes
		// split across two vocabularies forever.
		if (parsed.legacyCategoryKey) {
			this.queue.request(path, (text) => normalizeBlock(text));
		}

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

		// Opt-in orphan repair, running the same relaxed pass the sidebar's
		// "Fix orphans" button runs. Off by default: an orphan you can see and
		// fix beats a highlight that moved without being asked to.
		if (this.settings.autoRepairOrphans) {
			this.repairOrphans(parsed.body, parsed.annotations, outcomes, path);
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

	// Apply one queued block edit through the editor that has `path` open,
	// returning false when no editing view holds it (the caller then writes to
	// the vault as before). `this.editors` only ever holds real note editors —
	// Reading-view-only leaves are absent, and embedded table-cell views are
	// detached — so falling through is exactly the "nobody is editing this"
	// case where a disk write is safe.
	//
	// Two details keep the edit invisible: only the stretch that actually
	// changed is replaced (every mutation here rewrites the end-of-file block,
	// so the diff is a tail edit and the cursor/selection upstream of it never
	// moves), and the transaction is kept out of the undo history — the user
	// did not ask for a selector refresh, so ⌘Z must still undo their typing.
	private applyThroughEditor(path: string, mutate: (text: string) => string): boolean {
		for (const view of this.editors) {
			if (editorViewPath(view) !== path) continue;
			const current = view.state.doc.toString();
			const next = mutate(current);
			// Nothing to do, but the file IS open here — claiming the write stops
			// the vault path from re-writing identical bytes.
			if (next === current) return true;
			let start = 0;
			const shortest = Math.min(current.length, next.length);
			while (start < shortest && current[start] === next[start]) start++;
			let endCurrent = current.length;
			let endNext = next.length;
			while (
				endCurrent > start &&
				endNext > start &&
				current[endCurrent - 1] === next[endNext - 1]
			) {
				endCurrent--;
				endNext--;
			}
			view.dispatch({
				changes: { from: start, to: endCurrent, insert: next.slice(start, endNext) },
				annotations: Transaction.addToHistory.of(false),
			});
			return true;
		}
		return false;
	}

	// ── Editor attachment (called by the CodeMirror ViewPlugin) ──────────────

	attachEditor(view: EditorView): void {
		this.editors.add(view);
		this.gutters.set(view, new EditorGutter(view, this));
	}

	detachEditor(view: EditorView): void {
		this.editors.delete(view);
		this.gutters.get(view)?.destroy();
		this.gutters.delete(view);
		const timer = this.editorTimers.get(view);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.editorTimers.delete(view);
		}
	}

	// The editor reflowed or scrolled — re-place the gutter cards without
	// re-resolving anything.
	onEditorGeometryChange(view: EditorView): void {
		this.gutters.get(view)?.requestLayout();
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
		// The decisive check for Obsidian's nested table-cell editors. It is
		// repeated here (the ViewPlugin already tries) because this runs from a
		// timer, by which point the view's DOM is certainly attached and the
		// nesting is visible — whereas plugin construction can race that.
		//
		// Resolving from such a view would hand setStateFromDoc a single cell's
		// text as if it were the whole note, wiping every annotation the file
		// has. Undo the attachment rather than merely skipping, so no stale
		// gutter is left mounted inside the cell.
		if (isEmbeddedEditorView(view)) {
			this.detachEditor(view);
			return;
		}
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
		applyEditorDecorations(view, state.body, state.annotations, state.outcomes, this.settings, (id) => {
			this.revealAnnotation(path, id);
		});
		this.gutters.get(view)?.sync(path, state.annotations, state.outcomes, this.settings);
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

	// ── Reading-view gutters ─────────────────────────────────────────────────

	// A section of a note finished rendering — its highlight spans and markers
	// (the things the Reading gutter measures) have just moved.
	onReadingRendered(_path: string): void {
		this.scheduleReadingGutterSync();
	}

	private scheduleReadingGutterSync(): void {
		if (this.readingGutterTimer !== null) window.clearTimeout(this.readingGutterTimer);
		this.readingGutterTimer = window.setTimeout(() => {
			this.readingGutterTimer = null;
			this.syncReadingGutters();
		}, READING_GUTTER_DEBOUNCE_MS);
	}

	// Create a gutter for every markdown leaf now in Reading view, refresh the
	// ones that already exist, and tear down any whose leaf has closed or
	// switched back to editing.
	private syncReadingGutters(): void {
		const live = new Set<HTMLElement>();
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.getMode() !== 'preview') continue;
			const path = view.file?.path;
			if (path === undefined) continue;
			const state = this.states.get(path);
			if (!state) {
				// Not parsed yet; ensureFileState notifies when it is.
				void this.ensureFileState(path);
				continue;
			}
			const key = view.contentEl;
			live.add(key);
			let gutter = this.readingGutters.get(key);
			if (!gutter) {
				gutter = new ReadingGutter(key, this);
				this.readingGutters.set(key, gutter);
			}
			gutter.sync(path, state.annotations, state.outcomes, this.settings);
		}
		for (const [key, gutter] of this.readingGutters) {
			if (live.has(key)) continue;
			gutter.destroy();
			this.readingGutters.delete(key);
		}
	}

	// ── Annotation CRUD (used by commands and the sidebar) ───────────────────

	// Selection → annotation (highlight, category picked when several exist);
	// no selection → comment marker at the cursor.
	private annotateOrComment(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): void {
		const from = editor.posToOffset(editor.getCursor('from'));
		const to = editor.posToOffset(editor.getCursor('to'));
		if (from === to) {
			this.addAnnotationFromEditor(editor, ctx, 'comment', '');
			return;
		}
		const names = usableCategoryNames(this.settings);
		const first = names[0];
		if (names.length === 0) {
			new Notice('No annotation categories are enabled — check the plugin settings');
			return;
		}
		if (names.length === 1 && first !== undefined) {
			this.addAnnotationFromEditor(editor, ctx, 'highlight', first);
			return;
		}
		new CategorySuggestModal(this.app, names, (name) => {
			this.addAnnotationFromEditor(editor, ctx, 'highlight', name);
		}).open();
	}

	private addAnnotationFromEditor(
		editor: Editor,
		ctx: MarkdownView | MarkdownFileInfo,
		type: AnnotationType,
		categoryName: string,
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
			category: categoryName,
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

	// Reassign one annotation to a different category (sidebar dropdown).
	setCategory(path: string, id: string, categoryName: string): void {
		this.patchAnnotation(path, id, {
			category: categoryName,
			dateModified: formatTimestamp(Date.now()),
		});
		this.decorateAllFor(path);
		this.rerenderPreviews();
	}

	// Rename a category in settings AND rewrite the "category" field in every
	// annotated note that references the old name (they store the name).
	async renameCategory(oldName: string, newName: string): Promise<boolean> {
		const styles = this.settings.categoryStyles;
		const current = styles[oldName];
		if (!current) return false;
		if (newName === '' || isUnsafeKey(newName) || styles[newName]) return false;

		// Move the key while preserving the display order.
		const next: Record<string, typeof current> = {};
		for (const [key, value] of Object.entries(styles)) {
			next[key === oldName ? newName : key] = value;
		}
		this.settings.categoryStyles = next;
		await this.saveSettings();

		let fileCount = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const doc = await this.app.vault.cachedRead(file);
			if (!doc.includes(BLOCK_OPEN)) continue;
			const { annotations } = parseDocument(doc);
			if (!annotations.some((a) => a.category === oldName)) continue;
			this.queue.request(file.path, (text) => renameAnnotationCategory(text, oldName, newName));
			fileCount++;
			const state = this.states.get(file.path);
			if (state) {
				for (const a of state.annotations) {
					if (a.category === oldName) a.category = newName;
				}
			}
		}
		if (fileCount > 0) {
			new Notice(
				`MD Annotation: renamed category in ${fileCount} note${fileCount === 1 ? '' : 's'}`,
			);
			this.notifyChange();
		}
		return true;
	}

	// Re-resolve every orphaned annotation at the relaxed repair bar, and adopt
	// each one that lands somewhere unambiguous. Mutates `annotations` and
	// `outcomes` in place and queues the new selectors; returns how many were
	// re-anchored. Ambiguous orphans are left alone — two plausible sites are
	// never guessed between, at any confidence bar.
	private repairOrphans(
		body: string,
		annotations: ReadonlyArray<Annotation>,
		outcomes: Map<string, MatchResult>,
		path: string,
	): number {
		let repaired = 0;
		for (const annotation of annotations) {
			const outcome = outcomes.get(annotation.id);
			if (outcome && outcome.status !== 'orphaned') continue;
			const result = repairSelector(body, annotation.selector);
			if (result.status !== 'matched') continue;
			// Re-capture from where it actually landed, so the annotation is
			// anchored to today's text rather than to the drifted original.
			const selector = captureSelector(body, result.start, result.end);
			const dateModified = formatTimestamp(Date.now());
			annotation.selector = selector;
			annotation.dateModified = dateModified;
			outcomes.set(annotation.id, { ...result, refreshedSelector: null });
			this.queue.request(path, (text) =>
				updateAnnotation(text, annotation.id, { selector, dateModified }),
			);
			repaired++;
		}
		return repaired;
	}

	// Sidebar "Fix orphans" button: the same pass, on the note already parsed.
	repairOrphansInNote(path: string): number {
		const state = this.states.get(path);
		if (!state) return 0;
		const repaired = this.repairOrphans(state.body, state.annotations, state.outcomes, path);
		if (repaired > 0) {
			this.decorateAllFor(path);
			this.notifyChange();
		}
		return repaired;
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

	// Sidebar entry → the annotation in the note. Governed by the General-tab
	// "Sidebar click jumps to text" toggle.
	async jumpToAnnotation(path: string, id: string): Promise<void> {
		if (!this.settings.sidebarClickJumpsToText) return;
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
		this.flashAnnotationInText(id);
	}

	// ── Text ⇄ sidebar reveal / sync ─────────────────────────────────────────

	// Called when annotated text or a comment marker is clicked in the editor or
	// Reading view: open the sidebar, scroll to the entry, flash it, and focus
	// its comment box (Update001 "jump the cursor to the Comment text box").
	// Governed by the General-tab "Text click jumps to sidebar" toggle.
	revealAnnotation(path: string, id: string): void {
		if (!this.settings.textClickJumpsToSidebar) return;
		void this.revealInSidebar(path, id, { flash: true, focus: true, activate: true });
	}

	// A gutter card was clicked: scroll the sidebar to the same entry, but only
	// when it is already open. Opening it would move panes around underneath
	// the click, and focusing its comment box would steal the caret from the
	// card the user just clicked into — so this reveals without doing either.
	revealFromGutter(path: string, id: string): void {
		if (!this.hasSidebar()) return;
		void this.revealInSidebar(path, id, { flash: true, focus: false, activate: false });
	}

	// Cursor moved in an editor — when sync is on and the sidebar is open, scroll
	// it to the nearest entry.
	onEditorSelectionChange(view: EditorView): void {
		if (!this.settings.syncTextAndSidebar) return;
		const path = editorViewPath(view);
		if (path === null || !this.hasSidebar()) return;
		const offset = view.state.selection.main.head;
		if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
		this.syncTimer = window.setTimeout(() => {
			this.syncTimer = null;
			const state = this.states.get(path);
			if (!state) return;
			const id = nearestAnnotationId(state.annotations, state.outcomes, offset);
			if (id) void this.revealInSidebar(path, id, { flash: false, focus: false, activate: false });
		}, SYNC_DEBOUNCE_MS);
	}

	// The matched entry nearest the active editor's cursor (used to scroll the
	// sidebar on open and when sync is switched on).
	nearestToCursor(path: string): string | null {
		const state = this.states.get(path);
		if (!state) return null;
		let offset = 0;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.file?.path === path) {
			offset = view.editor.posToOffset(view.editor.getCursor('head'));
		}
		return nearestAnnotationId(state.annotations, state.outcomes, offset);
	}

	private async revealInSidebar(
		path: string,
		id: string,
		opts: { flash: boolean; focus: boolean; activate: boolean },
	): Promise<void> {
		this.pendingReveal = { path, id, flash: opts.flash, focus: opts.focus };
		// Only an explicit click from the note brings the sidebar to the front;
		// passive sync/open scrolling must not steal the right panel.
		if (opts.activate) await this.activateSidebar();
		// A newly created sidebar renders in onOpen and consumes the request;
		// an already-open one needs a nudge.
		this.notifyChange();
	}

	consumePendingReveal(path: string): { id: string; flash: boolean; focus: boolean } | null {
		const reveal = this.pendingReveal;
		if (reveal && reveal.path === path) {
			this.pendingReveal = null;
			return { id: reveal.id, flash: reveal.flash, focus: reveal.focus };
		}
		return null;
	}

	private hasSidebar(): boolean {
		return this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE).length > 0;
	}

	// Briefly highlight every rendered occurrence of an annotation in the note
	// (Update001 "Flash … Comment icon … when SB entry is active"). Public so the
	// sidebar can also fire it when you click into an entry's Note field
	// (Update003) — the flash points out where that entry lives in the text.
	flashAnnotationInText(id: string): void {
		const selector = `[data-mdann-id="${CSS.escape(id)}"]`;
		this.app.workspace.iterateAllLeaves((leaf) => {
			for (const el of Array.from(leaf.view.containerEl.querySelectorAll(selector))) {
				const node = el as HTMLElement;
				node.addClass('mdann-flash-text');
				window.setTimeout(() => node.removeClass('mdann-flash-text'), TEXT_FLASH_MS);
			}
		});
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

	// Ribbon icon / command entry point: closes the sidebar if it's the
	// front-most tab in an expanded right split, otherwise reveals it (same
	// as activateSidebar). Other call sites (new comment, explicit reveal
	// from the note) always want a reveal and must keep calling
	// activateSidebar directly — they must never toggle the sidebar shut.
	async toggleSidebar(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)[0];
		// getActiveViewOfType tracks keyboard focus, not on-screen visibility —
		// with the editor focused (the common case) it reports null even while
		// the sidebar is plainly showing. offsetParent is null only when the
		// element (or an ancestor) isn't rendered, e.g. a background tab behind
		// another one in the same split, so it reflects real visibility instead.
		const visible =
			existing !== undefined &&
			!this.app.workspace.rightSplit.collapsed &&
			existing.view.containerEl.offsetParent !== null;
		if (visible) {
			// detach() + a manual rightSplit.collapse() (tried in v1.0.16-1.0.18)
			// still left the pane visible in some layouts. Obsidian's own core
			// "Toggle the right sidebar" command is what its native collapse arrow
			// runs, so delegate to it rather than keep reimplementing that
			// collapse ourselves — it leaves the leaf (and any other tabs sharing
			// the split, e.g. Backlinks) intact and just hides the pane.
			(this.app as AppWithCommands).commands.executeCommandById(
				TOGGLE_RIGHT_SIDEBAR_COMMAND_ID,
			);
			return;
		}
		await this.activateSidebar();
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
		// Reading view has no equivalent of the editor's decoration pass, so its
		// gutters are refreshed from the same signal the sidebar listens to.
		this.scheduleReadingGutterSync();
	}
}
