# Test Azure Resources
# This script verifies that the Azure resources are properly provisioned

param(
    [switch]$Verbose
)

Write-Host "Testing Azure Resources..." -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan

$allPassed = $true

# Load environment variables - try Python API first, then TypeScript API
$envFile = Join-Path $PSScriptRoot "..\src\api-python\.env"
if (-not (Test-Path $envFile)) {
    $envFile = Join-Path $PSScriptRoot "..\src\api\.env"
}

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
        }
    }
    Write-Host "[OK] .env file loaded from $envFile" -ForegroundColor Green
}
else {
    Write-Host "[FAIL] .env file not found" -ForegroundColor Red
    Write-Host "Run 'azd provision' first to create resources and .env files" -ForegroundColor Yellow
    exit 1
}

# Test 1: Azure VoiceLive/OpenAI Endpoint
Write-Host "`nTest 1: Azure VoiceLive Endpoint..." -ForegroundColor Yellow
$endpoint = $env:AZURE_VOICELIVE_ENDPOINT
if (-not $endpoint) {
    $endpoint = $env:AZURE_OPENAI_ENDPOINT
}
if ($endpoint) {
    try {
        $response = Invoke-WebRequest -Uri $endpoint -Method Head -TimeoutSec 10 -ErrorAction Stop
        Write-Host "[OK] VoiceLive endpoint is reachable: $endpoint" -ForegroundColor Green
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 401 -or $_.Exception.Response.StatusCode -eq 403) {
            Write-Host "[OK] VoiceLive endpoint exists (auth required): $endpoint" -ForegroundColor Green
        }
        else {
            Write-Host "[WARN] VoiceLive endpoint may not be reachable: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}
else {
    Write-Host "[FAIL] AZURE_VOICELIVE_ENDPOINT not set" -ForegroundColor Red
    $allPassed = $false
}

# Test 2: VoiceLive Model Configuration
Write-Host "`nTest 2: VoiceLive Model Configuration..." -ForegroundColor Yellow
$model = $env:AZURE_VOICELIVE_MODEL
if ($model) {
    Write-Host "[OK] VoiceLive model configured: $model" -ForegroundColor Green
}
else {
    Write-Host "[WARN] AZURE_VOICELIVE_MODEL not set (will use default)" -ForegroundColor Yellow
}

# Test 3: Azure Communication Services Configuration
Write-Host "`nTest 3: Azure Communication Services..." -ForegroundColor Yellow
$acsEndpoint = $env:AZURE_COMMUNICATION_ENDPOINT
if ($acsEndpoint) {
    Write-Host "[OK] Communication Services endpoint: $acsEndpoint" -ForegroundColor Green
    
    # Try to access the ACS endpoint
    try {
        $response = Invoke-WebRequest -Uri $acsEndpoint -Method Head -TimeoutSec 10 -ErrorAction Stop
        Write-Host "[OK] Communication Services is reachable" -ForegroundColor Green
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 401 -or $_.Exception.Response.StatusCode -eq 403 -or $_.Exception.Response.StatusCode -eq 404) {
            Write-Host "[OK] Communication Services exists (auth required - using managed identity)" -ForegroundColor Green
        }
        else {
            Write-Host "[WARN] Communication Services may not be reachable: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}
else {
    Write-Host "[FAIL] AZURE_COMMUNICATION_ENDPOINT not set" -ForegroundColor Red
    $allPassed = $false
}

# Test 4: Verify using Azure CLI
Write-Host "`nTest 4: Verify resources with Azure CLI..." -ForegroundColor Yellow
try {
    $resourceGroup = az group list --query "[?contains(name, 'vla')].name" -o tsv 2>$null | Select-Object -First 1
    if ($resourceGroup) {
        Write-Host "[OK] Resource group found: $resourceGroup" -ForegroundColor Green
        
        # Verify SecurityControl tag
        $tags = az group show --name $resourceGroup --query "tags" -o json 2>$null | ConvertFrom-Json
        if ($tags.SecurityControl -eq 'Ignore') {
            Write-Host "[OK] SecurityControl:Ignore tag is set on resource group" -ForegroundColor Green
        }
        else {
            Write-Host "[WARN] SecurityControl:Ignore tag not found on resource group" -ForegroundColor Yellow
        }
        
        # List resources in the group
        if ($Verbose) {
            $resources = az resource list --resource-group $resourceGroup --query "[].{Name:name,Type:type}" -o table 2>&1
            Write-Host "`nResources in $resourceGroup :" -ForegroundColor Cyan
            Write-Host $resources
        }
        else {
            $resourceCount = (az resource list --resource-group $resourceGroup --query "length(@)" -o tsv 2>$null)
            Write-Host "[OK] Found $resourceCount resources in resource group" -ForegroundColor Green
        }
    }
    else {
        Write-Host "[WARN] No resource group found - may be using different name" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "[WARN] Could not verify with Azure CLI: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Summary
Write-Host "`n=========================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
}
else {
    Write-Host "Some tests failed!" -ForegroundColor Red
    exit 1
}
