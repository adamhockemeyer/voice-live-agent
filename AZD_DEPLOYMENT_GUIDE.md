# AZD Deployment Readiness Review

## ✅ NOW READY FOR `azd up`

All issues have been fixed. Here's the complete status:

### **Dockerfiles**
- ✅ **API (Python)**: `src/api-python/Dockerfile` - Correctly builds Python app with FastAPI
- ✅ **UI (Next.js)**: `src/ui/Dockerfile` - Correctly uses multi-stage build for optimized container

### **Infrastructure (Bicep)**
- ✅ **Container Registry**: New ACR module created to store built container images
- ✅ **All Modules**: Properly structured with AI Services, ACS, Storage, Event Grid, etc.
- ✅ **Environment Variables**: All config passed to Container Apps including storage connection string
- ✅ **Recording**: Call recording infrastructure fully configured with storage

### **Azure Developer CLI (azd)**
- ✅ **azure.yaml**: Correctly configured with services pointing to Dockerfiles
- ✅ **Image References**: Updated to use ACR `${containerRegistry.outputs.loginServer}/api:latest` and `ui:latest`
- ✅ **Post-Provision Scripts**: Both PowerShell and Bash updated to set all required env vars

---

## **Deployment Process**

### **First-Time Deployment: `azd up`**

```powershell
# From project root
azd up

# What happens:
# 1. azd builds Docker images for api/ and ui/
# 2. azd pushes images to the new ACR
# 3. azd deploys Bicep infrastructure
# 4. Bicep creates all resources with ACR image references
# 5. Post-provision script runs automatically
#    - Sets CALLBACK_URI on container app
#    - Sets AZURE_STORAGE_CONNECTION_STRING on container app
#    - Creates local .env files for development
```

### **After Successful Deployment**

The postprovision script will output:
```
Phone Number: Not configured (see instructions below)
```

---

## **Phone Number Setup (Manual Step)**

After `azd up` completes, purchase a phone number:

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **Communication Services** → `acs-{environment-name}` → **Phone Numbers**
3. Click **Get** and purchase a toll-free number with **Voice capabilities** enabled
4. Copy the phone number (e.g., `+1-XXX-XXX-XXXX`)

### **Option A: Update via Portal UI**
1. Go to: Container Apps → `ca-api-{environment-name}` → **Environment variables**
2. Edit `ACS_PHONE_NUMBER` and paste the phone number
3. Click **Save** (container restarts with new value)

### **Option B: Update via CLI**
```powershell
# Replace with your actual values
$phoneNumber = "+1-XXX-XXX-XXXX"
$resourceGroup = "rg-{environment-name}"
$containerApp = "ca-api-{environment-name}"

az containerapp update `
    --name $containerApp `
    --resource-group $resourceGroup `
    --set-env-vars "ACS_PHONE_NUMBER=$phoneNumber" `
    --output none

echo "Updated ACS_PHONE_NUMBER to $phoneNumber"
```

### **Option C: Redeploy with azd**
After purchasing the number:
1. Update `.env` file in your environment (`.azure/{env-name}/.env`)
2. Or update the Bicep if you want it persisted in IaC
3. Run `azd deploy` to redeploy without reprovisioning

---

## **Container App Environment Variables**

**Automatically Set by Bicep:**
- `AZURE_VOICELIVE_ENDPOINT` - AI Services endpoint
- `AZURE_VOICELIVE_MODEL` - gpt-realtime
- `AZURE_VOICELIVE_VOICE` - en-US-Ava:DragonHDLatestNeural
- `AZURE_COMMUNICATION_ENDPOINT` - ACS endpoint
- `AZURE_STORAGE_CONNECTION_STRING` - Blob storage connection
- `PORT` - 8000

**Set by Post-Provision Script:**
- `CALLBACK_URI` - Public FQDN for webhooks (e.g., `https://ca-api-xyz.xyz.azurecontainerapps.io`)

**Manual/After Deployment:**
- `ACS_PHONE_NUMBER` - Phone number for incoming calls

---

## **How It All Works Together**

```
┌─────────────────────────────────────────────────────┐
│ azd up                                               │
│ ├─ Builds Docker images for api/ & ui/             │
│ ├─ Pushes to ACR                                    │
│ └─ Deploys Infrastructure                           │
│    ├─ Creates Container Apps                       │
│    ├─ References ACR images                        │
│    └─ Creates all supporting resources             │
└─────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────┐
│ Post-Provision Script (Auto-runs)                   │
│ ├─ Sets CALLBACK_URI on API container app          │
│ ├─ Sets AZURE_STORAGE_CONNECTION_STRING            │
│ └─ Creates local .env files                        │
└─────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────┐
│ Deployment Complete ✅                              │
│ ├─ API running at https://ca-api-{env}.{region}   │
│ │  azurecontainerapps.io                           │
│ ├─ UI running at https://ca-ui-{env}.{region}    │
│ │  azurecontainerapps.io                           │
│ └─ Ready for incoming calls (after phone number)   │
└─────────────────────────────────────────────────────┘
```

---

## **What Happens During Recording**

When a call connects:
1. ACS Call Recording API starts recording
2. Audio is stored in `recordings/{call_id}_{timestamp}.wav`
3. Managed identity automatically has permissions via Bicep role assignments
4. When call ends, recording stops and SAS URL can be generated

Access recording:
```
GET /api/calls/{call_id}/recording
```

Returns:
```json
{
  "callId": "call-123",
  "recordingUrl": "https://st{env}.blob.core.windows.net/recordings/call-123_20260202_120000.wav?sv=...",
  "status": "completed",
  "message": "Recording available for download"
}
```

---

## **Troubleshooting**

### **Containers won't start after deployment**
1. Check container logs: `az containerapp logs show -n ca-api-{env} -g rg-{env}`
2. Verify image exists in ACR: `az acr repository list --name acr{env}`
3. Check env vars are set: `az containerapp show -n ca-api-{env} -g rg-{env}`

### **CALLBACK_URI errors**
- If webhooks fail, check that CALLBACK_URI is set to the Container App FQDN
- Port must be 443 (HTTPS)

### **Phone calls not routing**
- Verify ACS_PHONE_NUMBER is set
- Check Event Grid subscription exists for incoming calls
- Verify webhook is accessible (CALLBACK_URI)

### **Recording not working**
- Check storage connection string is set
- Verify managed identity has Storage Blob Contributor role
- Ensure "recordings" container exists in storage account

---

## **Next Steps**

1. ✅ Run: `azd up`
2. ⏳ Wait for deployment (~10-15 minutes)
3. 📞 Purchase phone number via Portal
4. 📱 Set `ACS_PHONE_NUMBER` env var via Portal or CLI
5. 🎉 Make test calls!

