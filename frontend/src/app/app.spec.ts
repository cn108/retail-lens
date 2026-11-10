import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { AuthService, CurrentUser } from './core/auth/auth.service';

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

const signedInStub = {
  loading: signal(false),
  user: signal<CurrentUser | null>(user),
  isAuthenticated: computed(() => true),
  activeOrganisation: computed(() => user.organisations[0]),
  logout: async () => undefined,
  switchOrganisation: async () => undefined,
};

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: signedInStub },
      ],
    }).compileComponents();
  });

  it('renders the product name and primary navigation', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('RetailLens');
    expect(text).toContain('Dashboard');
  });

  it('shows the signed-in user and their organisation', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('analyst@example.com');
    expect(text).toContain('Acme Retail');
  });
});
