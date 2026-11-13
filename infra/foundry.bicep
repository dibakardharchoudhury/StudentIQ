targetScope = 'resourceGroup'

param location string = resourceGroup().location

var suffix = uniqueString(resourceGroup().id)
var resourceName = 'studentiq-ai-${suffix}'

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: resourceName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: resourceName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    application: 'StudentIQ'
    environment: 'personal'
    managedBy: 'IaC'
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: foundry
  name: 'studentiq'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'StudentIQ'
    description: 'Parent-controlled educational tutor'
  }
}

resource modelRouter 'Microsoft.CognitiveServices/accounts/deployments@2025-10-01-preview' = {
  parent: foundry
  name: 'model-router'
  dependsOn: [
    project
  ]
  sku: {
    name: 'DataZoneStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'model-router'
      version: '2025-11-18'
    }
    routing: {
      mode: 'cost'
      models: [
        {
          format: 'OpenAI'
          name: 'gpt-5.4-mini'
          version: '2026-03-17'
        }
        {
          format: 'OpenAI'
          name: 'gpt-5.4'
          version: '2026-03-05'
        }
      ]
    }
  }
}

output foundryName string = foundry.name
output foundryId string = foundry.id
output projectId string = project.id
output endpoint string = foundry.properties.endpoint
