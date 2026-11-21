// Runs the nutrition engine off the main thread (a full day takes 1-3 s). Logic lives in workerProtocol.ts.
import {
  runWorkerRequest,
  type WorkerRequest,
} from '@/lib/plan/workerProtocol';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = (e) => {
  ctx.postMessage(runWorkerRequest(e.data));
};
