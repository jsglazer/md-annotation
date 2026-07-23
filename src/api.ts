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
//   dv.table(['Quote', 'Format', 'Comment', 'Author', 'Created'],
//     anns.filter(a => a.status === 'open')
//         .map(a => [a.selector.exact, a.format, a.comment, a.author, a.dateCreate]));
//   ```
//
// Returned objects are deep copies — callers can mutate them freely without
// touching plugin state or note data.

import type { Vault } from 'obsidian';

import { BLOCK_OPEN, parseDocument } from './core/block';
import type { Annotation } from './core/types';

export interface FileAnnotations {
	path: string;
	annotations: Annotation[];
}

export interface MdAnnotationAPI {
	// All annotations of one markdown file ([] for non-markdown/missing files).
	getAnnotations(path: string): Promise<Annotation[]>;
	// Every annotated markdown file in the vault with its annotations.
	getAllAnnotations(): Promise<FileAnnotations[]>;
}

function clone<T>(v: T): T {
	return structuredClone(v);
}

export function createApi(vault: Vault): MdAnnotationAPI {
	return {
		async getAnnotations(path: string): Promise<Annotation[]> {
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
