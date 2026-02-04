# Deployment Checklist

Quick reference for deploying Voice Live Agent to Azure.

## Pre-Deployment

- [ ] Azure CLI installed and logged in (`az login`)
- [ ] Azure Developer CLI installed (`azd`)
- [ ] Azure subscription with AI Services access

## Deploy

```bash
azd up
```

Wait ~10-15 minutes for deployment to complete.

## Post-Deployment

- [ ] **Purchase phone number** in Azure Portal:
  - Communication Services → Phone Numbers → Get
  - Select toll-free with Voice capability
  
- [ ] **Test the app**:
  - Open UI URL from deployment output
  - Enter your phone number
  - Click "Call" - AI will call you!

## Verify Deployment

```bash
# Check containers are running
az containerapp show -n ca-api-{env} -g rg-{env} --query properties.state

# View logs
az containerapp logs show -n ca-api-{env} -g rg-{env} --follow

# Check images in registry
az acr repository list --name acr{env}
```

## Resources Created

```
✅ Resource Group: rg-{environment}
   ├─ Azure AI Services
   ├─ Azure Communication Services
   ├─ Azure Container Registry
   ├─ Azure Storage Account
   ├─ Container Apps Environment
   ├─ API Container App
   ├─ UI Container App
   └─ Event Grid Subscription
```

## URLs

- **UI**: `https://ca-ui-{env}.{region}.azurecontainerapps.io`
- **API**: `https://ca-api-{env}.{region}.azurecontainerapps.io`
- **Health**: `https://ca-api-{env}.{region}.azurecontainerapps.io/health`

## Common Issues

| Issue | Solution |
|-------|----------|
| No phone number | Purchase in Portal → ACS → Phone Numbers |
| Calls not connecting | Check CALLBACK_URI is set correctly |
| Container won't start | Check logs with `az containerapp logs show` |
| Recording fails | Verify managed identity has Storage Blob Contributor role |

## Cleanup

```bash
azd down
```

This deletes all Azure resources created by the deployment.
