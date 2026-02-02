<#
.SYNOPSIS
    Starts the Voice Live Agent demo environment locally.

.DESCRIPTION
    This script starts the Python API, Next.js UI, and optionally sets up dev tunnels
    for external access (needed for ACS webhooks).

.PARAMETER WithTunnels
    If specified, also starts Azure Dev Tunnels for API and UI.

.PARAMETER CallbackUri
    The public URL for ACS callbacks (e.g., your dev tunnel URL for port 8000).
    If provided, updates the CALLBACK_URI in the .env file.

.EXAMPLE
    .\start-demo.ps1
    # Starts API on localhost:8000 and UI on localhost:3000

.EXAMPLE
    .\start-demo.ps1 -WithTunnels
    # Starts everything plus dev tunnels for external access

.EXAMPLE
    .\start-demo.ps1 -CallbackUri "https://abc123-8000.usw2.devtunnels.ms"
    # Sets the callback URL and starts services
#>

param(
    [switch]$WithTunnels,
    [string]$CallbackUri
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiDir = Join-Path $scriptDir "src\api-python"
$uiDir = Join-Path $scriptDir "src\ui"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Voice Live Agent - Demo Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow

# Check Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Python is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

# Check for .env files
if (-not (Test-Path (Join-Path $apiDir ".env"))) {
    Write-Host "WARNING: No .env file found in src/api-python" -ForegroundColor Yellow
    Write-Host "         Run 'azd provision' first or copy .env.example to .env" -ForegroundColor Yellow
    
    $envExample = Join-Path $apiDir ".env.example"
    $envFile = Join-Path $apiDir ".env"
    if (Test-Path $envExample) {
        Write-Host "         Copying .env.example to .env..." -ForegroundColor Yellow
        Copy-Item $envExample $envFile
    }
}

Write-Host "Prerequisites OK" -ForegroundColor Green
Write-Host ""

# Update CALLBACK_URI if provided
if ($CallbackUri) {
    Write-Host "Updating CALLBACK_URI to: $CallbackUri" -ForegroundColor Yellow
    $envFile = Join-Path $apiDir ".env"
    if (Test-Path $envFile) {
        $content = Get-Content $envFile -Raw
        $content = $content -replace 'CALLBACK_URI=.*', "CALLBACK_URI=$CallbackUri"
        Set-Content -Path $envFile -Value $content -NoNewline
        Write-Host "Updated .env file" -ForegroundColor Green
    }
}

# Install dependencies if needed
Write-Host "[2/5] Checking dependencies..." -ForegroundColor Yellow

# Python dependencies
Push-Location $apiDir
if (-not (Test-Path "venv")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Gray
    python -m venv venv
}
Write-Host "Installing Python dependencies..." -ForegroundColor Gray
& ".\venv\Scripts\pip.exe" install -q -r requirements.txt
Pop-Location

# Node dependencies
Push-Location $uiDir
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing Node.js dependencies..." -ForegroundColor Gray
    npm install --silent
}
Pop-Location

Write-Host "Dependencies OK" -ForegroundColor Green
Write-Host ""

# Start dev tunnels FIRST if requested (so we can update .env before API starts)
$tunnelUrl = $null
if ($WithTunnels) {
    Write-Host "[3/6] Starting Azure Dev Tunnels..." -ForegroundColor Yellow
    
    if (-not (Get-Command devtunnel -ErrorAction SilentlyContinue)) {
        Write-Host "WARNING: devtunnel CLI not found. Install with: winget install Microsoft.devtunnel" -ForegroundColor Yellow
    }
    else {
        # First, create a persistent tunnel and get its URL
        Write-Host "Creating API tunnel (port 8000)..." -ForegroundColor Gray
        
        # Use a temporary file to capture the tunnel output
        $tempOutputFile = [System.IO.Path]::GetTempFileName()
        
        # Start the tunnel process with output redirected to file
        $apiTunnelProcess = Start-Process -FilePath "powershell" -ArgumentList @(
            "-NoExit",
            "-Command",
            "`$Host.UI.RawUI.WindowTitle = 'API Tunnel (8000)'; devtunnel host --port-numbers 8000 --allow-anonymous 2>&1 | Tee-Object -FilePath '$tempOutputFile'"
        ) -PassThru
        
        # Wait for tunnel to start and extract URL from the file
        Write-Host "Waiting for tunnel URL..." -ForegroundColor Gray
        $attempts = 0
        while (-not $tunnelUrl -and $attempts -lt 30) {
            Start-Sleep -Seconds 1
            $attempts++
            
            if (Test-Path $tempOutputFile) {
                $output = Get-Content $tempOutputFile -Raw -ErrorAction SilentlyContinue
                if ($output) {
                    # Match the URL with port in subdomain (e.g., https://abc123-8000.use2.devtunnels.ms)
                    if ($output -match '(https://[a-zA-Z0-9]+-8000\.[a-zA-Z0-9]+\.devtunnels\.ms)') {
                        $tunnelUrl = $Matches[1]
                    }
                    # Also try Connect via link format
                    elseif ($output -match 'Connect via browser:\s+(https://[^\s]+)') {
                        $tunnelUrl = $Matches[1]
                    }
                }
            }
        }
        
        # Clean up temp file after a delay (let it continue capturing)
        Start-Job -ScriptBlock { 
            param($file) 
            Start-Sleep -Seconds 60
            Remove-Item $file -ErrorAction SilentlyContinue 
        } -ArgumentList $tempOutputFile | Out-Null
        
        if ($tunnelUrl) {
            Write-Host "API Tunnel URL: $tunnelUrl" -ForegroundColor Green
            
            # Update .env with the tunnel URL
            $envFile = Join-Path $apiDir ".env"
            if (Test-Path $envFile) {
                $content = Get-Content $envFile -Raw
                if ($content -match 'CALLBACK_URI=') {
                    $content = $content -replace 'CALLBACK_URI=.*', "CALLBACK_URI=$tunnelUrl"
                }
                else {
                    $content = $content.TrimEnd() + "`nCALLBACK_URI=$tunnelUrl`n"
                }
                Set-Content -Path $envFile -Value $content -NoNewline
                Write-Host "Updated CALLBACK_URI in .env" -ForegroundColor Green
            }
            
            # Create/update Event Grid subscription for inbound calls
            Write-Host ""
            Write-Host "Configuring Event Grid subscription for inbound calls..." -ForegroundColor Yellow
            
            # Read ACS info from .env or azd
            $acsName = $null
            $resourceGroup = $null
            
            # Try to get from azd env
            try {
                $acsName = (azd env get-value AZURE_COMMUNICATION_SERVICES 2>$null)
                $resourceGroup = (azd env get-value AZURE_RESOURCE_GROUP 2>$null)
                if (-not $resourceGroup) {
                    $envName = (azd env get-value AZURE_ENV_NAME 2>$null)
                    if ($envName) { $resourceGroup = "rg-$envName" }
                }
            }
            catch { }
            
            if ($acsName -and $resourceGroup) {
                $webhookEndpoint = "$tunnelUrl/api/calls/inbound"
                $subscriptionName = "local-dev-inbound-calls"
                
                Write-Host "  ACS Resource: $acsName" -ForegroundColor Gray
                Write-Host "  Resource Group: $resourceGroup" -ForegroundColor Gray
                Write-Host "  Webhook: $webhookEndpoint" -ForegroundColor Gray
                
                # Get ACS resource ID
                $acsId = az communication show --name $acsName --resource-group $resourceGroup --query id -o tsv 2>$null
                
                if ($acsId) {
                    # Delete existing subscription if it exists (to update the URL)
                    az eventgrid event-subscription delete `
                        --name $subscriptionName `
                        --source-resource-id $acsId `
                        --output none 2>$null
                    
                    # Create new subscription
                    $result = az eventgrid event-subscription create `
                        --name $subscriptionName `
                        --source-resource-id $acsId `
                        --endpoint $webhookEndpoint `
                        --endpoint-type webhook `
                        --included-event-types "Microsoft.Communication.IncomingCall" `
                        --output none 2>&1
                    
                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "Event Grid subscription created for inbound calls!" -ForegroundColor Green
                        Write-Host "Inbound calls to your ACS phone number will now route to your local API." -ForegroundColor Green
                    }
                    else {
                        Write-Host "Warning: Could not create Event Grid subscription: $result" -ForegroundColor Yellow
                        Write-Host "You may need to manually configure Event Grid in Azure Portal." -ForegroundColor Yellow
                    }
                }
                else {
                    Write-Host "Warning: Could not find ACS resource ID" -ForegroundColor Yellow
                }
            }
            else {
                Write-Host "Warning: Could not find ACS configuration. Run 'azd provision' first." -ForegroundColor Yellow
                Write-Host "Inbound calls will not work until Event Grid is configured." -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "Could not capture tunnel URL automatically after $attempts seconds." -ForegroundColor Yellow
            Write-Host "Check the tunnel window for the URL and manually update CALLBACK_URI in src/api-python/.env" -ForegroundColor Yellow
        }
        
        # Start UI tunnel
        Write-Host "Starting UI tunnel (port 3000)..." -ForegroundColor Gray
        $uiTunnelProcess = Start-Process -FilePath "powershell" -ArgumentList @(
            "-NoExit",
            "-Command",
            "`$Host.UI.RawUI.WindowTitle = 'UI Tunnel (3000)'; devtunnel host --port-numbers 3000 --allow-anonymous"
        ) -PassThru
        
        Write-Host "Dev tunnels started." -ForegroundColor Green
        Write-Host ""
    }
}

# Start services
Write-Host "[4/6] Starting Python API (port 8000)..." -ForegroundColor Yellow
$apiProcess = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$apiDir'; .\venv\Scripts\activate; python -m uvicorn main:app --host 127.0.0.1 --port 8000"
) -PassThru

Write-Host "[5/6] Starting Next.js UI (port 3000)..." -ForegroundColor Yellow
$uiProcess = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$uiDir'; npm run dev"
) -PassThru

if (-not $WithTunnels) {
    Write-Host "[6/6] Skipping dev tunnels (use -WithTunnels to enable)" -ForegroundColor Gray
}
else {
    Write-Host "[6/6] Tunnels already running" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Demo Started!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  UI:  http://localhost:3000" -ForegroundColor Cyan
Write-Host "  API: http://localhost:8000" -ForegroundColor Cyan
Write-Host "  API Health: http://localhost:8000/health" -ForegroundColor Cyan
if ($tunnelUrl) {
    Write-Host ""
    Write-Host "  API Tunnel (CALLBACK_URI): $tunnelUrl" -ForegroundColor Magenta
}
Write-Host ""
Write-Host "Press Ctrl+C in each terminal window to stop the services." -ForegroundColor Gray
Write-Host ""

# Wait a moment then open browser
Start-Sleep -Seconds 5
Write-Host "Opening browser..." -ForegroundColor Gray
Start-Process "http://localhost:3000"
