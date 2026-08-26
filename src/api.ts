// Public JS API for query tools (Dataview / Datacore).
//
// The %%md-annotation block is line-delimited JSON that DQL cannot read, so
// this API is the supported query path from dataviewjs / datacorejs blocks:
//
//   const api = app.plugins.plugins['md-annotation'].api;
//   const anns = await api.getAnnotations(dv.current().file.path);
//   const all  = await api.getAllAnnotations();          // whole vault
//
// Example (dataviewjs) — table of open annotations in the current note:
//
//   ```dataviewjs
//   const api = app.plugins.plugins['md-annotation'].api;
//   const anns = await api.getAnnotations(dv.current().file.path);
//   dv.table(['Quote', 'Category', 'Comment', 'Author', 'Created'],
//     anns.filter(a => a.status === 'open')
//         .map(a => [a.selector.exact, a.category, a.comment, a.author, a.dateCreate]));
//   ```
//
// Returned objects are deep copies — callers can mutate them freely without
// touching plugin state or note data.
//
// v1.0.20 renamed an annotation's `format` to `category`. Returned objects
// carry BOTH keys (the copy is throwaway, so the alias costs nothing) and the
// old `getFormatNames` / `getFormatCommandId` still work, so existing script
// blocks keep running unchanged.

import type { Vault } from 'obsidian';

import { BLOCK_OPEN, parseDocument } from './core/block';
import type { Annotation } from './core/types';

export interface FileAnnotations {
	path: string;
	annotations: ApiAnnotation[];
}

export interface MdAnnotationAPI {
	// All annotations of one markdown file ([] for non-markdown/missing files).
	getAnnotations(path: string): Promise<ApiAnnotation[]>;
	// Every annotated markdown file in the vault with its annotations.
	getAllAnnotations(): Promise<FileAnnotations[]>;
	// The current category names, in settings order. Handy for building a Note
	// Toolbar menu without having to scrape command ids (see README).
	getCategoryNames(): string[];
	// The Obsidian command id that applies a given category (e.g.
	// 'md-annotation:apply-EditThis'). Returns null for an unknown category.
	getCategoryCommandId(categoryName: string): string | null;
	// Pre-1.0.20 names for the two above, kept so existing dataviewjs /
	// datacorejs blocks and Note Toolbar scripts do not have to be rewritten.
	getFormatNames(): string[];
	getFormatCommandId(categoryName: string): string | null;
}

// One returned annotation, plus the pre-1.0.20 spelling of its category.
export type ApiAnnotation = Annotation & { format: string };

function clone(a: Annotation): ApiAnnotation {
	return { ...structuredClone(a), format: a.category };
}

// Kept in sync with main.ts's per-category command registration.
export const CATEGORY_COMMAND_PREFIX = 'md-annotation:apply-';

export function createApi(vault: Vault, getCategoryNames: () => string[]): MdAnnotationAPI {
	const getCategoryCommandId = (categoryName: string): string | null =>
		getCategoryNames().includes(categoryName)
			? `${CATEGORY_COMMAND_PREFIX}${categoryName}`
			: null;

	return {
		getCategoryNames,
		getCategoryCommandId,
		getFormatNames: getCategoryNames,
		getFormatCommandId: getCategoryCommandId,

		async getAnnotations(path: string): Promise<ApiAnnotation[]> {
			const file = vault.getFileByPath(path);
			if (!file || file.extension !== 'md') return [];
			const doc = await vault.cachedRead(file);
			return parseDocument(doc).annotations.map(clone);
		},

		async getAllAnnotations(): Promise<FileAnnotations[]> {
			const out: FileAnnotations[] = [];
			for (const file of vault.getMarkdownFiles()) {
				const doc = await vault.cachedRead(file);
				// Cheap pre-filter before the full parse.
				if (!doc.includes(BLOCK_OPEN)) continue;
				const annotations = parseDocument(doc).annotations;
				if (annotations.length > 0) {
					out.push({ path: file.path, annotations: annotations.map(clone) });
				}
			}
			return out;
		},
	};
}
