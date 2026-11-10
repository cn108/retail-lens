import { HttpInterceptorFn } from '@angular/common/http';

import { API_BASE_URL } from '../api/api.config';

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * Send the session cookie with API calls and echo Django's CSRF token.
 *
 * The SPA and the API share an origin through the dev proxy, so the cookie is
 * first-party; `withCredentials` keeps it attached if they are ever split
 * across hosts again.
 */
export const credentialsInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(API_BASE_URL)) {
    return next(request);
  }

  const token = readCookie('csrftoken');
  return next(
    request.clone({
      withCredentials: true,
      setHeaders: token ? { 'X-CSRFToken': token } : {},
    }),
  );
};
