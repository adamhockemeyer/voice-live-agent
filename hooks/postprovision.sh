#!/bin/bash

# Post-provision hook for Azure Developer CLI
# This script creates .env files for local development after infrastructure is provisioned

echo "Creating .env files for local development..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Get outputs from azd env
AZURE_OPENAI_ENDPOINT=$(azd env get-value AZURE_OPENAI_ENDPOINT)
AZURE_COMMUNICATION_ENDPOINT=$(azd env get-value AZURE_COMMUNICATION_ENDPOINT)
API_URL=$(azd env get-value API_URL)

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

echo "Post-provision complete! You can now run locally with:"
echo "  API: cd src/api-python && pip install -r requirements.txt && python main.py"
echo "  UI:  cd src/ui && npm run dev"
