param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $Target
if ($signature.Status -ne 'Valid') { throw "安装包签名验证失败：$($signature.Status)" }
Write-Output "签名有效：$Target"
