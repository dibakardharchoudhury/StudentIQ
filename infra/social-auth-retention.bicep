targetScope = 'resourceGroup'

param dataStorageName string

resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: dataStorageName
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: dataStorage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-social-auth-records'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['learning-history/social-auth/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 2
                }
              }
            }
          }
        }
      ]
    }
  }
}
