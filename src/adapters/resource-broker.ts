import {ForgeError} from '../shared/errors.ts';
import type {SlotLoadSnapshot} from '../shared/types.ts';

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
}

export class ResourceSlotBroker {
  private readonly maxWorkerSlots: number;
  private activeWorkerSlots = 0;
  private readonly workerWaitQueue: Waiter[] = [];
  private humanPriorityBusy = false;
  private readonly humanWaitQueue: Waiter[] = [];

  constructor(maxWorkerSlots = 3) {
    this.maxWorkerSlots = Math.max(1, Math.floor(maxWorkerSlots));
  }

  async acquireWorkerSlot(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new ForgeError('ABORTED', 'Worker slot request aborted', 499);
    }
    if (this.activeWorkerSlots < this.maxWorkerSlots) {
      this.activeWorkerSlots += 1;
      return this.createWorkerRelease();
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const waiter: Waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolvePromise();
        },
        reject: err => {
          signal?.removeEventListener('abort', onAbort);
          rejectPromise(err);
        },
      };
      const onAbort = (): void => {
        const idx = this.workerWaitQueue.indexOf(waiter);
        if (idx >= 0) {
          this.workerWaitQueue.splice(idx, 1);
        }
        waiter.reject(
          new ForgeError('ABORTED', 'Worker slot acquisition aborted', 499),
        );
      };
      this.workerWaitQueue.push(waiter);
      signal?.addEventListener('abort', onAbort, {once: true});
    });

    return this.createWorkerRelease();
  }

  async acquireHumanPrioritySlot(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new ForgeError('ABORTED', 'Priority slot request aborted', 499);
    }
    if (!this.humanPriorityBusy) {
      this.humanPriorityBusy = true;
      return this.createHumanRelease();
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const waiter: Waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolvePromise();
        },
        reject: err => {
          signal?.removeEventListener('abort', onAbort);
          rejectPromise(err);
        },
      };
      const onAbort = (): void => {
        const idx = this.humanWaitQueue.indexOf(waiter);
        if (idx >= 0) {
          this.humanWaitQueue.splice(idx, 1);
        }
        waiter.reject(
          new ForgeError('ABORTED', 'Priority slot acquisition aborted', 499),
        );
      };
      this.humanWaitQueue.push(waiter);
      signal?.addEventListener('abort', onAbort, {once: true});
    });

    return this.createHumanRelease();
  }

  getSnapshot(): SlotLoadSnapshot {
    return {
      maxWorkerSlots: this.maxWorkerSlots,
      activeWorkerSlots: this.activeWorkerSlots,
      queuedWorkerTasks: this.workerWaitQueue.length,
      humanPrioritySlotBusy: this.humanPriorityBusy,
    };
  }

  private createWorkerRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.workerWaitQueue.shift();
      if (next) {
        next.resolve();
      } else {
        this.activeWorkerSlots = Math.max(0, this.activeWorkerSlots - 1);
      }
    };
  }

  private createHumanRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.humanWaitQueue.shift();
      if (next) {
        next.resolve();
      } else {
        this.humanPriorityBusy = false;
      }
    };
  }
}
