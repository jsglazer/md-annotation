import { describe, expect, it } from 'vitest';
import type { Mutation, Scheduler } from '../src/core/queue';
import { WriteQueue } from '../src/core/queue';

// Deterministic fake scheduler: timers fire only when the test advances time.
class FakeScheduler implements Scheduler {
	private timers = new Map<number, { fn: () => void; due: number }>();
	private nextId = 1;
	private now = 0;

	set(fn: () => void, delayMs: number): number {
		const id = this.nextId++;
		this.timers.set(id, { fn, due: this.now + delayMs });
		return id;
	}

	clear(handle: number): void {
		this.timers.delete(handle);
	}

	advance(ms: number): void {
		this.now += ms;
		// Fire due timers in registration order, allowing refires to schedule.
		for (const [id, t] of [...this.timers.entries()].sort((a, b) => a[1].due - b[1].due)) {
			if (t.due <= this.now && this.timers.has(id)) {
				this.timers.delete(id);
				t.fn();
			}
		}
	}
}

// Controllable async store standing in for Vault.process.
class FakeStore {
	docs = new Map<string, string>();
	processCalls: string[] = [];
	// When set, process() blocks until the test releases it.
	private gate: Promise<void> | null = null;
	private release: (() => void) | null = null;

	block(): void {
		this.gate = new Promise((resolve) => {
			this.release = resolve;
		});
	}

	unblock(): void {
		this.release?.();
		this.gate = null;
		this.release = null;
	}

	async process(key: string, mutate: Mutation): Promise<void> {
		this.processCalls.push(key);
		if (this.gate) await this.gate;
		this.docs.set(key, mutate(this.docs.get(key) ?? ''));
	}
}

function setup(delayMs = 500) {
	const scheduler = new FakeScheduler();
	const store = new FakeStore();
	const errors: Array<{ key: string; error: unknown }> = [];
	const queue = new WriteQueue(
		{ process: (key, mutate) => store.process(key, mutate) },
		delayMs,
		scheduler,
		(key, error) => errors.push({ key, error }),
	);
	return { scheduler, store, queue, errors };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('WriteQueue — debouncing', () => {
	it('coalesces rapid requests for one key into a single write', async () => {
		const { scheduler, store, queue } = setup(500);
		queue.request('note.md', (t) => t + 'a');
		scheduler.advance(200);
		queue.request('note.md', (t) => t + 'b');
		scheduler.advance(200);
		queue.request('note.md', (t) => t + 'c');
		// The window keeps resetting: nothing has fired yet.
		expect(store.processCalls).toEqual([]);
		scheduler.advance(499);
		expect(store.processCalls).toEqual([]);
		scheduler.advance(1);
		await flushMicrotasks();
		expect(store.processCalls).toEqual(['note.md']);
		// Mutations applied once, in FIFO order.
		expect(store.docs.get('note.md')).toBe('abc');
	});

	it('debounces per key: separate keys keep separate windows', async () => {
		const { scheduler, store, queue } = setup(500);
		queue.request('a.md', (t) => t + 'A');
		scheduler.advance(300);
		queue.request('b.md', (t) => t + 'B');
		scheduler.advance(200); // a.md due (500), b.md not (200/500)
		await flushMicrotasks();
		expect(store.processCalls).toEqual(['a.md']);
		scheduler.advance(300);
		await flushMicrotasks();
		expect(store.processCalls).toEqual(['a.md', 'b.md']);
	});
});

describe('WriteQueue — sequencing', () => {
	it('never overlaps writes: the next write waits for the previous to settle', async () => {
		const { scheduler, store, queue } = setup(100);
		store.block();
		queue.request('a.md', (t) => t + 'A');
		scheduler.advance(100);
		queue.request('b.md', (t) => t + 'B');
		scheduler.advance(100);
		await flushMicrotasks();
		// First write started and is blocked; second must not have started.
		expect(store.processCalls).toEqual(['a.md']);
		store.unblock();
		await flushMicrotasks();
		expect(store.processCalls).toEqual(['a.md', 'b.md']);
		expect(store.docs.get('a.md')).toBe('A');
		expect(store.docs.get('b.md')).toBe('B');
	});

	it('a request arriving during an in-flight write is written afterwards, in order', async () => {
		const { scheduler, store, queue } = setup(100);
		store.block();
		queue.request('a.md', (t) => t + '1');
		scheduler.advance(100);
		await flushMicrotasks();
		expect(store.processCalls).toEqual(['a.md']);
		// New mutation for the same key while its write is in flight.
		queue.request('a.md', (t) => t + '2');
		scheduler.advance(100);
		store.unblock();
		await queue.flush();
		expect(store.processCalls).toEqual(['a.md', 'a.md']);
		expect(store.docs.get('a.md')).toBe('12');
	});

	it('continues sequencing after a write fails, reporting the error', async () => {
		const { scheduler, store, queue, errors } = setup(100);
		const boom = new Error('disk full');
		const failingOnce = store.process.bind(store);
		let failed = false;
		store.process = async (key, mutate) => {
			if (!failed) {
				failed = true;
				store.processCalls.push(key);
				throw boom;
			}
			await failingOnce(key, mutate);
		};
		queue.request('a.md', (t) => t + 'A');
		queue.request('b.md', (t) => t + 'B');
		scheduler.advance(100);
		await queue.flush();
		expect(errors).toEqual([{ key: 'a.md', error: boom }]);
		expect(store.docs.get('b.md')).toBe('B');
	});
});

describe('WriteQueue — flush and dispose', () => {
	it('flush fires pending windows immediately and awaits completion', async () => {
		const { store, queue } = setup(10_000);
		queue.request('a.md', (t) => t + 'A');
		queue.request('b.md', (t) => t + 'B');
		expect(queue.pendingCount).toBe(2);
		await queue.flush();
		expect(queue.pendingCount).toBe(0);
		expect(store.docs.get('a.md')).toBe('A');
		expect(store.docs.get('b.md')).toBe('B');
	});

	it('dispose cancels pending writes and rejects new requests', async () => {
		const { scheduler, store, queue } = setup(100);
		queue.request('a.md', (t) => t + 'A');
		queue.dispose();
		queue.request('b.md', (t) => t + 'B');
		scheduler.advance(1000);
		await flushMicrotasks();
		expect(store.processCalls).toEqual([]);
	});
});
