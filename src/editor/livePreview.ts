// CodeMirror 6 integration: transient mark decorations for Live Preview and
// Source mode. Nothing is ever written into the document here — highlights
// exist only as decorations that map through edits between resolutions.
//
// The ViewPlugin below is also how the plugin obtains EditorView handles:
// CodeMirror instantiates it per editor, so no undocumented Obsidian
// internals are needed to reach the editor or dispatch effects.

import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { editorInfoField } from 'obsidian';

import type { MatchResult } from '../core/matcher';
import type { MdAnnotationSettings } from '../core/settings';
import { highlightClasses, highlightStyleText } from '../core/settings';
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
}

export const EDITOR_RESOLVE_DEBOUNCE_MS = 250;

export function buildEditorExtension(host: EditorHost): Extension {
	const watcher = ViewPlugin.fromClass(
		class {
			constructor(private view: EditorView) {
				host.attachEditor(view);
				host.scheduleEditorResolve(view, 0);
			}

			update(update: { docChanged: boolean; view: EditorView }): void {
				if (update.docChanged) host.scheduleEditorResolve(update.view, EDITOR_RESOLVE_DEBOUNCE_MS);
			}

			destroy(): void {
				host.detachEditor(this.view);
			}
		},
	);
	return [annotationDecoField, watcher];
}

// The file path an EditorView is showing, via Obsidian's public state field.
export function editorViewPath(view: EditorView): string | null {
	return view.state.field(editorInfoField, false)?.file?.path ?? null;
}

// Build and dispatch the decoration set for one editor from resolved matches.
export function applyEditorDecorations(
	view: EditorView,
	annotations: ReadonlyArray<Annotation>,
	outcomes: ReadonlyMap<string, MatchResult>,
	settings: MdAnnotationSettings,
): void {
	const docLength = view.state.doc.length;
	const ranges: Array<{ from: number; to: number; annotation: Annotation }> = [];
	for (const annotation of annotations) {
		const outcome = outcomes.get(annotation.id);
		if (!outcome || outcome.status !== 'matched') continue;
		const from = Math.max(0, outcome.start);
		const to = Math.min(outcome.end, docLength);
		if (from >= to) continue;
		ranges.push({ from, to, annotation });
	}
	ranges.sort((a, b) => a.from - b.from || a.to - b.to);

	const builder = new RangeSetBuilder<Decoration>();
	for (const r of ranges) {
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
