// The margin-gutter cards themselves: their DOM, their editing behaviour, and
// the stacking rule that keeps two cards anchored to nearby lines from
// overlapping. Shared by both gutter implementations — the CodeMirror one
// (Live Preview / Source) and the Reading-view one — which differ only in how
// they obtain coordinates, not in what a card is.
//
// Nothing here reads layout: callers hand in already-measured positions, so a
// pass never interleaves layout reads with layout writes.

import type { MatchResult } from '../core/matcher';
import type { GutterSide, MdAnnotationSettings } from '../core/settings';
import { GUTTER_STYLE_PROPS, gutterStyleVars } from '../core/settings';
import type { Annotation } from '../core/types';

// Vertical breathing room between two cards that would otherwise overlap.
const CARD_GAP = 6;
// Where the leader line meets the card, measured down from its top edge.
const LEADER_JOIN = 10;
// Longest quote echoed as placeholder text on a highlight with no note yet.
const PLACEHOLDER_MAX = 60;
// Text the note must keep for itself. Below this the gutters are suppressed
// rather than allowed to squeeze the note.
export const MIN_TEXT_WIDTH = 280;

// The slice of the plugin a gutter card needs: persist an edited note, flash
// the annotation in the text when its card takes focus (the same feedback the
// sidebar gives), and reveal the matching sidebar entry when the card is
// clicked.
export interface GutterHost {
	setComment(path: string, id: string, comment: string): void;
	flashAnnotationInText(id: string): void;
	revealFromGutter(path: string, id: string): void;
}

export interface Card {
	root: HTMLElement;
	leader: HTMLElement;
	tick: HTMLElement;
	num: HTMLElement;
	text: HTMLTextAreaElement;
	side: GutterSide;
	// Value last written into the textarea. An edit round-trips through the
	// document (the annotation block is rewritten), so the resulting state
	// change must not overwrite the box that is still being typed in.
	rendered: string;
	// Last top written, so an unchanged pass touches no styles at all.
	top: number;
	// Value+width the textarea was last auto-sized for.
	sizedFor: string;
}

// One card's measured position: where its anchor sits in layer coordinates and
// how tall the card is. A null anchorY means the anchor is not currently
// rendered (scrolled out of a CodeMirror viewport, or absent from the DOM),
// so the card is hidden until it comes back.
export interface Placement {
	id: string;
	side: GutterSide;
	anchorY: number | null;
	height: number;
}

// The two margin layers and the cards inside them. Elements are reused by
// annotation id rather than rebuilt, which is what keeps an in-progress edit
// (and its caret) alive across the re-resolve that the edit triggers.
export class CardLayers {
	readonly layers: Record<GutterSide, HTMLElement>;
	readonly cards = new Map<string, Card>();
	private readonly doc: Document;

	constructor(
		doc: Document,
		private host: GutterHost,
		private getPath: () => string,
		// A growing note pushes the cards below it down, so the owner has to be
		// told to run another positioning pass.
		private onEdit: () => void,
	) {
		this.doc = doc;
		this.layers = { left: this.createLayer('left'), right: this.createLayer('right') };
	}

	// Move both layers into `parent`. Reading view rebuilds its content element
	// on every re-render, so the layers have to be re-homed rather than assumed
	// to still be attached.
	mount(parent: HTMLElement): void {
		if (this.layers.left.parentElement !== parent) parent.appendChild(this.layers.left);
		if (this.layers.right.parentElement !== parent) parent.appendChild(this.layers.right);
	}

	destroy(): void {
		this.cards.clear();
		this.layers.left.remove();
		this.layers.right.remove();
	}

	setLayerBox(side: GutterSide, left: number, width: number): void {
		this.layers[side].setCssProps({ left: `${left}px`, width: `${width}px` });
	}

	setLayerWidth(width: number): void {
		this.layers.left.setCssProps({ width: `${width}px` });
		this.layers.right.setCssProps({ width: `${width}px` });
	}

	// Create or update the card for one annotation, and return it.
	upsert(
		annotation: Annotation,
		side: GutterSide,
		commentNumber: number | undefined,
		settings: MdAnnotationSettings,
	): Card {
		const card = this.cards.get(annotation.id) ?? this.createCard(annotation.id, side);
		if (card.side !== side) {
			this.attach(card, side);
			card.top = Number.NaN;
		}

		const label = commentNumber === undefined ? '' : String(commentNumber);
		if (card.num.textContent !== label) card.num.textContent = label;

		// A highlight with no note yet echoes its quote as placeholder text, so
		// the card says what it is about and doubles as the box to type into.
		const placeholder =
			annotation.type === 'comment' ? 'Comment…' : excerpt(annotation.selector.exact);
		if (card.text.placeholder !== placeholder) card.text.placeholder = placeholder;

		if (this.doc.activeElement !== card.text && card.rendered !== annotation.comment) {
			card.text.value = annotation.comment;
			card.rendered = annotation.comment;
		}

		card.root.classList.toggle('mdann-gutter-card-closed', annotation.status === 'closed');
		const vars = gutterStyleVars(annotation.type, annotation.category, settings);
		applyStyleProps(card.root, vars);
		applyStyleProps(card.leader, vars);
		return card;
	}

	// Drop every card that is no longer wanted.
	prune(wanted: ReadonlySet<string>): void {
		for (const [id, card] of this.cards) {
			if (wanted.has(id)) continue;
			card.root.remove();
			card.leader.remove();
			this.cards.delete(id);
		}
	}

	// Grow one note box to fit its text. This is the one place a write precedes
	// a read, so callers confine it to their measure phase; it is skipped when
	// neither the text, the available width, nor the font size has changed —
	// the font size lives on card.root (font: inherit on the textarea), so it
	// has to be part of the cache key too, or a size-only settings change
	// leaves the box stuck at its old height.
	autoSize(card: Card): void {
		const key = `${card.text.clientWidth} ${card.root.style.fontSize} ${card.text.value}`;
		if (card.sizedFor === key) return;
		card.text.setCssProps({ height: '0px' });
		card.text.setCssProps({ height: `${card.text.scrollHeight}px` });
		card.sizedFor = key;
	}

	// Cards want to sit level with their anchor; when two would overlap the
	// lower one is pushed down, and its leader stretches back up to the line it
	// belongs to.
	place(items: ReadonlyArray<Placement>): void {
		for (const side of ['left', 'right'] as const) {
			const laid: Array<{ id: string; anchorY: number; height: number }> = [];
			for (const item of items) {
				if (item.side !== side) continue;
				if (item.anchorY === null) this.hideCard(item.id);
				else laid.push({ id: item.id, anchorY: item.anchorY, height: item.height });
			}
			laid.sort((a, b) => a.anchorY - b.anchorY);

			let cursor = Number.NEGATIVE_INFINITY;
			for (const item of laid) {
				const top = Math.max(item.anchorY, cursor);
				this.placeCard(item.id, top, item.anchorY);
				cursor = top + item.height + CARD_GAP;
			}
		}
	}

	hideAll(): void {
		for (const id of this.cards.keys()) this.hideCard(id);
	}

	// ── DOM construction ─────────────────────────────────────────────────────

	private createLayer(side: GutterSide): HTMLElement {
		const el = this.doc.createElement('div');
		el.className = `mdann-gutter mdann-gutter-${side}`;
		return el;
	}

	private createCard(id: string, side: GutterSide): Card {
		// Born hidden. A card is absolutely positioned, so until the first pass
		// gives it a top it would otherwise render at the top of the layer —
		// i.e. pinned to the first line of the file, whatever it is anchored to.
		const leader = this.doc.createElement('div');
		leader.className = 'mdann-gutter-leader mdann-gutter-hidden';
		const tick = this.doc.createElement('div');
		tick.className = 'mdann-gutter-tick';
		leader.appendChild(tick);

		const root = this.doc.createElement('div');
		root.className = 'mdann-gutter-card mdann-gutter-hidden';
		root.setAttribute('data-mdann-id', id);
		const num = this.doc.createElement('span');
		num.className = 'mdann-gutter-num';
		root.appendChild(num);
		const text = this.doc.createElement('textarea');
		text.className = 'mdann-gutter-text';
		text.rows = 1;
		root.appendChild(text);

		const card: Card = {
			root,
			leader,
			tick,
			num,
			text,
			side,
			rendered: '',
			top: Number.NaN,
			sizedFor: '',
		};
		this.attach(card, side);

		text.addEventListener('focus', () => {
			root.classList.add('mdann-gutter-card-active');
			this.host.flashAnnotationInText(id);
		});
		text.addEventListener('blur', () => root.classList.remove('mdann-gutter-card-active'));
		text.addEventListener('input', () => this.onEdit());
		text.addEventListener('change', () => {
			card.rendered = text.value;
			this.host.setComment(this.getPath(), id, text.value);
		});
		// The card sits inside the editor's own scroller. CodeMirror binds its
		// keymaps to contentDOM so they are already out of reach, but Obsidian's
		// global hotkeys are document-level — keep typing in the note to itself.
		text.addEventListener('keydown', (event) => {
			event.stopPropagation();
			if (event.key === 'Escape') text.blur();
		});
		root.addEventListener('mousedown', (event) => event.stopPropagation());
		root.addEventListener('click', (event) => {
			// Clicking a card scrolls the sidebar to the same entry when it is
			// already open (it never opens it — that would move the pane out
			// from under the click).
			this.host.revealFromGutter(this.getPath(), id);
			// The whole card is the note, so clicking its padding starts editing.
			if (event.target === root) text.focus();
		});

		this.cards.set(id, card);
		return card;
	}

	private attach(card: Card, side: GutterSide): void {
		const layer = this.layers[side];
		layer.appendChild(card.leader);
		layer.appendChild(card.root);
		card.side = side;
		card.root.classList.toggle('mdann-gutter-card-left', side === 'left');
		card.leader.classList.toggle('mdann-gutter-leader-left', side === 'left');
	}

	private placeCard(id: string, top: number, anchorY: number): void {
		const card = this.cards.get(id);
		if (!card) return;
		card.root.classList.remove('mdann-gutter-hidden');
		card.leader.classList.remove('mdann-gutter-hidden');
		if (card.top !== top) {
			card.root.setCssProps({ top: `${top}px` });
			card.top = top;
		}
		const join = top + LEADER_JOIN;
		card.leader.setCssProps({
			top: `${Math.min(join, anchorY)}px`,
			height: `${Math.abs(join - anchorY)}px`,
		});
		// The horizontal tick sits at whichever end of the run is the text.
		card.tick.classList.toggle('mdann-gutter-tick-bottom', anchorY > join);
	}

	private hideCard(id: string): void {
		const card = this.cards.get(id);
		if (!card) return;
		card.root.classList.add('mdann-gutter-hidden');
		card.leader.classList.add('mdann-gutter-hidden');
		card.top = Number.NaN;
	}
}

// Which annotations belong in the gutter at all, in one place so both gutters
// agree: the type must be switched on, and an orphan has no position to align
// to (it stays in the sidebar, which is where it can be re-anchored).
export function gutterShows(annotation: Annotation, settings: MdAnnotationSettings): boolean {
	return annotation.type === 'comment'
		? settings.gutterCommentsEnabled
		: settings.gutterAnnotationsEnabled;
}

export function gutterSideFor(annotation: Annotation, settings: MdAnnotationSettings): GutterSide {
	return annotation.type === 'comment'
		? settings.gutterCommentsSide
		: settings.gutterAnnotationsSide;
}

// What one note has to put in the gutter, per type. `matched` is what would be
// drawn right now; `present` also counts annotations that are currently
// orphaned, which is what keeps the margin from collapsing mid-edit — see
// gutterOpenTypes.
export interface GutterContent {
	matched: GutterTypes;
	present: GutterTypes;
}

export interface GutterTypes {
	annotations: boolean;
	comments: boolean;
}

export function gutterContent(
	annotations: ReadonlyArray<Annotation>,
	outcomes: ReadonlyMap<string, MatchResult>,
): GutterContent {
	const matched: GutterTypes = { annotations: false, comments: false };
	const present: GutterTypes = { annotations: false, comments: false };
	for (const annotation of annotations) {
		const key = annotation.type === 'comment' ? 'comments' : 'annotations';
		present[key] = true;
		if (outcomes.get(annotation.id)?.status === 'matched') matched[key] = true;
	}
	return { matched, present };
}

// Whether each type's gutter is open for this note. With
// gutterOnlyWhenAnnotated off this is just the two enable toggles; with it on,
// a margin opens once the note has a card of that type to show.
//
// Closing is deliberately stickier than opening. Editing the very text a
// highlight is anchored to orphans it for a moment, and collapsing the margin
// on that would reflow the note under the cursor mid-keystroke — so a gutter
// that is already open stays open while any annotation of its type remains in
// the note, and closes only once the last one is gone. A note holding nothing
// but orphans still never opens one, since there would be no card in it.
export function gutterOpenTypes(
	settings: MdAnnotationSettings,
	content: GutterContent,
	previous: GutterTypes,
): GutterTypes {
	const open = (key: keyof GutterTypes, enabled: boolean): boolean => {
		if (!enabled) return false;
		if (!settings.gutterOnlyWhenAnnotated) return true;
		if (content.matched[key]) return true;
		return previous[key] && content.present[key];
	};
	return {
		annotations: open('annotations', settings.gutterAnnotationsEnabled),
		comments: open('comments', settings.gutterCommentsEnabled),
	};
}

// Which margins are in use, given which types are open.
export function activeGutterSides(
	settings: MdAnnotationSettings,
	open: GutterTypes,
): Record<GutterSide, boolean> {
	const active = (side: GutterSide): boolean =>
		(open.annotations && settings.gutterAnnotationsSide === side) ||
		(open.comments && settings.gutterCommentsSide === side);
	return { left: active('left'), right: active('right') };
}

function excerpt(text: string): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	if (flat === '') return 'Note…';
	return flat.length > PLACEHOLDER_MAX ? `${flat.slice(0, PLACEHOLDER_MAX)}…` : flat;
}

// Card elements are reused, so a property the new format does not set has to be
// cleared rather than left behind from the old one.
function applyStyleProps(el: HTMLElement, vars: Record<string, string>): void {
	for (const prop of GUTTER_STYLE_PROPS) {
		if (!(prop in vars)) el.style.removeProperty(prop);
	}
	for (const [prop, value] of Object.entries(vars)) el.style.setProperty(prop, value);
}
