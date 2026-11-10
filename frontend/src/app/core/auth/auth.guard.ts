import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  // Both tokens must be read before the await: the injection context is only
  // available while the guard runs synchronously.
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ensureRestored();
  return auth.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ensureRestored();
  return auth.isAuthenticated() ? router.createUrlTree(['/dashboard']) : true;
};
