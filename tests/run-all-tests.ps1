# Run All Tests
# This script runs all test scripts and provides a summary

param(
    [switch]$Verbose
)

Write-Host "Voice Live Agent - Test Suite" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

$testDir = $PSScriptRoot
$results = @()

# Test 1: Azure Resources
Write-Host "Running: test-azure-resources.ps1" -ForegroundColor Yellow
Write-Host "-----------------------------------" -ForegroundColor Gray
try {
    $params = @{}
    if ($Verbose) { $params['Verbose'] = $true }
    & "$testDir\test-azure-resources.ps1" @params
    $results += @{ Name = "Azure Resources"; Status = "PASS" }
} catch {
    $results += @{ Name = "Azure Resources"; Status = "FAIL" }
}
Write-Host ""

# Test 2: Azure OpenAI Realtime
Write-Host "Running: test-realtime-connection.ps1" -ForegroundColor Yellow
Write-Host "--------------------------------------" -ForegroundColor Gray
try {
    & "$testDir\test-realtime-connection.ps1"
    $results += @{ Name = "Realtime Connection"; Status = "PASS" }
} catch {
    $results += @{ Name = "Realtime Connection"; Status = "FAIL" }
}
Write-Host ""

# Test 3: API Server
Write-Host "Running: test-api-server.ps1" -ForegroundColor Yellow
Write-Host "----------------------------" -ForegroundColor Gray
try {
    & "$testDir\test-api-server.ps1"
    $results += @{ Name = "API Server"; Status = "PASS" }
} catch {
    $results += @{ Name = "API Server"; Status = "FAIL" }
}
Write-Host ""

# Summary
Write-Host "=============================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

$passed = 0
$failed = 0

foreach ($result in $results) {
    if ($result.Status -eq "PASS") {
        Write-Host "[PASS] $($result.Name)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "[FAIL] $($result.Name)" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "Total: $($results.Count) | Passed: $passed | Failed: $failed" -ForegroundColor Cyan

if ($failed -gt 0) {
    exit 1
} else {
    exit 0
}
