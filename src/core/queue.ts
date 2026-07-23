// Debounced, sequenced single-writer queue for note file updates.
// Pure module: I/O and timers are injected, so the queue's debouncing and
// sequencing behavior is fully unit-testable with a fake scheduler.
//
// Guarantees:
//   - Mutations for one key are coalesced (debounced) and applied in FIFO
//     order in a single read-modify-write.
//   - Writes are strictly sequenced: the next write starts only after the
//     previous one settles, so writes can never overlap or race.

export type Mutation = (text: string) => string;

export interface QueueIO {
	// Atomic read-modify-write of one file (the shell backs this with
	// Vault.process, which has exactly this contract).
	process(key: string, mutate: Mutation): Promise<void>;
}

export interface Scheduler {
	set(fn: () => void, delayMs: number): number;
	clear(handle: number): void;
}

interface PendingEntry {
	mutations: Mutation[];
	timer: number;
}

export class WriteQueue {
	private pending = new Map<string, PendingEntry>();
	// Global write chain — every write appends here, giving strict sequencing.
	private chain: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(
		private io: QueueIO,
		private delayMs: number,
		private scheduler: Scheduler,
		private onError: (key: string, error: unknown) => void = () => undefined,
	) {}

	// Queue a mutation for `key`. Restarts that key's debounce window.
	request(key: string, mutation: Mutation): void {
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
			timer: this.scheduler.set(() => this.fire(key), this.delayMs),
		});
	}

	get pendingCount(): number {
		return this.pending.size;
	}

	// Fire all pending debounce windows immediately and wait for every queued
	// write to settle.
	flush(): Promise<void> {
		for (const key of [...this.pending.keys()]) {
			const entry = this.pending.get(key);
			if (entry) this.scheduler.clear(entry.timer);
			this.fire(key);
		}
		return this.chain;
	}

	dispose(): void {
		this.disposed = true;
		for (const entry of this.pending.values()) this.scheduler.clear(entry.timer);
		this.pending.clear();
	}

	private fire(key: string): void {
		const entry = this.pending.get(key);
		if (!entry) return;
		this.pending.delete(key);
		const mutations = entry.mutations;
		const combined: Mutation = (text) => mutations.reduce((acc, m) => m(acc), text);
		this.chain = this.chain
			.then(() => this.io.process(key, combined))
			.catch((error: unknown) => {
				this.onError(key, error);
			});
	}
}
