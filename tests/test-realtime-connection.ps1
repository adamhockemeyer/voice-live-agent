# Test Azure OpenAI Realtime Connection
# This script tests the connection to Azure OpenAI Realtime API

Write-Host "Testing Azure OpenAI Realtime Connection..." -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

# Load environment variables
$envFile = Join-Path $PSScriptRoot "..\src\api\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2])
        }
    }
} else {
    Write-Host "[FAIL] .env file not found" -ForegroundColor Red
    exit 1
}

$endpoint = $env:AZURE_OPENAI_ENDPOINT
$deployment = $env:AZURE_OPENAI_DEPLOYMENT

if (-not $endpoint -or -not $deployment) {
    Write-Host "[FAIL] Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_DEPLOYMENT" -ForegroundColor Red
    exit 1
}

Write-Host "Endpoint: $endpoint" -ForegroundColor Gray
Write-Host "Deployment: $deployment" -ForegroundColor Gray

# Test 1: Get Access Token
Write-Host "`nTest 1: Getting Azure AD token..." -ForegroundColor Yellow
try {
    $token = az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv 2>$null
    if ($token) {
        Write-Host "[OK] Access token obtained (length: $($token.Length))" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Could not get access token" -ForegroundColor Red
        Write-Host "Make sure you're logged in with 'az login'" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "[FAIL] Error getting token: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 2: List Deployments
Write-Host "`nTest 2: Checking model deployment..." -ForegroundColor Yellow
$cleanEndpoint = $endpoint.TrimEnd('/')
$deploymentsUrl = "$cleanEndpoint/openai/deployments?api-version=2024-10-01-preview"

try {
    $headers = @{
        "Authorization" = "Bearer $token"
    }
    $response = Invoke-RestMethod -Uri $deploymentsUrl -Headers $headers -Method Get -TimeoutSec 30
    
    $realtimeDeployment = $response.data | Where-Object { $_.id -eq $deployment }
    if ($realtimeDeployment) {
        Write-Host "[OK] Found deployment: $deployment" -ForegroundColor Green
        Write-Host "     Model: $($realtimeDeployment.model)" -ForegroundColor Gray
    } else {
        Write-Host "[WARN] Deployment '$deployment' not found in response" -ForegroundColor Yellow
        Write-Host "Available deployments:" -ForegroundColor Gray
        $response.data | ForEach-Object { Write-Host "  - $($_.id): $($_.model)" -ForegroundColor Gray }
    }
} catch {
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "[WARN] Deployments endpoint returned 404 (may need different API version)" -ForegroundColor Yellow
    } else {
        Write-Host "[WARN] Could not list deployments: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Test 3: Test Realtime WebSocket endpoint format
Write-Host "`nTest 3: Checking Realtime WebSocket URL format..." -ForegroundColor Yellow
$wsEndpoint = $endpoint.Replace("https://", "wss://").TrimEnd('/')
$realtimeUrl = "$wsEndpoint/openai/realtime?api-version=2024-10-01-preview&deployment=$deployment"
Write-Host "[OK] Realtime WebSocket URL: $realtimeUrl" -ForegroundColor Green

# Summary
Write-Host "`n===========================================" -ForegroundColor Cyan
Write-Host "Azure OpenAI Realtime connection test complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To test the full solution:" -ForegroundColor Yellow
Write-Host "  1. Start API: cd src/api && npm run dev" -ForegroundColor Gray
Write-Host "  2. Start UI:  cd src/ui && npm run dev" -ForegroundColor Gray
Write-Host "  3. Open http://localhost:3000 in browser" -ForegroundColor Gray
