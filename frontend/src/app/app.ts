import { Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from './core/auth/auth.service';
import { ActivityTray } from './shared/activity-tray';
import { CommandPalette } from './shared/command-palette';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ActivityTray, CommandPalette],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly menuOpen = signal(false);
  readonly searchOpen = signal(false);

  readonly navGroups: NavGroup[] = [
    {
      label: 'Workspace',
      items: [
        {
          path: '/dashboard',
          label: 'Dashboard',
          icon: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
        },
        { path: '/datasets', label: 'Datasets', icon: 'M3 7h7l2 2h9v10H3z' },
        {
          path: '/boards',
          label: 'Boards',
          icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
        },
      ],
    },
    {
      label: 'Analyse',
      items: [
        { path: '/sales', label: 'Sales', icon: 'M4 19V5m0 14h16M8 15l3-4 3 2 5-7' },
        {
          path: '/customers',
          label: 'Customers',
          icon: 'M16 20v-1.5a4.5 4.5 0 0 0-9 0V20m4.5-7a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm4-7a3 3 0 0 1 0 6m2 3a4 4 0 0 1 3 4v1',
        },
        {
          path: '/products',
          label: 'Products',
          icon: 'm12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8m-9 5v9',
        },
        {
          path: '/geography',
          label: 'Geography',
          icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-18c3 3 3 15 0 18M3.5 9h17M3.5 15h17',
        },
        {
          path: '/returns',
          label: 'Returns',
          icon: 'M9 14 4 9l5-5m-5 5h11a5 5 0 0 1 0 10h-3',
        },
        {
          path: '/basket',
          label: 'Cross-sell',
          icon: 'M4 8h7v11H4zM13 8h7v7h-7zM4 4h7M13 4h7',
        },
      ],
    },
    {
      label: 'Intelligence',
      items: [
        { path: '/forecasting', label: 'Forecasting', icon: 'M3 17l6-6 4 3 8-9m-6 0h6v6' },
        { path: '/reports', label: 'Reports', icon: 'M6 3h9l4 4v14H6zM15 3v5h4M9 12h7M9 16h7' },
      ],
    },
    {
      label: 'Operate',
      items: [
        {
          path: '/monitoring',
          label: 'Monitoring',
          icon: 'M18 8a6 6 0 1 0-12 0c0 6-3 6-3 8h18c0-2-3-2-3-8M10 20a2 2 0 0 0 4 0',
        },
        {
          path: '/quality',
          label: 'Data quality',
          icon: 'm12 3 8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3 9 2.5 2.5L16 10',
        },
        {
          path: '/settings',
          label: 'Settings',
          icon: 'M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M10 14v6',
        },
      ],
    },
  ];

  readonly nav = this.navGroups.flatMap((group) => group.items);

  async signOut(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  @HostListener('document:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    if (
      !this.auth.isAuthenticated() ||
      event.repeat ||
      event.altKey ||
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== 'k'
    ) {
      return;
    }
    event.preventDefault();
    this.searchOpen.update((open) => !open);
  }

  openSearch(): void {
    this.menuOpen.set(false);
    this.searchOpen.set(true);
  }

  async switchOrganisation(event: Event): Promise<void> {
    const organisationId = (event.target as HTMLSelectElement).value;
    if (!organisationId) {
      return;
    }
    try {
      this.menuOpen.set(false);
      await this.auth.switchOrganisation(organisationId);
    } catch {
      // Keep the current organisation; the next API call reports the problem.
    }
  }
}
