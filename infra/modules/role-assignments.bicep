@description('Principal ID to assign roles to')
param principalId string

@description('Storage account name')
param storageAccountName string

@description('AI Services name')
param aiServicesName string

@description('Communication Services name')
param communicationServicesName string

@description('Container Registry name')
param containerRegistryName string

@description('Assign Storage Blob Data Contributor role')
param assignStorage bool = true

@description('Assign Cognitive Services User role')
param assignAI bool = true

@description('Assign Communication Services Contributor role')
param assignAcs bool = true

@description('Assign ACRPull role')
param assignAcr bool = true

// Get existing resources
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource aiServices 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: aiServicesName
}

resource communicationServices 'Microsoft.Communication/communicationServices@2023-04-01' existing = {
  name: communicationServicesName
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: containerRegistryName
}

// Storage Blob Data Contributor role for recordings and logs
resource storageBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignStorage) {
  name: guid(storageAccount.id, principalId, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  scope: storageAccount
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    )
  }
}

// Cognitive Services User role for Azure OpenAI
resource cognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignAI) {
  name: guid(aiServices.id, principalId, 'a97b65f3-24c7-4388-baec-2e87135dc908')
  scope: aiServices
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'a97b65f3-24c7-4388-baec-2e87135dc908'
    )
  }
}

// Communication Services Contributor role
resource acsContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignAcs) {
  name: guid(communicationServices.id, principalId, 'b24988ac-6180-42a0-ab88-20f7382dd24c')
  scope: communicationServices
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b24988ac-6180-42a0-ab88-20f7382dd24c'
    )
  }
}

// ACRPull role for Container Registry (allows container apps to pull images)
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignAcr) {
  name: guid(containerRegistry.id, principalId, '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  scope: containerRegistry
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
  }
}
