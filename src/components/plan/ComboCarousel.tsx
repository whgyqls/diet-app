'use client';

import { useRef, useState } from 'react';
import type { Card } from '@/lib/plan/planState';
import { ComboCard } from './ComboCard';

/** Horizontal swipe list (CSS scroll-snap), one combo card at a time. */
export function ComboCarousel({
  cards,
  pickedCardId,
  onPick,
}: {
  cards: Card[];
  pickedCardId?: string;
  onPick: (cardId: string) => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const onScroll = () => {
    const el = ref.current;
    if (!el || el.children.length === 0) return;
    const first = el.children[0] as HTMLElement;
    const step = first.offsetWidth + 12;
    setActive(Math.min(cards.length - 1, Math.round(el.scrollLeft / step)));
  };
  return (
    <div>
      <ul
        ref={ref}
        onScroll={onScroll}
        aria-label="추천 조합 (좌우로 넘겨 보기)"
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2"
      >
        {cards.map((c, i) => (
          <li key={c.id} className="w-[85%] max-w-sm shrink-0 snap-center">
            <ComboCard
              combo={c.combo}
              index={i}
              total={cards.length}
              picked={c.id === pickedCardId}
              onPick={() => onPick(c.id)}
            />
          </li>
        ))}
      </ul>
      <p className="mt-1 flex justify-center gap-1.5" aria-hidden="true">
        {cards.map((c, i) => (
          <span
            key={c.id}
            className={`h-2 w-2 rounded-full ${i === active ? 'bg-emerald-600' : 'bg-neutral-300 dark:bg-neutral-600'}`}
          />
        ))}
      </p>
    </div>
  );
}
