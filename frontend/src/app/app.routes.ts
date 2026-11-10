import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login').then((m) => m.Login),
    title: 'Sign in · RetailLens',
    canActivate: [guestGuard],
  },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Dashboard · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'datasets',
    loadComponent: () => import('./features/datasets/datasets').then((m) => m.Datasets),
    title: 'Datasets · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'datasets/:id',
    loadComponent: () =>
      import('./features/datasets/dataset-detail').then((m) => m.DatasetDetailPage),
    title: 'Dataset · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'sales',
    loadComponent: () => import('./features/sales/sales').then((m) => m.Sales),
    title: 'Sales · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'customers',
    loadComponent: () => import('./features/customers/customers').then((m) => m.Customers),
    title: 'Customers · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'customers/:id',
    loadComponent: () =>
      import('./features/customers/customer-detail').then((m) => m.CustomerDetailPage),
    title: 'Customer · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'products',
    loadComponent: () => import('./features/products/products').then((m) => m.Products),
    title: 'Products · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'products/:id',
    loadComponent: () =>
      import('./features/products/product-detail').then((m) => m.ProductDetailPage),
    title: 'Product · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'geography',
    loadComponent: () => import('./features/geography/geography').then((m) => m.Geography),
    title: 'Geography · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'returns',
    loadComponent: () => import('./features/returns/returns').then((m) => m.Returns),
    title: 'Returns · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'basket',
    loadComponent: () => import('./features/basket/basket').then((m) => m.Basket),
    title: 'Market basket · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'quality',
    loadComponent: () => import('./features/quality/quality').then((m) => m.Quality),
    title: 'Data quality · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'monitoring',
    loadComponent: () => import('./features/monitoring/monitoring').then((m) => m.Monitoring),
    title: 'Monitoring · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'boards',
    loadComponent: () => import('./features/boards/boards').then((m) => m.Boards),
    title: 'Boards · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'forecasting',
    loadComponent: () => import('./features/forecasting/forecasting').then((m) => m.Forecasting),
    title: 'Forecasting · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'reports',
    loadComponent: () => import('./features/reports/reports').then((m) => m.Reports),
    title: 'Reports · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'reports/:id',
    loadComponent: () => import('./features/reports/reports').then((m) => m.Reports),
    title: 'Report · RetailLens',
    canActivate: [authGuard],
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
    title: 'Settings · RetailLens',
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'dashboard' },
];
