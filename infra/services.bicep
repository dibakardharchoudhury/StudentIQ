targetScope = 'resourceGroup'

param location string = resourceGroup().location

var suffix = uniqueString(resourceGroup().id)
var tags = {
  application: 'StudentIQ'
  environment: 'personal'
  managedBy: 'IaC'
}

resource hostStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'sqih${suffix}'
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
  }
  tags: tags
}

resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'sqid${suffix}'
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
  }
  tags: tags
}

resource hostBlobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: hostStorage
  name: 'default'
}

resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: hostBlobs
  name: 'function-packages'
  properties: {
    publicAccess: 'None'
  }
}

resource dataBlobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: dataStorage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource sessions 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: dataBlobs
  name: 'learning-history'
  properties: {
    publicAccess: 'None'
  }
}

resource speech 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: 'studentiq-speech-${suffix}'
  location: location
  kind: 'SpeechServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'studentiq-speech-${suffix}'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
  tags: tags
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'sqi-${suffix}'
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
  tags: tags
}

output hostStorageName string = hostStorage.name
output dataStorageName string = dataStorage.name
output dataStorageUrl string = dataStorage.properties.primaryEndpoints.blob
output speechName string = speech.name
output speechId string = speech.id
output vaultName string = vault.name
