import { HomeActions } from '@/components/HomeActions';

export default function Home() {
  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-xl font-bold">원물 식단</h1>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        먹을 수 있는 재료를 고르면, 단백질 + 탄수화물 + 식이섬유 + 지방원 조합과
        양념 권장량을 끼니별로 추천해요.
      </p>
      <HomeActions />
    </main>
  );
}
