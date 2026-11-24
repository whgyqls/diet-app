import Link from 'next/link';
import { BackNav } from '@/components/BackNav';
import { DayPlanList } from '@/components/saved/DayPlanList';
import { SavedList } from '@/components/saved/SavedList';

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-md">
      <BackNav fallback="/plan" />
      <h1 className="px-4 pt-4 text-xl font-bold">저장한 조합</h1>
      <SavedList />
      <DayPlanList />
      <div className="px-4 pb-8">
        <Link
          href="/plan"
          className="inline-flex min-h-11 items-center underline"
        >
          추천 화면으로
        </Link>
      </div>
    </main>
  );
}
