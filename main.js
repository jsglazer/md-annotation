"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MdAnnotationPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");

// src/core/annotation.ts
function generateAnnotationId(nowMs, random) {
  const t = Math.max(0, Math.floor(nowMs)).toString(36);
  const clamped = Math.min(Math.max(random, 0), 0.9999999);
  const r = Math.floor(clamped * 36 ** 4).toString(36).padStart(4, "0");
  return `${t}-${r}`;
}
function formatTimestamp(nowMs) {
  return new Date(nowMs).toISOString();
}
function createAnnotation(input) {
  const created = formatTimestamp(input.nowMs);
  return {
    id: input.id,
    type: input.type,
    format: input.format,
    selector: input.selector,
    comment: input.comment,
    author: input.author,
    status: "open",
    dateCreate: created,
    dateModified: created,
    dateClosed: null
  };
}

// src/core/types.ts
function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isTextQuoteSelector(v) {
  return isRecord(v) && typeof v.exact === "string" && typeof v.prefix === "string" && typeof v.suffix === "string";
}
var ANNOTATION_KNOWN_KEYS = [
  "id",
  "type",
  "format",
  "selector",
  "comment",
  "author",
  "status",
  "dateCreate",
  "dateModified",
  "dateClosed"
];
function parseAnnotationValue(v) {
  if (!isRecord(v)) return null;
  if (typeof v.id !== "string" || v.id === "") return null;
  if (v.type !== "highlight" && v.type !== "comment") return null;
  if (typeof v.format !== "string") return null;
  if (!isTextQuoteSelector(v.selector)) return null;
  if (typeof v.comment !== "string") return null;
  if (typeof v.author !== "string") return null;
  if (v.status !== "open" && v.status !== "closed") return null;
  if (typeof v.dateCreate !== "string") return null;
  if (typeof v.dateModified !== "string") return null;
  if (v.dateClosed !== null && typeof v.dateClosed !== "string") return null;
  const known = new Set(ANNOTATION_KNOWN_KEYS);
  let extras;
  for (const key of Object.keys(v)) {
    if (known.has(key)) continue;
    extras = extras != null ? extras : {};
    extras[key] = v[key];
  }
  const annotation = {
    id: v.id,
    type: v.type,
    format: v.format,
    selector: {
      exact: v.selector.exact,
      prefix: v.selector.prefix,
      suffix: v.selector.suffix
    },
    comment: v.comment,
    author: v.author,
    status: v.status,
    dateCreate: v.dateCreate,
    dateModified: v.dateModified,
    dateClosed: v.dateClosed
  };
  if (extras) annotation.extras = extras;
  return annotation;
}
function selectorsEqual(a, b) {
  return a.exact === b.exact && a.prefix === b.prefix && a.suffix === b.suffix;
}

// src/core/block.ts
var BLOCK_OPEN = "%%md-annotation";
var BLOCK_CLOSE = "%%";
function isMarkerLine(line, marker) {
  return line.trimEnd() === marker;
}
function parseDocument(doc) {
  const lines = doc.split("\n");
  let openIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line !== void 0 && isMarkerLine(line, BLOCK_OPEN)) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return { body: doc, annotations: [], unparseable: [] };
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== void 0 && isMarkerLine(line, BLOCK_CLOSE)) {
      closeIdx = i;
      break;
    }
  }
  const contentEnd = closeIdx === -1 ? lines.length : closeIdx;
  const contentLines = lines.slice(openIdx + 1, contentEnd);
  const tailLines = closeIdx === -1 ? [] : lines.slice(closeIdx + 1);
  const tail = tailLines.join("\n");
  const bodyLines = lines.slice(0, openIdx);
  const body = tail.trim() === "" ? bodyLines.join("\n") : bodyLines.join("\n") + "\n" + tail;
  const annotations = [];
  const unparseable = [];
  for (const raw of contentLines) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      unparseable.push(raw);
      continue;
    }
    const annotation = parseAnnotationValue(parsed);
    if (annotation) annotations.push(annotation);
    else unparseable.push(raw);
  }
  return { body, annotations, unparseable };
}
function serializeAnnotationLine(a) {
  const out = {
    id: a.id,
    type: a.type,
    format: a.format,
    selector: { exact: a.selector.exact, prefix: a.selector.prefix, suffix: a.selector.suffix },
    comment: a.comment,
    author: a.author,
    status: a.status,
    dateCreate: a.dateCreate,
    dateModified: a.dateModified,
    dateClosed: a.dateClosed
  };
  if (a.extras) {
    const known = new Set(ANNOTATION_KNOWN_KEYS);
    for (const key of Object.keys(a.extras)) {
      if (!known.has(key)) out[key] = a.extras[key];
    }
  }
  return JSON.stringify(out);
}
function composeDocument(body, annotations, unparseable) {
  if (annotations.length === 0 && unparseable.length === 0) return body;
  const bodyLines = body === "" ? [] : body.split("\n");
  const last = bodyLines[bodyLines.length - 1];
  if (bodyLines.length > 0 && last !== void 0 && last.trimEnd() !== "") bodyLines.push("");
  const blockLines = [
    BLOCK_OPEN,
    ...annotations.map(serializeAnnotationLine),
    ...unparseable,
    BLOCK_CLOSE,
    ""
  ];
  return [...bodyLines, ...blockLines].join("\n");
}
function upsertAnnotation(doc, annotation) {
  const { body, annotations, unparseable } = parseDocument(doc);
  const idx = annotations.findIndex((a) => a.id === annotation.id);
  if (idx === -1) annotations.push(annotation);
  else annotations[idx] = annotation;
  return composeDocument(body, annotations, unparseable);
}
function updateAnnotation(doc, id, patch) {
  const { body, annotations, unparseable } = parseDocument(doc);
  const idx = annotations.findIndex((a) => a.id === id);
  if (idx === -1) return doc;
  const current = annotations[idx];
  if (!current) return doc;
  annotations[idx] = { ...current, ...patch, id };
  return composeDocument(body, annotations, unparseable);
}
function removeAnnotation(doc, id) {
  const { body, annotations, unparseable } = parseDocument(doc);
  const next = annotations.filter((a) => a.id !== id);
  if (next.length === annotations.length) return doc;
  return composeDocument(body, next, unparseable);
}
function removeUnparseableLine(doc, raw) {
  const { body, annotations, unparseable } = parseDocument(doc);
  const idx = unparseable.indexOf(raw);
  if (idx === -1) return doc;
  const next = [...unparseable.slice(0, idx), ...unparseable.slice(idx + 1)];
  return composeDocument(body, annotations, next);
}

// src/core/matcher.ts
var CONTEXT_LENGTH = 32;
var HIGH_CONFIDENCE = 0.75;
var AMBIGUITY_MARGIN = 0.05;
var FUZZY_MIN_QUOTE_LENGTH = 8;
var ANCHOR_KEY_LENGTH = 16;
function captureSelector(text, start, end, contextLength = CONTEXT_LENGTH) {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - contextLength), start),
    suffix: text.slice(end, Math.min(text.length, end + contextLength))
  };
}
function indicesOf(text, needle) {
  const out = [];
  if (needle === "") return out;
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}
function backwardOverlap(expected, text, pos) {
  let n = 0;
  while (n < expected.length && pos - n - 1 >= 0 && text.charAt(pos - n - 1) === expected.charAt(expected.length - 1 - n)) {
    n++;
  }
  return n;
}
function forwardOverlap(expected, text, pos) {
  let n = 0;
  while (n < expected.length && pos + n < text.length && text.charAt(pos + n) === expected.charAt(n)) {
    n++;
  }
  return n;
}
function contextScore(text, start, end, selector) {
  const prefixScore = selector.prefix === "" ? 1 : backwardOverlap(selector.prefix, text, start) / selector.prefix.length;
  const suffixScore = selector.suffix === "" ? 1 : forwardOverlap(selector.suffix, text, end) / selector.suffix.length;
  return (prefixScore + suffixScore) / 2;
}
function bigrams(s) {
  var _a;
  const map = /* @__PURE__ */ new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    map.set(bg, ((_a = map.get(bg)) != null ? _a : 0) + 1);
  }
  return map;
}
function diceSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  let overlap = 0;
  for (const [bg, countA] of aBigrams) {
    const countB = bBigrams.get(bg);
    if (countB !== void 0) overlap += Math.min(countA, countB);
  }
  return 2 * overlap / (a.length - 1 + (b.length - 1));
}
function resolveExact(text, selector) {
  const occurrences = indicesOf(text, selector.exact);
  if (occurrences.length === 0) return null;
  const scored = occurrences.map((start) => ({
    start,
    end: start + selector.exact.length,
    ctx: contextScore(text, start, start + selector.exact.length, selector)
  })).sort((a, b) => b.ctx - a.ctx || a.start - b.start);
  const perfect = scored.filter((s) => s.ctx === 1);
  if (perfect.length === 1) {
    const hit = perfect[0];
    if (!hit) return null;
    return { status: "matched", start: hit.start, end: hit.end, confidence: 1, refreshedSelector: null };
  }
  if (perfect.length > 1) return { status: "orphaned", reason: "ambiguous" };
  const best = scored[0];
  if (!best) return null;
  if (occurrences.length === 1) {
    const confidence2 = 0.75 + 0.25 * best.ctx;
    return acceptWithRefresh(text, best.start, best.end, confidence2, selector);
  }
  const second = scored[1];
  if (second && best.ctx - second.ctx < AMBIGUITY_MARGIN) {
    return { status: "orphaned", reason: "ambiguous" };
  }
  const confidence = 0.5 + 0.5 * best.ctx;
  if (confidence < HIGH_CONFIDENCE) return { status: "orphaned", reason: "ambiguous" };
  return acceptWithRefresh(text, best.start, best.end, confidence, selector);
}
function contextAnchoredCandidates(text, selector) {
  const exact = selector.exact;
  const prefixKey = selector.prefix.slice(-ANCHOR_KEY_LENGTH);
  const suffixKey = selector.suffix.slice(0, ANCHOR_KEY_LENGTH);
  const maxGap = exact.length * 2 + CONTEXT_LENGTH;
  const ranges = [];
  const prefixEnds = prefixKey === "" ? [] : indicesOf(text, prefixKey).map((i) => i + prefixKey.length);
  const suffixStarts = suffixKey === "" ? [] : indicesOf(text, suffixKey);
  for (const p of prefixEnds) {
    for (const s of suffixStarts) {
      if (s >= p && s - p <= maxGap) ranges.push({ start: p, end: s });
    }
    ranges.push({ start: p, end: Math.min(text.length, p + exact.length) });
  }
  for (const s of suffixStarts) {
    ranges.push({ start: Math.max(0, s - exact.length), end: s });
  }
  const seen = /* @__PURE__ */ new Set();
  const candidates = [];
  for (const r of ranges) {
    if (r.end <= r.start) continue;
    const key = `${r.start}:${r.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sim = diceSimilarity(text.slice(r.start, r.end), exact);
    candidates.push({ start: r.start, end: r.end, score: 0.5 + 0.5 * sim });
  }
  return candidates;
}
function fuzzyScanCandidates(text, selector) {
  const exact = selector.exact;
  if (exact.length < FUZZY_MIN_QUOTE_LENGTH || text.length < exact.length) return [];
  const step = Math.max(1, Math.floor(exact.length / 4));
  const coarseHits = [];
  for (let i = 0; i + exact.length <= text.length; i += step) {
    if (diceSimilarity(text.slice(i, i + exact.length), exact) >= 0.6) coarseHits.push(i);
  }
  const refined = [];
  for (const hit of coarseHits) {
    let bestStart = hit;
    let bestSim = 0;
    const from = Math.max(0, hit - step);
    const to = Math.min(text.length - exact.length, hit + step);
    for (let i = from; i <= to; i++) {
      const sim = diceSimilarity(text.slice(i, i + exact.length), exact);
      if (sim > bestSim) {
        bestSim = sim;
        bestStart = i;
      }
    }
    const last = refined[refined.length - 1];
    if (last && Math.abs(bestStart - last.start) < exact.length) {
      if (bestSim > last.sim) {
        last.start = bestStart;
        last.sim = bestSim;
      }
    } else {
      refined.push({ start: bestStart, sim: bestSim });
    }
  }
  return refined.map((r) => ({
    start: r.start,
    end: r.start + exact.length,
    score: 0.85 * r.sim
  }));
}
function sameSite(a, b) {
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (inter <= 0) return false;
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return inter >= shorter / 2;
}
function pickCandidate(text, candidates, selector) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.start - b.start);
  const best = sorted[0];
  if (!best || best.score < HIGH_CONFIDENCE) return null;
  const rival = sorted.slice(1).find((c) => !sameSite(best, c));
  if (rival && best.score - rival.score < AMBIGUITY_MARGIN) {
    return { status: "orphaned", reason: "ambiguous" };
  }
  return acceptWithRefresh(text, best.start, best.end, Math.min(best.score, 0.99), selector);
}
function acceptWithRefresh(text, start, end, confidence, selector) {
  const captured = captureSelector(text, start, end);
  return {
    status: "matched",
    start,
    end,
    confidence,
    refreshedSelector: selectorsEqual(captured, selector) ? null : captured
  };
}
function resolveSelector(text, selector) {
  if (selector.exact === "") return { status: "orphaned", reason: "not-found" };
  const exactResult = resolveExact(text, selector);
  if (exactResult) return exactResult;
  const anchored = pickCandidate(text, contextAnchoredCandidates(text, selector), selector);
  if (anchored) return anchored;
  const fuzzy = pickCandidate(text, fuzzyScanCandidates(text, selector), selector);
  if (fuzzy) return fuzzy;
  return { status: "orphaned", reason: "not-found" };
}
function resolveSelectors(text, selectors) {
  const out = /* @__PURE__ */ new Map();
  for (const { id, selector } of selectors) {
    out.set(id, resolveSelector(text, selector));
  }
  return out;
}

// src/core/queue.ts
var WriteQueue = class {
  constructor(io, delayMs, scheduler, onError = () => void 0) {
    this.io = io;
    this.delayMs = delayMs;
    this.scheduler = scheduler;
    this.onError = onError;
    this.pending = /* @__PURE__ */ new Map();
    // Global write chain — every write appends here, giving strict sequencing.
    this.chain = Promise.resolve();
    this.disposed = false;
  }
  // Queue a mutation for `key`. Restarts that key's debounce window.
  request(key, mutation) {
    if (this.disposed) return;
    const entry = this.pending.get(key);
    if (entry) {
      entry.mutations.push(mutation);
      this.scheduler.clear(entry.timer);
      entry.timer = this.scheduler.set(() => this.fire(key), this.delayMs);
      return;
    }
    this.pending.set(key, {
      mutations: [mutation],
      timer: this.scheduler.set(() => this.fire(key), this.delayMs)
    });
  }
  get pendingCount() {
    return this.pending.size;
  }
  // Fire all pending debounce windows immediately and wait for every queued
  // write to settle.
  flush() {
    for (const key of [...this.pending.keys()]) {
      const entry = this.pending.get(key);
      if (entry) this.scheduler.clear(entry.timer);
      this.fire(key);
    }
    return this.chain;
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.pending.values()) this.scheduler.clear(entry.timer);
    this.pending.clear();
  }
  fire(key) {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    const mutations = entry.mutations;
    const combined = (text) => mutations.reduce((acc, m) => m(acc), text);
    this.chain = this.chain.then(() => this.io.process(key, combined)).catch((error) => {
      this.onError(key, error);
    });
  }
};

// src/core/settings.ts
function themeColors(fontColor = "", backgroundColor = "") {
  return { fontColor, backgroundColor };
}
function defaultSettings() {
  return {
    author: "",
    formats: [
      {
        id: "default",
        name: "Yellow",
        style: {
          light: themeColors("", "#fff3a3"),
          dark: themeColors("", "#7a6f1f")
        }
      }
    ],
    commentUseAnnotationFormats: false,
    commentStyle: {
      light: themeColors("", "#c8e6c9"),
      dark: themeColors("", "#2e5d33")
    }
  };
}
function asRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
}
function readString(v) {
  return typeof v === "string" ? v : "";
}
function readThemeColors(v) {
  const r = asRecord(v);
  if (!r) return themeColors();
  return themeColors(readString(r.fontColor), readString(r.backgroundColor));
}
function readFormatStyle(v) {
  const r = asRecord(v);
  if (!r) return { light: themeColors(), dark: themeColors() };
  return { light: readThemeColors(r.light), dark: readThemeColors(r.dark) };
}
function normalizeSettings(raw) {
  const s = defaultSettings();
  const r = asRecord(raw);
  if (!r) return s;
  if (typeof r.author === "string") s.author = r.author;
  if (typeof r.commentUseAnnotationFormats === "boolean") {
    s.commentUseAnnotationFormats = r.commentUseAnnotationFormats;
  }
  if (r.commentStyle !== void 0) s.commentStyle = readFormatStyle(r.commentStyle);
  if (Array.isArray(r.formats)) {
    const formats = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of r.formats) {
      const f = asRecord(item);
      if (!f) continue;
      const id = readString(f.id);
      if (id === "" || seen.has(id)) continue;
      seen.add(id);
      formats.push({ id, name: readString(f.name), style: readFormatStyle(f.style) });
    }
    if (formats.length > 0) s.formats = formats;
  }
  return s;
}
function normalizeHex(value) {
  const v = value.trim();
  if (v === "") return "";
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (/^[0-9a-fA-F]{6}$/.test(v)) return "#" + v;
  return "";
}
function isValidHex(v) {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}
var HIGHLIGHT_CLASS = "mdann-hl";
var COMMENT_CLASS = "mdann-comment";
function formatClass(formatId) {
  return "mdann-f-" + formatId.replace(/[^a-zA-Z0-9_-]/g, "-");
}
function resolveStyle(annotationType, formatId, settings) {
  var _a;
  if (annotationType === "comment" && !settings.commentUseAnnotationFormats) {
    return settings.commentStyle;
  }
  const found = (_a = settings.formats.find((f) => f.id === formatId)) != null ? _a : settings.formats[0];
  return found ? found.style : settings.commentStyle;
}
function highlightStyleVars(annotationType, formatId, settings) {
  const style = resolveStyle(annotationType, formatId, settings);
  const color = (v, fallback) => isValidHex(v) ? v : fallback;
  return {
    "--mdann-light-fg": color(style.light.fontColor, "inherit"),
    "--mdann-light-bg": color(style.light.backgroundColor, "transparent"),
    "--mdann-dark-fg": color(style.dark.fontColor, "inherit"),
    "--mdann-dark-bg": color(style.dark.backgroundColor, "transparent")
  };
}
function highlightStyleText(annotationType, formatId, settings) {
  return Object.entries(highlightStyleVars(annotationType, formatId, settings)).map(([prop, value]) => `${prop}: ${value};`).join(" ");
}
function highlightClasses(annotationType, formatId, settings) {
  if (annotationType === "comment" && !settings.commentUseAnnotationFormats) {
    return `${HIGHLIGHT_CLASS} ${COMMENT_CLASS}`;
  }
  const known = settings.formats.some((f) => f.id === formatId);
  const fallback = settings.formats[0];
  const id = known ? formatId : fallback ? fallback.id : formatId;
  return `${HIGHLIGHT_CLASS} ${formatClass(id)}`;
}

// src/editor/livePreview.ts
var import_state = require("@codemirror/state");
var import_view = require("@codemirror/view");
var import_obsidian = require("obsidian");
var setAnnotationDecorations = import_state.StateEffect.define({
  map: (value, mapping) => value.map(mapping)
});
var annotationDecoField = import_state.StateField.define({
  create: () => import_view.Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setAnnotationDecorations)) next = effect.value;
    }
    return next;
  },
  provide: (field) => import_view.EditorView.decorations.from(field)
});
var EDITOR_RESOLVE_DEBOUNCE_MS = 250;
function buildEditorExtension(host) {
  const watcher = import_view.ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        host.attachEditor(view);
        host.scheduleEditorResolve(view, 0);
      }
      update(update) {
        if (update.docChanged) host.scheduleEditorResolve(update.view, EDITOR_RESOLVE_DEBOUNCE_MS);
      }
      destroy() {
        host.detachEditor(this.view);
      }
    }
  );
  return [annotationDecoField, watcher];
}
function editorViewPath(view) {
  var _a, _b, _c;
  return (_c = (_b = (_a = view.state.field(import_obsidian.editorInfoField, false)) == null ? void 0 : _a.file) == null ? void 0 : _b.path) != null ? _c : null;
}
function applyEditorDecorations(view, annotations, outcomes, settings) {
  const docLength = view.state.doc.length;
  const ranges = [];
  for (const annotation of annotations) {
    const outcome = outcomes.get(annotation.id);
    if (!outcome || outcome.status !== "matched") continue;
    const from = Math.max(0, outcome.start);
    const to = Math.min(outcome.end, docLength);
    if (from >= to) continue;
    ranges.push({ from, to, annotation });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new import_state.RangeSetBuilder();
  for (const r of ranges) {
    builder.add(
      r.from,
      r.to,
      import_view.Decoration.mark({
        class: highlightClasses(r.annotation.type, r.annotation.format, settings),
        attributes: {
          "data-mdann-id": r.annotation.id,
          style: highlightStyleText(r.annotation.type, r.annotation.format, settings)
        }
      })
    );
  }
  view.dispatch({ effects: setAnnotationDecorations.of(builder.finish()) });
}

// src/editor/readingView.ts
var import_obsidian2 = require("obsidian");
function collectTextSlices(root) {
  var _a;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const slices = [];
  let text = "";
  let node = walker.nextNode();
  while (node) {
    const value = (_a = node.nodeValue) != null ? _a : "";
    slices.push({ node, start: text.length, end: text.length + value.length });
    text += value;
    node = walker.nextNode();
  }
  return { text, slices };
}
function unwrapHighlightSpan(span) {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  parent.normalize();
}
function sweepHighlightSpans(root) {
  for (const span of Array.from(root.querySelectorAll(`span.${HIGHLIGHT_CLASS}`))) {
    unwrapHighlightSpan(span);
  }
}
var HighlightRenderChild = class extends import_obsidian2.MarkdownRenderChild {
  constructor() {
    super(...arguments);
    this.spans = [];
  }
  get spanCount() {
    return this.spans.length;
  }
  // Resolve `selector` against this element's rendered text and wrap the
  // match. The rendered text differs from the markdown source (syntax is
  // stripped), which is exactly what the staged matcher tolerates.
  tryWrap(selector, classes, styleVars, annotationId) {
    const { text, slices } = collectTextSlices(this.containerEl);
    if (text === "") return;
    const result = resolveSelector(text, selector);
    if (result.status !== "matched") return;
    this.wrapRange(slices, result.start, result.end, classes, styleVars, annotationId);
  }
  wrapRange(slices, start, end, classes, styleVars, annotationId) {
    var _a;
    const doc = this.containerEl.ownerDocument;
    for (const slice of slices) {
      const from = Math.max(start, slice.start);
      const to = Math.min(end, slice.end);
      if (from >= to) continue;
      let target = slice.node;
      const localFrom = from - slice.start;
      const localTo = to - slice.start;
      if (localFrom > 0) target = target.splitText(localFrom);
      if (localTo - localFrom < target.length) target.splitText(localTo - localFrom);
      const span = doc.createElement("span");
      span.className = classes;
      span.setAttribute("data-mdann-id", annotationId);
      span.setCssProps(styleVars);
      (_a = target.parentNode) == null ? void 0 : _a.insertBefore(span, target);
      span.appendChild(target);
      this.spans.push(span);
    }
  }
  onunload() {
    for (const span of this.spans) unwrapHighlightSpan(span);
    this.spans = [];
  }
};
function sectionRange(info) {
  var _a;
  const lines = info.text.split("\n");
  if (info.lineStart >= lines.length) return null;
  let offset = 0;
  let start = 0;
  let end = info.text.length;
  for (let i = 0; i < lines.length; i++) {
    if (i === info.lineStart) start = offset;
    offset += ((_a = lines[i]) != null ? _a : "").length + 1;
    if (i === info.lineEnd) {
      end = Math.min(offset - 1, info.text.length);
      break;
    }
  }
  return { start, end };
}
function createReadingPostProcessor(host) {
  return async (el, ctx) => {
    const state = await host.ensureFileState(ctx.sourcePath);
    if (!state || state.annotations.length === 0) return;
    let candidates = state.annotations.filter(
      (a) => {
        var _a;
        return ((_a = state.outcomes.get(a.id)) == null ? void 0 : _a.status) === "matched";
      }
    );
    if (candidates.length === 0) return;
    const section = ctx.getSectionInfo(el);
    const range = section ? sectionRange(section) : null;
    if (range) {
      candidates = candidates.filter((a) => {
        const outcome = state.outcomes.get(a.id);
        return (outcome == null ? void 0 : outcome.status) === "matched" && outcome.start < range.end && outcome.end > range.start;
      });
      if (candidates.length === 0) return;
    }
    const child = new HighlightRenderChild(el);
    for (const annotation of candidates) {
      const outcome = state.outcomes.get(annotation.id);
      if ((outcome == null ? void 0 : outcome.status) !== "matched") continue;
      const selector = captureSelector(state.body, outcome.start, outcome.end);
      child.tryWrap(
        selector,
        highlightClasses(annotation.type, annotation.format, host.settings),
        highlightStyleVars(annotation.type, annotation.format, host.settings),
        annotation.id
      );
    }
    if (child.spanCount > 0) ctx.addChild(child);
  };
}

// src/settingsTab.ts
var import_obsidian3 = require("obsidian");
function isValidHex2(v) {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}
var MdAnnotationSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("mdann-settings");
    new import_obsidian3.Setting(containerEl).setName("Author").setDesc("Name recorded on every annotation and comment you create").addText(
      (text) => text.setValue(this.plugin.settings.author).onChange(async (value) => {
        this.plugin.settings.author = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Annotation formats").setHeading();
    containerEl.createEl("p", {
      text: "Each format defines font and background colors for the light and dark themes. Leave a color empty to inherit the theme default.",
      cls: "setting-item-description"
    });
    for (const format of this.plugin.settings.formats) this.renderFormatRow(containerEl, format);
    new import_obsidian3.Setting(containerEl).addButton(
      (btn) => btn.setButtonText("Add format").setCta().onClick(async () => {
        this.plugin.settings.formats.push({
          id: generateAnnotationId(Date.now(), Math.random()),
          name: "New format",
          style: {
            light: { fontColor: "", backgroundColor: "" },
            dark: { fontColor: "", backgroundColor: "" }
          }
        });
        await this.plugin.saveSettings();
        this.display();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Comments").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Comments use annotation formats").setDesc("On: pick one of the formats above when adding a comment. Off: all comments use the single comment format below.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.commentUseAnnotationFormats).onChange(async (value) => {
        this.plugin.settings.commentUseAnnotationFormats = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (!this.plugin.settings.commentUseAnnotationFormats) {
      this.renderStyleGrid(containerEl, "Comment format", this.plugin.settings.commentStyle);
    }
  }
  renderFormatRow(containerEl, format) {
    const setting = new import_obsidian3.Setting(containerEl).setClass("mdann-format-row");
    setting.addText(
      (text) => text.setPlaceholder("Name").setValue(format.name).onChange(async (value) => {
        format.name = value.trim();
        await this.plugin.saveSettings();
      })
    );
    this.addColorControls(setting.controlEl, format.style);
    setting.addButton(
      (btn) => btn.setButtonText("Delete").onClick(async () => {
        if (this.plugin.settings.formats.length <= 1) return;
        this.plugin.settings.formats = this.plugin.settings.formats.filter(
          (f) => f.id !== format.id
        );
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
  renderStyleGrid(containerEl, label, style) {
    const setting = new import_obsidian3.Setting(containerEl).setName(label);
    this.addColorControls(setting.controlEl, style);
  }
  // Four color cells: light font/background, dark font/background.
  addColorControls(controlEl, style) {
    const grid = controlEl.createDiv({ cls: "mdann-color-grid" });
    const cells = [
      { label: "Light font", colors: style.light, key: "fontColor" },
      { label: "Light bg", colors: style.light, key: "backgroundColor" },
      { label: "Dark font", colors: style.dark, key: "fontColor" },
      { label: "Dark bg", colors: style.dark, key: "backgroundColor" }
    ];
    for (const cell of cells) this.renderColorCell(grid, cell.label, cell.colors, cell.key);
  }
  renderColorCell(grid, label, colors, key) {
    const wrap = grid.createDiv({ cls: "mdann-color-cell" });
    wrap.createEl("span", { text: label, cls: "mdann-color-label" });
    const picker = wrap.createEl("input", { attr: { type: "color" }, cls: "mdann-color-picker" });
    picker.value = isValidHex2(colors[key]) ? colors[key] : "#888888";
    picker.addEventListener("change", () => {
      colors[key] = picker.value;
      void this.plugin.saveSettings();
    });
    const clear = wrap.createEl("button", { text: "\u2715", cls: "mdann-color-clear" });
    clear.setAttribute("aria-label", `Clear ${label.toLowerCase()} color`);
    clear.addEventListener("click", () => {
      colors[key] = "";
      picker.value = "#888888";
      void this.plugin.saveSettings();
    });
    const hex = wrap.createEl("input", {
      cls: "mdann-color-hex",
      attr: { type: "text", maxlength: "7", placeholder: "\u2014", spellcheck: "false" }
    });
    hex.value = colors[key];
    hex.addEventListener("change", () => {
      const norm = normalizeHex(hex.value);
      colors[key] = norm;
      hex.value = norm;
      if (norm !== "") picker.value = norm;
      void this.plugin.saveSettings();
    });
  }
};

// src/ui/formatSuggest.ts
var import_obsidian4 = require("obsidian");
var FormatSuggestModal = class extends import_obsidian4.FuzzySuggestModal {
  constructor(app, formats, onChoose) {
    super(app);
    this.formats = formats;
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a format");
  }
  getItems() {
    return this.formats;
  }
  getItemText(format) {
    return format.name === "" ? format.id : format.name;
  }
  onChooseItem(format) {
    this.onChoose(format);
  }
};

// src/ui/sidebar.ts
var import_obsidian5 = require("obsidian");
var SIDEBAR_VIEW_TYPE = "md-annotation-sidebar";
var AnnotationSidebarView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.unsubscribe = null;
  }
  getViewType() {
    return SIDEBAR_VIEW_TYPE;
  }
  getDisplayText() {
    return "Annotations";
  }
  getIcon() {
    return "highlighter";
  }
  onOpen() {
    this.unsubscribe = this.plugin.onStateChange(() => this.render());
    this.render();
    return Promise.resolve();
  }
  onClose() {
    var _a;
    (_a = this.unsubscribe) == null ? void 0 : _a.call(this);
    this.unsubscribe = null;
    return Promise.resolve();
  }
  render() {
    const active = this.contentEl.ownerDocument.activeElement;
    if (active && this.contentEl.contains(active) && active.tagName === "TEXTAREA") return;
    const root = this.contentEl;
    root.empty();
    root.addClass("mdann-sidebar");
    const file = this.plugin.activeMarkdownFile();
    if (!file) {
      root.createEl("p", { text: "Open a note to see its annotations.", cls: "mdann-empty" });
      return;
    }
    const state = this.plugin.getState(file.path);
    root.createEl("div", { text: file.basename, cls: "mdann-file-title" });
    if (!state || state.annotations.length === 0 && state.unparseable.length === 0) {
      root.createEl("p", { text: "No annotations in this note yet.", cls: "mdann-empty" });
      return;
    }
    const matched = [];
    const orphaned = [];
    for (const annotation of state.annotations) {
      const outcome = state.outcomes.get(annotation.id);
      if ((outcome == null ? void 0 : outcome.status) === "matched") matched.push({ annotation, start: outcome.start });
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
      root.createEl("p", {
        text: "These lines in the annotation block could not be read (often sync-conflict leftovers). They are preserved untouched until you delete them.",
        cls: "mdann-hint"
      });
      for (const raw of state.unparseable) this.renderUnparseable(root, file.path, raw);
    }
  }
  sectionHeader(root, text) {
    root.createEl("div", { text, cls: "mdann-section" });
  }
  renderCard(root, path, annotation, outcome) {
    const isOrphan = outcome === void 0 || outcome.status === "orphaned";
    const card = root.createDiv({ cls: "mdann-card" + (isOrphan ? " mdann-card-orphan" : "") });
    const quote = card.createDiv({ cls: "mdann-quote" });
    const excerpt = annotation.selector.exact.length > 120 ? annotation.selector.exact.slice(0, 120) + "\u2026" : annotation.selector.exact;
    const chip = quote.createEl("span", {
      text: excerpt === "" ? "(empty quote)" : excerpt,
      cls: highlightClasses(annotation.type, annotation.format, this.plugin.settings)
    });
    chip.setCssProps(highlightStyleVars(annotation.type, annotation.format, this.plugin.settings));
    if (!isOrphan) {
      chip.addClass("mdann-quote-clickable");
      chip.addEventListener("click", () => {
        void this.plugin.jumpToAnnotation(path, annotation.id);
      });
    }
    if (isOrphan) {
      const reason = outcome && outcome.status === "orphaned" && outcome.reason === "ambiguous" ? "Multiple equally likely locations \u2014 select the right text and re-anchor." : "Original text not found \u2014 select the new text and re-anchor.";
      card.createEl("div", { text: reason, cls: "mdann-orphan-reason" });
    }
    const comment = card.createEl("textarea", {
      cls: "mdann-comment-input",
      attr: { rows: "2", placeholder: annotation.type === "comment" ? "Comment\u2026" : "Note\u2026" }
    });
    comment.value = annotation.comment;
    comment.addEventListener("change", () => {
      this.plugin.setComment(path, annotation.id, comment.value);
    });
    const meta = card.createDiv({ cls: "mdann-meta" });
    const author = annotation.author === "" ? "unknown author" : annotation.author;
    const created = annotation.dateCreate.slice(0, 10);
    meta.setText(`${author} \xB7 ${created} \xB7 ${annotation.status}`);
    const buttons = card.createDiv({ cls: "mdann-buttons" });
    if (isOrphan) {
      const reanchor = buttons.createEl("button", { text: "Re-anchor to selection" });
      reanchor.addEventListener("click", () => {
        this.plugin.reanchorFromSelection(path, annotation.id);
      });
    } else {
      const toggle = buttons.createEl("button", {
        text: annotation.status === "open" ? "Close" : "Reopen"
      });
      toggle.addEventListener("click", () => {
        this.plugin.setStatus(path, annotation.id, annotation.status === "open" ? "closed" : "open");
      });
    }
    const del = buttons.createEl("button", { text: "Delete", cls: "mod-warning" });
    del.addEventListener("click", () => {
      this.plugin.deleteAnnotation(path, annotation.id);
    });
  }
  renderUnparseable(root, path, raw) {
    const card = root.createDiv({ cls: "mdann-card mdann-card-orphan" });
    card.createEl("code", { text: raw, cls: "mdann-raw-line" });
    const buttons = card.createDiv({ cls: "mdann-buttons" });
    const del = buttons.createEl("button", { text: "Delete line", cls: "mod-warning" });
    del.addEventListener("click", () => {
      this.plugin.deleteUnparseableLine(path, raw);
    });
  }
};

// src/main.ts
var WRITE_DEBOUNCE_MS = 500;
var DISK_REFRESH_DEBOUNCE_MS = 400;
var MdAnnotationPlugin = class extends import_obsidian6.Plugin {
  constructor() {
    super(...arguments);
    this.settings = normalizeSettings(null);
    this.states = /* @__PURE__ */ new Map();
    this.editors = /* @__PURE__ */ new Set();
    this.editorTimers = /* @__PURE__ */ new Map();
    this.diskTimers = /* @__PURE__ */ new Map();
    this.changeListeners = /* @__PURE__ */ new Set();
  }
  async onload() {
    this.settings = normalizeSettings(await this.loadData());
    this.queue = new WriteQueue(
      {
        process: async (path, mutate) => {
          const file = this.app.vault.getFileByPath(path);
          if (!file) return;
          await this.app.vault.process(file, mutate);
        }
      },
      WRITE_DEBOUNCE_MS,
      {
        set: (fn, ms) => window.setTimeout(fn, ms),
        clear: (handle) => window.clearTimeout(handle)
      },
      (key) => new import_obsidian6.Notice(`MD Annotation: failed to write ${key}`)
    );
    this.registerEditorExtension(buildEditorExtension(this));
    this.registerMarkdownPostProcessor(createReadingPostProcessor(this));
    this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new AnnotationSidebarView(leaf, this));
    this.addSettingTab(new MdAnnotationSettingTab(this.app, this));
    this.addRibbonIcon("highlighter", "Open annotation sidebar", () => {
      void this.activateSidebar();
    });
    this.addCommand({
      id: "annotate-selection",
      name: "Annotate selection",
      editorCallback: (editor, ctx) => {
        this.promptAnnotate(editor, ctx);
      }
    });
    this.addCommand({
      id: "comment-selection",
      name: "Comment on selection",
      editorCallback: (editor, ctx) => {
        this.promptComment(editor, ctx);
      }
    });
    this.addCommand({
      id: "open-sidebar",
      name: "Open annotation sidebar",
      callback: () => {
        void this.activateSidebar();
      }
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, ctx) => {
        if (editor.getSelection() === "") return;
        menu.addItem(
          (item) => item.setTitle("Annotate selection").setIcon("highlighter").onClick(() => {
            this.promptAnnotate(editor, ctx);
          })
        );
        menu.addItem(
          (item) => item.setTitle("Comment on selection").setIcon("message-square").onClick(() => {
            this.promptComment(editor, ctx);
          })
        );
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.states.has(file.path)) return;
        this.scheduleDiskRefresh(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const state = this.states.get(oldPath);
        this.states.delete(oldPath);
        if (state) this.states.set(file.path, state);
        this.notifyChange();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.states.delete(file.path);
        this.notifyChange();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && file.extension === "md") void this.ensureFileState(file.path);
        this.notifyChange();
      })
    );
  }
  onunload() {
    for (const timer of this.editorTimers.values()) window.clearTimeout(timer);
    this.editorTimers.clear();
    for (const timer of this.diskTimers.values()) window.clearTimeout(timer);
    this.diskTimers.clear();
    void this.queue.flush().finally(() => this.queue.dispose());
    this.app.workspace.iterateAllLeaves((leaf) => {
      sweepHighlightSpans(leaf.view.containerEl);
    });
  }
  async saveSettings() {
    await this.saveData(this.settings);
    for (const view of this.editors) this.decorate(view);
    this.rerenderPreviews();
    this.notifyChange();
  }
  // ── Per-file state ───────────────────────────────────────────────────────
  getState(path) {
    var _a;
    return (_a = this.states.get(path)) != null ? _a : null;
  }
  async ensureFileState(path) {
    const cached = this.states.get(path);
    if (cached) return cached;
    const file = this.app.vault.getFileByPath(path);
    if (!file || file.extension !== "md") return null;
    const doc = await this.app.vault.cachedRead(file);
    return this.setStateFromDoc(path, doc);
  }
  // Parse + resolve one document snapshot, persist self-healed selectors,
  // and cache the result.
  setStateFromDoc(path, doc) {
    const parsed = parseDocument(doc);
    const outcomes = resolveSelectors(
      parsed.body,
      parsed.annotations.map((a) => ({ id: a.id, selector: a.selector }))
    );
    for (const annotation of parsed.annotations) {
      const outcome = outcomes.get(annotation.id);
      if ((outcome == null ? void 0 : outcome.status) === "matched" && outcome.refreshedSelector) {
        const refreshed = outcome.refreshedSelector;
        annotation.selector = refreshed;
        this.queue.request(
          path,
          (text) => updateAnnotation(text, annotation.id, { selector: refreshed })
        );
      }
    }
    const state = {
      body: parsed.body,
      annotations: parsed.annotations,
      unparseable: parsed.unparseable,
      outcomes
    };
    this.states.set(path, state);
    this.notifyChange();
    return state;
  }
  scheduleDiskRefresh(path) {
    const existing = this.diskTimers.get(path);
    if (existing !== void 0) window.clearTimeout(existing);
    this.diskTimers.set(
      path,
      window.setTimeout(() => {
        this.diskTimers.delete(path);
        if (this.hasEditorFor(path)) return;
        void (async () => {
          const file = this.app.vault.getFileByPath(path);
          if (!file) return;
          const doc = await this.app.vault.cachedRead(file);
          this.setStateFromDoc(path, doc);
        })();
      }, DISK_REFRESH_DEBOUNCE_MS)
    );
  }
  // ── Editor attachment (called by the CodeMirror ViewPlugin) ──────────────
  attachEditor(view) {
    this.editors.add(view);
  }
  detachEditor(view) {
    this.editors.delete(view);
    const timer = this.editorTimers.get(view);
    if (timer !== void 0) {
      window.clearTimeout(timer);
      this.editorTimers.delete(view);
    }
  }
  scheduleEditorResolve(view, delayMs) {
    const existing = this.editorTimers.get(view);
    if (existing !== void 0) window.clearTimeout(existing);
    this.editorTimers.set(
      view,
      window.setTimeout(() => {
        this.editorTimers.delete(view);
        this.resolveEditor(view);
      }, delayMs)
    );
  }
  resolveEditor(view) {
    const path = editorViewPath(view);
    if (path === null) return;
    this.setStateFromDoc(path, view.state.doc.toString());
    this.decorateAllFor(path);
  }
  hasEditorFor(path) {
    for (const view of this.editors) {
      if (editorViewPath(view) === path) return true;
    }
    return false;
  }
  decorate(view) {
    const path = editorViewPath(view);
    if (path === null) return;
    const state = this.states.get(path);
    if (!state) return;
    applyEditorDecorations(view, state.annotations, state.outcomes, this.settings);
  }
  decorateAllFor(path) {
    for (const view of this.editors) {
      if (editorViewPath(view) === path) this.decorate(view);
    }
  }
  rerenderPreviews() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof import_obsidian6.MarkdownView && view.getMode() === "preview") {
        view.previewMode.rerender(true);
      }
    }
  }
  // ── Annotation CRUD (used by commands and the sidebar) ───────────────────
  promptAnnotate(editor, ctx) {
    const formats = this.settings.formats;
    const first = formats[0];
    if (formats.length === 1 && first) {
      this.addAnnotationFromEditor(editor, ctx, "highlight", first.id);
      return;
    }
    new FormatSuggestModal(this.app, formats, (format) => {
      this.addAnnotationFromEditor(editor, ctx, "highlight", format.id);
    }).open();
  }
  promptComment(editor, ctx) {
    if (!this.settings.commentUseAnnotationFormats) {
      this.addAnnotationFromEditor(editor, ctx, "comment", "");
      return;
    }
    new FormatSuggestModal(this.app, this.settings.formats, (format) => {
      this.addAnnotationFromEditor(editor, ctx, "comment", format.id);
    }).open();
  }
  addAnnotationFromEditor(editor, ctx, type, formatId) {
    var _a;
    const path = (_a = ctx.file) == null ? void 0 : _a.path;
    if (path === void 0) return;
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    if (from === to) {
      new import_obsidian6.Notice("Select some text to annotate");
      return;
    }
    const doc = editor.getValue();
    const { body } = parseDocument(doc);
    if (to > body.length) {
      new import_obsidian6.Notice("The annotation block itself cannot be annotated");
      return;
    }
    const selector = captureSelector(body, from, to);
    const annotation = createAnnotation({
      id: generateAnnotationId(Date.now(), Math.random()),
      type,
      format: formatId,
      selector,
      comment: "",
      author: this.settings.author,
      nowMs: Date.now()
    });
    this.queue.request(path, (text) => upsertAnnotation(text, annotation));
    const state = this.states.get(path);
    if (state) {
      state.annotations.push(annotation);
      state.outcomes.set(annotation.id, {
        status: "matched",
        start: from,
        end: to,
        confidence: 1,
        refreshedSelector: null
      });
      this.decorateAllFor(path);
    }
    this.notifyChange();
    if (type === "comment") void this.activateSidebar();
  }
  setComment(path, id, comment) {
    this.patchAnnotation(path, id, { comment, dateModified: formatTimestamp(Date.now()) });
  }
  setStatus(path, id, status) {
    const now = formatTimestamp(Date.now());
    this.patchAnnotation(path, id, {
      status,
      dateClosed: status === "closed" ? now : null,
      dateModified: now
    });
  }
  reanchorFromSelection(path, id) {
    var _a;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!view || ((_a = view.file) == null ? void 0 : _a.path) !== path) {
      new import_obsidian6.Notice("Open the note in an editor and select the new text first");
      return;
    }
    const editor = view.editor;
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    if (from === to) {
      new import_obsidian6.Notice("Select the text to re-anchor this annotation to");
      return;
    }
    const { body } = parseDocument(editor.getValue());
    if (to > body.length) {
      new import_obsidian6.Notice("The annotation block itself cannot be annotated");
      return;
    }
    const selector = captureSelector(body, from, to);
    this.patchAnnotation(path, id, { selector, dateModified: formatTimestamp(Date.now()) });
    const state = this.states.get(path);
    if (state) {
      state.outcomes.set(id, {
        status: "matched",
        start: from,
        end: to,
        confidence: 1,
        refreshedSelector: null
      });
      this.decorateAllFor(path);
      this.notifyChange();
    }
  }
  patchAnnotation(path, id, patch) {
    this.queue.request(path, (text) => updateAnnotation(text, id, patch));
    const state = this.states.get(path);
    if (state) {
      const idx = state.annotations.findIndex((a) => a.id === id);
      const current = state.annotations[idx];
      if (current) state.annotations[idx] = { ...current, ...patch, id };
      this.notifyChange();
    }
  }
  deleteAnnotation(path, id) {
    this.queue.request(path, (text) => removeAnnotation(text, id));
    const state = this.states.get(path);
    if (state) {
      state.annotations = state.annotations.filter((a) => a.id !== id);
      state.outcomes.delete(id);
      this.decorateAllFor(path);
      this.notifyChange();
    }
  }
  deleteUnparseableLine(path, raw) {
    this.queue.request(path, (text) => removeUnparseableLine(text, raw));
    const state = this.states.get(path);
    if (state) {
      const idx = state.unparseable.indexOf(raw);
      if (idx !== -1) state.unparseable.splice(idx, 1);
      this.notifyChange();
    }
  }
  // ── Navigation & sidebar ─────────────────────────────────────────────────
  async jumpToAnnotation(path, id) {
    var _a, _b;
    const state = this.states.get(path);
    const outcome = state == null ? void 0 : state.outcomes.get(id);
    if (!outcome || outcome.status !== "matched") return;
    let view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!view || ((_a = view.file) == null ? void 0 : _a.path) !== path) {
      await this.app.workspace.openLinkText(path, "", false);
      view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    }
    if (!view || ((_b = view.file) == null ? void 0 : _b.path) !== path) return;
    const editor = view.editor;
    const from = editor.offsetToPos(outcome.start);
    const to = editor.offsetToPos(outcome.end);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
  }
  async activateSidebar() {
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
  activeMarkdownFile() {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === "md" ? file : null;
  }
  // ── Change notification (sidebar refresh) ────────────────────────────────
  onStateChange(listener) {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }
  notifyChange() {
    for (const listener of this.changeListeners) listener();
  }
};
