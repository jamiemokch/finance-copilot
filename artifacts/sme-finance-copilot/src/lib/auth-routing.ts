export type AuthSurface =
  | 'loading'
  | 'profile-error'
  | 'welcome'
  | 'onboarding'
  | 'dashboard'
  | 'app';

export function getLoginUrl(baseUrl = ''): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `/api/login?returnTo=${encodeURIComponent(base || '/')}`;
}

export function getLogoutUrl(baseUrl = ''): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `/api/logout?returnTo=${encodeURIComponent(base || '/')}`;
}

export function getAuthSurface(input: {
  location: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  profilesCount: number;
  profilesLoaded: boolean;
  profileLoadError: boolean;
}): AuthSurface {
  if (input.isLoading || (input.isAuthenticated && !input.profilesLoaded)) {
    return 'loading';
  }

  if (input.isAuthenticated && input.profileLoadError) {
    return 'profile-error';
  }

  const isPublicRoute = input.location === '/' || input.location === '/welcome';

  if (!input.isAuthenticated) {
    return 'welcome';
  }

  if (input.profilesCount === 0) {
    return 'onboarding';
  }

  if (isPublicRoute || input.location === '/onboarding') {
    return 'dashboard';
  }

  return 'app';
}