# VS Code + Claude Code 진행 가이드

## 0. 시작 전 준비 (한 번만)

1. 프로젝트 폴더를 만들고 이 폴더의 `PLAN.md`, `CLAUDE.md`, `PROMPTS.md`, `data/`를 그대로 복사한다.
2. 필요한 것: Node.js LTS, Git, Supabase 계정, Vercel 계정, Anthropic API 키(Phase 6에서).
3. VS Code에서 폴더를 열고 Claude Code를 실행한 뒤 `git init`부터 시킨다(되돌리기용).

## 1. 모델·모드 사용법

| 상황 | 설정 |
|---|---|
| 기본 추천 | `/model opusplan` — **플랜 모드에서는 Opus, 실행할 때는 Sonnet**으로 자동 전환. 원하는 "기획은 Opus, 평소엔 Sonnet"과 정확히 같음 |
| Phase 1·2·5 설계처럼 어려운 구현 | 실행까지 `/model opus` |
| 화면 작업 등 일반 구현 | `/model sonnet` |
| 플랜 모드 켜기/끄기 | `Shift+Tab` (각 Phase 시작 시 항상 플랜 모드로 계획부터) |
| 자동 진행 | 계획 승인 후 "자동 수락(auto-accept)" 모드. 멈출 지점은 `CLAUDE.md`의 "반드시 멈추고 물어볼 때" 목록이 정한다 |

**Phase마다 반복하는 순서**
1. 새 대화 시작(`/clear`) — 이전 Phase 대화가 쌓이면 헷갈림이 늘어난다
2. 플랜 모드에서 아래 프롬프트 붙여넣기 → 계획 확인 → 승인
3. 자동 진행
4. ✋ 확인 지점에서 직접 확인 → 문제 없으면 커밋 지시 ("커밋해줘")

> 계획을 철저히 하면 중간 질문과 오류가 크게 줄지만 0이 되지는 않는다. 그래서 이 계획은 **테스트**(특히 Phase 2 계산 엔진)와 **Phase별 확인 지점**으로 오류를 일찍 잡도록 짰다.

---

## 2. Phase별 프롬프트 (그대로 붙여넣기)

### Phase 0 — 셋업 (Sonnet)
```
PLAN.md와 CLAUDE.md를 읽고 Phase 0을 진행해줘.
Next.js(App Router, TypeScript strict, Tailwind, ESLint, src 디렉터리) 프로젝트를 현재 폴더에 만들고,
Prettier, Vitest, Playwright를 설정해. CLAUDE.md의 폴더 구조대로 빈 폴더/파일을 만들고
npm 스크립트(dev, build, lint, test, test:e2e)를 맞춰줘. 기존 PLAN.md, CLAUDE.md, data/는 건드리지 마.
끝나면 lint/test/build 결과를 보여주고 멈춰.
```

### Phase 1 — 데이터 확정 (Opus)
```
Phase 1을 진행해줘. data/foods.json과 data/seasonings.json은 근사치 초안이야.
1) PLAN.md 6장의 타입을 src/types에 만들고, zod로 JSON 스키마 검증을 작성해.
2) 데이터 검증 테스트: 스키마 통과, id 중복 없음, kcal ≈ 4×단백질 + 4×(탄수−식이섬유) + 2×식이섬유 + 9×지방 (±20%),
   portion.min ≤ max, step으로 나누어떨어짐.
   (버섯류는 공식 kcal가 이 공식보다 30~40% 낮게 나오는 게 정상이니 group "버섯"은 칼로리 검사에서 제외해)
3) 영양값 출처는 data/raw/ 의 공공데이터 CSV야. 아래 규칙으로 foods.json 수치를 교체해.
   - 1순위: raw_foods_utf8.csv (원재료성식품, 공공데이터포털 CP949 원본을 UTF-8로 변환한 것)
   - 2순위: 원재료성에 없는 두부만 integrated_foods_utf8.csv(가공식품 일부만 담긴 5만 행 파일)에서
     일반 "국산콩 두부" 제품 3~5개 평균으로 가져와 (순두부·연두부·양념 제품 제외)
   - 잡곡밥은 조리 상태 데이터가 없어 '잡곡_..._생것' × 조리 비율로 추정했음(_todo 참고). 현미 생것/현미밥
     항목들로 비율을 다시 계산해 확정하고 "추정"으로 표시해. 퀴노아는 뺐음.
   - 귀리밥은 원재료성 '귀리밥_도정' 값. 귀리밥 식이섬유 빈칸은
     같은 원재료성의 귀리 생것 값에 조리 비율(귀리밥 kcal ÷ 귀리 생것 kcal)을 곱해 추정하고 "추정"으로 표시해
   - 항목 선택: foods.json의 basis와 같은 상태(raw=생것, cooked=찐것/삶은것/밥)로,
     "대표_평균" > "평균" > 그 외 순. 품종이 여러 개면 일반 품종 2~3개의 평균
   - 소고기는 저지방 부위(홍두깨살·우둔·사태·안심)만 쓰고 한우 1·2등급 평균으로 확정했음(이미 반영, source 참고)
   - 나트륨 등 빈칸은 같은 식품의 다른 항목 값으로 채우고 "보충"이라고 표시
   - foods.json 각 재료에 source(식품코드, 식품명, 파일명)를 기록
   - 같은 항목에서 micro100g(칼륨, 칼슘, 철, 비타민A, 비타민C)도 채워. 빈칸은 비워두기(추정 금지)
   - 데이터로 계산할 수 없는 특징이 있는 재료만 note 한 줄 초안을 써(예: 등푸른 생선 "오메가3가 많은 등푸른 생선").
     효능·질병 관련 표현은 금지. 초안 목록을 표로 보여주고 내 검토를 받아
   바꾼 값은 표(재료 | 이전 값 | 새 값 | 출처 식품명)로 정리하고, 확신이 없는 값은 "확인 필요"로 표시해.
끝나면 재료 목록과 변경 표를 보여주고 멈춰. 추가/삭제할 재료가 있는지 내가 정할게.
```

### Phase 2 — 계산 엔진 (Opus)
```
Phase 2를 진행해줘. PLAN.md 4장·5장 규칙대로 src/lib/nutrition에 순수 함수로 구현해.
- constants.ts: 모든 계수
- targets.ts: 프로필 → 하루/끼니 목표
- portions.ts: 조합 → 재료별 중량(10g 단위, min/max 제한)
- seasoning.ts: 나트륨 예산 → 양념 권장
- badges.ts: PLAN.md 5장 3-1의 보너스 배지("단백질도 풍부", "식이섬유 풍부") 계산 + 재료별 기여량
- highlights.ts: PLAN.md 3.2 재료 카드 정보(분류별 핵심 수치 1줄, 장단점 칩 최대 2개) 계산. 하루 권장량은 constants.ts에
- scoring.ts, generate.ts: 조합 생성, 점수, 다양성(MMR), 하루 식단 배치, 고정 재료·이미 본 조합 제외
각 파일마다 Vitest 테스트를 먼저 쓰고 구현해(경계값: 재료 1개만 선택, 탄수 0개, 나트륨 많은 재료만 선택 등).
마지막에 예시 사용자 3명(감량 여성 60kg, 유지 남성 75kg, 근육 증가 남성 70kg)의 하루 식단을 표로 출력하고 멈춰.
```

### Phase 3 — 프로필·재료 고르기 화면 (Sonnet)
```
Phase 3을 진행해줘. PLAN.md 3.1, 3.2대로 /onboarding과 /select를 만들어.
아직 Supabase 없이 로컬 상태(zustand 또는 React context, localStorage 저장)로 동작하게 해.
모바일 375px 우선, 재료 카드 3단 토글(먹을 수 있음 → 좋아함 → 해제), 분류 필터, 전체 선택, 최소 선택 조건 안내.
재료 카드에는 highlights.ts 결과(핵심 수치 1줄 + 장단점 칩 + note)를 보여주고, ⓘ를 누르면 전체 영양성분 바텀시트.
카드 정보 때문에 토글 터치 영역이 좁아지지 않게 해.
끝나면 dev 서버 주소를 알려주고 멈춰.
```

### Phase 4 — 추천 화면 (Sonnet)
```
Phase 4를 진행해줘. PLAN.md 3.3대로 /plan을 만들어.
Phase 2 엔진만 사용하고 화면에서 영양 계산을 직접 하지 마.
하루 합계 막대, 끼니 탭, 조합 카드 가로 스와이프(기본 5개), 이 조합 선택, 재료 바꾸기, 고정, 비교(2~3개), 저장, 다시 추천.
핵심 흐름(선택 → 추천 → 조합 선택 → 재료 바꾸기)을 Playwright 테스트로 작성해. 끝나면 멈춰.
```

### Phase 5 — Supabase (설계 Opus → 구현 Sonnet)
```
Phase 5를 진행해줘. PLAN.md 6.3 스키마로 supabase/migrations SQL과 RLS 정책을 먼저 작성해서 보여주고 멈춰.
내가 승인하면: @supabase/ssr로 로그인(이메일 매직링크 + Google), 미들웨어로 보호 라우트,
로컬 상태를 DB 저장으로 교체, 계정 삭제 시 데이터 전부 삭제. 필요한 환경변수 이름만 알려줘.
```

### Phase 6 — AI 설명 (Sonnet)
```
Phase 6을 진행해줘. PLAN.md 7장대로 /api/explain을 만들어. 코드 작성 전에 claude-api 스킬 문서를 확인해.
캐시(ai_explanations), 하루 호출 제한(ai_usage), 실패·거절 시 설명만 숨김.
추천 카드에서 설명은 비동기로 불러오게 해. ANTHROPIC_API_KEY는 내가 .env.local에 넣을게.

모델은 아직 미정이야. 먼저 비교 스크립트(scripts/compare-models.ts)를 만들어서:
- Phase 2 엔진으로 서로 다른 조합 10개(감량/유지/근육 증가 섞어서)를 만들고
- 같은 프롬프트로 claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5 설명을 각각 뽑아
- 결과를 docs/model-comparison.md에 표로 저장해(조합 | Haiku | Sonnet | Opus | 응답시간 | 토큰 수 | 예상 비용)
- 숫자를 잘못 인용했거나 입력에 없는 수치를 만든 설명은 표시해줘
실행 전에 예상 API 비용을 알려주고 내 승인을 받아. 결과 표를 보여주고 멈춰. 내가 모델을 고르면 그걸로 API를 완성해.
```

### Phase 7 — PWA·마무리 (Sonnet)
```
Phase 7을 진행해줘. PWA 매니페스트·아이콘·서비스워커(오프라인 시 마지막 식단 보기), 다크 모드,
접근성(대비, 터치 영역 44px, 라벨) 점검, 빈 상태/오류 화면 정리. Lighthouse 결과를 보여주고 멈춰.
```

### Phase 8 — 배포 (Sonnet)
```
Phase 8을 진행해줘. Vercel 배포에 필요한 설정과 환경변수 목록, Supabase 리디렉션 URL 설정 방법을 정리해줘.
실제 배포 명령은 내가 승인한 뒤에 실행해.
```

---

## 3. 문제가 생겼을 때
- 같은 오류가 반복되면: `/model opus`로 바꾸고 "원인부터 분석하고 수정 계획을 먼저 보여줘"
- 결과가 기획과 다르면: "PLAN.md ○장과 다른 부분을 찾아서 고쳐줘"
- 대화가 길어져 엉뚱해지면: 커밋 후 `/clear` 하고 해당 Phase 프롬프트로 다시 시작
