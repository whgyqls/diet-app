import { BackNav } from '@/components/BackNav';
import { SelectFlow } from '@/components/select/SelectFlow';

export default function Page() {
  return (
    <main>
      <BackNav fallback="/onboarding" />
      <SelectFlow />
    </main>
  );
}
