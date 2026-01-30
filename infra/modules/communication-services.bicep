@description('Name of the Communication Services resource')
param name string

@description('Location for the resource (global for ACS)')
param location string = 'global'

@description('Tags for the resource')
param tags object = {}

// Azure Communication Services
resource communicationServices 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    dataLocation: 'United States'
  }
}

output id string = communicationServices.id
output name string = communicationServices.name
output endpoint string = 'https://${communicationServices.name}.communication.azure.com'
