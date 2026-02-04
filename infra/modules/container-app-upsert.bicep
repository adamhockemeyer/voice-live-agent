@description('Name of the Container App')
param name string

@description('Location for the resource')
param location string

@description('Tags for the resource')
param tags object = {}

@description('Container Apps Environment Name')
param containerAppsEnvironmentName string

@description('Container Registry Name')
param containerRegistryName string

@description('Container image to deploy')
param containerImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'

@description('Managed identity type: SystemAssigned, UserAssigned, or SystemAssigned, UserAssigned')
param identityType string = 'UserAssigned'

@description('User-assigned identity name')
param identityName string

@description('Target port for the container')
param targetPort int

@description('Environment variables')
param env array = []

@description('Container registry settings')
param registries array = []

@description('Whether the container app already exists')
param exists bool = false

@description('CPU cores for the container')
param containerCpuCoreCount string = '0.5'

@description('Memory for the container')
param containerMemory string = '1Gi'

var resourceGroupName = resourceGroup().name
var subscriptionId = subscription().subscriptionId
var containerAppsEnvironmentResourceId = '/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.App/managedEnvironments/${containerAppsEnvironmentName}'
var identityResourceId = '/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identityName}'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: identityType
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironmentResourceId
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        corsPolicy: {
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
          allowedHeaders: ['*']
        }
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'main'
          image: containerImage
          resources: {
            cpu: json(containerCpuCoreCount)
            memory: containerMemory
          }
          env: env
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1  // Force single instance - call state is in-memory
      }
    }
  }
}

output id string = containerApp.id
output name string = containerApp.name
output uri string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output fqdn string = containerApp.properties.configuration.ingress.fqdn
