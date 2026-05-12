/**
 * Brand string for the UI (title, header). Set at build time via VITE_APP_BRAND.
 * Docker build sets VITE_APP_BRAND=LiteClaw so the image always shows LiteClaw.
 */
const env = (import.meta as unknown as { env?: { VITE_APP_BRAND?: string } }).env;
export const APP_BRAND = (env?.VITE_APP_BRAND?.trim() && env.VITE_APP_BRAND) || "LiteClaw";
