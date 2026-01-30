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

// API Container App (Python with VoiceLive SDK)
module apiContainerApp 'modules/container-app.bicep' = {
  name: 'api-container-app'
  scope: rg
  params: {
    name: 'ca-api-${environmentName}'
    location: location
    tags: tags
    containerAppsEnvironmentId: containerAppsEnvironment.outputs.id
    containerImage: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
    targetPort: 8000
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
        name: 'PORT'
        value: '8000'
      }
    ]
    secrets: []
  }
}

// UI Container App
module uiContainerApp 'modules/container-app.bicep' = {
  name: 'ui-container-app'
  scope: rg
  params: {
    name: 'ca-ui-${environmentName}'
    location: location
    tags: tags
    containerAppsEnvironmentId: containerAppsEnvironment.outputs.id
    containerImage: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
    targetPort: 3000
    env: [
      {
        name: 'NEXT_PUBLIC_API_URL'
        value: apiContainerApp.outputs.fqdn
      }
    ]
    secrets: []
  }
}

// Role assignments for API Container App managed identity
module apiRoleAssignments 'modules/role-assignments.bicep' = {
  name: 'api-role-assignments'
  scope: rg
  params: {
    principalId: apiContainerApp.outputs.principalId
    storageAccountName: storage.outputs.name
    aiServicesName: aiServices.outputs.name
    communicationServicesName: communicationServices.outputs.name
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
