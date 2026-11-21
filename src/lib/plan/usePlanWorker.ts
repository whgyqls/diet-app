'use client';
// Owns the plan Web Worker. Stale responses are ignored by request id (workerProtocol.ts); the latest id is
// kept per meal, so rerolling lunch while breakfast runs kills neither. The worker is terminated only when a
// new day calculation starts and on unmount.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MealOptionsResult } from '@/lib/nutrition/mealOptions';
import type { MealType } from '@/types/nutrition';
import type { PlanInputs } from './requestFingerprint';
import {
  createRequestTracker,
  type MealRequestMsg,
  type WorkerRequest,
  type WorkerResponse,
} from './workerProtocol';

export type DayResult = Extract<WorkerResponse, { ok: true; kind: 'day' }>;
export type WorkerStatus = 'idle' | 'loading' | 'error';
export type MealParams = Omit<MealRequestMsg, 'kind' | 'id'>;

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner'];
const DAY_ERROR = '추천을 계산하지 못했어요. 다시 시도해 주세요.';

export function usePlanWorker(handlers: {
  onDay: (r: DayResult) => void;
  onMeal: (meal: MealType, result: MealOptionsResult) => void;
  onMealError: (meal: MealType) => void;
}) {
  const [status, setStatus] = useState<WorkerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingMeals, setPendingMeals] = useState<MealType[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const tracker = useRef(createRequestTracker());
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const syncPending = useCallback(
    () =>
      setPendingMeals(MEALS.filter((m) => tracker.current.isMealPending(m))),
    [],
  );
  const failDay = useCallback((message: string) => {
    setError(message);
    setStatus('error');
  }, []);

  const createWorker = useCallback((): Worker | null => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../../workers/plan.worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch {
      return null;
    }
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      if (res.kind === 'day') {
        if (!tracker.current.accept({ kind: 'day', id: res.id })) return;
        if (res.ok) {
          setStatus('idle');
          handlersRef.current.onDay(res);
        } else failDay(DAY_ERROR);
        return;
      }
      const meal = res.meal;
      if (!meal || !tracker.current.accept({ kind: 'meal', meal, id: res.id }))
        return;
      syncPending();
      if (res.ok) handlersRef.current.onMeal(meal, res.result);
      else handlersRef.current.onMealError(meal);
    };
    worker.onerror = () => {
      // The worker itself broke: every request in flight is lost.
      for (const m of MEALS) {
        const id = tracker.current.latestMealId(m);
        if (
          id !== undefined &&
          tracker.current.accept({ kind: 'meal', meal: m, id })
        )
          handlersRef.current.onMealError(m);
      }
      syncPending();
      const dayId = tracker.current.latestDayId();
      if (dayId !== null && tracker.current.accept({ kind: 'day', id: dayId }))
        failDay(DAY_ERROR);
    };
    return worker;
  }, [failDay, syncPending]);

  const runDay = useCallback(
    (inputs: PlanInputs) => {
      // A new day calculation cancels everything in flight, so the worker is replaced.
      workerRef.current?.terminate();
      workerRef.current = null;
      const id = tracker.current.startDay();
      syncPending();
      setError(null);
      setStatus('loading');
      const worker = createWorker();
      if (!worker) {
        tracker.current.accept({ kind: 'day', id });
        failDay('이 브라우저에서는 추천을 계산할 수 없어요.');
        return;
      }
      workerRef.current = worker;
      const req: WorkerRequest = {
        kind: 'day',
        id,
        refYear: new Date().getFullYear(),
        inputs,
      };
      worker.postMessage(req);
    },
    [createWorker, failDay, syncPending],
  );

  /** Reroll one meal. Does not touch other meals' requests or the day calculation. */
  const runMeal = useCallback(
    (params: MealParams) => {
      const worker = workerRef.current ?? createWorker();
      if (!worker) {
        handlersRef.current.onMealError(params.meal);
        return;
      }
      workerRef.current = worker;
      const id = tracker.current.startMeal(params.meal);
      syncPending();
      worker.postMessage({
        kind: 'meal',
        id,
        ...params,
      } satisfies WorkerRequest);
    },
    [createWorker, syncPending],
  );

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { status, error, pendingMeals, runDay, runMeal };
}
