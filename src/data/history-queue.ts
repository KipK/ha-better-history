export interface HistoryQueueTask<T> {
  id: string;
  run(): Promise<T>;
}

export interface HistoryQueueEvent {
  event: "queue.start" | "queue.task_start" | "queue.task_complete" | "queue.cancelled";
  queuedCount: number;
  activeCount: number;
  completedCount: number;
  taskId?: string;
}

export interface HistoryQueueOptions {
  concurrency?: number;
  isCancelled?: () => boolean;
  onEvent?: (event: HistoryQueueEvent) => void;
}

export interface HistoryQueueResult<T, TTask extends HistoryQueueTask<T> = HistoryQueueTask<T>> {
  task: TTask;
  value: T;
  durationMs: number;
}

export async function runHistoryQueue<T, TTask extends HistoryQueueTask<T> = HistoryQueueTask<T>>(
  tasks: TTask[],
  options: HistoryQueueOptions & { onResult?: (result: HistoryQueueResult<T, TTask>) => void | Promise<void> } = {}
): Promise<HistoryQueueResult<T, TTask>[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const results: HistoryQueueResult<T, TTask>[] = [];
  let nextIndex = 0;
  let activeCount = 0;
  let completedCount = 0;

  const emit = (event: HistoryQueueEvent["event"], taskId?: string): void => {
    options.onEvent?.({
      event,
      taskId,
      queuedCount: Math.max(tasks.length - nextIndex, 0),
      activeCount,
      completedCount
    });
  };

  emit("queue.start");

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      if (options.isCancelled?.()) {
        emit("queue.cancelled");
        return;
      }

      const task = tasks[nextIndex++];
      activeCount += 1;
      emit("queue.task_start", task.id);

      try {
        const start = typeof performance !== "undefined" ? performance.now() : Date.now();
        const value = await task.run();
        const durationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
        const result = { task, value, durationMs };
        results.push(result);
        completedCount += 1;
        emit("queue.task_complete", task.id);
        await options.onResult?.(result);
      } finally {
        activeCount -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

  return results;
}
