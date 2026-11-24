import { BackNav } from '@/components/BackNav';
import { OnboardingForm } from '@/components/onboarding/OnboardingForm';

export default function Page() {
  return (
    <main>
      <BackNav fallback="/" />
      <OnboardingForm />
    </main>
  );
}
