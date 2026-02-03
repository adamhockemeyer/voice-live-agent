# Pre-Deployment Checklist

## ✅ All Systems Go for `azd up`

### **Code & Containers**
- [x] API Dockerfile (Python/FastAPI) - Correct
- [x] UI Dockerfile (Next.js) - Correct multi-stage build
- [x] requirements.txt updated with `azure-storage-blob` for recording
- [x] main.py - Call recording fully implemented
- [x] azure.yaml - Correctly configured for azd

### **Infrastructure (Bicep)**
- [x] Container Registry module created
- [x] main.bicep references ACR images (not placeholder helloworld)
- [x] Storage connection string output added
- [x] Communication Services recording enabled
- [x] All role assignments for managed identity
- [x] Event Grid for incoming calls
- [x] Environment variables for all services

### **Post-Deployment Scripts**
- [x] postprovision.ps1 - Sets CALLBACK_URI + storage connection string
- [x] postprovision.sh - Same for Linux/Mac
- [x] Phone number detection and instructions
- [x] Local .env file creation

### **Recording Implementation**
- [x] Call recording starts on CallConnected event
- [x] Call recording stops on CallDisconnected event
- [x] SAS URL generation for recording playback
- [x] Blob storage permissions via managed identity
- [x] Recording metadata tracked per call

---

## **Deployment Command**

```powershell
cd c:\Users\adhocke\source\repos\voice-live-agent
azd up
```

---

## **After Deployment (5-10 minutes)**

### **Required Manual Step: Phone Number**

1. **Purchase Phone Number** (Portal)
   - Navigate to: Azure Portal → Communication Services → `acs-{environment}`
   - Click: **Phone Numbers**
   - Click: **Get** → Select toll-free → Purchase

2. **Configure Phone Number** (Choose one)
   
   **Option A - Portal UI (Simplest)**
   - Container Apps → `ca-api-{env}` → Environment variables
   - Edit: `ACS_PHONE_NUMBER` 
   - Paste phone number → Save
   
   **Option B - Azure CLI**
   ```powershell
   az containerapp update `
     --name "ca-api-{env}" `
     --resource-group "rg-{env}" `
     --set-env-vars "ACS_PHONE_NUMBER=+1-XXX-XXX-XXXX"
   ```

---

## **Verify Deployment**

```powershell
# Check Container Apps are running
az containerapp show -n ca-api-{env} -g rg-{env} --query properties.state
az containerapp show -n ca-ui-{env} -g rg-{env} --query properties.state

# Check images are in ACR
az acr repository list --name acr{env}

# Check container app env vars
az containerapp show -n ca-api-{env} -g rg-{env} --query properties.template.containers[0].env

# View logs
az containerapp logs show -n ca-api-{env} -g rg-{env} --follow
```

---

## **What Gets Created**

```
✅ Resource Group: rg-{environment}
   ├─ AI Services (GPT-4 Realtime)
   ├─ Communication Services (ACS)
   ├─ Container Registry (ACR)
   ├─ Storage Account (Recordings + Logs)
   ├─ Container Apps Environment
   ├─ API Container App (Python)
   ├─ UI Container App (Next.js)
   └─ Event Grid (Incoming call routing)
```

---

## **URLs After Deployment**

- **API**: `https://ca-api-{env}.{region}.azurecontainerapps.io`
- **UI**: `https://ca-ui-{env}.{region}.azurecontainerapps.io`
- **Recording endpoint**: `GET /api/calls/{callId}/recording` → SAS URL

---

## **Cost Notes**

- **Container Registry**: ~$5/month (Basic tier)
- **Container Apps**: ~$0.04/vCPU-hour (on-demand)
- **Storage**: Minimal (blob storage + recordings)
- **Communication Services**: Pay-per-minute for phone calls

---

## **Troubleshooting During Deployment**

If `azd up` fails:

1. **Docker build fails**
   - Check: `docker build src/api-python -t test`
   - Check: `docker build src/ui -t test`

2. **ACR push fails**
   - Run: `az acr login --name acr{env}`
   - Verify ACR exists: `az acr list --resource-group rg-{env}`

3. **Container app startup fails**
   - Check logs: `az containerapp logs show -n ca-api-{env}`
   - Verify image exists: `az acr repository show-tags --repository api --name acr{env}`

4. **Post-provision errors**
   - Verify Azure CLI is logged in: `az account show`
   - Check resource group exists before postprovision runs

---

**Ready to deploy? Run: `azd up`** 🚀
