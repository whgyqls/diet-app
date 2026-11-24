'use client';

import { useState } from 'react';
import { fetchExplanation } from '@/lib/explain/client';
import type { ExplainRequest, ExplainResponse } from '@/lib/explain/types';
import { AI_TEXT } from '@/lib/ui-labels';

/** The AI explanation of one card. Asked only when the button is pressed (the free quota is small). */
export function AiExplain({ request }: { request: ExplainRequest }) {
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'done'; res: ExplainResponse }
  >({ status: 'idle' });

  const ask = async () => {
    setState({ status: 'loading' });
    setState({ status: 'done', res: await fetchExplanation(request) });
  };

  if (state.status === 'idle')
    return (
      <button
        type="button"
        onClick={() => void ask()}
        className="mt-3 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm font-medium dark:border-neutral-600"
      >
        {AI_TEXT.button}
      </button>
    );
  if (state.status === 'loading')
    return (
      <p role="status" aria-busy className="mt-3 text-sm">
        {AI_TEXT.loading}
      </p>
    );
  const { res } = state;
  const ai = res.source !== 'fallback';
  return (
    <div data-testid="ai-explain-result" className="mt-3 text-sm">
      {ai && (
        <span className="mr-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
          {AI_TEXT.tag}
        </span>
      )}
      <span>{res.text}</span>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        {ai
          ? AI_TEXT.note
          : res.reason === 'LIMIT'
            ? AI_TEXT.fallbackLimit
            : res.reason === 'BUSY'
              ? AI_TEXT.fallbackBusy
              : AI_TEXT.fallbackError}
      </p>
    </div>
  );
}
