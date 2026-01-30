@description('Name of the AI Foundry Hub')
param name string

@description('Location for the resource')
param location string

@description('Tags for the resource')
param tags object = {}

@description('AI Services resource ID to connect')
param aiServicesId string

@description('AI Services resource name')
param aiServicesName string

@description('Storage account ID for the hub')
param storageAccountId string

// AI Foundry Hub (new style - not ML workspace)
resource aiHub 'Microsoft.MachineLearningServices/workspaces@2024-10-01' = {
  name: '${name}-hub'
  location: location
  tags: tags
  kind: 'Hub'
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: '${name} AI Foundry Hub'
    description: 'AI Foundry Hub for Voice Live Agent'
    storageAccount: storageAccountId
    publicNetworkAccess: 'Enabled'
    enableDataIsolation: false
  }
}

// AI Foundry Project (connected to the hub)
resource aiProject 'Microsoft.MachineLearningServices/workspaces@2024-10-01' = {
  name: '${name}-project'
  location: location
  tags: tags
  kind: 'Project'
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: '${name} Voice Live Project'
    description: 'AI Foundry Project for Voice Live Agent with project management'
    hubResourceId: aiHub.id
    publicNetworkAccess: 'Enabled'
  }
}

// Connection to AI Services from the Hub
resource aiServicesConnection 'Microsoft.MachineLearningServices/workspaces/connections@2024-10-01' = {
  parent: aiHub
  name: 'ai-services-connection'
  properties: {
    category: 'AIServices'
    target: 'https://${aiServicesName}.cognitiveservices.azure.com/'
    authType: 'AAD'
    isSharedToAll: true
    metadata: {
      ApiType: 'Azure'
      ResourceId: aiServicesId
    }
  }
}

output hubId string = aiHub.id
output hubName string = aiHub.name
output projectId string = aiProject.id
output projectName string = aiProject.name
