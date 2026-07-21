export type RuntimeEnvironment = 'development' | 'staging' | 'production';
export type RuntimeAuthenticationMode = 'development' | 'oidc';

export type ApplicationRuntime = Readonly<{
  apiBaseUrl: string;
  webBaseUrl: string;
  environment: RuntimeEnvironment;
  authenticationMode: RuntimeAuthenticationMode;
}>;

declare global {
  interface Window {
    __FMCGBYALEX_RUNTIME__?: {
      apiBaseUrl?: string;
      webBaseUrl?: string;
      environment?: RuntimeEnvironment;
      authenticationMode?: RuntimeAuthenticationMode;
    };
  }
}

const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLocalBrowser = localHostnames.has(window.location.hostname);
const injected = window.__FMCGBYALEX_RUNTIME__;
const viteApiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const applicationRuntime: ApplicationRuntime = {
  apiBaseUrl: trimTrailingSlash(
    injected?.apiBaseUrl ?? viteApiBaseUrl ?? (isLocalBrowser ? 'http://localhost:8787' : window.location.origin)
  ),
  webBaseUrl: trimTrailingSlash(injected?.webBaseUrl ?? window.location.origin),
  environment: injected?.environment ?? (isLocalBrowser ? 'development' : 'production'),
  authenticationMode: injected?.authenticationMode ?? (isLocalBrowser ? 'development' : 'oidc')
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
