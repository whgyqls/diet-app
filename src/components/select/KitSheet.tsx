'use client';

import { useEffect, useState } from 'react';
import {
  KIT_NAME_MAX,
  kitItemCount,
  type IngredientKit,
  type KitApplyMode,
  type KitNameError,
} from '@/lib/kits/kits';
import { STYLE_INFO } from '@/lib/ui-labels';
import { ConfirmDialog } from './ConfirmDialog';

const NAME_ERROR_TEXT: Record<KitNameError, string> = {
  EMPTY: '이름을 입력해 주세요',
  TOO_LONG: `이름은 ${KIT_NAME_MAX}자까지 쓸 수 있어요`,
  DUPLICATE: '같은 이름의 세트가 있어요',
};

const inputClass =
  'min-h-11 w-full rounded-lg border border-neutral-300 bg-background px-3 dark:border-neutral-600';
const smallBtn =
  'min-h-11 rounded-lg border border-neutral-300 px-3 text-sm dark:border-neutral-600';

export function KitSheet({
  kits,
  selectedCount,
  onSave,
  onRename,
  onDelete,
  onLoad,
  onClose,
}: {
  kits: IngredientKit[];
  selectedCount: number;
  onSave: (name: string, withStyles: boolean) => KitNameError | null;
  onRename: (id: string, name: string) => KitNameError | null;
  onDelete: (id: string) => void;
  onLoad: (id: string, mode: KitApplyMode) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [withStyles, setWithStyles] = useState(false);
  const [saveError, setSaveError] = useState<KitNameError | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [editError, setEditError] = useState<KitNameError | null>(null);
  const [deleting, setDeleting] = useState<IngredientKit | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    const err = onSave(name, withStyles);
    setSaveError(err);
    if (!err) {
      setName('');
      setWithStyles(false);
    }
  };

  const rename = () => {
    if (!editing) return;
    const err = onRename(editing.id, editing.name);
    setEditError(err);
    if (!err) setEditing(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="내 재료 세트"
        className="mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">내 재료 세트</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="min-h-11 min-w-11 text-xl"
          >
            ✕
          </button>
        </div>

        <section className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <label className="text-sm font-medium" htmlFor="kit-name">
            세트 이름
          </label>
          <input
            id="kit-name"
            value={name}
            maxLength={KIT_NAME_MAX + 5}
            onChange={(e) => {
              setName(e.target.value);
              setSaveError(null);
            }}
            placeholder="예: 평일 점심"
            className={inputClass}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withStyles}
              onChange={(e) => setWithStyles(e.target.checked)}
              className="size-5"
            />
            식단 스타일도 함께 저장
          </label>
          {saveError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {NAME_ERROR_TEXT[saveError]}
            </p>
          )}
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={save}
            className="min-h-12 rounded-lg bg-emerald-600 font-semibold text-white disabled:opacity-40"
          >
            현재 선택 저장
          </button>
          {selectedCount === 0 && (
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              재료를 1개 이상 고르면 저장할 수 있어요.
            </p>
          )}
        </section>

        <h3 className="mt-4 mb-2 font-semibold">저장한 세트</h3>
        {kits.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            저장한 세트가 없어요
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {kits.map((k) => (
              <li
                key={k.id}
                className="rounded-xl border border-neutral-300 p-3 dark:border-neutral-700"
              >
                {editing?.id === k.id ? (
                  <div className="flex flex-col gap-2">
                    <label className="sr-only" htmlFor={`rename-${k.id}`}>
                      새 이름
                    </label>
                    <input
                      id={`rename-${k.id}`}
                      value={editing.name}
                      onChange={(e) => {
                        setEditing({ id: k.id, name: e.target.value });
                        setEditError(null);
                      }}
                      className={inputClass}
                    />
                    {editError && (
                      <p
                        role="alert"
                        className="text-sm text-red-700 dark:text-red-400"
                      >
                        {NAME_ERROR_TEXT[editError]}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className={`${smallBtn} flex-1`}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={rename}
                        className="min-h-11 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white"
                      >
                        이름 저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="font-semibold">{k.name}</p>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400">
                      재료 {kitItemCount(k)}개
                      {k.styles
                        ? ` · 스타일: ${k.styles.length ? k.styles.map((s) => STYLE_INFO[s].label).join(', ') : '기본 식단'}`
                        : ''}
                    </p>
                    {loading === k.id ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <p className="text-sm">
                          지금 고른 재료를 어떻게 할까요?
                        </p>
                        <div className="flex gap-2">
                          {(
                            [
                              ['replace', '바꾸기'],
                              ['merge', '합치기'],
                            ] as const
                          ).map(([mode, label]) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                setLoading(null);
                                onLoad(k.id, mode);
                              }}
                              className="min-h-11 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white"
                            >
                              {label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setLoading(null)}
                            className={smallBtn}
                          >
                            취소
                          </button>
                        </div>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400">
                          바꾸기: 세트 내용으로 교체 · 합치기: 지금 선택에
                          세트를 더함
                        </p>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          aria-label={`${k.name} 불러오기`}
                          onClick={() => setLoading(k.id)}
                          className="min-h-11 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white"
                        >
                          불러오기
                        </button>
                        <button
                          type="button"
                          aria-label={`${k.name} 이름 수정`}
                          onClick={() => {
                            setEditing({ id: k.id, name: k.name });
                            setEditError(null);
                          }}
                          className={smallBtn}
                        >
                          이름 수정
                        </button>
                        <button
                          type="button"
                          aria-label={`${k.name} 삭제`}
                          onClick={() => setDeleting(k)}
                          className={`${smallBtn} text-red-700 dark:text-red-400`}
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {deleting && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title={`'${deleting.name}' 세트를 삭제할까요?`}
            body="삭제한 세트는 되돌릴 수 없어요."
            confirmLabel="삭제"
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              onDelete(deleting.id);
              setDeleting(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
