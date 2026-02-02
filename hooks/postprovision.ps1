# Post-provision hook for Azure Developer CLI
# This script creates .env files for local development after infrastructure is provisioned

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Post-Provision Configuration" -ForegroundColor Cyan
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
$acsPhoneNumber = ""
$resourceGroup = $envValues['AZURE_RESOURCE_GROUP']
$apiUrl = $envValues['API_URL']
$envName = $envValues['AZURE_ENV_NAME']

# If we don't have resource group from azd, try to extract from location
if (-not $resourceGroup) {
    $resourceGroup = "rg-" + $envName
}

# Update API Container App with CALLBACK_URI environment variable
Write-Host ""
Write-Host "Updating API Container App with CALLBACK_URI..." -ForegroundColor Yellow
if ($apiUrl -and $resourceGroup) {
    $apiContainerAppName = "ca-api-$envName"
    $callbackUri = "https://$apiUrl"
    try {
        az containerapp update `
            --name $apiContainerAppName `
            --resource-group $resourceGroup `
            --set-env-vars "CALLBACK_URI=$callbackUri" `
            --output none
        Write-Host "Set CALLBACK_URI=$callbackUri on $apiContainerAppName" -ForegroundColor Green
    }
    catch {
        Write-Host "Warning: Could not update CALLBACK_URI: $_" -ForegroundColor Yellow
    }
}

# Check for existing phone numbers
Write-Host ""
Write-Host "Checking for ACS phone number..." -ForegroundColor Yellow

if ($acsName) {
    try {
        Write-Host "Checking ACS resource: $acsName" -ForegroundColor Gray
        
        # Get connection string and list phone numbers
        $connectionString = az communication list-key --name $acsName --resource-group $resourceGroup --query "primaryConnectionString" -o tsv 2>$null
        
        if ($connectionString) {
            $phoneNumbersJson = az communication phonenumber list --connection-string $connectionString 2>$null
            $phoneNumbers = $phoneNumbersJson | ConvertFrom-Json -ErrorAction SilentlyContinue
            
            if ($phoneNumbers -and $phoneNumbers.Count -gt 0) {
                $acsPhoneNumber = $phoneNumbers[0].phoneNumber
                Write-Host "Found existing phone number: $acsPhoneNumber" -ForegroundColor Green
            }
            else {
                Write-Host "No phone numbers found." -ForegroundColor Yellow
                Write-Host ""
                Write-Host "To enable phone calls, purchase a number in Azure Portal:" -ForegroundColor Yellow
                Write-Host "  1. Go to: https://portal.azure.com" -ForegroundColor Gray
                Write-Host "  2. Navigate to: Communication Services -> $acsName -> Phone Numbers" -ForegroundColor Gray
                Write-Host "  3. Click 'Get' and purchase a toll-free number with voice capabilities" -ForegroundColor Gray
                Write-Host "  4. Add the number to src/api-python/.env as ACS_PHONE_NUMBER" -ForegroundColor Gray
            }
        }
        else {
            Write-Host "Could not get ACS connection string" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "Could not check phone numbers: $_" -ForegroundColor Yellow
    }
}
else {
    Write-Host "ACS not configured" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Creating .env files for local development..." -ForegroundColor Yellow

# Create Python API .env file
$apiEnvPath = Join-Path $PSScriptRoot "..\src\api-python\.env"
$apiEnvContent = @"
# Azure VoiceLive Configuration
AZURE_VOICELIVE_ENDPOINT=$($envValues['AZURE_OPENAI_ENDPOINT'])
AZURE_VOICELIVE_MODEL=gpt-realtime
AZURE_VOICELIVE_VOICE=en-US-Ava:DragonHDLatestNeural
AZURE_VOICELIVE_INSTRUCTIONS=You are a helpful AI voice assistant for a delivery tracking service. Help callers check on their truck deliveries, provide status updates, and answer questions. Be concise and professional.

# Azure Communication Services Configuration (Managed Identity)
AZURE_COMMUNICATION_ENDPOINT=$($envValues['AZURE_COMMUNICATION_ENDPOINT'])
ACS_PHONE_NUMBER=$acsPhoneNumber

# Server Configuration
PORT=8000
CALLBACK_URI=https://$($envValues['API_URL'])
"@

Set-Content -Path $apiEnvPath -Value $apiEnvContent
Write-Host "Created: $apiEnvPath" -ForegroundColor Green

# Create UI .env file  
$uiEnvPath = Join-Path $PSScriptRoot "..\src\ui\.env"
$uiEnvContent = @"
NEXT_PUBLIC_API_URL=http://localhost:8000
"@

Set-Content -Path $uiEnvPath -Value $uiEnvContent
Write-Host "Created: $uiEnvPath" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Post-Provision Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
if ($acsPhoneNumber) {
    Write-Host "Phone Number: $acsPhoneNumber" -ForegroundColor Cyan
}
else {
    Write-Host "Phone Number: Not configured (see instructions above)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Run the demo with:" -ForegroundColor Gray
Write-Host "  .\start-demo.ps1" -ForegroundColor White
Write-Host ""
