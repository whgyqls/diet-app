import type { Metadata } from 'next';
import Link from 'next/link';
import { BackNav } from '@/components/BackNav';
import { ACCOUNT_DATA_TEXT } from '@/lib/ui-labels';

export const metadata: Metadata = { title: '개인정보 안내 · 원물 식단' };

/**
 * Privacy notice. Public: no login needed (it is not in PROTECTED_PREFIXES, src/lib/auth/routes.ts).
 * It describes what the code really stores (supabase/migrations/0001_init.sql, src/lib/store) and must change
 * when that changes. The AI explanation part follows src/lib/explain (what is sent: payload.ts, what is kept:
 * supabase/migrations/0002_ai.sql).
 */
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-md p-4 pb-16">
      <BackNav fallback="/" flush />
      <h1 className="mt-2 text-xl font-bold">개인정보 안내</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        시행일 2026-11-25
      </p>

      <section aria-labelledby="who" className="mt-6">
        <h2 id="who" className="text-base font-bold">
          누가 운영하나요
        </h2>
        <p className="mt-2 text-sm">
          이 앱은 학생 프로젝트로 만든 원물 식단 추천 앱이에요.
        </p>
      </section>

      <section aria-labelledby="what" className="mt-6">
        <h2 id="what" className="text-base font-bold">
          어떤 정보를 모으나요
        </h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>로그인:</strong> 이메일 주소. Google로 로그인하면 Google이
            알려 주는 이메일과 기본 프로필 정보(이름, 프로필 사진 주소)가 로그인
            서비스에 저장될 수 있어요. 앱은 이 가운데 이메일만 로그인에 쓰고,
            이름과 사진은 쓰거나 화면에 보여 주지 않아요.
          </li>
          <li>
            <strong>앱에서 입력한 정보:</strong> 성별, 출생연도, 키, 몸무게,
            활동량, 목표(감량·유지·근육 증가), 식사 횟수, 식단 스타일, 직접
            설정한 목표 숫자, 먹을 수 있는/좋아하는 재료와 양념 선택, 내 재료
            세트, 저장한 조합(★), 날짜별 식단 기록(그날 고른 끼니별
            재료·분량·영양 합계).
          </li>
          <li>
            <strong>이 브라우저에 저장되는 것:</strong> 로그인 상태(쿠키)와,
            빠르게 보여 주려고 위 정보를 복사해 둔 사본.
          </li>
          <li>
            <strong>AI 설명 사용 기록:</strong> 하루 사용 횟수 한도를 지키려고
            날짜별 횟수를 계정에 연결해 저장해요.
          </li>
          <li>광고나 분석 도구는 쓰지 않아요.</li>
        </ul>
      </section>

      <section aria-labelledby="where" className="mt-6">
        <h2 id="where" className="text-base font-bold">
          어디에 저장되고 누가 처리하나요
        </h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>Supabase:</strong> 로그인과 위 정보의 저장(데이터베이스). 내
            정보는 나만 볼 수 있도록 접근 규칙(RLS)으로 막아 두었어요.
          </li>
          <li>
            <strong>Netlify:</strong> 앱을 인터넷에 올려 두는 호스팅.
          </li>
          <li>
            <strong>OpenRouter와 AI 모델 제공자:</strong> &lsquo;AI 설명
            보기&rsquo;를 누를 때만. 아래 &lsquo;AI 설명&rsquo;을 보세요.
          </li>
          <li>
            <strong>Google:</strong> &lsquo;Google로 계속하기&rsquo;를 선택할
            때만.
          </li>
          <li>
            서비스들이 운영을 위해 접속 기록이나 백업을 일정 기간 보관할 수
            있어요. 앱이 정하는 것이 아니에요.
          </li>
          <li>정보를 판매하거나 광고에 쓰지 않아요.</li>
        </ul>
      </section>

      <section aria-labelledby="ai" className="mt-6">
        <h2 id="ai" className="text-base font-bold">
          AI 설명
        </h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
          <li>
            추천 카드의 &lsquo;AI 설명 보기&rsquo;를 눌렀을 때만, 그 조합의 재료
            이름과 분량, 영양 합계, 양념, 목표 종류(감량·유지·근육 증가)가
            OpenRouter를 거쳐 AI 모델 제공자에게 전달돼요.
          </li>
          <li>
            이메일, 계정 ID, 성별, 출생연도, 키, 몸무게, 목표 칼로리 같은 숫자는
            보내지 않아요.
          </li>
          <li>
            모델 제공자는 자기 약관에 따라 받은 내용을 보관하거나 모델 개선에 쓸
            수 있어요. 앱이 정하는 것이 아니에요. 설명은 Google(Gemma)의 무료
            모델이 먼저 만들고, 실패하면 NVIDIA를 통해 제공되는 무료 모델로
            넘어갈 수 있어요.
          </li>
          <li>
            같은 조합의 설명은 다시 쓰려고 앱의 데이터베이스(Supabase)에
            저장해요. 이 설명은 계정과 연결되지 않아요.
          </li>
          <li>
            AI 설명은 부정확할 수 있고, 쓸 수 없을 때는 앱이 계산 결과로 만든
            기본 설명을 보여 줘요.
          </li>
          <li>
            AI 쪽 사정(제공자의 한도나 지연)으로 설명을 받지 못하면 그 호출은
            사용 횟수에서 빼 줘요.
          </li>
        </ul>
      </section>

      <section aria-labelledby="delete" className="mt-6">
        <h2 id="delete" className="text-base font-bold">
          계정과 정보 삭제
        </h2>
        <p className="mt-2 text-sm">
          계정과 정보는 <strong>설정 → 계정 삭제</strong>에서 직접, 언제든
          삭제할 수 있어요. 삭제하면 계정과 {ACCOUNT_DATA_TEXT}이 모두 지워지고
          되돌릴 수 없어요. 이 브라우저에 남은 내 기록도 함께 지워져요. (다른
          계정이 이미 불러간 이 브라우저의 옛 기록은 그 계정의 것이라 남아
          있어요.)
        </p>
      </section>

      <section aria-labelledby="note" className="mt-6">
        <h2 id="note" className="text-base font-bold">
          참고
        </h2>
        <p className="mt-2 text-sm">
          이 앱은 의료 행위가 아니라 식단 참고용이에요.
        </p>
      </section>

      <p className="mt-8 text-sm">
        <Link href="/" className="underline">
          처음으로
        </Link>
      </p>
    </main>
  );
}
