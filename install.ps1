# ============================================================================
# dsh-drop-by 安装脚本（幂等，可重复跑）
# ----------------------------------------------------------------------------
# 做的事：
#   1) 备份 profile 的 package.json 和 cordis.patch.yml（带时间戳）
#   2) package.json：dependencies 加 link 依赖 + dsh.profile.bundles 加一项
#   3) 在 profile/node_modules 下建一个 junction 指向本目录
#   4) cordis.patch.yml 末尾插一段 insert（已经有了就跳过）
#
# 不做的事：**不重启、不关机、不碰正在跑的 DSH 进程**。
# 装完你自己挑时候重启 DSH，插件才会加载。
#
#   卸载：同目录的 uninstall.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'

$pluginDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$dshHome    = Join-Path $env:USERPROFILE '.dsh'
$profileDir = Join-Path $dshHome 'profiles\desktop'
$pkgPath    = Join-Path $profileDir 'package.json'
$patchPath  = Join-Path $profileDir 'cordis.patch.yml'
$linkPath   = Join-Path $profileDir 'node_modules\dsh-drop-by'
$stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $pkgPath))   { throw "找不到 $pkgPath —— profile 路径不对？" }
if (-not (Test-Path $patchPath)) { throw "找不到 $patchPath" }

Write-Host "插件目录 : $pluginDir"
Write-Host "profile  : $profileDir"

# ---- 1) 备份 ----
function Backup-File([string]$path) {
  # ⚠ 名字要唯一：同一秒重跑两次，后一份会把前面那份「原件」盖掉
  $to = "$path.bak-dropby-$stamp"
  $n = 1
  while (Test-Path $to) { $to = "$path.bak-dropby-$stamp-$n"; $n++ }
  Copy-Item $path $to -Force
  Write-Host "已备份   : $(Split-Path -Leaf $to)"
}
Backup-File $pkgPath
Backup-File $patchPath

# ---- 2) package.json ----
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$deps = $pkg.dependencies
if ($null -eq $deps) {
  $pkg | Add-Member -NotePropertyName 'dependencies' -NotePropertyValue ([pscustomobject]@{}) -Force
  $deps = $pkg.dependencies
}
if (-not ($deps.PSObject.Properties.Name -contains 'dsh-drop-by')) {
  $deps | Add-Member -NotePropertyName 'dsh-drop-by' -NotePropertyValue ("link:" + $pluginDir) -Force
  Write-Host "dependencies: 已加 dsh-drop-by"
} else {
  $deps.'dsh-drop-by' = "link:" + $pluginDir
  Write-Host "dependencies: dsh-drop-by 已存在，指向已更新"
}

$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-drop-by') {
  $pkg.dsh.profile.bundles = @($bundles + 'dsh-drop-by')
  Write-Host "bundles     : 已加 dsh-drop-by"
} else {
  Write-Host "bundles     : dsh-drop-by 已存在，跳过"
}

$json = $pkg | ConvertTo-Json -Depth 30
# ⚠⚠ 2026-10-30 踩过的坑：Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写 BOM，
#   Node 的 JSON.parse 遇到 BOM 直接抛 `Unexpected token '锘`，DSH 启动阶段就崩（crash-*-host.log）。
#   所以这里一律用 .NET 显式写「无 BOM 的 UTF-8」，写之前自己先 parse 一遍。
try { [void]($json | ConvertFrom-Json) } catch { throw "生成的 package.json 不是有效 JSON，已中止（原文件没动）" }
[System.IO.File]::WriteAllText($pkgPath, $json, (New-Object System.Text.UTF8Encoding($false)))
if ((Get-Content $pkgPath -TotalCount 1) -match '^\xEF\xBB\xBF') { throw '写出来的 package.json 带 BOM，已中止' }
Write-Host "已写入   : $pkgPath"

# ---- 3) junction ----
$existing = Get-Item $linkPath -ErrorAction SilentlyContinue
if ($null -ne $existing) {
  $target = $existing.Target
  if ($target -and ((Resolve-Path $target).Path -eq (Resolve-Path $pluginDir).Path)) {
    Write-Host "junction    : 已存在且指向本目录，跳过"
  } else {
    Write-Host "junction    : 已存在但指向别处（$target），先删掉重建"
    Remove-Item $linkPath -Force -Recurse
    New-Item -ItemType Junction -Path $linkPath -Target $pluginDir | Out-Null
  }
} else {
  $nmDir = Split-Path -Parent $linkPath
  if (-not (Test-Path $nmDir)) { New-Item -ItemType Directory -Force -Path $nmDir | Out-Null }
  New-Item -ItemType Junction -Path $linkPath -Target $pluginDir | Out-Null
  Write-Host "junction    : 已建 -> $pluginDir"
}

# ---- 4) cordis.patch.yml ----
$patchText = Get-Content $patchPath -Raw -Encoding UTF8
if ($patchText -match 'name:\s*dsh-drop-by') {
  Write-Host "patch       : 已经有 dsh-drop-by，跳过"
} else {
  $block = @'

# ── dsh-drop-by：到点了她自己来找你说话（设置页 /dsh-drop-by）──
- insert:
    - id: dsh-drop-by
      name: dsh-drop-by
'@
  # 同样用 .NET 追加，避免 5.1 的 Add-Content -Encoding UTF8 在边界情况下掺进 BOM
  [System.IO.File]::AppendAllText($patchPath, ($block -replace "`r?`n", "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "patch       : 已插入 insert 段"
}

Write-Host ''
Write-Host '装完了。**现在没有重启任何东西**，你方便的时候自己重启 DSH 才会加载。'
Write-Host "重启后设置页： http://127.0.0.1:<DSH 端口>/dsh-drop-by"
Write-Host "回滚： powershell -File `"$pluginDir\uninstall.ps1`""
