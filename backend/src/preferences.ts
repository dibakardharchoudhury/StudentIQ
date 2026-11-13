import { validatePreferences, type JsonBlobStore, type Preferences } from "./contracts.js";

export function readPreferenceDefaults(env: Record<string, string | undefined>): Preferences {
  try {
    return validatePreferences({
      appearance: env.DEFAULT_APPEARANCE ?? "rose",
      voice: env.DEFAULT_VOICE ?? "default",
      mood: env.DEFAULT_MOOD ?? "gentle"
    });
  } catch {
    throw new Error("Invalid preference defaults configuration.");
  }
}

export class PreferencesRepository {
  private readonly defaults: Preferences;

  constructor(private readonly blobs: JsonBlobStore, defaults: Preferences) {
    this.defaults = validatePreferences(defaults);
  }

  private key(parentOid: string): string {
    return `parents/${parentOid.toLowerCase()}/preferences.json`;
  }

  async get(parentOid: string): Promise<Preferences> {
    const stored = await this.blobs.read<unknown>(this.key(parentOid));
    if (!stored) return { ...this.defaults };
    try {
      return validatePreferences(stored.value);
    } catch {
      throw new Error("Invalid preference storage.");
    }
  }

  async put(parentOid: string, value: Preferences): Promise<Preferences> {
    const preferences = validatePreferences(value);
    const key = this.key(parentOid);
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.blobs.read<unknown>(key);
      const saved = current
        ? await this.blobs.replace(key, preferences, current.etag)
        : await this.blobs.create(key, preferences);
      if (saved) return { ...preferences };
    }
    throw new Error("Preference write could not be confirmed.");
  }
}
