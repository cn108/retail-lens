import { HttpErrorResponse } from '@angular/common/http';

interface ApiErrorBody {
  error?: {
    status?: number;
    message?: string;
    fields?: Record<string, string[] | Record<string, unknown>>;
  };
}

/**
 * Turn an API failure into one sentence a person can act on.
 *
 * Django answers every error with `{error: {status, message, fields}}`; field
 * errors are more specific than the generic message, so they win.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }
  if (error.status === 0) {
    return 'The API did not respond. Check that the backend is running.';
  }

  const body = error.error as ApiErrorBody | null;
  const fields = body?.error?.fields;
  if (fields) {
    const first = Object.values(fields)
      .flatMap((value) => (Array.isArray(value) ? value : Object.values(value).flat()))
      .find((value): value is string => typeof value === 'string' && value.length > 0);
    if (first) {
      return first;
    }
  }

  return body?.error?.message ?? fallback;
}
