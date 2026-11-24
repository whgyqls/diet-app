import { DeleteAccountButton } from '@/components/auth/DeleteAccountButton';
import { LogoutButton } from '@/components/auth/LogoutButton';

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-md p-4">
      <h1 className="text-xl font-bold">설정</h1>
      <div className="mt-6 flex flex-col gap-3">
        <LogoutButton />
        <DeleteAccountButton />
      </div>
    </main>
  );
}
