# Post-deploy hook for Azure Developer CLI
# This script configures Event Grid subscription for incoming calls

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Post-Deploy Configuration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get outputs from azd env and strip quotes
Write-Host "Reading Azure environment values..." -ForegroundColor Yellow
$envOutput = azd env get-values
$envValues = @{}
foreach ($line in $envOutput) {
    if ($line -match '^([^=]+)=(.*)$') {
        $key = $matches[1]
        $value = $matches[2].Trim('"')
        $envValues[$key] = $value
    }
}

$acsName = $envValues['AZURE_COMMUNICATION_SERVICES']
$resourceGroup = $envValues['AZURE_RESOURCE_GROUP']
$apiUrl = $envValues['API_URL']
$envName = $envValues['AZURE_ENV_NAME']

# If we don't have resource group from azd, try to extract from env name
if (-not $resourceGroup) {
    $resourceGroup = "rg-" + $envName
}

# Ensure Event Grid subscription exists for incoming calls
Write-Host ""
Write-Host "Setting up Event Grid subscription for incoming calls..." -ForegroundColor Yellow
if ($acsName -and $resourceGroup -and $apiUrl) {
    $systemTopicName = "evgt-$envName"
    $subscriptionName = "incoming-call-subscription"
    $webhookUrl = "https://$apiUrl/api/calls/inbound"

    # Wait for API to be ready before creating webhook subscription
    Write-Host "Waiting for API to be ready at $webhookUrl..." -ForegroundColor Gray
    $maxRetries = 20
    $retryCount = 0
    $apiReady = $false

    while ($retryCount -lt $maxRetries -and -not $apiReady) {
        try {
            $response = Invoke-WebRequest -Uri "https://$apiUrl/health" -TimeoutSec 5 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                $apiReady = $true
                Write-Host "API is ready!" -ForegroundColor Green
            }
        }
        catch {
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Write-Host "  Attempt $retryCount/$maxRetries - API not ready yet, waiting 5 seconds..." -ForegroundColor Gray
                Start-Sleep -Seconds 5
            }
        }
    }

    if (-not $apiReady) {
        Write-Host "Warning: API health check timed out. Event Grid subscription may fail validation." -ForegroundColor Yellow
    }

    try {
        # Check if system topic exists
        $topicExists = az eventgrid system-topic show --name $systemTopicName --resource-group $resourceGroup 2>$null

        if (-not $topicExists) {
            Write-Host "Event Grid system topic not found - will be created by Bicep" -ForegroundColor Gray
        }
        else {
            # Check if subscription exists
            $subExists = az eventgrid system-topic event-subscription show `
                --name $subscriptionName `
                --system-topic-name $systemTopicName `
                --resource-group $resourceGroup 2>$null

            if (-not $subExists) {
                Write-Host "Creating Event Grid subscription for incoming calls..." -ForegroundColor Yellow
                Write-Host "  Webhook URL: $webhookUrl" -ForegroundColor Gray
                az eventgrid system-topic event-subscription create `
                    --name $subscriptionName `
                    --system-topic-name $systemTopicName `
                    --resource-group $resourceGroup `
                    --endpoint $webhookUrl `
                    --endpoint-type webhook `
                    --included-event-types "Microsoft.Communication.IncomingCall" `
                    --output none

                if ($LASTEXITCODE -eq 0) {
                    Write-Host "Event Grid subscription created successfully!" -ForegroundColor Green
                    Write-Host "  Inbound calls will now be routed to: $webhookUrl" -ForegroundColor Green
                }
                else {
                    Write-Host "Failed to create Event Grid subscription" -ForegroundColor Red
                    Write-Host "  You may need to run the following command manually:" -ForegroundColor Yellow
                    Write-Host "  az eventgrid system-topic event-subscription create --name $subscriptionName ``" -ForegroundColor Gray
                    Write-Host "    --system-topic-name $systemTopicName --resource-group $resourceGroup ``" -ForegroundColor Gray
                    Write-Host "    --endpoint $webhookUrl --endpoint-type webhook ``" -ForegroundColor Gray
                    Write-Host "    --included-event-types 'Microsoft.Communication.IncomingCall'" -ForegroundColor Gray
                }
            }
            else {
                Write-Host "Event Grid subscription already exists" -ForegroundColor Green
            }
        }
    }
    catch {
        Write-Host "Note: Unable to configure Event Grid subscription automatically" -ForegroundColor Yellow
        Write-Host "  Run this command after deployment completes:" -ForegroundColor Yellow
        Write-Host "  az eventgrid system-topic event-subscription create --name $subscriptionName ``" -ForegroundColor Gray
        Write-Host "    --system-topic-name $systemTopicName --resource-group $resourceGroup ``" -ForegroundColor Gray
        Write-Host "    --endpoint $webhookUrl --endpoint-type webhook ``" -ForegroundColor Gray
        Write-Host "    --included-event-types 'Microsoft.Communication.IncomingCall'" -ForegroundColor Gray
    }
}
else {
    Write-Host "Missing ACS name, resource group, or API URL. Cannot create Event Grid subscription." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Post-Deploy Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""