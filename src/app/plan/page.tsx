import { BackNav } from '@/components/BackNav';
import { PlanScreen } from '@/components/plan/PlanScreen';

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-md">
      <BackNav fallback="/select" />
      <PlanScreen />
    </main>
  );
}
