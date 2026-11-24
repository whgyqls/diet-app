import Link from 'next/link';
import { BackNav } from '@/components/BackNav';
import { DeleteAccountButton } from '@/components/auth/DeleteAccountButton';
import { LogoutButton } from '@/components/auth/LogoutButton';

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-md p-4">
      <BackNav fallback="/" flush />
      <h1 className="mt-2 text-xl font-bold">설정</h1>
      <div className="mt-6 flex flex-col gap-3">
        <LogoutButton />
        <DeleteAccountButton />
      </div>
      <p className="mt-6 text-sm">
        <Link href="/privacy" className="underline">
          개인정보 안내
        </Link>
      </p>
    </main>
  );
}
