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
function renameAnnotationFormat(doc, oldName, newName) {
  const { body, annotations, unparseable } = parseDocument(doc);
  let changed = false;
  for (const a of annotations) {
    if (a.format === oldName) {
      a.format = newName;
      changed = true;
    }
  }
  if (!changed) return doc;
  return composeDocument(body, annotations, unparseable);
}
function removeUnparseableLine(doc, raw) {
  const { body, annotations, unparseable } = parseDocument(doc);
  const idx = unparseable.indexOf(raw);
  if (idx === -1) return doc;
  const next = [...unparseable.slice(0, idx), ...unparseable.slice(idx + 1)];
  return composeDocument(body, annotations, next);
}

// src/api.ts
function clone(v) {
  return structuredClone(v);
}
var FORMAT_COMMAND_PREFIX = "md-annotation:apply-";
function createApi(vault, getFormatNames) {
  return {
    getFormatNames,
    getFormatCommandId(formatName) {
      return getFormatNames().includes(formatName) ? `${FORMAT_COMMAND_PREFIX}${formatName}` : null;
    },
    async getAnnotations(path) {
      const file = vault.getFileByPath(path);
      if (!file || file.extension !== "md") return [];
      const doc = await vault.cachedRead(file);
      return parseDocument(doc).annotations.map(clone);
    },
    async getAllAnnotations() {
      const out = [];
      for (const file of vault.getMarkdownFiles()) {
        const doc = await vault.cachedRead(file);
        if (!doc.includes(BLOCK_OPEN)) continue;
        const annotations = parseDocument(doc).annotations;
        if (annotations.length > 0) {
          out.push({ path: file.path, annotations: annotations.map(clone) });
        }
      }
      return out;
    }
  };
}

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
function resolvePoint(text, selector) {
  const prefixKey = selector.prefix.slice(-ANCHOR_KEY_LENGTH);
  const suffixKey = selector.suffix.slice(0, ANCHOR_KEY_LENGTH);
  if (prefixKey === "" && suffixKey === "") return { status: "orphaned", reason: "not-found" };
  const positions = /* @__PURE__ */ new Set();
  for (const i of indicesOf(text, prefixKey)) positions.add(i + prefixKey.length);
  for (const i of indicesOf(text, suffixKey)) positions.add(i);
  const scored = [...positions].map((pos) => ({ pos, score: contextScore(text, pos, pos, selector) })).sort((a, b) => b.score - a.score || a.pos - b.pos);
  const best = scored[0];
  if (!best || best.score < HIGH_CONFIDENCE) return { status: "orphaned", reason: "not-found" };
  const rival = scored.slice(1).find((c) => c.pos !== best.pos);
  if (rival && best.score - rival.score < AMBIGUITY_MARGIN) {
    return { status: "orphaned", reason: "ambiguous" };
  }
  return acceptWithRefresh(text, best.pos, best.pos, Math.min(best.score, 1), selector);
}
function resolveSelector(text, selector) {
  if (selector.exact === "") return resolvePoint(text, selector);
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

// src/core/ordering.ts
function numberComments(annotations, outcomes) {
  const matched = [];
  for (const a of annotations) {
    if (a.type !== "comment") continue;
    const outcome = outcomes.get(a.id);
    if ((outcome == null ? void 0 : outcome.status) === "matched") matched.push({ id: a.id, start: outcome.start });
  }
  matched.sort((x, y) => x.start - y.start);
  const map = /* @__PURE__ */ new Map();
  matched.forEach((m, i) => map.set(m.id, i + 1));
  return map;
}
function lineNumberAt(body, offset) {
  const clamped = Math.max(0, Math.min(offset, body.length));
  let line = 1;
  for (let i = 0; i < clamped; i++) {
    if (body.charCodeAt(i) === 10) line++;
  }
  return line;
}
function nearestAnnotationId(annotations, outcomes, offset) {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const a of annotations) {
    const outcome = outcomes.get(a.id);
    if ((outcome == null ? void 0 : outcome.status) !== "matched") continue;
    const dist = offset < outcome.start ? outcome.start - offset : offset > outcome.end ? offset - outcome.end : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = a.id;
    }
  }
  return best;
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
function colorOption(color = "") {
  return { enabled: color !== "", color };
}
function partStyle(fr = "", bg = "") {
  return { fr: colorOption(fr), bg: colorOption(bg) };
}
function makeFormatStyle() {
  return { use: true, fontSize: "", light: partStyle(), dark: partStyle() };
}
function isUnsafeKey(key) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}
function defaultSettings() {
  return {
    author: "",
    formatStyles: {
      Yellow: {
        use: true,
        fontSize: "",
        light: partStyle("", "#fff3a3"),
        dark: partStyle("", "#7a6f1f")
      }
    },
    annotationFormattingEnabled: true,
    commentsFormattingEnabled: true,
    commentsHiddenEnabled: false,
    syncTextAndSidebar: true,
    sidebarClickJumpsToText: true,
    textClickJumpsToSidebar: true,
    commentStyle: {
      light: partStyle("", "#c8e6c9"),
      dark: partStyle("", "#2e5d33")
    }
  };
}
function asRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
}
function readString(v) {
  return typeof v === "string" ? v : "";
}
function readColorOption(v) {
  const r = asRecord(v);
  if (!r) return colorOption();
  return { enabled: r.enabled === true, color: readString(r.color) };
}
function readPartStyle(v) {
  const r = asRecord(v);
  if (!r) return partStyle();
  return { fr: readColorOption(r.fr), bg: readColorOption(r.bg) };
}
function legacyPartStyle(v) {
  const r = asRecord(v);
  if (!r) return partStyle();
  return partStyle(readString(r.fontColor), readString(r.backgroundColor));
}
function readThemedPartStyles(v) {
  const r = asRecord(v);
  if (!r) return { light: partStyle(), dark: partStyle() };
  return { light: readPartStyle(r.light), dark: readPartStyle(r.dark) };
}
function readFormatStyle(v) {
  const r = asRecord(v);
  if (!r) return makeFormatStyle();
  return {
    use: r.use !== false,
    fontSize: readString(r.fontSize),
    light: readPartStyle(r.light),
    dark: readPartStyle(r.dark)
  };
}
function normalizeSettings(raw) {
  const s = defaultSettings();
  const r = asRecord(raw);
  if (!r) return s;
  if (typeof r.author === "string") s.author = r.author;
  const booleanKeys = [
    "annotationFormattingEnabled",
    "commentsFormattingEnabled",
    "commentsHiddenEnabled",
    "syncTextAndSidebar",
    "sidebarClickJumpsToText",
    "textClickJumpsToSidebar"
  ];
  for (const key of booleanKeys) {
    if (typeof r[key] === "boolean") s[key] = r[key];
  }
  const styles = asRecord(r.formatStyles);
  if (styles) {
    const next = {};
    for (const [name, value] of Object.entries(styles)) {
      if (name === "" || isUnsafeKey(name)) continue;
      const v = asRecord(value);
      if (!v) continue;
      next[name] = readFormatStyle(v);
    }
    if (Object.keys(next).length > 0) s.formatStyles = next;
  } else if (Array.isArray(r.formats)) {
    const next = {};
    for (const item of r.formats) {
      const f = asRecord(item);
      if (!f) continue;
      const name = readString(f.name) !== "" ? readString(f.name) : readString(f.id);
      if (name === "" || isUnsafeKey(name) || next[name]) continue;
      const style = asRecord(f.style);
      next[name] = {
        use: true,
        fontSize: "",
        light: legacyPartStyle(style == null ? void 0 : style.light),
        dark: legacyPartStyle(style == null ? void 0 : style.dark)
      };
    }
    if (Object.keys(next).length > 0) s.formatStyles = next;
  }
  const cs = asRecord(r.commentStyle);
  if (cs) {
    const light = asRecord(cs.light);
    if (light && ("fr" in light || "bg" in light)) {
      s.commentStyle = readThemedPartStyles(cs);
    } else {
      s.commentStyle = { light: legacyPartStyle(cs.light), dark: legacyPartStyle(cs.dark) };
    }
  }
  return s;
}
var FORMATS_EXPORT_VERSION = 1;
function exportFormats(settings) {
  const payload = {
    version: FORMATS_EXPORT_VERSION,
    formatStyles: settings.formatStyles,
    commentStyle: settings.commentStyle
  };
  return JSON.stringify(payload, null, "	");
}
function readFormatStyleRecord(v) {
  const styles = asRecord(v);
  const next = {};
  if (!styles) return next;
  for (const [name, value] of Object.entries(styles)) {
    if (name === "" || isUnsafeKey(name)) continue;
    if (!asRecord(value)) continue;
    next[name] = readFormatStyle(value);
  }
  return next;
}
function parseFormatsImport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return null;
  }
  const r = asRecord(raw);
  if (!r) return null;
  const source = "formatStyles" in r ? r.formatStyles : raw;
  const formatStyles = readFormatStyleRecord(source);
  if (Object.keys(formatStyles).length === 0) return null;
  const commentStyle = asRecord(r.commentStyle) ? readThemedPartStyles(r.commentStyle) : null;
  return { formatStyles, commentStyle };
}
function mergeFormats(current, incoming, mode) {
  if (mode === "replace") {
    return { formatStyles: { ...incoming }, added: Object.keys(incoming), skipped: [] };
  }
  const formatStyles = { ...current };
  const added = [];
  const skipped = [];
  for (const [name, style] of Object.entries(incoming)) {
    if (name in formatStyles) {
      skipped.push(name);
      continue;
    }
    formatStyles[name] = style;
    added.push(name);
  }
  return { formatStyles, added, skipped };
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
function isValidFontSize(value) {
  const v = value.trim();
  if (v === "") return false;
  return /^\d+(\.\d+)?(px|pt|em|rem|%|vh|vw)$/.test(v) || /^[a-zA-Z-]+$/.test(v);
}
var HIGHLIGHT_CLASS = "mdann-hl";
var COMMENT_CLASS = "mdann-comment";
var MARKER_CLASS = "mdann-marker";
function formatClass(formatName) {
  return "mdann-f-" + formatName.replace(/[^a-zA-Z0-9_-]/g, "-");
}
function firstUsedFormatName(settings) {
  for (const [name, style] of Object.entries(settings.formatStyles)) {
    if (style.use) return name;
  }
  return "";
}
function usableFormatNames(settings) {
  return Object.entries(settings.formatStyles).filter(([, style]) => style.use).map(([name]) => name);
}
function resolveStyle(annotationType, formatName, settings) {
  if (annotationType === "comment" && formatName === "") {
    return { style: settings.commentStyle, fontSize: "" };
  }
  const exact = settings.formatStyles[formatName];
  if (exact == null ? void 0 : exact.use) return { style: exact, fontSize: exact.fontSize };
  const fallback = settings.formatStyles[firstUsedFormatName(settings)];
  return fallback ? { style: fallback, fontSize: fallback.fontSize } : null;
}
function enabledColor(opt) {
  return opt.enabled && isValidHex(opt.color) ? opt.color : "";
}
function highlightStyleVars(annotationType, formatName, settings) {
  const resolved = resolveStyle(annotationType, formatName, settings);
  if (!resolved) return {};
  const { style, fontSize } = resolved;
  const color = (opt, fallback) => enabledColor(opt) || fallback;
  const vars = {
    "--mdann-light-fg": color(style.light.fr, "inherit"),
    "--mdann-light-bg": color(style.light.bg, "transparent"),
    "--mdann-dark-fg": color(style.dark.fr, "inherit"),
    "--mdann-dark-bg": color(style.dark.bg, "transparent")
  };
  if (isValidFontSize(fontSize)) vars["font-size"] = fontSize.trim();
  return vars;
}
function highlightStyleText(annotationType, formatName, settings) {
  return Object.entries(highlightStyleVars(annotationType, formatName, settings)).map(([prop, value]) => `${prop}: ${value};`).join(" ");
}
function highlightClasses(annotationType, formatName, settings) {
  var _a;
  if (annotationType === "comment" && formatName === "") {
    return `${HIGHLIGHT_CLASS} ${COMMENT_CLASS}`;
  }
  const known = (_a = settings.formatStyles[formatName]) == null ? void 0 : _a.use;
  const name = known ? formatName : firstUsedFormatName(settings);
  return name === "" ? HIGHLIGHT_CLASS : `${HIGHLIGHT_CLASS} ${formatClass(name)}`;
}
function markerClasses() {
  return `${MARKER_CLASS} ${COMMENT_CLASS}`;
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
        else if (update.selectionSet) host.onEditorSelectionChange(update.view);
      }
      destroy() {
        host.detachEditor(this.view);
      }
    }
  );
  const clickReveal = import_view.EditorView.domEventHandlers({
    click(event, view) {
      const target = event.target;
      const el = target == null ? void 0 : target.closest("[data-mdann-id]");
      const id = el == null ? void 0 : el.getAttribute("data-mdann-id");
      const path = id ? editorViewPath(view) : null;
      if (id && path) host.revealAnnotation(path, id);
      return false;
    }
  });
  return [annotationDecoField, watcher, clickReveal];
}
function editorViewPath(view) {
  var _a, _b, _c;
  return (_c = (_b = (_a = view.state.field(import_obsidian.editorInfoField, false)) == null ? void 0 : _a.file) == null ? void 0 : _b.path) != null ? _c : null;
}
var CommentMarkerWidget = class extends import_view.WidgetType {
  constructor(annotationId, classes, styleText, label, onClick) {
    super();
    this.annotationId = annotationId;
    this.classes = classes;
    this.styleText = styleText;
    this.label = label;
    this.onClick = onClick;
  }
  eq(other) {
    return other.annotationId === this.annotationId && other.classes === this.classes && other.styleText === this.styleText && other.label === this.label;
  }
  toDOM(view) {
    const doc = view.dom.ownerDocument;
    const span = doc.createElement("span");
    span.className = this.classes;
    span.setAttribute("data-mdann-id", this.annotationId);
    if (this.styleText !== "") span.setAttribute("style", this.styleText);
    (0, import_obsidian.setIcon)(span, "message-square");
    if (this.label !== "") {
      const num = doc.createElement("span");
      num.className = "mdann-marker-num";
      num.textContent = this.label;
      span.appendChild(num);
    }
    span.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick();
    });
    return span;
  }
  ignoreEvent() {
    return false;
  }
};
function applyEditorDecorations(view, annotations, outcomes, settings, onMarkerClick) {
  const docLength = view.state.doc.length;
  const ranges = [];
  for (const annotation of annotations) {
    const outcome = outcomes.get(annotation.id);
    if (!outcome || outcome.status !== "matched") continue;
    const from = Math.max(0, Math.min(outcome.start, docLength));
    const to = Math.min(outcome.end, docLength);
    if (from > to) continue;
    if (from === to) {
      if (annotation.type !== "comment" || settings.commentsHiddenEnabled) continue;
      ranges.push({ from, to, annotation });
      continue;
    }
    if (annotation.type === "highlight" && !settings.annotationFormattingEnabled) continue;
    if (annotation.type === "comment" && !settings.commentsFormattingEnabled) continue;
    ranges.push({ from, to, annotation });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const commentNumbers = numberComments(annotations, outcomes);
  const builder = new import_state.RangeSetBuilder();
  for (const r of ranges) {
    if (r.from === r.to) {
      const styled = settings.commentsFormattingEnabled;
      const number = commentNumbers.get(r.annotation.id);
      builder.add(
        r.from,
        r.to,
        import_view.Decoration.widget({
          widget: new CommentMarkerWidget(
            r.annotation.id,
            markerClasses() + (styled ? "" : " mdann-marker-plain"),
            styled ? highlightStyleText(r.annotation.type, r.annotation.format, settings) : "",
            number !== void 0 ? String(number) : "",
            () => onMarkerClick(r.annotation.id)
          ),
          side: 1
        })
      );
      continue;
    }
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
  for (const marker of Array.from(root.querySelectorAll(`span.${MARKER_CLASS}`))) {
    marker.remove();
  }
}
var HighlightRenderChild = class extends import_obsidian2.MarkdownRenderChild {
  constructor() {
    super(...arguments);
    this.spans = [];
    this.markers = [];
  }
  get spanCount() {
    return this.spans.length + this.markers.length;
  }
  // Resolve `selector` against this element's rendered text and wrap the
  // match. The rendered text differs from the markdown source (syntax is
  // stripped), which is exactly what the staged matcher tolerates.
  tryWrap(selector, classes, styleVars, annotationId, onClick) {
    const { text, slices } = collectTextSlices(this.containerEl);
    if (text === "") return;
    const result = resolveSelector(text, selector);
    if (result.status !== "matched") return;
    this.wrapRange(slices, result.start, result.end, classes, styleVars, annotationId, onClick);
  }
  // Resolve a point selector (empty quote) against the rendered text and
  // insert a marker icon at the matched position.
  tryMarker(selector, classes, styleVars, annotationId, label, onClick) {
    var _a;
    const { text, slices } = collectTextSlices(this.containerEl);
    if (text === "") return;
    const result = resolveSelector(text, selector);
    if (result.status !== "matched") return;
    const pos = result.start;
    const doc = this.containerEl.ownerDocument;
    const span = doc.createElement("span");
    span.className = classes;
    span.setAttribute("data-mdann-id", annotationId);
    span.setCssProps(styleVars);
    (0, import_obsidian2.setIcon)(span, "message-square");
    if (label !== "") {
      const num = doc.createElement("span");
      num.className = "mdann-marker-num";
      num.textContent = label;
      span.appendChild(num);
    }
    span.addEventListener("click", (e) => {
      e.preventDefault();
      onClick();
    });
    const slice = slices.find((s) => pos >= s.start && pos <= s.end);
    if (!slice) return;
    const local = pos - slice.start;
    const target = local > 0 && local < slice.node.length ? slice.node.splitText(local) : null;
    const anchor = target != null ? target : local === 0 ? slice.node : slice.node.nextSibling;
    (_a = slice.node.parentNode) == null ? void 0 : _a.insertBefore(span, anchor);
    this.markers.push(span);
  }
  wrapRange(slices, start, end, classes, styleVars, annotationId, onClick) {
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
      span.className = classes + " mdann-hl-clickable";
      span.setAttribute("data-mdann-id", annotationId);
      span.setCssProps(styleVars);
      span.addEventListener("click", () => onClick());
      (_a = target.parentNode) == null ? void 0 : _a.insertBefore(span, target);
      span.appendChild(target);
      this.spans.push(span);
    }
  }
  onunload() {
    for (const span of this.spans) unwrapHighlightSpan(span);
    this.spans = [];
    for (const marker of this.markers) marker.remove();
    this.markers = [];
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
function inSection(outcome, range) {
  if (outcome.start === outcome.end) {
    return outcome.start >= range.start && outcome.start <= range.end;
  }
  return outcome.start < range.end && outcome.end > range.start;
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
        return (outcome == null ? void 0 : outcome.status) === "matched" && inSection(outcome, range);
      });
      if (candidates.length === 0) return;
    }
    const settings = host.settings;
    const commentNumbers = numberComments(state.annotations, state.outcomes);
    const child = new HighlightRenderChild(el);
    for (const annotation of candidates) {
      const outcome = state.outcomes.get(annotation.id);
      if ((outcome == null ? void 0 : outcome.status) !== "matched") continue;
      const selector = captureSelector(state.body, outcome.start, outcome.end);
      if (outcome.start === outcome.end) {
        if (annotation.type !== "comment" || settings.commentsHiddenEnabled) continue;
        const styled = settings.commentsFormattingEnabled;
        const number = commentNumbers.get(annotation.id);
        child.tryMarker(
          selector,
          markerClasses() + (styled ? "" : " mdann-marker-plain"),
          styled ? highlightStyleVars(annotation.type, annotation.format, settings) : {},
          annotation.id,
          number !== void 0 ? String(number) : "",
          () => host.revealAnnotation(ctx.sourcePath, annotation.id)
        );
        continue;
      }
      if (annotation.type === "highlight" && !settings.annotationFormattingEnabled) continue;
      if (annotation.type === "comment" && !settings.commentsFormattingEnabled) continue;
      child.tryWrap(
        selector,
        highlightClasses(annotation.type, annotation.format, settings),
        highlightStyleVars(annotation.type, annotation.format, settings),
        annotation.id,
        () => host.revealAnnotation(ctx.sourcePath, annotation.id)
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
function enabledColor2(opt) {
  return opt.enabled && isValidHex2(opt.color) ? opt.color : "";
}
var MdAnnotationSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.pendingFormatName = "";
    this.activeTab = "general";
  }
  isDarkTheme() {
    return this.containerEl.ownerDocument.body.classList.contains("theme-dark");
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("mdann-settings");
    containerEl.createDiv({
      cls: "mdann-settings-version",
      text: `MD Annotation v${this.plugin.manifest.version}`
    });
    const tabBar = containerEl.createDiv("mdann-tab-bar");
    const tabs = [
      { id: "general", label: "General" },
      { id: "annotations", label: "Annotations" },
      { id: "comments", label: "Comments" }
    ];
    for (const tab of tabs) {
      const btn = tabBar.createEl("button", {
        text: tab.label,
        cls: "mdann-tab-btn" + (this.activeTab === tab.id ? " mdann-tab-btn-active" : "")
      });
      btn.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.display();
      });
    }
    if (this.activeTab === "annotations") {
      this.renderAnnotationsTab(containerEl);
      return;
    }
    if (this.activeTab === "comments") {
      this.renderCommentsTab(containerEl);
      return;
    }
    this.renderGeneralTab(containerEl);
  }
  async saveAndRefresh() {
    await this.plugin.saveSettings();
  }
  // ── General tab ──────────────────────────────────────────────────────────
  renderGeneralTab(containerEl) {
    const infoPanel = containerEl.createDiv({ cls: "mdann-info-panel" });
    const p1 = infoPanel.createEl("p");
    p1.appendText("If you encounter errors or have questions, please submit an Issue on the ");
    p1.createEl("a", {
      text: "GitHub page",
      href: "https://github.com/jsglazer/md-annotation",
      attr: { target: "_blank", rel: "noopener" }
    });
    p1.appendText(".");
    const p2 = infoPanel.createEl("p");
    p2.appendText(
      "Annotations and comments are queryable from dataviewjs / datacorejs via "
    );
    p2.createEl("code", { text: "app.plugins.plugins['md-annotation'].api" });
    p2.appendText(".");
    new import_obsidian3.Setting(containerEl).setName("Author").setDesc("Name recorded on every annotation and comment you create").addText(
      (text) => text.setValue(this.plugin.settings.author).onChange(async (value) => {
        this.plugin.settings.author = value.trim();
        await this.plugin.saveSettings();
      })
    );
    this.renderNavigationSection(containerEl);
    this.renderFormatTransferSection(containerEl);
  }
  // The three text ⇄ sidebar navigation behaviours, each independently
  // switchable. All default on.
  renderNavigationSection(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Navigation").setHeading();
    this.renderToggle(
      containerEl,
      "Sync text and sidebar",
      'Moving the cursor in the note scrolls the sidebar to the nearest entry (also toggled by the "Sync text and sidebar" command)',
      () => this.plugin.settings.syncTextAndSidebar,
      (v) => {
        this.plugin.settings.syncTextAndSidebar = v;
      }
    );
    this.renderToggle(
      containerEl,
      "Sidebar click jumps to text",
      "Clicking an annotation or comment entry in the sidebar selects and scrolls to that text in the note",
      () => this.plugin.settings.sidebarClickJumpsToText,
      (v) => {
        this.plugin.settings.sidebarClickJumpsToText = v;
      }
    );
    this.renderToggle(
      containerEl,
      "Text click jumps to sidebar",
      "Clicking annotated text or a comment marker opens the sidebar, scrolls to that entry and puts the cursor in its comment box",
      () => this.plugin.settings.textClickJumpsToSidebar,
      (v) => {
        this.plugin.settings.textClickJumpsToSidebar = v;
      }
    );
  }
  // Formats are stored in this vault's own data.json. Obsidian Sync replicates
  // a vault to itself on other devices — it never bridges two different vaults
  // — so moving formats between vaults is an explicit copy/paste.
  renderFormatTransferSection(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Share formats between vaults").setHeading();
    containerEl.createEl("p", {
      text: "Formats live in this vault only. Obsidian Sync copies a vault to your other devices, not to your other vaults, so formats added in one vault never appear in another. Export them here and import the result in the other vault.",
      cls: "setting-item-description"
    });
    new import_obsidian3.Setting(containerEl).setName("Export formats").setDesc("Copy every format (and the comment style) to the clipboard as JSON").addButton(
      (btn) => btn.setButtonText("Copy to clipboard").onClick(() => {
        const json = exportFormats(this.plugin.settings);
        void navigator.clipboard.writeText(json).then(
          () => {
            const count = Object.keys(this.plugin.settings.formatStyles).length;
            new import_obsidian3.Notice(`Copied ${count} format${count === 1 ? "" : "s"} to the clipboard`);
          },
          () => new import_obsidian3.Notice("Could not write to the clipboard")
        );
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Import formats").setDesc("Paste an exported payload to add its formats to this vault").addButton(
      (btn) => btn.setButtonText("Paste and import").setCta().onClick(() => {
        new ImportFormatsModal(this.app, (text, mode) => this.importFormats(text, mode)).open();
      })
    );
  }
  // Returns an outcome message for the modal; null means the import ran and
  // the modal can close.
  importFormats(text, mode) {
    const parsed = parseFormatsImport(text);
    if (!parsed) return "That does not look like an exported format payload.";
    const result = mergeFormats(this.plugin.settings.formatStyles, parsed.formatStyles, mode);
    this.plugin.settings.formatStyles = result.formatStyles;
    if (parsed.commentStyle) this.plugin.settings.commentStyle = parsed.commentStyle;
    void this.saveAndRefresh().then(() => this.display());
    const added = result.added.length;
    const skipped = result.skipped.length;
    new import_obsidian3.Notice(
      mode === "replace" ? `Replaced formats with ${added} imported format${added === 1 ? "" : "s"}` : `Imported ${added} format${added === 1 ? "" : "s"}` + (skipped > 0 ? `, kept ${skipped} already here` : "")
    );
    return null;
  }
  // ── Annotations tab ──────────────────────────────────────────────────────
  renderAnnotationsTab(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Annotation Visibility").setHeading();
    this.renderToggle(
      containerEl,
      "Annotation formatting",
      'Apply format colors to annotated text (also toggled by the "Show/hide annotation formats" command)',
      () => this.plugin.settings.annotationFormattingEnabled,
      (v) => {
        this.plugin.settings.annotationFormattingEnabled = v;
      }
    );
    new import_obsidian3.Setting(containerEl).setName("Annotation Formats").setHeading();
    containerEl.createEl("p", {
      text: "Per-format colors for annotations. Fr = text color, Bg = background. Each checkbox controls whether that color is applied. Uncheck Use to disable a row without deleting it. Renaming a format also updates every note that references the old name.",
      cls: "setting-item-description"
    });
    this.renderFormatGrid(containerEl);
    new import_obsidian3.Setting(containerEl).setName("Add format").setDesc("Name shown in the format picker and stored on each annotation").addText(
      (text) => text.setPlaceholder("Key").onChange((v) => {
        this.pendingFormatName = v.trim();
      })
    ).addButton(
      (btn) => btn.setButtonText("Add").setCta().onClick(async () => {
        const name = this.pendingFormatName;
        if (!name || isUnsafeKey(name) || this.plugin.settings.formatStyles[name]) return;
        this.plugin.settings.formatStyles[name] = makeFormatStyle();
        await this.saveAndRefresh();
        this.display();
      })
    );
  }
  renderFormatGrid(containerEl) {
    const names = Object.keys(this.plugin.settings.formatStyles).sort();
    if (names.length === 0) {
      containerEl.createEl("p", {
        text: "No formats configured yet \u2014 add one below.",
        cls: "setting-item-description"
      });
      return;
    }
    const wrap = containerEl.createDiv("mdann-grid-wrap");
    const table = wrap.createEl("table", { cls: "mdann-grid-table" });
    const thead = table.createEl("thead");
    const r1 = thead.createEl("tr");
    r1.createEl("th", { text: "Use", attr: { rowspan: "2" } });
    r1.createEl("th", { text: "Name", attr: { rowspan: "2" }, cls: "mdann-grid-name-h" });
    r1.createEl("th", { text: "Light", attr: { colspan: "2" }, cls: "mdann-grid-sep" });
    r1.createEl("th", { text: "Dark", attr: { colspan: "2" }, cls: "mdann-grid-sep" });
    r1.createEl("th", { text: "Size", attr: { rowspan: "2" }, cls: "mdann-grid-sep" });
    r1.createEl("th", { text: "Example", attr: { rowspan: "2" } });
    r1.createEl("th", { text: "", attr: { rowspan: "2" } });
    const r2 = thead.createEl("tr");
    for (let i = 0; i < 4; i++) {
      r2.createEl("th", {
        text: i % 2 === 0 ? "Fr" : "Bg",
        cls: i % 2 === 0 ? "mdann-grid-sep" : ""
      });
    }
    const tbody = table.createEl("tbody");
    for (const name of names) this.renderFormatRow(tbody, name);
  }
  renderFormatRow(tbody, name) {
    const style = this.plugin.settings.formatStyles[name];
    if (!style) return;
    const tr = tbody.createEl("tr");
    tr.toggleClass("mdann-grid-row-unused", !style.use);
    const useTd = tr.createEl("td");
    const useCheck = useTd.createEl("input", {
      attr: { type: "checkbox" },
      cls: "mdann-grid-check"
    });
    useCheck.checked = style.use;
    useCheck.addEventListener("change", () => {
      style.use = useCheck.checked;
      tr.toggleClass("mdann-grid-row-unused", !style.use);
      void this.saveAndRefresh();
    });
    this.renderFormatNameCell(tr, name);
    let exampleTd = null;
    const refreshExample = () => {
      if (exampleTd) this.renderFormatExample(exampleTd, name);
    };
    for (const theme of ["light", "dark"]) {
      for (const field of ["fr", "bg"]) {
        const td = tr.createEl("td", { cls: field === "fr" ? "mdann-grid-sep" : "" });
        this.renderColorCell(td, style[theme][field], refreshExample);
      }
    }
    const sizeTd = tr.createEl("td", { cls: "mdann-grid-sep" });
    const sizeInput = sizeTd.createEl("input", {
      cls: "mdann-grid-size-input",
      attr: { type: "text", placeholder: "\u2014" }
    });
    sizeInput.value = style.fontSize;
    sizeInput.addEventListener("change", () => {
      style.fontSize = sizeInput.value.trim();
      void this.saveAndRefresh();
      refreshExample();
    });
    exampleTd = tr.createEl("td", { cls: "mdann-grid-example" });
    refreshExample();
    const delTd = tr.createEl("td");
    const delBtn = delTd.createEl("button", { text: "Del", cls: "mdann-grid-del" });
    delBtn.addEventListener("click", () => {
      if (Object.keys(this.plugin.settings.formatStyles).length <= 1) {
        new import_obsidian3.Notice("At least one format must remain");
        return;
      }
      new ConfirmModal(this.app, `Delete the format "${name}"? This cannot be undone.`, () => {
        delete this.plugin.settings.formatStyles[name];
        void this.saveAndRefresh().then(() => this.display());
      }).open();
    });
  }
  // Editable name cell: renaming a format moves its style to the new key AND
  // rewrites the stored name in every annotated note (plugin.renameFormat).
  // Validates against blanks, prototype-unsafe keys, and existing names; on
  // a bad name the input reverts to the original and a Notice explains why.
  renderFormatNameCell(tr, name) {
    const td = tr.createEl("td", { cls: "mdann-grid-name" });
    const input = td.createEl("input", {
      cls: "mdann-grid-name-input",
      attr: { type: "text", spellcheck: "false" }
    });
    input.value = name;
    const commit = () => {
      const next = input.value.trim();
      if (next === name) {
        input.value = name;
        return;
      }
      const styles = this.plugin.settings.formatStyles;
      if (!next || isUnsafeKey(next) || styles[next]) {
        new import_obsidian3.Notice(
          !next ? "Format name cannot be empty" : styles[next] ? `Format "${next}" already exists` : `"${next}" is not a valid format name`
        );
        input.value = name;
        return;
      }
      void this.plugin.renameFormat(name, next).then((ok) => {
        if (!ok) input.value = name;
        this.display();
      });
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        input.value = name;
        input.blur();
      }
    });
  }
  renderFormatExample(td, name) {
    td.empty();
    const style = this.plugin.settings.formatStyles[name];
    if (!style) return;
    const theme = this.isDarkTheme() ? "dark" : "light";
    this.appendExampleSpan(
      td,
      "Sample text",
      enabledColor2(style[theme].fr),
      enabledColor2(style[theme].bg),
      isValidFontSize(style.fontSize) ? style.fontSize.trim() : ""
    );
  }
  appendExampleSpan(td, text, color, backgroundColor, fontSize) {
    const span = td.createEl("span", { text });
    span.setCssStyles({ color, backgroundColor, fontSize });
  }
  // One cell bound to a ColorOption: a checkbox, a swatch (native picker), and
  // an editable hex field. The hex field is the primary way to read/set the
  // color — type or paste #rrggbb (the # is optional) and the swatch follows.
  // Setting a color by either control auto-enables the checkbox; the checkbox
  // alone toggles whether the stored color is applied.
  renderColorCell(td, opt, onChanged) {
    const wrap = td.createDiv("mdann-grid-cell");
    const check = wrap.createEl("input", { attr: { type: "checkbox" }, cls: "mdann-grid-check" });
    check.checked = opt.enabled;
    const picker = wrap.createEl("input", { attr: { type: "color" }, cls: "mdann-grid-color" });
    picker.value = isValidHex2(opt.color) ? opt.color : "#888888";
    const hex = wrap.createEl("input", {
      cls: "mdann-grid-hex",
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- '#hex' is a hex-notation placeholder, not prose
      attr: { type: "text", maxlength: "7", placeholder: "#hex", spellcheck: "false" }
    });
    hex.value = isValidHex2(opt.color) ? opt.color : "";
    const autoEnable = () => {
      if (!opt.enabled) {
        opt.enabled = true;
        check.checked = true;
      }
    };
    check.addEventListener("change", () => {
      opt.enabled = check.checked;
      if (opt.enabled && !isValidHex2(opt.color)) {
        opt.color = picker.value;
        hex.value = picker.value;
      }
      void this.saveAndRefresh();
      onChanged();
    });
    picker.addEventListener("input", () => {
      opt.color = picker.value;
      hex.value = picker.value;
      autoEnable();
      onChanged();
    });
    picker.addEventListener("change", () => {
      opt.color = picker.value;
      hex.value = picker.value;
      void this.saveAndRefresh();
      onChanged();
    });
    hex.addEventListener("input", () => {
      const norm = normalizeHex(hex.value);
      if (!norm) return;
      opt.color = norm;
      picker.value = norm;
      autoEnable();
      onChanged();
    });
    hex.addEventListener("change", () => {
      const norm = normalizeHex(hex.value);
      if (norm) {
        hex.value = norm;
        opt.color = norm;
        picker.value = norm;
        autoEnable();
        void this.saveAndRefresh();
        onChanged();
      } else {
        hex.value = isValidHex2(opt.color) ? opt.color : "";
      }
    });
  }
  // ── Comments tab ─────────────────────────────────────────────────────────
  renderCommentsTab(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Comment visibility").setHeading();
    this.renderToggle(
      containerEl,
      "Hide comment markers",
      "Hide comment markers entirely in Live Preview and Reading view",
      () => this.plugin.settings.commentsHiddenEnabled,
      (v) => {
        this.plugin.settings.commentsHiddenEnabled = v;
      }
    );
    this.renderToggle(
      containerEl,
      "Comment formatting",
      'Apply the comment colors to markers (also toggled by the "Show/hide comment formats" command)',
      () => this.plugin.settings.commentsFormattingEnabled,
      (v) => {
        this.plugin.settings.commentsFormattingEnabled = v;
      }
    );
    new import_obsidian3.Setting(containerEl).setName("Comment format").setHeading();
    containerEl.createEl("p", {
      text: "Colors for comment markers (comments are added with no text selected and render as a small icon at the insertion point). Fr = icon color, Bg = background.",
      cls: "setting-item-description"
    });
    this.renderCommentGrid(containerEl, this.plugin.settings.commentStyle);
  }
  renderCommentGrid(containerEl, style) {
    const wrap = containerEl.createDiv("mdann-grid-wrap");
    const table = wrap.createEl("table", { cls: "mdann-grid-table" });
    const thead = table.createEl("thead");
    const r1 = thead.createEl("tr");
    r1.createEl("th", { text: "Light", attr: { colspan: "2" } });
    r1.createEl("th", { text: "Dark", attr: { colspan: "2" }, cls: "mdann-grid-sep" });
    r1.createEl("th", { text: "Example", attr: { rowspan: "2" }, cls: "mdann-grid-sep" });
    const r2 = thead.createEl("tr");
    for (let i = 0; i < 4; i++) {
      r2.createEl("th", {
        text: i % 2 === 0 ? "Fr" : "Bg",
        cls: i > 0 && i % 2 === 0 ? "mdann-grid-sep" : ""
      });
    }
    const tbody = table.createEl("tbody");
    const tr = tbody.createEl("tr");
    let exampleTd = null;
    const refreshExample = () => {
      if (!exampleTd) return;
      exampleTd.empty();
      const theme = this.isDarkTheme() ? "dark" : "light";
      const part = style[theme];
      this.appendExampleSpan(exampleTd, "\u{1F4AC} comment", enabledColor2(part.fr), enabledColor2(part.bg), "");
    };
    for (const theme of ["light", "dark"]) {
      for (const field of ["fr", "bg"]) {
        const td = tr.createEl("td", {
          cls: theme === "dark" && field === "fr" ? "mdann-grid-sep" : ""
        });
        this.renderColorCell(td, style[theme][field], refreshExample);
      }
    }
    exampleTd = tr.createEl("td", { cls: "mdann-grid-example mdann-grid-sep" });
    refreshExample();
  }
  // ── Shared small controls ────────────────────────────────────────────────
  renderToggle(containerEl, name, desc, getValue, setValue) {
    new import_obsidian3.Setting(containerEl).setName(name).setDesc(desc).addToggle(
      (toggle) => toggle.setValue(getValue()).onChange(async (v) => {
        setValue(v);
        await this.saveAndRefresh();
      })
    );
  }
};
var ImportFormatsModal = class extends import_obsidian3.Modal {
  constructor(app, onImport) {
    super(app);
    this.onImport = onImport;
  }
  onOpen() {
    this.contentEl.createEl("h3", { text: "Import formats" });
    this.contentEl.createEl("p", {
      text: "Paste the JSON copied by the export button in the other vault.",
      cls: "setting-item-description"
    });
    const input = this.contentEl.createEl("textarea", {
      cls: "mdann-import-input",
      attr: { rows: "10", placeholder: '{ "version": 1, "formatStyles": { \u2026 } }', spellcheck: "false" }
    });
    const error = this.contentEl.createEl("p", { cls: "mdann-import-error" });
    const run = (mode) => {
      const message = this.onImport(input.value, mode);
      if (message === null) {
        this.close();
        return;
      }
      error.setText(message);
    };
    const buttonRow = this.contentEl.createDiv("mdann-confirm-buttons");
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    const replaceBtn = buttonRow.createEl("button", { text: "Replace all", cls: "mod-warning" });
    replaceBtn.addEventListener("click", () => {
      new ConfirmModal(
        this.app,
        "Replace every format in this vault with the imported ones? Annotations using a format that is not in the payload will fall back to the first enabled format until you reassign them.",
        () => run("replace"),
        "Replace all"
      ).open();
    });
    const mergeBtn = buttonRow.createEl("button", { text: "Merge", cls: "mod-cta" });
    mergeBtn.addEventListener("click", () => run("merge"));
    input.focus();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmModal = class extends import_obsidian3.Modal {
  constructor(app, message, onConfirm, confirmText = "Delete") {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.confirmText = confirmText;
  }
  onOpen() {
    this.contentEl.createEl("p", { text: this.message });
    const buttonRow = this.contentEl.createDiv("mdann-confirm-buttons");
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    const confirmBtn = buttonRow.createEl("button", { text: this.confirmText, cls: "mod-warning" });
    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/formatSuggest.ts
var import_obsidian4 = require("obsidian");
var FormatSuggestModal = class extends import_obsidian4.FuzzySuggestModal {
  constructor(app, names, onChoose) {
    super(app);
    this.names = names;
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a format");
  }
  getItems() {
    return this.names;
  }
  getItemText(name) {
    return name;
  }
  onChooseItem(name) {
    this.onChoose(name);
  }
};

// src/ui/sidebar.ts
var import_obsidian5 = require("obsidian");
var SIDEBAR_VIEW_TYPE = "md-annotation-sidebar";
var FLASH_MS = 1200;
var COMMENT_FILTER = "c:";
function filterValue(annotation) {
  return annotation.format === "" ? COMMENT_FILTER : `f:${annotation.format}`;
}
function filterLabel(annotation) {
  return annotation.format === "" ? "Comment" : annotation.format;
}
var AnnotationSidebarView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.unsubscribe = null;
    // One card element per annotation id, rebuilt each render, so reveal/sync
    // can scroll to and highlight a specific entry.
    this.cardEls = /* @__PURE__ */ new Map();
    // Ids of the cards currently rendered, in display order — what First/Last
    // jump to, so they honor the active search/filter.
    this.visibleOrder = [];
    // True until the first render after opening, so we can scroll to the entry
    // nearest the cursor exactly once on open.
    this.freshOpen = true;
    // Toolbar state, kept across re-renders (the panel rebuilds on every change).
    this.searchQuery = "";
    this.formatFilter = "";
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
    this.freshOpen = true;
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
    const prevScroll = root.scrollTop;
    const searchCaret = active instanceof HTMLInputElement && active.hasClass("mdann-search-input") ? active.selectionStart : null;
    root.empty();
    root.addClass("mdann-sidebar");
    this.cardEls.clear();
    this.visibleOrder = [];
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
    const commentNumbers = numberComments(state.annotations, state.outcomes);
    const matched = [];
    const orphaned = [];
    for (const annotation of state.annotations) {
      const outcome = state.outcomes.get(annotation.id);
      if ((outcome == null ? void 0 : outcome.status) === "matched") matched.push({ annotation, start: outcome.start });
      else orphaned.push(annotation);
    }
    matched.sort((a, b) => a.start - b.start);
    this.renderToolbar(root, state.annotations);
    const visibleMatched = matched.filter((m) => this.passesFilters(m.annotation));
    const visibleOrphaned = orphaned.filter((a) => this.passesFilters(a));
    if (visibleMatched.length > 0) {
      this.sectionHeader(root, this.countLabel("Annotations", visibleMatched.length, matched.length));
      for (const { annotation } of visibleMatched) {
        this.renderCard(
          root,
          file.path,
          annotation,
          state.outcomes.get(annotation.id),
          commentNumbers.get(annotation.id),
          state.body
        );
      }
    }
    if (visibleOrphaned.length > 0) {
      this.sectionHeader(root, this.countLabel("Orphaned", visibleOrphaned.length, orphaned.length));
      for (const annotation of visibleOrphaned) {
        this.renderCard(
          root,
          file.path,
          annotation,
          state.outcomes.get(annotation.id),
          commentNumbers.get(annotation.id),
          state.body
        );
      }
    }
    if (visibleMatched.length === 0 && visibleOrphaned.length === 0 && state.annotations.length > 0) {
      root.createEl("p", {
        text: "No entries match the current search or filter.",
        cls: "mdann-empty"
      });
    }
    if (state.unparseable.length > 0) {
      this.sectionHeader(root, `Needs attention (${state.unparseable.length})`);
      root.createEl("p", {
        text: "These lines in the annotation block could not be read (often sync-conflict leftovers). They are preserved untouched until you delete them.",
        cls: "mdann-hint"
      });
      for (const raw of state.unparseable) this.renderUnparseable(root, file.path, raw);
    }
    this.restoreSearchFocus(searchCaret);
    this.applyRevealOrRestore(file.path, prevScroll);
  }
  // "Annotations (3)" normally; "Annotations (3 of 11)" while narrowed.
  countLabel(name, shown, total) {
    return shown === total ? `${name} (${shown})` : `${name} (${shown} of ${total})`;
  }
  passesFilters(annotation) {
    if (this.formatFilter !== "" && filterValue(annotation) !== this.formatFilter) return false;
    if (this.searchQuery === "") return true;
    return annotation.comment.toLowerCase().includes(this.searchQuery);
  }
  // ── Toolbar ──────────────────────────────────────────────────────────────
  renderToolbar(root, annotations) {
    const bar = root.createDiv({ cls: "mdann-toolbar" });
    const searchRow = bar.createDiv({ cls: "mdann-toolbar-row" });
    const search = searchRow.createEl("input", {
      cls: "mdann-search-input",
      attr: {
        type: "search",
        placeholder: "Search notes and comments\u2026",
        spellcheck: "false"
      }
    });
    search.value = this.searchQuery;
    search.addEventListener("input", () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.render();
    });
    const controlRow = bar.createDiv({ cls: "mdann-toolbar-row" });
    this.renderFilterSelect(controlRow, annotations);
    const first = controlRow.createEl("button", {
      text: "First",
      cls: "mdann-jump-btn",
      attr: { "aria-label": "Scroll to the first entry" }
    });
    const last = controlRow.createEl("button", {
      text: "Last",
      cls: "mdann-jump-btn",
      attr: { "aria-label": "Scroll to the last entry" }
    });
    first.addEventListener("click", () => this.jumpToEnd("first"));
    last.addEventListener("click", () => this.jumpToEnd("last"));
  }
  renderFilterSelect(row, annotations) {
    const select = row.createEl("select", { cls: "dropdown mdann-filter-select" });
    select.createEl("option", { text: "All formats", attr: { value: "" } });
    const present = /* @__PURE__ */ new Map();
    for (const annotation of annotations) present.set(filterValue(annotation), filterLabel(annotation));
    const entries = [...present.entries()].sort(([a], [b]) => {
      if (a === COMMENT_FILTER) return -1;
      if (b === COMMENT_FILTER) return 1;
      return a.localeCompare(b);
    });
    for (const [value, label] of entries) {
      select.createEl("option", { text: label, attr: { value } });
    }
    if (this.formatFilter !== "" && !present.has(this.formatFilter)) this.formatFilter = "";
    select.value = this.formatFilter;
    select.addEventListener("change", () => {
      this.formatFilter = select.value;
      this.render();
    });
  }
  jumpToEnd(end) {
    const id = end === "first" ? this.visibleOrder[0] : this.visibleOrder[this.visibleOrder.length - 1];
    if (id === void 0) return;
    this.scrollToCard(id, { flash: false, focus: false });
  }
  restoreSearchFocus(caret) {
    if (caret === null) return;
    const search = this.contentEl.querySelector(".mdann-search-input");
    if (!search) return;
    search.focus();
    search.setSelectionRange(caret, caret);
  }
  // After a rebuild, either honor an explicit reveal request (click-from-text
  // or sync), scroll to the entry nearest the cursor on first open, or leave
  // the scroll position exactly where it was (so a status toggle, comment
  // edit, etc. never yanks the list — Update001 "Do not scroll SB on status
  // change").
  applyRevealOrRestore(path, prevScroll) {
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
  scrollToCard(id, opts) {
    for (const el of this.cardEls.values()) el.removeClass("mdann-card-active");
    const card = this.cardEls.get(id);
    if (!card) return;
    card.addClass("mdann-card-active");
    card.scrollIntoView({ block: "center" });
    if (opts.flash) {
      card.addClass("mdann-flash");
      this.contentEl.win.setTimeout(() => card.removeClass("mdann-flash"), FLASH_MS);
    }
    if (opts.focus) {
      const textarea = card.querySelector("textarea");
      textarea == null ? void 0 : textarea.focus();
    }
  }
  sectionHeader(root, text) {
    root.createEl("div", { text, cls: "mdann-section" });
  }
  renderCard(root, path, annotation, outcome, commentNumber, body) {
    const isOrphan = outcome === void 0 || outcome.status === "orphaned";
    const card = root.createDiv({ cls: "mdann-card" + (isOrphan ? " mdann-card-orphan" : "") });
    this.cardEls.set(annotation.id, card);
    this.visibleOrder.push(annotation.id);
    if (!isOrphan) {
      card.addClass("mdann-card-clickable");
      card.addEventListener("click", (event) => {
        const target = event.target;
        if (target == null ? void 0 : target.closest("button, select, textarea, input, a")) return;
        void this.plugin.jumpToAnnotation(path, annotation.id);
      });
    }
    const isPointComment = annotation.type === "comment" && annotation.selector.exact === "";
    const head = card.createDiv({ cls: "mdann-card-head" });
    const quote = head.createDiv({ cls: "mdann-quote" });
    if (isPointComment && commentNumber !== void 0) {
      quote.createEl("span", { text: String(commentNumber), cls: "mdann-card-num" });
    }
    const excerpt = annotation.selector.exact.length > 120 ? annotation.selector.exact.slice(0, 120) + "\u2026" : annotation.selector.exact;
    const chip = quote.createEl("span", {
      text: isPointComment ? "comment marker" : excerpt === "" ? "(empty quote)" : excerpt,
      cls: highlightClasses(annotation.type, annotation.format, this.plugin.settings)
    });
    chip.setCssProps(highlightStyleVars(annotation.type, annotation.format, this.plugin.settings));
    if (annotation.type === "comment" && (outcome == null ? void 0 : outcome.status) === "matched") {
      head.createEl("span", {
        text: `line ${lineNumberAt(body, outcome.start)}`,
        cls: "mdann-card-line"
      });
    }
    if (isOrphan) {
      const reason = outcome && outcome.status === "orphaned" && outcome.reason === "ambiguous" ? "Multiple equally likely locations \u2014 select the right text and re-anchor." : "Original text not found \u2014 select the new text and re-anchor.";
      card.createEl("div", { text: reason, cls: "mdann-orphan-reason" });
    }
    this.renderFormatSelector(card, path, annotation);
    const comment = card.createEl("textarea", {
      cls: "mdann-comment-input",
      attr: { rows: "2", placeholder: annotation.type === "comment" ? "Comment\u2026" : "Note\u2026" }
    });
    comment.value = annotation.comment;
    comment.addEventListener("change", () => {
      this.plugin.setComment(path, annotation.id, comment.value);
    });
    comment.addEventListener("focus", () => {
      this.plugin.flashAnnotationInText(annotation.id);
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
      this.confirmDelete(annotation, () => this.plugin.deleteAnnotation(path, annotation.id));
    });
  }
  // A format dropdown bound to one annotation. Comments lead with a "Comment"
  // option (the dedicated comment style, stored as the empty format name).
  renderFormatSelector(card, path, annotation) {
    const row = card.createDiv({ cls: "mdann-format-select-row" });
    row.createEl("span", { text: "Format", cls: "mdann-format-select-label" });
    const select = row.createEl("select", { cls: "dropdown mdann-format-select" });
    if (annotation.type === "comment") {
      const def = select.createEl("option", { text: "Comment", attr: { value: "" } });
      if (annotation.format === "") def.selected = true;
    }
    const names = Object.keys(this.plugin.settings.formatStyles);
    if (annotation.format !== "" && !names.includes(annotation.format)) {
      const missing = select.createEl("option", {
        text: `${annotation.format} (missing)`,
        attr: { value: annotation.format }
      });
      missing.selected = true;
    }
    for (const name of names) {
      const option = select.createEl("option", { text: name, attr: { value: name } });
      if (name === annotation.format) option.selected = true;
    }
    select.addEventListener("change", () => {
      this.plugin.setFormat(path, annotation.id, select.value);
    });
  }
  confirmDelete(annotation, onConfirm) {
    const isComment = annotation.type === "comment";
    const label = isComment ? "this comment" : "this annotation";
    new SidebarConfirmModal(this.app, `Delete ${label}? This cannot be undone.`, onConfirm).open();
  }
  renderUnparseable(root, path, raw) {
    const card = root.createDiv({ cls: "mdann-card mdann-card-orphan" });
    card.createEl("code", { text: raw, cls: "mdann-raw-line" });
    const buttons = card.createDiv({ cls: "mdann-buttons" });
    const del = buttons.createEl("button", { text: "Delete line", cls: "mod-warning" });
    del.addEventListener("click", () => {
      new SidebarConfirmModal(
        this.app,
        "Delete this unreadable block line? This cannot be undone.",
        () => this.plugin.deleteUnparseableLine(path, raw)
      ).open();
    });
  }
};
var SidebarConfirmModal = class extends import_obsidian5.Modal {
  constructor(app, message, onConfirm) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    this.contentEl.createEl("p", { text: this.message });
    const buttonRow = this.contentEl.createDiv("mdann-confirm-buttons");
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    const confirmBtn = buttonRow.createEl("button", { text: "Delete", cls: "mod-warning" });
    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
var WRITE_DEBOUNCE_MS = 500;
var DISK_REFRESH_DEBOUNCE_MS = 400;
var SYNC_DEBOUNCE_MS = 150;
var TEXT_FLASH_MS = 1200;
var MdAnnotationPlugin = class extends import_obsidian6.Plugin {
  constructor() {
    super(...arguments);
    this.settings = normalizeSettings(null);
    this.states = /* @__PURE__ */ new Map();
    this.editors = /* @__PURE__ */ new Set();
    this.editorTimers = /* @__PURE__ */ new Map();
    this.diskTimers = /* @__PURE__ */ new Map();
    this.changeListeners = /* @__PURE__ */ new Set();
    // A one-shot request the sidebar consumes on its next render: scroll to
    // (and optionally flash/focus) the entry for `id`.
    this.pendingReveal = null;
    // Paths whose already-rendered Reading view has been re-rendered once after
    // annotations first loaded (fixes formatting not appearing until a toggle).
    this.initialRendered = /* @__PURE__ */ new Set();
    this.syncTimer = null;
    // Format names that currently have a generated "Apply - <name>" command, so
    // syncFormatCommands can diff against settings and add/remove as they change.
    this.formatCommandNames = /* @__PURE__ */ new Set();
  }
  async onload() {
    this.settings = normalizeSettings(await this.loadData());
    this.api = createApi(this.app.vault, () => Object.keys(this.settings.formatStyles));
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
      id: "annotate",
      name: "Annotate",
      icon: "highlighter",
      editorCallback: (editor, ctx) => {
        this.annotateOrComment(editor, ctx);
      }
    });
    this.addCommand({
      id: "open-sidebar",
      name: "Open annotation sidebar",
      icon: "panel-right",
      callback: () => {
        void this.activateSidebar();
      }
    });
    this.addCommand({
      id: "toggle-sync",
      name: "Sync text and sidebar",
      icon: "arrow-left-right",
      callback: () => {
        this.settings.syncTextAndSidebar = !this.settings.syncTextAndSidebar;
        void this.saveSettings();
        new import_obsidian6.Notice(`Text/sidebar sync ${this.settings.syncTextAndSidebar ? "on" : "off"}`);
        if (this.settings.syncTextAndSidebar && this.hasSidebar()) {
          const file = this.activeMarkdownFile();
          if (file) {
            const nearest = this.nearestToCursor(file.path);
            if (nearest) {
              void this.revealInSidebar(file.path, nearest, {
                flash: false,
                focus: false,
                activate: false
              });
            }
          }
        }
      }
    });
    this.addCommand({
      id: "toggle-annotation-formats",
      name: "Show/hide annotation formats",
      callback: () => {
        this.settings.annotationFormattingEnabled = !this.settings.annotationFormattingEnabled;
        void this.saveSettings();
        new import_obsidian6.Notice(
          `Annotation formats ${this.settings.annotationFormattingEnabled ? "shown" : "hidden"}`
        );
      }
    });
    this.addCommand({
      id: "toggle-comment-formats",
      name: "Show/hide comment formats",
      callback: () => {
        this.settings.commentsFormattingEnabled = !this.settings.commentsFormattingEnabled;
        void this.saveSettings();
        new import_obsidian6.Notice(
          `Comment formats ${this.settings.commentsFormattingEnabled ? "shown" : "hidden"}`
        );
      }
    });
    this.syncFormatCommands();
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, ctx) => {
        const hasSelection = editor.getSelection() !== "";
        menu.addItem(
          (item) => item.setTitle(hasSelection ? "Annotate selection" : "Insert comment").setIcon(hasSelection ? "highlighter" : "message-square").onClick(() => {
            this.annotateOrComment(editor, ctx);
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
    if (this.syncTimer !== null) {
      window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    void this.queue.flush().finally(() => this.queue.dispose());
    this.app.workspace.iterateAllLeaves((leaf) => {
      sweepHighlightSpans(leaf.view.containerEl);
    });
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.syncFormatCommands();
    for (const view of this.editors) this.decorate(view);
    this.rerenderPreviews();
    this.notifyChange();
  }
  // ── Per-format commands ("Apply - <name>", one per format) ───────────────
  //
  // Registered dynamically so a format added in the settings tab immediately
  // gains its own command — which also lets a Note Toolbar JavaScript item
  // build a live "apply format" menu via ntb.menu() (see README). Removed or
  // renamed formats have their stale command torn down. addCommand prefixes
  // the id with the plugin id; removeCommand needs that full prefixed id.
  formatCommandId(formatName) {
    return `apply-${formatName}`;
  }
  syncFormatCommands() {
    const current = new Set(Object.keys(this.settings.formatStyles));
    for (const name of current) {
      if (this.formatCommandNames.has(name)) continue;
      this.addCommand({
        id: this.formatCommandId(name),
        name: `Apply - ${name}`,
        icon: "highlighter",
        editorCheckCallback: (checking, editor, ctx) => {
          if (!this.settings.formatStyles[name]) return false;
          if (checking) return true;
          this.applyNamedFormat(editor, ctx, name);
          return true;
        }
      });
      this.formatCommandNames.add(name);
    }
    for (const name of [...this.formatCommandNames]) {
      if (current.has(name)) continue;
      this.removeCommand(`${this.manifest.id}:${this.formatCommandId(name)}`);
      this.formatCommandNames.delete(name);
    }
  }
  // Selection → highlight with this format; bare cursor → comment carrying it
  // (the marker then renders in that format's color).
  applyNamedFormat(editor, ctx, formatName) {
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    const type = from === to ? "comment" : "highlight";
    this.addAnnotationFromEditor(editor, ctx, type, formatName);
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
    const state = this.setStateFromDoc(path, doc);
    this.scheduleInitialPreviewRender(path);
    return state;
  }
  scheduleInitialPreviewRender(path) {
    if (this.initialRendered.has(path)) return;
    this.initialRendered.add(path);
    window.setTimeout(() => this.rerenderPreviewsForPath(path), 0);
  }
  rerenderPreviewsForPath(path) {
    var _a;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof import_obsidian6.MarkdownView && view.getMode() === "preview" && ((_a = view.file) == null ? void 0 : _a.path) === path) {
        view.previewMode.rerender(true);
      }
    }
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
    applyEditorDecorations(view, state.annotations, state.outcomes, this.settings, (id) => {
      this.revealAnnotation(path, id);
    });
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
  // Selection → annotation (highlight, format picked when several exist);
  // no selection → comment marker at the cursor.
  annotateOrComment(editor, ctx) {
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    if (from === to) {
      this.addAnnotationFromEditor(editor, ctx, "comment", "");
      return;
    }
    const names = usableFormatNames(this.settings);
    const first = names[0];
    if (names.length === 0) {
      new import_obsidian6.Notice("No annotation formats are enabled \u2014 check the plugin settings");
      return;
    }
    if (names.length === 1 && first !== void 0) {
      this.addAnnotationFromEditor(editor, ctx, "highlight", first);
      return;
    }
    new FormatSuggestModal(this.app, names, (name) => {
      this.addAnnotationFromEditor(editor, ctx, "highlight", name);
    }).open();
  }
  addAnnotationFromEditor(editor, ctx, type, formatName) {
    var _a;
    const path = (_a = ctx.file) == null ? void 0 : _a.path;
    if (path === void 0) return;
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    if (from === to && type !== "comment") {
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
    if (from === to && selector.prefix === "" && selector.suffix === "") {
      new import_obsidian6.Notice("Cannot anchor a comment in an empty note");
      return;
    }
    const annotation = createAnnotation({
      id: generateAnnotationId(Date.now(), Math.random()),
      type,
      format: formatName,
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
  // Reassign one annotation to a different format (sidebar dropdown).
  setFormat(path, id, formatName) {
    this.patchAnnotation(path, id, {
      format: formatName,
      dateModified: formatTimestamp(Date.now())
    });
    this.decorateAllFor(path);
    this.rerenderPreviews();
  }
  // Rename a format in settings AND rewrite the "format" field in every
  // annotated note that references the old name (they store the name).
  async renameFormat(oldName, newName) {
    const styles = this.settings.formatStyles;
    const current = styles[oldName];
    if (!current) return false;
    if (newName === "" || isUnsafeKey(newName) || styles[newName]) return false;
    const next = {};
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
      new import_obsidian6.Notice(
        `MD Annotation: renamed format in ${fileCount} note${fileCount === 1 ? "" : "s"}`
      );
      this.notifyChange();
    }
    return true;
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
  // Sidebar entry → the annotation in the note. Governed by the General-tab
  // "Sidebar click jumps to text" toggle.
  async jumpToAnnotation(path, id) {
    var _a, _b;
    if (!this.settings.sidebarClickJumpsToText) return;
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
    this.flashAnnotationInText(id);
  }
  // ── Text ⇄ sidebar reveal / sync ─────────────────────────────────────────
  // Called when annotated text or a comment marker is clicked in the editor or
  // Reading view: open the sidebar, scroll to the entry, flash it, and focus
  // its comment box (Update001 "jump the cursor to the Comment text box").
  // Governed by the General-tab "Text click jumps to sidebar" toggle.
  revealAnnotation(path, id) {
    if (!this.settings.textClickJumpsToSidebar) return;
    void this.revealInSidebar(path, id, { flash: true, focus: true, activate: true });
  }
  // Cursor moved in an editor — when sync is on and the sidebar is open, scroll
  // it to the nearest entry.
  onEditorSelectionChange(view) {
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
  nearestToCursor(path) {
    var _a;
    const state = this.states.get(path);
    if (!state) return null;
    let offset = 0;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (view && ((_a = view.file) == null ? void 0 : _a.path) === path) {
      offset = view.editor.posToOffset(view.editor.getCursor("head"));
    }
    return nearestAnnotationId(state.annotations, state.outcomes, offset);
  }
  async revealInSidebar(path, id, opts) {
    this.pendingReveal = { path, id, flash: opts.flash, focus: opts.focus };
    if (opts.activate) await this.activateSidebar();
    this.notifyChange();
  }
  consumePendingReveal(path) {
    const reveal = this.pendingReveal;
    if (reveal && reveal.path === path) {
      this.pendingReveal = null;
      return { id: reveal.id, flash: reveal.flash, focus: reveal.focus };
    }
    return null;
  }
  hasSidebar() {
    return this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE).length > 0;
  }
  // Briefly highlight every rendered occurrence of an annotation in the note
  // (Update001 "Flash … Comment icon … when SB entry is active"). Public so the
  // sidebar can also fire it when you click into an entry's Note field
  // (Update003) — the flash points out where that entry lives in the text.
  flashAnnotationInText(id) {
    const selector = `[data-mdann-id="${CSS.escape(id)}"]`;
    this.app.workspace.iterateAllLeaves((leaf) => {
      for (const el of Array.from(leaf.view.containerEl.querySelectorAll(selector))) {
        const node = el;
        node.addClass("mdann-flash-text");
        window.setTimeout(() => node.removeClass("mdann-flash-text"), TEXT_FLASH_MS);
      }
    });
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
