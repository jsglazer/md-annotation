// CodeMirror 6 integration: transient mark decorations for Live Preview and
// Source mode, plus widget decorations for point comments (comments added
// with no selection render as a small marker icon). Nothing is ever written
// into the document here — highlights exist only as decorations that map
// through edits between resolutions.
//
// The ViewPlugin below is also how the plugin obtains EditorView handles:
// CodeMirror instantiates it per editor, so no undocumented Obsidian
// internals are needed to reach the editor or dispatch effects.

import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { editorInfoField, setIcon } from 'obsidian';

import type { MatchResult } from '../core/matcher';
import { numberComments } from '../core/ordering';
import type { MdAnnotationSettings } from '../core/settings';
import {
	highlightClasses,
	highlightStyleText,
	markerClasses,
} from '../core/settings';
import type { Annotation } from '../core/types';

// Replaces the current decoration set wholesale after a resolution pass.
export const setAnnotationDecorations = StateEffect.define<DecorationSet>({
	map: (value, mapping) => value.map(mapping),
});

// Between resolutions, existing decorations are mapped through document
// changes so highlights track the text the user is editing.
export const annotationDecoField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		let next = deco.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(setAnnotationDecorations)) next = effect.value;
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

// Minimal surface main.ts must offer the editor layer.
export interface EditorHost {
	attachEditor(view: EditorView): void;
	detachEditor(view: EditorView): void;
	scheduleEditorResolve(view: EditorView, delayMs: number): void;
	// Annotated text (highlight span or comment marker) was clicked in the
	// editor — reveal and focus the matching sidebar entry.
	revealAnnotation(path: string, id: string): void;
	// The cursor/selection moved — used by the "Sync text and sidebar" toggle.
	onEditorSelectionChange(view: EditorView): void;
}

export const EDITOR_RESOLVE_DEBOUNCE_MS = 250;

export function buildEditorExtension(host: EditorHost): Extension {
	const watcher = ViewPlugin.fromClass(
		class {
			constructor(private view: EditorView) {
				host.attachEditor(view);
				host.scheduleEditorResolve(view, 0);
			}

			update(update: {
				docChanged: boolean;
				selectionSet: boolean;
				view: EditorView;
			}): void {
				if (update.docChanged) host.scheduleEditorResolve(update.view, EDITOR_RESOLVE_DEBOUNCE_MS);
				else if (update.selectionSet) host.onEditorSelectionChange(update.view);
			}

			destroy(): void {
				host.detachEditor(this.view);
			}
		},
	);
	// Clicking annotated text reveals its sidebar entry. Marker widgets carry
	// their own listener; this covers mark decorations (highlights/comments).
	const clickReveal = EditorView.domEventHandlers({
		click(event, view): boolean {
			const target = event.target as HTMLElement | null;
			const el = target?.closest('[data-mdann-id]');
			const id = el?.getAttribute('data-mdann-id');
			const path = id ? editorViewPath(view) : null;
			if (id && path) host.revealAnnotation(path, id);
			return false;
		},
	});
	return [annotationDecoField, watcher, clickReveal];
}

// The file path an EditorView is showing, via Obsidian's public state field.
export function editorViewPath(view: EditorView): string | null {
	return view.state.field(editorInfoField, false)?.file?.path ?? null;
}

// Inline marker rendered at a point comment's anchor position. The click
// callback is provided per-decoration pass and deliberately excluded from
// eq() so redraws only happen when the visible bits change.
class CommentMarkerWidget extends WidgetType {
	constructor(
		private annotationId: string,
		private classes: string,
		private styleText: string,
		private label: string,
		private onClick: () => void,
	) {
		super();
	}

	eq(other: CommentMarkerWidget): boolean {
		return (
			other.annotationId === this.annotationId &&
			other.classes === this.classes &&
			other.styleText === this.styleText &&
			other.label === this.label
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const doc = view.dom.ownerDocument;
		const span = doc.createElement('span');
		span.className = this.classes;
		span.setAttribute('data-mdann-id', this.annotationId);
		if (this.styleText !== '') span.setAttribute('style', this.styleText);
		setIcon(span, 'message-square');
		if (this.label !== '') {
			const num = doc.createElement('span');
			num.className = 'mdann-marker-num';
			num.textContent = this.label;
			span.appendChild(num);
		}
		span.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onClick();
		});
		return span;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

// Build and dispatch the decoration set for one editor from resolved matches.
// Range annotations become mark decorations; point comments (start === end)
// become marker widgets. Visibility toggles are applied here:
//   - annotationFormattingEnabled off → no highlight decorations
//   - commentsFormattingEnabled off → range comments undecorated, markers plain
//   - commentsHiddenEnabled on → no markers at all
export function applyEditorDecorations(
	view: EditorView,
	annotations: ReadonlyArray<Annotation>,
	outcomes: ReadonlyMap<string, MatchResult>,
	settings: MdAnnotationSettings,
	onMarkerClick: (annotationId: string) => void,
): void {
	const docLength = view.state.doc.length;
	const ranges: Array<{ from: number; to: number; annotation: Annotation }> = [];
	for (const annotation of annotations) {
		const outcome = outcomes.get(annotation.id);
		if (!outcome || outcome.status !== 'matched') continue;
		const from = Math.max(0, Math.min(outcome.start, docLength));
		const to = Math.min(outcome.end, docLength);
		if (from > to) continue;
		if (from === to) {
			// Point comment marker.
			if (annotation.type !== 'comment' || settings.commentsHiddenEnabled) continue;
			ranges.push({ from, to, annotation });
			continue;
		}
		if (annotation.type === 'highlight' && !settings.annotationFormattingEnabled) continue;
		if (annotation.type === 'comment' && !settings.commentsFormattingEnabled) continue;
		ranges.push({ from, to, annotation });
	}
	ranges.sort((a, b) => a.from - b.from || a.to - b.to);

	const commentNumbers = numberComments(annotations, outcomes);
	const builder = new RangeSetBuilder<Decoration>();
	for (const r of ranges) {
		if (r.from === r.to) {
			const styled = settings.commentsFormattingEnabled;
			const number = commentNumbers.get(r.annotation.id);
			builder.add(
				r.from,
				r.to,
				Decoration.widget({
					widget: new CommentMarkerWidget(
						r.annotation.id,
						markerClasses() + (styled ? '' : ' mdann-marker-plain'),
						styled
							? highlightStyleText(r.annotation.type, r.annotation.format, settings)
							: '',
						number !== undefined ? String(number) : '',
						() => onMarkerClick(r.annotation.id),
					),
					side: 1,
				}),
			);
			continue;
		}
		builder.add(
			r.from,
			r.to,
			Decoration.mark({
				class: highlightClasses(r.annotation.type, r.annotation.format, settings),
				attributes: {
					'data-mdann-id': r.annotation.id,
					style: highlightStyleText(r.annotation.type, r.annotation.format, settings),
				},
			}),
		);
	}
	view.dispatch({ effects: setAnnotationDecorations.of(builder.finish()) });
}
