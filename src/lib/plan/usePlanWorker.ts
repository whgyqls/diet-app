'use client';
// Owns the plan Web Worker. Stale responses are ignored by request id (workerProtocol.ts);
// the worker is terminated only when a new day calculation starts and on unmount.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanInputs } from './requestFingerprint';
import {
  createRequestTracker,
  type WorkerRequest,
  type WorkerResponse,
} from './workerProtocol';

export type DayResult = Extract<WorkerResponse, { ok: true; kind: 'day' }>;
export type WorkerStatus = 'idle' | 'loading' | 'error';

export function usePlanWorker(onDay: (r: DayResult) => void) {
  const [status, setStatus] = useState<WorkerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const tracker = useRef(createRequestTracker());
  const onDayRef = useRef(onDay);
  useEffect(() => {
    onDayRef.current = onDay;
  });

  const fail = useCallback((message: string) => {
    setError(message);
    setStatus('error');
  }, []);

  const runDay = useCallback(
    (inputs: PlanInputs) => {
      // A new day calculation cancels everything in flight, so the worker is replaced.
      workerRef.current?.terminate();
      workerRef.current = null;
      const id = tracker.current.startDay();
      setError(null);
      setStatus('loading');
      let worker: Worker;
      try {
        worker = new Worker(
          new URL('../../workers/plan.worker.ts', import.meta.url),
          { type: 'module' },
        );
      } catch {
        fail('이 브라우저에서는 추천을 계산할 수 없어요.');
        return;
      }
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const res = e.data;
        if (!tracker.current.accept({ kind: 'day', id: res.id })) return;
        if (res.ok) {
          setStatus('idle');
          onDayRef.current(res);
        } else fail('추천을 계산하지 못했어요. 다시 시도해 주세요.');
      };
      worker.onerror = () => {
        if (tracker.current.accept({ kind: 'day', id }))
          fail('추천을 계산하지 못했어요. 다시 시도해 주세요.');
      };
      const req: WorkerRequest = {
        kind: 'day',
        id,
        refYear: new Date().getFullYear(),
        inputs,
      };
      worker.postMessage(req);
    },
    [fail],
  );

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { status, error, runDay };
}
