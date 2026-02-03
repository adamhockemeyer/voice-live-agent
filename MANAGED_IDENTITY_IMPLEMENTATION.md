# Managed Identity Implementation - Architecture Update

## ✅ Changes Made

### **1. Azure Developer CLI (azure.yaml)**
Added remote build configuration:
```yaml
services:
  api:
    build: remote  # ACR Remote Build
  ui:
    build: remote  # ACR Remote Build
```

**Benefits:**
- Builds happen in Azure (ACR), not locally
- No Docker daemon needed
- Consistent build environment
- Faster deployments

---

### **2. Infrastructure - Zero Connection Strings Approach**

#### **Container Registry ACR Pull Role**
Added `ACRPull` role assignment so Container Apps can pull images from ACR without admin credentials.

**File:** `infra/modules/role-assignments.bicep`
```bicep
// ACRPull role for Container Registry
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: containerRegistry
  roleDefinitionId: '7f951dda-4ed3-4181-b6e1-8d0ccf865d7e'  // ACRPull
}
```

#### **Storage Account - No Connection Strings**
Changed from:
```bicep
AZURE_STORAGE_CONNECTION_STRING=<connection-string>
```

To:
```bicep
AZURE_STORAGE_ACCOUNT_NAME=stvoicelive614  # Just the account name
```

**Why:** DefaultAzureCredential uses system-assigned managed identity + role assignments

---

### **3. Python API (src/api-python/main.py)**

#### **Before: Connection String**
```python
Config.AZURE_STORAGE_CONNECTION_STRING = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")

blob_service_client = BlobServiceClient.from_connection_string(
    Config.AZURE_STORAGE_CONNECTION_STRING
)
```

#### **After: Managed Identity**
```python
Config.AZURE_STORAGE_ACCOUNT_NAME = os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "")

credential = DefaultAzureCredential()  # Uses system-assigned managed identity
blob_url = f"https://{Config.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net"
blob_service_client = BlobServiceClient(account_url=blob_url, credential=credential)
```

**Benefits:**
- ✅ No secrets stored in env vars
- ✅ No connection strings to manage
- ✅ Better security (no exposed keys)
- ✅ Automatic credential refresh
- ✅ Works with DefaultAzureCredential locally (for testing with `az login`)

---

### **4. Recording Endpoint - Simplified**

#### **Before: Generated SAS tokens from connection string**
```python
account_key = extract_from_connection_string(Config.AZURE_STORAGE_CONNECTION_STRING)
sas_token = generate_blob_sas(..., account_key=account_key, ...)
recording_url = f"https://{account_name}.blob.core.windows.net/recordings/{blob_name}?{sas_token}"
```

#### **After: Direct blob URL (managed identity auth)**
```python
recording_url = f"https://{Config.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/recordings/{blob_name}"
# Auth handled by DefaultAzureCredential through blob_service_client
```

**How it works:**
1. Client has Storage Blob Data Contributor role (via Bicep role assignments)
2. Client calls `/api/calls/{id}/recording` endpoint
3. Endpoint returns blob URL
4. Client can download using Azure SDK or Python blob library (which uses managed identity)

---

### **5. Post-Provision Scripts - Simplified**

#### **Before: Retrieved connection string**
```powershell
$storageConnectionString = az storage account show-connection-string ...
az containerapp update --set-env-vars "AZURE_STORAGE_CONNECTION_STRING=$storageConnectionString"
```

#### **After: Just sets CALLBACK_URI**
```powershell
az containerapp update --set-env-vars "CALLBACK_URI=$callbackUri"
# Storage credential is handled by managed identity automatically
```

---

## **Identity & Permission Model**

```
┌─────────────────────────────────────────────┐
│  Container App (System-Assigned Identity)  │
└─────────────────────────────────────────────┘
          ↓
   DefaultAzureCredential
   ├─ Uses system-assigned managed identity
   ├─ Automatically authenticated to Azure
   └─ No credentials in code
          ↓
┌─────────────────────────────────────────────┐
│  Role Assignments (via Bicep)               │
├─────────────────────────────────────────────┤
│ ✓ Storage Blob Data Contributor             │
│   └─ Read/write recordings to blob storage │
│ ✓ Cognitive Services User                   │
│   └─ Access OpenAI/VoiceLive models        │
│ ✓ Communication Services Contributor        │
│   └─ Make calls, start recording, etc      │
│ ✓ ACRPull                                   │
│   └─ Pull container images from ACR        │
└─────────────────────────────────────────────┘
```

---

## **Security Benefits**

| Aspect | Before | After |
|--------|--------|-------|
| **Secrets in Code** | Connection strings | None |
| **Key Management** | Manual rotation needed | Automatic |
| **Local Testing** | Need connection string | `az login` only |
| **Audit Trail** | No identity tracking | Full audit in AAD |
| **Compromise Risk** | High (exposed keys) | Low (managed identity) |
| **Multi-environment** | Copy keys around | Same code everywhere |

---

## **Environment Variables Summary**

### **Set by Bicep (Deployment Time)**
```
AZURE_VOICELIVE_ENDPOINT      ← AI Services endpoint
AZURE_VOICELIVE_MODEL         ← gpt-realtime
AZURE_VOICELIVE_VOICE         ← Voice model
AZURE_COMMUNICATION_ENDPOINT  ← ACS endpoint
AZURE_STORAGE_ACCOUNT_NAME    ← Storage account (just name, no key)
PORT                          ← 8000
```

### **Set by Post-Provision Script**
```
CALLBACK_URI                  ← Container App FQDN for webhooks
```

### **No Longer Used**
```
❌ AZURE_STORAGE_CONNECTION_STRING  (was: DefaultEndpointsProtocol=...)
❌ Any explicit API keys
```

---

## **How `azd` Remote Build Works**

```
azd up
  ↓
[Detects services with build: remote]
  ↓
[Pushes source to ACR]
  ↓
[ACR builds images using Dockerfile]
  ├─ api:latest ← from src/api-python/Dockerfile
  └─ ui:latest  ← from src/ui/Dockerfile
  ↓
[Container App pulls from ACR]
  ├─ Uses system-assigned managed identity
  ├─ Has ACRPull role on ACR
  └─ No credentials needed
  ↓
✅ Images deployed
```

---

## **Local Development**

For local testing with managed identity simulation:

```powershell
# Login to Azure
az login

# Python code will use your Azure CLI credentials via DefaultAzureCredential
python src/api-python/main.py
```

**What happens locally:**
1. DefaultAzureCredential tries managed identity (fails - you're not in Container)
2. Falls back to Azure CLI credentials (succeeds - you did `az login`)
3. Can read from your own storage account

---

## **Deployment Ready**

✅ **No secrets to manage**  
✅ **No connection strings to copy**  
✅ **Remote builds in ACR**  
✅ **Managed identity authentication**  
✅ **Full audit trail in Azure AD**  
✅ **Same code for dev and production**

Ready to run: `azd up` 🚀
