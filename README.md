This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 필요한 키

`.env.sample`을 `.env.local`로 복사한 뒤 값을 채웁니다. `.env.local`은 커밋하지 않습니다. Netlify에서는 같은 이름을 사이트의 환경변수에 직접 입력합니다. 값은 이 저장소에 적지 않습니다.

| 이름 | 용도 | 공개 여부 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 주소(경로 없는 `https://<ref>.supabase.co`) | 브라우저에 공개 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon 키(데이터는 RLS가 보호) | 브라우저에 공개 |
| `SUPABASE_SERVICE_ROLE_KEY` | 계정 삭제(서버 전용) | **비공개. `NEXT_PUBLIC_` 접두사 금지** |
| `ANTHROPIC_API_KEY` | AI 설명(서버 전용). 아직 코드가 읽지 않음 | 비공개 |

테스트용 Supabase 프로젝트의 값은 `.env.test.local`에 넣습니다(`SUPABASE_TEST_PROJECT=1`과 위 세 이름). 운영 프로젝트 값은 거기에 넣지 않습니다.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy

The deployment target is Netlify (database and login stay on Supabase). The checklist is in `PLAN.md`, section 9.1.
