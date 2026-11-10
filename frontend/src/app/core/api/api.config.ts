/**
 * Base URL of the Django API.
 *
 * The Angular dev server proxies /api to Django (see proxy.conf.json), so the
 * browser always talks to its own origin. That keeps the session cookie
 * first-party and means the same relative URL works when Django serves the
 * built application in production.
 */
export const API_BASE_URL = '/api/v1';
