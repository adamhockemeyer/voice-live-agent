@description('Name of the Event Grid System Topic')
param name string

@description('Location for the resource')
param location string

@description('Tags for the resource')
param tags object = {}

@description('Resource ID of the ACS resource to subscribe to')
param communicationServicesId string

@description('Webhook endpoint URL for incoming call events')
param webhookEndpoint string

// Event Grid System Topic for ACS
resource systemTopic 'Microsoft.EventGrid/systemTopics@2024-06-01-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    source: communicationServicesId
    topicType: 'Microsoft.Communication.CommunicationServices'
  }
}

// Note: Event subscription is created in postprovision hook to ensure webhook endpoint is ready
// This avoids validation failures during initial deployment when the API might not be responding yet

output systemTopicId string = systemTopic.id
output systemTopicName string = systemTopic.name
output webhookEndpoint string = webhookEndpoint
