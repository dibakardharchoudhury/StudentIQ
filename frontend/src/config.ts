import { z } from 'zod';

const configSchema = z.object({
  apiBaseUrl: z.string().url(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  apiScope: z.string().regex(/^(?:api|https):\/\/[^\s]+\/[^\s/]+$/, 'Use a full exposed API scope URI.'),
});
export type AppConfig = z.infer<typeof configSchema>;

export function parseConfig(value: unknown): AppConfig {
  const result = configSchema.safeParse(value);
  if (!result.success) throw new Error('Parent setup needed: fill in public config.json (apiBaseUrl, tenantId, clientId, apiScope).');
  const url = new URL(result.data.apiBaseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('apiBaseUrl must be an HTTPS URL without credentials, query or fragment (HTTP localhost allowed for development).');
  }
  return { ...result.data, apiBaseUrl: url.href.replace(/\/$/, '') };
}

export async function loadConfig(): Promise<AppConfig> {
  const response = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('Cannot load public config.json. Check the project-site path and deployment.');
  return parseConfig(await response.json());
}
