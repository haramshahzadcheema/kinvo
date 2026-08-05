import type { Response } from 'supertest';

const DEFAULT_COOKIE_NAME = 'kinvo_refresh_token';

export function extractRefreshTokenCookie(
  response: Response,
  cookieName: string = DEFAULT_COOKIE_NAME,
): string {
  const setCookieHeader = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookieLine = setCookieHeader?.find((line) => line.startsWith(`${cookieName}=`));
  if (!cookieLine) {
    throw new Error(`Expected a "${cookieName}" cookie in the response, found none.`);
  }
  const value = cookieLine.split(';')[0]?.split('=')[1];
  if (!value) {
    throw new Error(`Could not parse "${cookieName}" cookie value.`);
  }
  return value;
}

export function cookieHeader(rawValue: string, cookieName: string = DEFAULT_COOKIE_NAME): string {
  return `${cookieName}=${rawValue}`;
}
