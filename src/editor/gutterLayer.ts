// Margin gutter for Live Preview and Source mode: annotation notes rendered as
// cards in the left and/or right margin of the editor, each vertically aligned
// to the line its annotation is anchored to, with a leader line back to the
// text. The Reading view gets the same cards from readingGutter.ts, which
// measures rendered spans instead of CodeMirror geometry.
//
// The two layers live in view.scrollDOM, which is OUTSIDE contentDOM: the cards
// are therefore never part of the CodeMirror document (they scroll with the
// text natively, and their textareas can never reach CodeMirror's keymaps).
// All geometry is read and written inside view.requestMeasure so a pass never
// interleaves layout reads with layout writes.

import type { EditorView } from '@codemirror/view';

import type { MatchResult } from '../core/matcher';
import { numberComments } from '../core/ordering';
import type { GutterSide, MdAnnotationSettings } from '../core/settings';
import { GUTTER_DEFAULT_WIDTH, clampGutterWidth } from '../core/settings';
import type { Annotation } from '../core/types';
import type { GutterContent, GutterHost, GutterTypes, Placement } from './gutterCards';
import {
	CardLayers,
	MIN_TEXT_WIDTH,
	activeGutterSides,
	gutterContent,
	gutterOpenTypes,
	gutterShows,
	gutterSideFor,
} from './gutterCards';

// A measured margin below this is taken as "our padding rule did not apply"
// (a theme overrode it), and the configured width is used instead.
const MIN_STRIP = 60;

export type { GutterHost };

interface Measured {
	leftX: number;
	leftW: number;
	rightX: number;
	rightW: number;
	suppressed: boolean;
	items: Placement[];
}

export class EditorGutter {
	private readonly doc: Document;
	private readonly cards: CardLayers;
	// Document offset each card is anchored to — the CodeMirror-specific half of
	// a card's position, so it lives here rather than on the shared card.
	private anchors = new Map<string, number>();
	private path = '';
	private width = GUTTER_DEFAULT_WIDTH;
	private activeSides: Record<GutterSide, boolean> = { left: false, right: false };
	// Which types currently have an open margin. Kept across passes because
	// closing one is hysteretic — see gutterOpenTypes.
	private openTypes: GutterTypes = { annotations: false, comments: false };
	private suppressed = false;
	private measurePending = false;
	private layoutDirty = false;
	private destroyed = false;

	constructor(
		private view: EditorView,
		host: GutterHost,
	) {
		this.doc = view.dom.ownerDocument;
		this.cards = new CardLayers(
			this.doc,
			host,
			() => this.path,
			() => this.requestLayout(),
		);
		this.cards.mount(view.scrollDOM);
		// Persistent marker for the padding transition in styles.css: it has to
		// outlive the on-left/on-right classes, or the collapse back to no
		// gutter would have no rule to animate it.
		view.dom.classList.add('mdann-gutter-host');
	}

	destroy(): void {
		this.destroyed = true;
		this.activeSides = { left: false, right: false };
		this.applyPadding();
		this.cards.destroy();
		this.view.dom.classList.remove(
			'mdann-gutter-host',
			'mdann-gutter-on-left',
			'mdann-gutter-on-right',
			'mdann-gutter-suppressed',
		);
	}

	// Reconcile the cards against the current annotations.
	sync(
		path: string,
		annotations: ReadonlyArray<Annotation>,
		outcomes: ReadonlyMap<string, MatchResult>,
		settings: MdAnnotationSettings,
	): void {
		if (this.destroyed) return;
		this.path = path;
		this.applyMargins(settings, gutterContent(annotations, outcomes));

		const numbers = numberComments(annotations, outcomes);
		const docLength = this.view.state.doc.length;
		const wanted = new Set<string>();

		for (const annotation of annotations) {
			if (!gutterShows(annotation, settings)) continue;
			const outcome = outcomes.get(annotation.id);
			if (!outcome || outcome.status !== 'matched') continue;
			wanted.add(annotation.id);
			this.anchors.set(annotation.id, Math.max(0, Math.min(outcome.start, docLength)));
			this.cards.upsert(
				annotation,
				gutterSideFor(annotation, settings),
				numbers.get(annotation.id),
				settings,
			);
		}

		this.cards.prune(wanted);
		for (const id of [...this.anchors.keys()]) {
			if (!wanted.has(id)) this.anchors.delete(id);
		}

		this.requestLayout();
	}

	// Re-place the existing cards without touching their content — the editor
	// resized, reflowed, or scrolled a new stretch of document into view.
	requestLayout(): void {
		if (this.destroyed) return;
		if (this.measurePending) {
			// A pass is already in flight, and it may already have read its list
			// of cards. Dropping this request would strand anything added since
			// — an unpositioned card has no `top` and falls to the top of the
			// file — so remember to run another pass instead.
			this.layoutDirty = true;
			return;
		}
		this.measurePending = true;
		this.view.requestMeasure<Measured>({
			read: (view) => {
				// Anything changed after this point needs a further pass.
				this.layoutDirty = false;
				return this.measure(view);
			},
			write: (measured) => {
				this.measurePending = false;
				this.position(measured);
				if (this.layoutDirty) this.requestLayout();
			},
		});
	}

	// Reserve the margin the cards occupy. Padding is applied per side, not per
	// card, so adding a second annotation never shifts the text — only opening
	// or closing a side does, and styles.css transitions that.
	private applyMargins(settings: MdAnnotationSettings, content: GutterContent): void {
		this.width = clampGutterWidth(settings.gutterWidth);
		this.openTypes = gutterOpenTypes(settings, content, this.openTypes);
		this.activeSides = activeGutterSides(settings, this.openTypes);
		const dom = this.view.dom;
		dom.classList.toggle('mdann-gutter-on-left', this.activeSides.left);
		dom.classList.toggle('mdann-gutter-on-right', this.activeSides.right);
		// A starting width, so a card created this pass is already close to its
		// final size when the measure phase auto-sizes its note box.
		this.cards.setLayerWidth(this.width);
		this.applyPadding();
	}

	// The room itself. This has to be an inline !important declaration, not a
	// rule in styles.css: Obsidian puts --file-margins on .cm-content and themes
	// re-declare it, so a plugin stylesheet loses the cascade no matter what
	// specificity it uses — and a gutter with no padding behind it draws its
	// cards straight over the text.
	private applyPadding(): void {
		const content = this.view.contentDOM;
		const set = (prop: string, on: boolean): void => {
			if (on) content.style.setProperty(prop, `${this.width}px`, 'important');
			else content.style.removeProperty(prop);
		};
		set('padding-left', this.activeSides.left && !this.suppressed);
		set('padding-right', this.activeSides.right && !this.suppressed);
	}

	// ── Measure / position ───────────────────────────────────────────────────

	private measure(view: EditorView): Measured {
		const scroller = view.scrollDOM;
		const reserved =
			(this.activeSides.left ? this.width : 0) + (this.activeSides.right ? this.width : 0);
		const suppressed = scroller.clientWidth < reserved + MIN_TEXT_WIDTH;
		if (suppressed) {
			return { leftX: 0, leftW: 0, rightX: 0, rightW: 0, suppressed, items: [] };
		}

		const scrollRect = scroller.getBoundingClientRect();
		const contentRect = view.contentDOM.getBoundingClientRect();
		// Layers are absolutely positioned children of the scroller, so their
		// coordinates are relative to its padding box at scroll offset zero.
		const originX = scrollRect.left - scroller.scrollLeft;
		const originY = scrollRect.top - scroller.scrollTop;

		const items: Placement[] = [];
		for (const [id, card] of this.cards.cards) {
			const anchor = this.anchors.get(id);
			const coords = anchor === undefined ? null : anchorCoords(view, anchor);
			if (!coords) {
				items.push({ id, side: card.side, anchorY: null, height: 0 });
				continue;
			}
			this.cards.autoSize(card);
			items.push({
				id,
				side: card.side,
				anchorY: coords.top - originY,
				height: card.root.offsetHeight,
			});
		}

		// The content element carries the gutter padding, so each freed strip runs
		// from its border edge inwards by that padding. Reading the padding back
		// rather than assuming it keeps the cards inside whatever room actually
		// exists — including however the theme centres the text.
		const style = this.doc.defaultView?.getComputedStyle(view.contentDOM);
		const strip = (value: string | undefined): number => {
			const n = value === undefined ? Number.NaN : Number.parseFloat(value);
			return Number.isFinite(n) && n >= MIN_STRIP ? n : this.width;
		};
		const rightW = strip(style?.paddingRight);
		return {
			leftX: contentRect.left - originX,
			leftW: strip(style?.paddingLeft),
			rightX: contentRect.right - originX - rightW,
			rightW,
			suppressed,
			items,
		};
	}

	private position(m: Measured): void {
		if (this.destroyed) return;
		this.view.dom.classList.toggle('mdann-gutter-suppressed', m.suppressed);
		if (this.suppressed !== m.suppressed) {
			this.suppressed = m.suppressed;
			this.applyPadding();
		}
		if (m.suppressed) return;
		this.cards.setLayerBox('left', m.leftX, m.leftW);
		this.cards.setLayerBox('right', m.rightX, m.rightW);
		this.cards.place(m.items);
	}
}

// Coordinates for an anchor, or null when its line is not currently rendered.
function anchorCoords(view: EditorView, pos: number): { top: number } | null {
	for (const range of view.visibleRanges) {
		if (pos >= range.from && pos <= range.to) return view.coordsAtPos(pos);
	}
	return null;
}
