// Type declarations for Vite's import.meta.env
// Used by use-auth.ts to construct login/logout redirect URLs

interface ImportMeta {
  readonly env: {
    readonly BASE_URL: string;
    readonly MODE: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly SSR: boolean;
    [key: string]: unknown;
  };
}
