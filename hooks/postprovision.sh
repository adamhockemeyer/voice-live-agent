#!/bin/bash

# Post-provision hook for Azure Developer CLI
# This script creates .env files for local development after infrastructure is provisioned

echo "========================================"
echo "  Post-Provision Configuration"
echo "========================================"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Get outputs from azd env
echo "Reading Azure environment values..."
AZURE_OPENAI_ENDPOINT=$(azd env get-value AZURE_OPENAI_ENDPOINT)
AZURE_COMMUNICATION_ENDPOINT=$(azd env get-value AZURE_COMMUNICATION_ENDPOINT)
API_URL=$(azd env get-value API_URL)
AZURE_ENV_NAME=$(azd env get-value AZURE_ENV_NAME)
RESOURCE_GROUP=$(azd env get-value AZURE_RESOURCE_GROUP)

# If we don't have resource group from azd, try to extract from env name
if [ -z "$RESOURCE_GROUP" ]; then
    RESOURCE_GROUP="rg-$AZURE_ENV_NAME"
fi

# Update API Container App with CALLBACK_URI environment variable
echo ""
echo "Updating API Container App with CALLBACK_URI..."
if [ -n "$API_URL" ] && [ -n "$RESOURCE_GROUP" ]; then
    API_CONTAINER_APP_NAME="ca-api-$AZURE_ENV_NAME"
    CALLBACK_URI="https://$API_URL"
    az containerapp update \
        --name "$API_CONTAINER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --set-env-vars "CALLBACK_URI=$CALLBACK_URI" \
        --output none 2>/dev/null && \
        echo "Set CALLBACK_URI=$CALLBACK_URI on $API_CONTAINER_APP_NAME" || \
        echo "Warning: Could not update CALLBACK_URI"
fi

# Create Python API .env file
cat > "$PROJECT_ROOT/src/api-python/.env" << EOF
# Azure VoiceLive Configuration
AZURE_VOICELIVE_ENDPOINT=$AZURE_OPENAI_ENDPOINT
AZURE_VOICELIVE_MODEL=gpt-realtime
AZURE_VOICELIVE_VOICE=en-US-Ava:DragonHDLatestNeural
AZURE_VOICELIVE_INSTRUCTIONS=You are a helpful AI voice assistant for a delivery tracking service. Help callers check on their truck deliveries, provide status updates, and answer questions. Be concise and professional.

# Azure Communication Services Configuration (Managed Identity)
AZURE_COMMUNICATION_ENDPOINT=$AZURE_COMMUNICATION_ENDPOINT
ACS_PHONE_NUMBER=

# Server Configuration
PORT=8000
CALLBACK_URI=https://$API_URL
EOF

echo "Created: $PROJECT_ROOT/src/api-python/.env"

# Create UI .env file
cat > "$PROJECT_ROOT/src/ui/.env" << EOF
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF

echo "Created: $PROJECT_ROOT/src/ui/.env"

echo ""
echo "========================================"
echo "  Post-Provision Complete!"
echo "========================================"
echo ""
echo "Run the demo with:"
echo "  ./start-demo.ps1 (Windows) or start the API and UI manually"
echo ""
