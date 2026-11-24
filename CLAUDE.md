# CLAUDE.md

원물 위주 식단 추천 PWA. 기획 전체는 `PLAN.md`가 기준이다. 작업 전에 해당 Phase 부분을 읽고, 기획과 다르게 해야 할 이유가 생기면 구현하지 말고 먼저 물어본다.

## 제품 핵심 규칙
- 레시피를 만들지 않는다. 결과는 항상 "단백질 + 탄수화물(0~1) + 식이섬유(1~2) + 지방원(0~1) + 양념 권장량" 조합이다.
- 영양 계산·분량·순위는 `src/lib/nutrition/`의 순수 함수로만 한다. UI나 AI가 숫자를 계산하거나 바꾸지 않는다.
- 모든 영양 상수는 `src/lib/nutrition/constants.ts` 한 곳에만 둔다. 매직 넘버 금지.
- 중량 단위는 g, 나트륨은 mg. 재료의 `basis`(raw/cooked)를 화면에 표시한다.
- 화면 문구는 한국어. 코드 식별자·주석은 영어.

## 기술 스택
- Next.js(App Router) + TypeScript(strict) + Tailwind CSS
- Supabase(Auth, Postgres, RLS). 마이그레이션은 `supabase/migrations/`에 SQL로.
- 테스트: Vitest(로직), Playwright(화면 흐름)
- AI 설명: OpenRouter의 OpenAI 호환 chat completions를 `fetch`로 호출한다(새 패키지 없음). 서버 라우트(`src/app/api/explain/route.ts`)에서만 호출하고, 키 `OPENROUTER_API_KEY`는 서버 전용이다(`NEXT_PUBLIC_` 금지). 모델 이름은 `src/lib/explain/config.ts`의 `DEFAULT_MODEL`(처음엔 `openrouter/free`)과 환경변수 `OPENROUTER_MODEL`, 이 한 곳에서만 바꾼다. AI에는 재료 이름·분량·영양 합계·양념·목표 종류(감량·유지·근육 증가)만 보내고 이메일·계정 ID·몸무게·나이·목표 숫자는 보내지 않는다. 같은 조합은 캐시, 사용자별·사이트 전체 하루 호출 한도, 서버 대기 8초, 실패하거나 검증에서 탈락하면 AI 없는 기본 문장을 쓴다. 답의 숫자는 입력값만 허용하고 효능 표현은 걸러낸다(`src/lib/explain/validate.ts`).

## 폴더 구조
```
data/                 foods.json, seasonings.json
src/app/              라우트(/, /onboarding, /select, /plan, /saved, /settings, /api/explain)
src/components/       UI 컴포넌트
src/lib/nutrition/    constants, targets, styles, flags, portions, seasoning, badges, highlights, scoring, generate (순수 함수 + *.test.ts)
src/lib/supabase/     클라이언트/서버 클라이언트, 쿼리
src/types/            공용 타입
supabase/migrations/  SQL
tests/e2e/            Playwright
```

## 명령어
- `npm run dev` / `npm run build` / `npm run lint` / `npm test` / `npm run test:e2e`
- 작업을 끝냈다고 말하기 전에 `npm run lint`, `npm test`, `npm run build`를 통과시킨다. 실패하면 실패했다고 그대로 보고한다.

## 반드시 멈추고 사용자에게 물어볼 때
1. 각 Phase가 끝났을 때 (PLAN.md 9장의 ✋ 항목을 보여주고 확인받기)
2. `PLAN.md`의 결정 사항과 다르게 구현해야 할 때
3. 새 npm 패키지를 추가할 때 (이름과 이유 한 줄)
4. DB 스키마·RLS 정책을 만들거나 바꿀 때
5. API 키·비밀값이 필요할 때 (직접 만들거나 추측하지 말 것. `.env.local`에 넣을 변수 이름만 알려주기)
6. 배포, 외부 서비스 설정 변경, 데이터 삭제 등 되돌리기 어려운 작업
7. 같은 오류를 두 번 고쳤는데도 해결되지 않을 때

그 외(코드 작성, 테스트 추가, 리팩터링, 린트 수정)는 묻지 않고 진행한다.

## 금지
- `.env*` 파일 커밋, 비밀값을 코드에 하드코딩
- 테스트를 통과시키려고 테스트를 삭제하거나 기대값을 임의로 바꾸기
- 클라이언트 코드에서 OpenRouter(AI) API 직접 호출, AI 요청에 사용자 정보(이메일·계정 ID·신체 정보·목표 숫자) 넣기
- 화면·AI 설명 문구에 "대사 개선", "혈당 개선" 같은 효능 표현 쓰기 (질병 예방·치료 효능 표현도 마찬가지)
