# Voice Live Agent

A demo application showcasing **real-time AI voice conversations** over the phone using Azure services. Call a phone number and talk to an AI agent powered by GPT-4o Realtime, or have the AI call you.

![Voice Live Agent UI](images/ui.png)

## What This Demo Does

This application demonstrates:

- **📞 Outbound Calls**: Enter a phone number in the web UI, and the AI agent calls you
- **📲 Inbound Calls**: Call the Azure phone number and talk to the AI agent
- **🎙️ Real-time Voice AI**: Natural conversation with GPT-4o Realtime model via Azure VoiceLive SDK
- **📝 Live Transcripts**: See the conversation transcribed in real-time in the web UI
- **🎯 Custom Agent Personas**: Configure different AI agent behaviors (customer service, surveys, etc.)

### How It Works

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Web UI        │      │  Python API     │      │ Azure VoiceLive │
│   (Next.js)     │◄────►│  (FastAPI)      │◄────►│ (GPT-4o Realtime)│
└─────────────────┘  SSE └────────┬────────┘  WS  └─────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
           ┌────────▼────────┐   │   ┌─────────▼─────────┐
           │  Azure Storage  │   │   │ Azure Communication│
           │  (Recordings)   │   │   │     Services       │
           └─────────────────┘   │   │   (Phone Calls)    │
                                 │   └───────────────────┘
                    ┌────────────▼────────────┐
                    │     PSTN Network        │
                    │   (Real Phone Calls)    │
                    └─────────────────────────┘
```

1. **You** interact with the web UI to initiate calls or view transcripts
2. **Azure Communication Services** handles the phone call (PSTN)
3. **Azure VoiceLive SDK** streams audio to/from GPT-4o Realtime
4. **Real-time transcripts** flow back to the UI via Server-Sent Events (SSE)

## Features

- **Azure VoiceLive SDK**: Official `azure.ai.voicelive` Python SDK for voice AI
- **Real-time Streaming**: Bidirectional audio with GPT-4o Realtime model
- **Phone Calls**: Make and receive real phone calls via Azure Communication Services
- **Live Transcripts**: Real-time transcription displayed in the web UI
- **Custom Agendas**: Guide the AI with custom instructions per call
- **Azure TTS Voices**: High-quality neural voices (e.g., `en-US-Ava:DragonHDLatestNeural`)
- **Barge-in Support**: Interrupt the AI while it's speaking
- **Call Recording**: Automatic recording stored in Azure Blob Storage
- **Managed Identity**: Secure authentication without connection strings
- **One-Command Deploy**: `azd up` deploys everything to Azure

## Prerequisites

- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Python 3.11+](https://python.org/)
- [Node.js 20+](https://nodejs.org/)
- Azure subscription with access to:
  - Azure AI Services (GPT-4o Realtime model)
  - Azure Communication Services (for phone calls)

## Quick Start

### Deploy to Azure

```bash
# One command deploys everything
azd up
```

This creates all required Azure resources:
- Azure AI Services (GPT-4o Realtime)
- Azure Communication Services (with phone number)
- Azure Container Apps (API + UI)
- Azure Storage (recordings)

After deployment (~10-15 minutes):
1. **Buy a phone number** in Azure Portal → Communication Services → Phone Numbers
2. Open the UI URL shown in the deployment output
3. Enter a phone number and click "Call" - the AI will call you!

### Local Development

```bash
# 1. Deploy Azure infrastructure (creates backend services)
azd provision

# 2. Start Python API
cd src/api-python
pip install -r requirements.txt
python main.py

# 3. Start UI (in another terminal)
cd src/ui
npm install
npm run dev
```

For local development with phone calls, you'll need [Azure Dev Tunnels](https://learn.microsoft.com/azure/developer/dev-tunnels/) to expose your local API for ACS webhooks:

```bash
devtunnel host --port-numbers 8000 --allow-anonymous
# Update CALLBACK_URI in src/api-python/.env with the tunnel URL
```

### Windows Demo Script

```powershell
# Starts API + UI locally, opens browser
.\start-demo.ps1

# With dev tunnels for phone call webhooks
.\start-demo.ps1 -WithTunnels
```

## Project Structure

```
voice-live-agent/
├── azure.yaml              # Azure Developer CLI configuration
├── infra/                  # Bicep infrastructure templates
│   ├── main.bicep
│   └── modules/
├── src/
│   ├── api-python/         # Python Backend (FastAPI + VoiceLive SDK)
│   │   ├── main.py         # API server with call handling
│   │   ├── voicelive_agent.py  # VoiceLive SDK wrapper
│   │   └── Dockerfile
│   └── ui/                 # Frontend (Next.js)
│       ├── app/
│       ├── components/
│       └── Dockerfile
└── README.md
```

## Configuration

### Environment Variables (API)

These are automatically set when deploying with `azd up`:

```bash
# Azure VoiceLive (AI)
AZURE_VOICELIVE_ENDPOINT=https://<ai-services>.cognitiveservices.azure.com/
AZURE_VOICELIVE_MODEL=gpt-4o-realtime-preview
AZURE_VOICELIVE_VOICE=en-US-Ava:DragonHDLatestNeural

# Azure Communication Services (Phone)
AZURE_COMMUNICATION_ENDPOINT=https://<acs>.communication.azure.com

# Azure Storage (Recordings)
AZURE_STORAGE_ACCOUNT_NAME=<storage-account>

# Webhook URL (set automatically by post-provision script)
CALLBACK_URI=https://<container-app-url>
```

**Note**: Phone numbers are automatically discovered from your ACS resource - no manual configuration needed.

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/config` | GET | Get configuration (phone number, status) |
| `/api/calls` | GET | List active calls |
| `/api/calls/outbound` | POST | Make an outbound phone call |
| `/api/calls/{id}/hangup` | POST | Hang up a call |
| `/api/calls/{id}/transcripts` | GET | Get call transcripts |
| `/api/calls/{id}/recording` | GET | Get recording URL |
| `/api/events/stream` | GET | SSE stream for real-time updates |

### Making an Outbound Call

```bash
curl -X POST https://your-api/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{
    "target_phone_number": "+1234567890",
    "agenda": "You are a friendly customer service agent. Ask how you can help today."
  }'
```

### SSE Events (Real-time Updates)

Connect to `/api/events/stream` to receive real-time updates:

```typescript
const eventSource = new EventSource('/api/events/stream');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data.type: 'call_created' | 'call_status' | 'transcript' | 'call_removed'
};
```

## Pricing Estimates

| Service | Estimated Cost |
|---------|---------------|
| Azure OpenAI Realtime (audio) | ~$0.06/min input, ~$0.24/min output |
| Azure Communication Services | ~$0.013/min (US toll-free) |
| Azure Container Apps | ~$0.04/vCPU-hour |
| Azure Storage | ~$0.02/GB/month |

## Troubleshooting

### Calls not connecting
- Verify you've purchased a phone number in ACS
- Check that CALLBACK_URI is set correctly (must be HTTPS, publicly accessible)
- View container logs: `az containerapp logs show -n ca-api-{env} -g rg-{env}`

### No AI voice on call
- Ensure Azure AI Services has GPT-4o Realtime model deployed
- Check VoiceLive endpoint is correct

### Transcripts not appearing
- Open browser dev tools, check for SSE connection to `/api/events/stream`
- Verify the call status shows "connected"

## Security

- **Managed Identity**: All Azure services authenticate via managed identity (no secrets)
- **No Connection Strings**: Storage, ACS, and AI Services use DefaultAzureCredential
- **HTTPS Only**: All endpoints require HTTPS in production

## License

MIT
