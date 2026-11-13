import { readQuotaSettings, type QuotaSettings } from "./quota.js";
import { readPreferenceDefaults } from "./preferences.js";
import type { Preferences } from "./contracts.js";

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppConfig extends QuotaSettings {
  tenantId: string;
  audience: string;
  parentOid: string;
  studentOid?: string;
  requiredScope: string;
  githubPagesOrigin: string;
  blobEndpoint: string;
  blobContainer: string;
  foundryEndpoint: string;
  foundryModel: string;
  foundryApiVersion: string;
  speechIdentityClientId: string;
  speechResourceId: string;
  speechRegion: string;
  preferenceDefaults: Preferences;
}

export function validateSpeechIdentity(clientId: string, resourceId: string): void {
  if (!GUID_PATTERN.test(clientId) ||
      clientId.toLowerCase() === process.env.AZURE_CLIENT_ID?.trim().toLowerCase() ||
      !/^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/resourceGroups\/[a-z0-9_.()-]{1,90}\/providers\/Microsoft\.CognitiveServices\/accounts\/[a-z0-9][a-z0-9-]{1,63}$/i.test(resourceId)) {
    throw new Error("Invalid isolated Speech identity configuration.");
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error("Missing required application configuration.");
  }
  return value;
}

function httpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid origin configuration.");
  }
  return url.origin;
}

function httpsEndpoint(value: string, setting: string, rootOnly: boolean): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`Invalid ${setting} configuration.`);
  }
  if (rootOnly && url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`Invalid ${setting} configuration.`);
  }
  return url.toString().replace(/\/$/, "");
}

export function getConfig(): AppConfig {
  const tenantId = required("ENTRA_TENANT_ID").toLowerCase();
  const parentOid = required("ENTRA_PARENT_OID").toLowerCase();
  const studentOid = process.env.ENTRA_STUDENT_OID?.trim().toLowerCase() || undefined;
  const audience = required("ENTRA_API_AUDIENCE");
  const requiredScope = required("ENTRA_REQUIRED_SCOPE");
  const blobContainer = required("BLOB_CONTAINER_NAME");
  const speechRegion = required("AZURE_SPEECH_REGION").toLowerCase();
  const speechIdentityClientId = required("SPEECH_IDENTITY_CLIENT_ID");
  const speechResourceId = required("SPEECH_RESOURCE_ID");
  validateSpeechIdentity(speechIdentityClientId, speechResourceId);
  const foundryModel = process.env.FOUNDRY_MODEL?.trim() || "model-router";
  const foundryApiVersion = process.env.FOUNDRY_API_VERSION?.trim() || "2024-05-01-preview";

  if (!GUID_PATTERN.test(tenantId) || !GUID_PATTERN.test(parentOid) ||
      (studentOid !== undefined && (!GUID_PATTERN.test(studentOid) || studentOid === parentOid)) ||
      !audience || /\s/.test(audience) || /\s/.test(requiredScope) ||
      !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(blobContainer) ||
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(speechRegion) ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(foundryModel) ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9-]+$/.test(foundryApiVersion)) {
    throw new Error("Invalid application configuration.");
  }

  return {
    ...readQuotaSettings(process.env),
    preferenceDefaults: readPreferenceDefaults(process.env),
    tenantId,
    audience,
    parentOid,
    ...(studentOid ? { studentOid } : {}),
    requiredScope,
    githubPagesOrigin: httpsOrigin(required("GITHUB_PAGES_ORIGIN")),
    blobEndpoint: httpsEndpoint(required("AZURE_STORAGE_BLOB_ENDPOINT"), "Blob endpoint", true),
    blobContainer,
    foundryEndpoint: httpsEndpoint(required("FOUNDRY_ENDPOINT"), "Foundry endpoint", true),
    foundryModel,
    foundryApiVersion,
    speechIdentityClientId,
    speechResourceId,
    speechRegion
  };
}
