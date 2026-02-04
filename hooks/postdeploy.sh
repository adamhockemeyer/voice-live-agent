#!/usr/bin/env bash
set -euo pipefail

printf "========================================\n"
printf "  Post-Deploy Configuration\n"
printf "========================================\n\n"

printf "Reading Azure environment values...\n"

# Read azd env values into variables
while IFS='=' read -r key value; do
  value=${value%"}"}
  value=${value#""}
  case "$key" in
    AZURE_COMMUNICATION_SERVICES) ACS_NAME="$value" ;;
    AZURE_RESOURCE_GROUP) RESOURCE_GROUP="$value" ;;
    API_URL) API_URL="$value" ;;
    AZURE_ENV_NAME) ENV_NAME="$value" ;;
  esac
done < <(azd env get-values)

if [[ -z "${RESOURCE_GROUP:-}" && -n "${ENV_NAME:-}" ]]; then
  RESOURCE_GROUP="rg-${ENV_NAME}"
fi

printf "\nSetting up Event Grid subscription for incoming calls...\n"
if [[ -n "${ACS_NAME:-}" && -n "${RESOURCE_GROUP:-}" && -n "${API_URL:-}" ]]; then
  SYSTEM_TOPIC_NAME="evgt-${ENV_NAME}"
  SUBSCRIPTION_NAME="incoming-call-subscription"
  WEBHOOK_URL="https://${API_URL}/api/calls/inbound"

  printf "Waiting for API to be ready at %s...\n" "$WEBHOOK_URL"
  MAX_RETRIES=20
  RETRY_COUNT=0
  API_READY=false

  while [[ $RETRY_COUNT -lt $MAX_RETRIES && "$API_READY" == false ]]; do
    if curl -fsS "https://${API_URL}/health" > /dev/null 2>&1; then
      API_READY=true
      printf "API is ready!\n"
      break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
      printf "  Attempt %s/%s - API not ready yet, waiting 5 seconds...\n" "$RETRY_COUNT" "$MAX_RETRIES"
      sleep 5
    fi
  done

  if [[ "$API_READY" == false ]]; then
    printf "Warning: API health check timed out. Event Grid subscription may fail validation.\n"
  fi

  if ! az eventgrid system-topic show --name "$SYSTEM_TOPIC_NAME" --resource-group "$RESOURCE_GROUP" > /dev/null 2>&1; then
    printf "Event Grid system topic not found - will be created by Bicep\n"
  else
    if ! az eventgrid system-topic event-subscription show \
      --name "$SUBSCRIPTION_NAME" \
      --system-topic-name "$SYSTEM_TOPIC_NAME" \
      --resource-group "$RESOURCE_GROUP" > /dev/null 2>&1; then

      printf "Creating Event Grid subscription for incoming calls...\n"
      printf "  Webhook URL: %s\n" "$WEBHOOK_URL"

      az eventgrid system-topic event-subscription create \
        --name "$SUBSCRIPTION_NAME" \
        --system-topic-name "$SYSTEM_TOPIC_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --endpoint "$WEBHOOK_URL" \
        --endpoint-type webhook \
        --included-event-types "Microsoft.Communication.IncomingCall" \
        --output none

      printf "Event Grid subscription created successfully!\n"
      printf "  Inbound calls will now be routed to: %s\n" "$WEBHOOK_URL"
    else
      printf "Event Grid subscription already exists\n"
    fi
  fi
else
  printf "Missing ACS name, resource group, or API URL. Cannot create Event Grid subscription.\n"
fi

printf "\n========================================\n"
printf "  Post-Deploy Complete!\n"
printf "========================================\n\n"
