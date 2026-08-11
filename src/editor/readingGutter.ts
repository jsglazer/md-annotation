// Margin gutter for the Reading view. Same cards as the editor gutter, but a
// different way of finding out where to put them: the Reading view has no
// CodeMirror geometry to query, so positions come from the bounding rects of
// the highlight spans and comment markers the post-processor has already put
// into the rendered note (every one carries data-mdann-id).
//
// The layers are absolutely positioned children of .markdown-preview-view (the
// scroller), so they scroll with the note without a scroll handler, exactly as
// the editor's layers do inside .cm-scroller. The room they sit in is reserved
// as inline padding on .markdown-preview-sizer (the content element) for the
// same cascade reason as in the editor: Obsidian and themes both set
// --file-margins there, so a rule in styles.css would lose.
//
// A card whose annotation has no rendered anchor is hidden rather than guessed
// at: that happens while a section is still rendering, and it resolves itself
// on the next pass.

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

const SCROLLER_SELECTOR = '.markdown-preview-view';
const SIZER_SELECTOR = '.markdown-preview-sizer';
// Below this a measured margin is taken as "our padding did not apply" and the
// configured width is used instead (mirrors the editor gutter).
const MIN_STRIP = 60;

interface Measured {
	leftX: number;
	leftW: number;
	rightX: number;
	rightW: number;
	suppressed: boolean;
	items: Placement[];
}

export class ReadingGutter {
	private readonly doc: Document;
	private readonly cards: CardLayers;
	private readonly observer: ResizeObserver | null;
	private scroller: HTMLElement | null = null;
	private sizer: HTMLElement | null = null;
	private path = '';
	private width = GUTTER_DEFAULT_WIDTH;
	private activeSides: Record<GutterSide, boolean> = { left: false, right: false };
	// Which types currently have an open margin — see gutterOpenTypes.
	private openTypes: GutterTypes = { annotations: false, comments: false };
	private suppressed = false;
	private frame: number | null = null;
	private destroyed = false;

	constructor(
		private container: HTMLElement,
		host: GutterHost,
	) {
		this.doc = container.ownerDocument;
		this.cards = new CardLayers(
			this.doc,
			host,
			() => this.path,
			() => this.requestLayout(),
		);
		// The preview reflows on window resize, sidebar drags, image loads and
		// callout expansion — all of which move the spans the cards point at.
		const win = this.doc.defaultView;
		this.observer = win
			? new win.ResizeObserver(() => this.requestLayout())
			: null;
	}

	destroy(): void {
		this.destroyed = true;
		this.observer?.disconnect();
		if (this.frame !== null) {
			this.doc.defaultView?.cancelAnimationFrame(this.frame);
			this.frame = null;
		}
		this.activeSides = { left: false, right: false };
		this.applyPadding();
		this.scroller?.removeClasses([
			'mdann-reading-gutter',
			'mdann-gutter-on-left',
			'mdann-gutter-on-right',
			'mdann-gutter-suppressed',
		]);
		this.cards.destroy();
	}

	// Reconcile the cards against the current annotations, then re-place them.
	sync(
		path: string,
		annotations: ReadonlyArray<Annotation>,
		outcomes: ReadonlyMap<string, MatchResult>,
		settings: MdAnnotationSettings,
	): void {
		if (this.destroyed) return;
		this.path = path;
		if (!this.resolveElements()) {
			this.cards.hideAll();
			return;
		}
		this.applyMargins(settings, gutterContent(annotations, outcomes));

		const numbers = numberComments(annotations, outcomes);
		const wanted = new Set<string>();
		for (const annotation of annotations) {
			if (!gutterShows(annotation, settings)) continue;
			// Orphans have no rendered text to sit beside; they stay in the
			// sidebar, which is where they can be re-anchored.
			if (outcomes.get(annotation.id)?.status !== 'matched') continue;
			wanted.add(annotation.id);
			this.cards.upsert(
				annotation,
				gutterSideFor(annotation, settings),
				numbers.get(annotation.id),
				settings,
			);
		}
		this.cards.prune(wanted);
		this.requestLayout();
	}

	requestLayout(): void {
		if (this.destroyed || this.frame !== null) return;
		const win = this.doc.defaultView;
		if (!win) return;
		this.frame = win.requestAnimationFrame(() => {
			this.frame = null;
			if (this.destroyed) return;
			if (!this.resolveElements()) {
				this.cards.hideAll();
				return;
			}
			this.position(this.measure());
		});
	}

	// Find (and re-home the layers into) the current preview elements. Reading
	// view rebuilds them on every re-render, so nothing may be cached across
	// passes; false means this view has no rendered preview right now.
	private resolveElements(): boolean {
		const scroller = this.container.querySelector<HTMLElement>(SCROLLER_SELECTOR);
		const sizer = scroller?.querySelector<HTMLElement>(SIZER_SELECTOR) ?? null;
		if (!scroller || !sizer) return false;

		if (this.scroller !== scroller || this.sizer !== sizer) {
			// Leave no padding behind on an element we are about to stop using.
			if (this.sizer && this.sizer !== sizer) {
				this.sizer.style.removeProperty('padding-left');
				this.sizer.style.removeProperty('padding-right');
			}
			this.scroller?.removeClasses([
				'mdann-reading-gutter',
				'mdann-gutter-on-left',
				'mdann-gutter-on-right',
				'mdann-gutter-suppressed',
			]);
			this.observer?.disconnect();
			this.scroller = scroller;
			this.sizer = sizer;
			this.observer?.observe(scroller);
			this.observer?.observe(sizer);
		}
		scroller.addClass('mdann-reading-gutter');
		this.cards.mount(scroller);
		return true;
	}

	private applyMargins(settings: MdAnnotationSettings, content: GutterContent): void {
		this.width = clampGutterWidth(settings.gutterWidth);
		this.openTypes = gutterOpenTypes(settings, content, this.openTypes);
		this.activeSides = activeGutterSides(settings, this.openTypes);
		this.scroller?.toggleClass('mdann-gutter-on-left', this.activeSides.left);
		this.scroller?.toggleClass('mdann-gutter-on-right', this.activeSides.right);
		this.cards.setLayerWidth(this.width);
		this.applyPadding();
	}

	private applyPadding(): void {
		const sizer = this.sizer;
		if (!sizer) return;
		const set = (prop: string, on: boolean): void => {
			if (on) sizer.style.setProperty(prop, `${this.width}px`, 'important');
			else sizer.style.removeProperty(prop);
		};
		set('padding-left', this.activeSides.left && !this.suppressed);
		set('padding-right', this.activeSides.right && !this.suppressed);
	}

	// ── Measure / position ───────────────────────────────────────────────────

	private measure(): Measured {
		const scroller = this.scroller;
		const sizer = this.sizer;
		if (!scroller || !sizer) {
			return { leftX: 0, leftW: 0, rightX: 0, rightW: 0, suppressed: true, items: [] };
		}

		const reserved =
			(this.activeSides.left ? this.width : 0) + (this.activeSides.right ? this.width : 0);
		const suppressed = scroller.clientWidth < reserved + MIN_TEXT_WIDTH;
		if (suppressed) {
			return { leftX: 0, leftW: 0, rightX: 0, rightW: 0, suppressed, items: [] };
		}

		const scrollRect = scroller.getBoundingClientRect();
		const sizerRect = sizer.getBoundingClientRect();
		// The layers are absolutely positioned in the scroller, so their
		// coordinates are relative to its padding box at scroll offset zero.
		const originX = scrollRect.left - scroller.scrollLeft;
		const originY = scrollRect.top - scroller.scrollTop;

		const items: Placement[] = [];
		for (const [id, card] of this.cards.cards) {
			const anchor = sizer.querySelector<HTMLElement>(`[data-mdann-id="${CSS.escape(id)}"]`);
			const rect = anchor?.getBoundingClientRect();
			// A span that has been wrapped away to nothing (zero-height) is not a
			// usable anchor — treat it as not yet rendered.
			if (!rect || (rect.height === 0 && rect.width === 0)) {
				items.push({ id, side: card.side, anchorY: null, height: 0 });
				continue;
			}
			this.cards.autoSize(card);
			items.push({
				id,
				side: card.side,
				anchorY: rect.top - originY,
				height: card.root.offsetHeight,
			});
		}

		const style = this.doc.defaultView?.getComputedStyle(sizer);
		const strip = (value: string | undefined): number => {
			const n = value === undefined ? Number.NaN : Number.parseFloat(value);
			return Number.isFinite(n) && n >= MIN_STRIP ? n : this.width;
		};
		const rightW = strip(style?.paddingRight);
		return {
			leftX: sizerRect.left - originX,
			leftW: strip(style?.paddingLeft),
			rightX: sizerRect.right - originX - rightW,
			rightW,
			suppressed,
			items,
		};
	}

	private position(m: Measured): void {
		if (this.destroyed) return;
		this.scroller?.toggleClass('mdann-gutter-suppressed', m.suppressed);
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
