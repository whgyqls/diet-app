// Korean messages for the login screen. Maps the Auth error (code / HTTP status) to something a person can act on.

/** Seconds before the same address may ask for another link (Supabase allows one per 60 s per user). */
export const RESEND_COOLDOWN_SECONDS = 60;

export const LOGIN_MESSAGES = {
  sent: '메일을 보냈어요. 메일의 링크를 누르면 로그인돼요. 안 보이면 스팸함도 확인해 주세요.',
  invalidEmail: '이메일 주소를 확인해 주세요.',
  rateLimited: '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.',
  notAuthorized: '이 주소로는 아직 로그인 메일을 보낼 수 없어요.',
  linkFailed:
    '로그인 링크가 만료됐거나 이미 사용됐어요. 새 링크를 받아 주세요.',
  generic: '메일을 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.',
} as const;

export type LoginErrorLike =
  { code?: string | null; status?: number | null } | null | undefined;

export function loginErrorMessage(error: LoginErrorLike): string {
  const code = error?.code ?? '';
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    error?.status === 429
  )
    return LOGIN_MESSAGES.rateLimited;
  if (code === 'email_address_not_authorized')
    return LOGIN_MESSAGES.notAuthorized;
  if (code === 'email_address_invalid' || code === 'validation_failed')
    return LOGIN_MESSAGES.invalidEmail;
  return LOGIN_MESSAGES.generic;
}

/** Light check before asking the server: something@something.something, no spaces. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
