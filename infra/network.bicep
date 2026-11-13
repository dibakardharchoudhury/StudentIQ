targetScope = 'resourceGroup'

param location string = resourceGroup().location

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

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'studentiq-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.91.0.0/16']
    }
    subnets: [
      {
        name: 'functions'
        properties: {
          addressPrefix: '10.91.0.0/26'
          delegations: [
            {
              name: 'functions'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.91.1.0/27'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

var zones = [
  'blob'
  'queue'
  'table'
]

resource dnsZones 'Microsoft.Network/privateDnsZones@2020-06-01' = [for zone in zones: {
  name: 'privatelink.${zone}.core.windows.net'
  location: 'global'
  tags: tags
}]

resource dnsLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for (zone, i) in zones: {
  parent: dnsZones[i]
  name: 'studentiq-vnet'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}]

var endpoints = [
  {
    name: 'host-blob'
    accountId: hostStorage.id
    group: 'blob'
    zoneIndex: 0
  }
  {
    name: 'host-queue'
    accountId: hostStorage.id
    group: 'queue'
    zoneIndex: 1
  }
  {
    name: 'host-table'
    accountId: hostStorage.id
    group: 'table'
    zoneIndex: 2
  }
  {
    name: 'data-blob'
    accountId: dataStorage.id
    group: 'blob'
    zoneIndex: 0
  }
]

resource privateEndpoints 'Microsoft.Network/privateEndpoints@2023-11-01' = [for endpoint in endpoints: {
  name: 'studentiq-${endpoint.name}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: '${vnet.id}/subnets/private-endpoints'
    }
    privateLinkServiceConnections: [
      {
        name: endpoint.name
        properties: {
          privateLinkServiceId: endpoint.accountId
          groupIds: [endpoint.group]
        }
      }
    ]
  }
}]

resource zoneGroups 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = [for (endpoint, i) in endpoints: {
  parent: privateEndpoints[i]
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: endpoint.group
        properties: {
          privateDnsZoneId: dnsZones[endpoint.zoneIndex].id
        }
      }
    ]
  }
}]

output functionSubnetId string = '${vnet.id}/subnets/functions'
