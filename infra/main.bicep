targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

// Optional parameters for AI Services
@description('Location for the OpenAI resource')
param openAiLocation string = 'eastus2'

@description('Whether the API container app already exists')
param apiAppExists bool = false

@description('Whether the UI container app already exists')
param uiAppExists bool = false

@description('GPT model name for realtime voice')
param gptRealtimeModelName string = 'gpt-4o-realtime-preview'

@description('GPT model version')
param gptRealtimeModelVersion string = '2024-12-17'

// Tags
var tags = {
  'azd-env-name': environmentName
  SecurityControl: 'Ignore'
}

// Resource group
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

// Cognitive Services (AI Services) deployment
module aiServices 'modules/ai-services.bicep' = {
  name: 'ai-services'
  scope: rg
  params: {
    name: 'ai-${environmentName}'
    location: openAiLocation
    tags: tags
    gptRealtimeModelName: gptRealtimeModelName
    gptRealtimeModelVersion: gptRealtimeModelVersion
  }
}

// Azure Communication Services
module communicationServices 'modules/communication-services.bicep' = {
  name: 'communication-services'
  scope: rg
  params: {
    name: 'acs-${environmentName}'
    location: 'global'
    tags: tags
  }
}

// Storage account for call recordings and logs
module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    name: 'st${replace(environmentName, '-', '')}'
    location: location
    tags: tags
  }
}

// Container Apps Environment
module containerAppsEnvironment 'modules/container-apps-environment.bicep' = {
  name: 'container-apps-environment'
  scope: rg
  params: {
    name: 'cae-${environmentName}'
    location: location
    tags: tags
  }
}

// Container Registry for built images
module containerRegistry 'modules/container-registry.bicep' = {
  name: 'container-registry'
  scope: rg
  params: {
    name: 'acr${replace(environmentName, '-', '')}'
    location: location
    tags: tags
  }
}

// User-assigned identities for Container Apps (RG scope)
module apiIdentity 'modules/managed-identity.bicep' = {
  name: 'api-identity'
  scope: rg
  params: {
    name: 'id-api-${environmentName}'
    location: location
    tags: tags
  }
}

module uiIdentity 'modules/managed-identity.bicep' = {
  name: 'ui-identity'
  scope: rg
  params: {
    name: 'id-ui-${environmentName}'
    location: location
    tags: tags
  }
}

// API Container App (Python with VoiceLive SDK)
module apiContainerApp 'modules/container-app-upsert.bicep' = {
  name: 'api-container-app'
  scope: rg
  params: {
    name: 'ca-api-${environmentName}'
    location: location
    tags: union(tags, { 'azd-service-name': 'api' })
    containerAppsEnvironmentName: containerAppsEnvironment.outputs.name
    containerRegistryName: containerRegistry.outputs.name
    containerImage: 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
    identityType: 'UserAssigned'
    identityName: apiIdentity.outputs.name
    targetPort: 8000
    exists: apiAppExists
    registries: [
      {
        server: containerRegistry.outputs.loginServer
        identity: apiIdentity.outputs.id
      }
    ]
    env: [
      {
        name: 'AZURE_VOICELIVE_ENDPOINT'
        value: aiServices.outputs.endpoint
      }
      {
        name: 'AZURE_VOICELIVE_MODEL'
        value: 'gpt-realtime'
      }
      {
        name: 'AZURE_VOICELIVE_VOICE'
        value: 'en-US-Ava:DragonHDLatestNeural'
      }
      {
        name: 'AZURE_COMMUNICATION_ENDPOINT'
        value: communicationServices.outputs.endpoint
      }
      {
        name: 'AZURE_STORAGE_ACCOUNT_NAME'
        value: storage.outputs.name
      }
      {
        name: 'PORT'
        value: '8000'
      }
      {
        name: 'AZURE_CLIENT_ID'
        value: apiIdentity.outputs.clientId
      }
    ]
  }
  dependsOn: [
    apiRoleAssignments
  ]
}

// UI Container App (Next.js frontend)
module uiContainerApp 'modules/container-app-upsert.bicep' = {
  name: 'ui-container-app'
  scope: rg
  params: {
    name: 'ca-ui-${environmentName}'
    location: location
    tags: union(tags, { 'azd-service-name': 'ui' })
    containerAppsEnvironmentName: containerAppsEnvironment.outputs.name
    containerRegistryName: containerRegistry.outputs.name
    containerImage: 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
    identityType: 'UserAssigned'
    identityName: uiIdentity.outputs.name
    targetPort: 3000
    exists: uiAppExists
    registries: [
      {
        server: containerRegistry.outputs.loginServer
        identity: uiIdentity.outputs.id
      }
    ]
    env: [
      {
        name: 'API_URL'
        value: 'https://${apiContainerApp.outputs.fqdn}'
      }
      {
        name: 'AZURE_CLIENT_ID'
        value: uiIdentity.outputs.clientId
      }
    ]
  }
  dependsOn: [
    uiRoleAssignments
  ]
}

// Role assignments for API Container App managed identity
module apiRoleAssignments 'modules/role-assignments.bicep' = {
  name: 'api-role-assignments'
  scope: rg
  params: {
    principalId: apiIdentity.outputs.principalId
    storageAccountName: storage.outputs.name
    aiServicesName: aiServices.outputs.name
    communicationServicesName: communicationServices.outputs.name
    containerRegistryName: containerRegistry.outputs.name
    assignStorage: true
    assignAI: true
    assignAcs: true
    assignAcr: true
  }
}

// Role assignments for UI Container App managed identity (ACR pull)
module uiRoleAssignments 'modules/role-assignments.bicep' = {
  name: 'ui-role-assignments'
  scope: rg
  params: {
    principalId: uiIdentity.outputs.principalId
    storageAccountName: storage.outputs.name
    aiServicesName: aiServices.outputs.name
    communicationServicesName: communicationServices.outputs.name
    containerRegistryName: containerRegistry.outputs.name
    assignStorage: false
    assignAI: false
    assignAcs: false
    assignAcr: true
  }
}

// Event Grid for incoming call routing
// Note: Event subscription is created in postprovision hook to ensure API is ready for webhook validation
module eventGrid 'modules/event-grid.bicep' = {
  name: 'event-grid'
  scope: rg
  params: {
    name: 'evgt-${environmentName}'
    location: 'global'
    tags: tags
    communicationServicesId: communicationServices.outputs.id
    webhookEndpoint: 'https://${apiContainerApp.outputs.fqdn}/api/calls/inbound'
  }
}

// Outputs
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_OPENAI_ENDPOINT string = aiServices.outputs.endpoint
output AZURE_OPENAI_DEPLOYMENT string = gptRealtimeModelName
output API_URL string = apiContainerApp.outputs.fqdn
output UI_URL string = uiContainerApp.outputs.fqdn
output AZURE_STORAGE_ACCOUNT string = storage.outputs.name
output AZURE_STORAGE_BLOB_ENDPOINT string = storage.outputs.blobEndpoint
output AZURE_COMMUNICATION_SERVICES string = communicationServices.outputs.name
output AZURE_COMMUNICATION_ENDPOINT string = communicationServices.outputs.endpoint
output AZURE_COMMUNICATION_RESOURCE_ID string = communicationServices.outputs.id
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
