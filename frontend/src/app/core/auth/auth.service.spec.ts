import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AuthService, CurrentUser } from './auth.service';

const user: CurrentUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'analyst@example.com',
  display_name: 'Ada Analyst',
  date_joined: '2026-01-01T00:00:00Z',
  preferences: { default_organisation: '22222222-2222-4222-8222-222222222222' },
  organisations: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Acme Retail',
      slug: 'acme-retail',
      currency: 'GBP',
      role: 'owner',
    },
  ],
};

/** Let an awaited HTTP call resume before asserting on the next request. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  it('refreshes the CSRF cookie before signing in', async () => {
    const login = service.login('analyst@example.com', 'a-long-password');

    http.expectOne('/api/v1/auth/csrf').flush({ csrfToken: 'token' });
    await settle();

    const request = http.expectOne('/api/v1/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'analyst@example.com',
      password: 'a-long-password',
    });
    request.flush(user);

    await login;
    expect(service.user()?.email).toBe('analyst@example.com');
    expect(service.isAuthenticated()).toBe(true);
    http.verify();
  });

  it('treats a missing session as signed out', async () => {
    const restored = service.ensureRestored();

    http.expectOne('/api/v1/auth/csrf').flush({});
    await settle();
    http
      .expectOne('/api/v1/auth/me')
      .flush(
        { error: { status: 401, message: 'Authentication credentials were not provided.' } },
        { status: 401, statusText: 'Unauthorized' },
      );

    await restored;
    expect(service.user()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.loading()).toBe(false);
    http.verify();
  });

  it('selects the preferred organisation and falls back to the first', async () => {
    const restored = service.ensureRestored();
    http.expectOne('/api/v1/auth/csrf').flush({});
    await settle();
    http.expectOne('/api/v1/auth/me').flush(user);
    await restored;

    expect(service.activeOrganisation()?.name).toBe('Acme Retail');

    service.user.set({ ...user, preferences: { default_organisation: null } });
    expect(service.activeOrganisation()?.id).toBe(user.organisations[0].id);
  });
});
