# Azure Deployment Guide

Deploy Voice Live Agent to Azure using the Azure Developer CLI (`azd`).

## Prerequisites

- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- Azure subscription with permissions to create resources
- Access to Azure AI Services (GPT-4o Realtime model)

## Quick Deploy

```bash
azd up
```

That's it! This single command:
1. Builds Docker images for the API and UI
2. Pushes images to Azure Container Registry
3. Deploys all infrastructure via Bicep
4. Configures environment variables automatically

**Deployment takes ~10-15 minutes.**

---

## What Gets Created

```
Resource Group: rg-{environment}
├── Azure AI Services (GPT-4o Realtime)
├── Azure Communication Services
├── Azure Container Registry
├── Azure Storage Account
├── Container Apps Environment
├── API Container App (Python/FastAPI)
├── UI Container App (Next.js)
└── Event Grid (incoming call routing)
```

---

## After Deployment

### 1. Purchase a Phone Number

The only manual step - buy a phone number for incoming/outgoing calls:

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **Communication Services** → your ACS resource → **Phone Numbers**
3. Click **Get** → Select a toll-free number with **Voice (inbound/outbound)** capability
4. Complete the purchase

**That's it!** The API automatically discovers purchased phone numbers - no configuration needed.

### 2. Access Your App

After deployment, `azd` outputs the URLs:

```
UI:  https://ca-ui-{env}.{region}.azurecontainerapps.io
API: https://ca-api-{env}.{region}.azurecontainerapps.io
```

Open the UI URL, enter a phone number, and click Call!

---

## Environment Variables

All environment variables are set automatically by deployment:

| Variable | Source | Description |
|----------|--------|-------------|
| `AZURE_VOICELIVE_ENDPOINT` | Bicep | AI Services endpoint |
| `AZURE_VOICELIVE_MODEL` | Bicep | gpt-4o-realtime-preview |
| `AZURE_VOICELIVE_VOICE` | Bicep | Neural voice model |
| `AZURE_COMMUNICATION_ENDPOINT` | Bicep | ACS endpoint |
| `AZURE_STORAGE_ACCOUNT_NAME` | Bicep | Storage for recordings |
| `CALLBACK_URI` | Post-provision | Container App FQDN |

**Phone numbers are discovered automatically** from your ACS resource at runtime.

---

## Deployment Commands

| Command | Description |
|---------|-------------|
| `azd up` | Full deployment (provision + deploy) |
| `azd provision` | Deploy infrastructure only |
| `azd deploy` | Deploy code only (after provision) |
| `azd down` | Delete all resources |

### Redeploy After Code Changes

```bash
azd deploy
```

### View Logs

```bash
az containerapp logs show -n ca-api-{env} -g rg-{env} --follow
```

---

## Troubleshooting

### Container won't start
```bash
# Check logs
az containerapp logs show -n ca-api-{env} -g rg-{env}

# Verify image exists
az acr repository list --name acr{env}
```

### Phone calls not working
- Verify you purchased a phone number in ACS
- Check CALLBACK_URI is the Container App's public URL
- Ensure the phone number has voice capability enabled

### Webhooks failing
- CALLBACK_URI must be HTTPS and publicly accessible
- Check Event Grid subscription exists in ACS resource

### Recording not working
- Verify managed identity has Storage Blob Data Contributor role
- Check "recordings" container exists in storage account

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ azd up                                               │
│ ├─ Builds Docker images                             │
│ ├─ Pushes to Azure Container Registry               │
│ └─ Deploys Bicep infrastructure                     │
└─────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────┐
│ Post-Provision Script (runs automatically)          │
│ ├─ Sets CALLBACK_URI on API container               │
│ └─ Creates local .env files for development         │
└─────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────┐
│ Deployment Complete ✅                               │
│ ├─ API: https://ca-api-{env}.{region}...            │
│ ├─ UI:  https://ca-ui-{env}.{region}...             │
│ └─ Ready! Just buy a phone number.                  │
└─────────────────────────────────────────────────────┘
```

---

## Cost Estimates

| Service | Estimated Cost |
|---------|---------------|
| Container Registry | ~$5/month (Basic) |
| Container Apps | ~$0.04/vCPU-hour |
| Storage | ~$0.02/GB/month |
| Communication Services | ~$0.013/min (toll-free) |
| Azure OpenAI Realtime | ~$0.06-0.24/min |

---

## Local Development After Provision

If you want to run locally but use Azure backend services:

```bash
# Deploy infrastructure only
azd provision

# The post-provision script creates .env files automatically

# Run API locally
cd src/api-python
pip install -r requirements.txt
python main.py

# Run UI locally (separate terminal)
cd src/ui
npm install
npm run dev
```

For phone calls to work locally, you need a public URL for webhooks. Use [Azure Dev Tunnels](https://learn.microsoft.com/azure/developer/dev-tunnels/):

```bash
devtunnel host --port-numbers 8000 --allow-anonymous
# Update CALLBACK_URI in .env with the tunnel URL
```

