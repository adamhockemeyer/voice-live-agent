# Voice Live Agent

A sample Azure application demonstrating real-time voice conversations using the **Azure VoiceLive SDK** with the GPT-Realtime model. Supports both WebSocket-based voice calls and Azure Communication Services (ACS) Call Automation for real phone calls.

## Features

- **Azure VoiceLive SDK**: Uses the official `azure.ai.voicelive` Python SDK for voice AI
- **Real-time Voice Conversations**: Bidirectional voice communication with AI using GPT-Realtime
- **Phone Call Support**: Make and receive real phone calls using Azure Communication Services
- **API-Triggered Calls**: Initiate outbound calls programmatically via REST API
- **Inbound Call Handling**: Answer and process incoming phone calls
- **Azure TTS Voices**: Support for Azure neural voices (e.g., `en-US-Ava:DragonHDLatestNeural`)
- **Barge-in Support**: Users can interrupt the AI while it's speaking
- **Echo Cancellation**: Built-in audio echo cancellation and noise reduction
- **Azure Container Apps**: Scalable deployment on Azure
- **Managed Identity**: Secure authentication without connection strings

## Security

- **Managed Identity**: All Azure services use managed identity for authentication (no connection strings)
- **SecurityControl Tag**: All resources are tagged with `SecurityControl:Ignore` for compliance

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│                 │      │                 │      │                 │
│   Next.js UI    │◄────►│  Python API     │◄────►│ Azure VoiceLive │
│  (Container App)│  WS  │ (FastAPI)       │  WS  │   (GPT-Realtime)│
│                 │      │                 │      │                 │
└─────────────────┘      └────────┬────────┘      └─────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
           ┌────────▼────────┐   │   ┌─────────▼─────────┐
           │                 │   │   │                   │
           │  Azure Storage  │   │   │ Azure Communication│
           │   (Recordings   │   │   │     Services      │
           │     & Logs)     │   │   │  (Phone Calls)    │
           │                 │   │   │                   │
           └─────────────────┘   │   └─────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │                         │
                    │     PSTN Network        │
                    │   (Real Phone Calls)    │
                    │                         │
                    └─────────────────────────┘
```

## Prerequisites

- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Python 3.11+](https://python.org/)
- [Node.js 20+](https://nodejs.org/) (for UI)
- Azure subscription with access to Azure AI Services (GPT-Realtime model)

## Quick Start

### Option 0: One-Command Demo Start (Windows)

```powershell
# Start API + UI locally (opens browser automatically)
.\start-demo.ps1

# With dev tunnels for ACS webhooks
.\start-demo.ps1 -WithTunnels
```

### Option 1: Deploy Infrastructure Only (for Local Development)

If you want to test locally with Azure backend services:

```bash
# Initialize environment
azd init

# Deploy only infrastructure (no containers)
azd provision

# The post-provision hook will automatically create .env files for local development
# You can now run locally:
cd src/api-python && pip install -r requirements.txt && python main.py
cd src/ui && npm install && npm run dev
```

### Option 2: Full Deployment

```bash
azd up
```

This will:
- Create an Azure Resource Group
- Deploy Azure AI Services with GPT-Realtime model
- Create Azure Communication Services for phone calls
- Create Azure Storage Account for recordings and logs
- Deploy Container Apps for UI and API

### Local Development (Manual Setup)

```bash
# 1. Deploy Azure infrastructure first
azd provision

# 2. Start Python API (Terminal 1)
cd src/api-python
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000

# 3. Start UI (Terminal 2)
cd src/ui
npm install
npm run dev
```

### Accessing Local Services with Azure Dev Tunnels

Since the servers run on localhost, you may need [Azure Dev Tunnels](https://learn.microsoft.com/azure/developer/dev-tunnels/) to access them from your browser or for ACS webhooks.

```bash
# Install dev tunnels (if not already installed)
winget install Microsoft.devtunnel

# Login (first time only)
devtunnel login

# Create tunnel for API (Terminal 3)
devtunnel host --port-numbers 8000 --allow-anonymous

# Create tunnel for UI (Terminal 4)
devtunnel host --port-numbers 3000 --allow-anonymous
```

The dev tunnel will output public URLs like:
- API: `https://<tunnel-id>-8000.use2.devtunnels.ms`
- UI: `https://<tunnel-id>-3000.use2.devtunnels.ms`

**Note**: Update `CALLBACK_URI` in `src/api-python/.env` with your API tunnel URL for ACS webhooks to work.

## Project Structure

```
voice-live-agent/
├── azure.yaml              # Azure Developer CLI configuration
├── hooks/                  # Post-deploy scripts
│   ├── postprovision.ps1   # Windows post-provision script
│   └── postprovision.sh    # Linux/Mac post-provision script
├── infra/                  # Bicep infrastructure templates
│   ├── main.bicep          # Main deployment template
│   ├── main.parameters.json
│   └── modules/
│       ├── ai-services.bicep
│       ├── communication-services.bicep
│       ├── storage.bicep
│       ├── container-apps-environment.bicep
│       ├── container-app.bicep
│       └── role-assignments.bicep
├── src/
│   ├── api-python/         # Python Backend API (FastAPI + VoiceLive SDK)
│   │   ├── main.py         # FastAPI server with ACS integration
│   │   ├── voicelive_agent.py  # VoiceLive SDK wrapper
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── ui/                 # Frontend UI (Next.js)
│       ├── app/
│       ├── components/
│       ├── package.json
│       └── Dockerfile
└── README.md
```

## Configuration

### Environment Variables

**API (.env)**
```bash
# Azure VoiceLive Configuration
AZURE_VOICELIVE_ENDPOINT=https://<your-ai-services>.cognitiveservices.azure.com/
AZURE_VOICELIVE_MODEL=gpt-realtime
AZURE_VOICELIVE_VOICE=en-US-Ava:DragonHDLatestNeural
AZURE_VOICELIVE_INSTRUCTIONS=You are a helpful AI voice assistant...

# Azure Communication Services Configuration (Managed Identity)
AZURE_COMMUNICATION_ENDPOINT=https://<acs-resource>.communication.azure.com
ACS_PHONE_NUMBER=+1234567890

# Server Configuration
PORT=8000
CALLBACK_URI=https://<your-public-url>
```

**UI (.env)**
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Pricing Estimates

| Service | Estimated Cost |
|---------|---------------|
| Azure OpenAI Realtime (audio input) | ~$0.10/min |
| Azure OpenAI Realtime (audio output) | ~$0.24/min |
| Azure Blob Storage | ~$0.02/GB/month |
| Azure Container Apps | Based on vCPU/memory usage |

## API Endpoints

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/calls` | GET | List active calls (voice and phone) |
| `/api/calls/outbound` | POST | Make an outbound phone call |
| `/api/calls/inbound` | POST | Answer an inbound call |
| `/api/calls/:callId/hangup` | POST | Hang up a call |
| `/api/calls/:callId/logs` | GET | Get call logs |
| `/api/calls/:callId/recording` | GET | Get call recording URL |
| `/api/calls/events` | POST | ACS Call Automation webhook |
| `/ws` | WebSocket | Real-time voice communication |

### Outbound Call API

Make an outbound phone call (API-triggered):

```bash
curl -X POST https://your-api/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{
    "targetPhoneNumber": "+1234567890",
    "sourcePhoneNumber": "+1987654321"
  }'
```

Response:
```json
{
  "success": true,
  "call": {
    "callId": "uuid",
    "connectionId": "connection-id",
    "startTime": "2024-01-01T00:00:00Z",
    "status": "connecting",
    "direction": "outbound",
    "phoneNumber": "+1234567890"
  }
}
```

## WebSocket Messages

### Client → Server
- `{ type: "start_call", direction: "outbound", agenda?: "<instructions>" }` - Start a new call with optional agenda
- `{ type: "audio", data: "<base64>" }` - Send audio data
- `{ type: "end_call" }` - End the call

**Agenda Feature**: Pass custom instructions to guide the AI during the call. For example:
```json
{
  "type": "start_call",
  "direction": "outbound",
  "agenda": "You are conducting a customer survey. Ask about their experience, get a 1-10 rating, and thank them."
}
```

### Server → Client
- `{ type: "call_started", callId: "<id>" }` - Call initiated
- `{ type: "audio", data: "<base64>" }` - Received audio
- `{ type: "transcript", role: "user"|"assistant", text: "<text>" }` - Transcription
- `{ type: "call_ended", callId: "<id>" }` - Call ended
- `{ type: "error", error: {...} }` - Error occurred

## License

MIT
