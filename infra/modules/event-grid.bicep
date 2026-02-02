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

// Event Subscription for Incoming Calls
resource incomingCallSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2024-06-01-preview' = {
  parent: systemTopic
  name: 'incoming-call-subscription'
  properties: {
    destination: {
      endpointType: 'WebHook'
      properties: {
        endpointUrl: webhookEndpoint
      }
    }
    filter: {
      includedEventTypes: [
        'Microsoft.Communication.IncomingCall'
      ]
    }
    eventDeliverySchema: 'EventGridSchema'
    retryPolicy: {
      maxDeliveryAttempts: 30
      eventTimeToLiveInMinutes: 1440
    }
  }
}

output systemTopicId string = systemTopic.id
output systemTopicName string = systemTopic.name
output subscriptionId string = incomingCallSubscription.id
