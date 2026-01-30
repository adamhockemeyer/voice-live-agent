@description('Principal ID to assign roles to')
param principalId string

@description('Storage account name')
param storageAccountName string

@description('AI Services name')
param aiServicesName string

@description('Communication Services name')
param communicationServicesName string

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

// Storage Blob Data Contributor role for recordings and logs
resource storageBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
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
resource cognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
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
resource acsContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
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
