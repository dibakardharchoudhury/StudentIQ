import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";

export function createAzureCredential(): DefaultAzureCredential | ManagedIdentityCredential {
  if (process.env.NODE_ENV === "development") {
    return new DefaultAzureCredential();
  }
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  return clientId
    ? new ManagedIdentityCredential({ clientId })
    : new ManagedIdentityCredential();
}
