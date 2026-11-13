targetScope = 'resourceGroup'

param location string = resourceGroup().location
param parentObjectId string
param studentObjectId string = ''
param appClientId string
param pagesOrigin string = 'https://dibakardharchoudhury.github.io'

var suffix = uniqueString(resourceGroup().id)
var tags = {
  application: 'StudentIQ'
  environment: 'personal'
  managedBy: 'IaC'
}

resource hostStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: 'sqih${suffix}'
}

resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: 'sqid${suffix}'
}

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: 'studentiq-ai-${suffix}'
}

resource speech 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: 'studentiq-speech-${suffix}'
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: 'studentiq-vnet'
}

resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'studentiq-runtime'
  location: location
  tags: tags
}

resource speechIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'studentiq-speech'
  location: location
  tags: tags
}

var hostRoleIds = [
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
]

resource hostRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for roleId in hostRoleIds: {
  name: guid(hostStorage.id, runtimeIdentity.id, roleId)
  scope: hostStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}]

resource dataRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(dataStorage.id, runtimeIdentity.id, 'blob-contributor')
  scope: dataStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, runtimeIdentity.id, 'openai-user')
  scope: foundry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource speechRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speech.id, speechIdentity.id, 'speech-user')
  scope: speech
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'f2dc8367-1007-4938-bd23-fe263f013447')
    principalId: speechIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'studentiq-flex'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
  tags: tags
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: 'studentiq-api-${suffix}'
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentity.id}': {}
      '${speechIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    virtualNetworkSubnetId: '${vnet.id}/subnets/functions'
    vnetRouteAllEnabled: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: {
        allowedOrigins: [pagesOrigin]
        supportCredentials: false
      }
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${hostStorage.properties.primaryEndpoints.blob}function-packages'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: runtimeIdentity.id
          }
        }
      }
      runtime: {
        name: 'node'
        version: '22'
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 512
      }
    }
  }
  tags: tags
  dependsOn: [
    hostRoles
    dataRole
    foundryRole
    speechRole
  ]
}

resource settings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: functionApp
  name: 'appsettings'
  properties: {
    AzureWebJobsStorage__credential: 'managedidentity'
    AzureWebJobsStorage__clientId: runtimeIdentity.properties.clientId
    AzureWebJobsStorage__blobServiceUri: hostStorage.properties.primaryEndpoints.blob
    AzureWebJobsStorage__queueServiceUri: hostStorage.properties.primaryEndpoints.queue
    AzureWebJobsStorage__tableServiceUri: hostStorage.properties.primaryEndpoints.table
    AZURE_CLIENT_ID: runtimeIdentity.properties.clientId
    ENTRA_TENANT_ID: tenant().tenantId
    ENTRA_API_AUDIENCE: appClientId
    ENTRA_PARENT_OID: parentObjectId
    ENTRA_STUDENT_OID: studentObjectId
    ENTRA_REQUIRED_SCOPE: 'access_as_user'
    GITHUB_PAGES_ORIGIN: pagesOrigin
    AZURE_STORAGE_BLOB_ENDPOINT: dataStorage.properties.primaryEndpoints.blob
    BLOB_CONTAINER_NAME: 'learning-history'
    FOUNDRY_ENDPOINT: foundry.properties.endpoint
    FOUNDRY_MODEL: 'model-router'
    FOUNDRY_API_VERSION: '2024-05-01-preview'
    SPEECH_IDENTITY_CLIENT_ID: speechIdentity.properties.clientId
    SPEECH_RESOURCE_ID: speech.id
    AZURE_SPEECH_REGION: location
  }
}

output functionName string = functionApp.name
output apiBaseUrl string = 'https://${functionApp.properties.defaultHostName}'
output runtimeIdentityId string = runtimeIdentity.id
output speechIdentityId string = speechIdentity.id
