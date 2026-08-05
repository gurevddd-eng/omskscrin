# Test WinRM connectivity from Debian (pwsh + PSWSMan) to a domain Windows PC.
param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [string]$DeployUser = "",
  [string]$DeployPassword = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Hostname = $Hostname.Trim()
if (-not $Hostname) { throw "Hostname required" }

if (-not $DeployUser -or -not $DeployPassword) {
  throw "DeployUser and DeployPassword required for WinRM"
}
if ($DeployUser -match '^(DOMAIN\\|domain\\)') {
  throw "DEPLOY_USER looks like a placeholder. Use user@udhb.local"
}

$sec = ConvertTo-SecureString $DeployPassword -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential ($DeployUser, $sec)

$sessionParams = @{
  ComputerName  = $Hostname
  Credential    = $cred
  ErrorAction   = "Stop"
  SessionOption = (New-PSSessionOption -OperationTimeout 0 -OpenTimeout 20000)
}

Write-Host "Connecting via WinRM to $Hostname as $DeployUser ..."
try {
  $session = New-PSSession @sessionParams
} catch {
  throw "WinRM connect failed to '$Hostname': $($_.Exception.Message)"
}

try {
  $info = Invoke-Command -Session $session -ScriptBlock {
    [pscustomobject]@{
      ComputerName = $env:COMPUTERNAME
      UserDomain   = $env:USERDOMAIN
      UserName     = $env:USERNAME
    }
  }
  Write-Output ("WINRM_OK:" + $info.ComputerName + " domain=" + $info.UserDomain + " user=" + $info.UserName)
} finally {
  Remove-PSSession $session -ErrorAction SilentlyContinue
}
