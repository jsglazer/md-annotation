// Shared per-file annotation state shape, kept in its own module so the
// editor/UI layers can type against it without importing main.ts.

import type { MatchResult } from './core/matcher';
import type { Annotation } from './core/types';

export interface FileAnnotationState {
	// Body text (everything above the annotation block) the outcomes were
	// resolved against. Body offsets equal document offsets (the block sits
	// at end-of-file), so match ranges are usable directly in the editor.
	body: string;
	annotations: Annotation[];
	unparseable: string[];
	outcomes: Map<string, MatchResult>;
}
