# ============================================================================
# dsh-drop-by 卸载 / 回滚脚本
# ----------------------------------------------------------------------------
# 反向做 install.ps1 的事：
#   1) 删 profile/node_modules/dsh-drop-by 这个 junction
#   2) package.json 里去掉 dependencies 和 bundles 里的项
#   3) cordis.patch.yml 里删掉 drop-by 那段 insert
#
# 不删：~/.dsh/drop-by-config.json（你的设置留着，重装回来还在）
# 不动：**不重启、不关机**。删完自己重启 DSH，插件才真正下线。
# ============================================================================
$ErrorActionPreference = 'Stop'

$pluginDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$pkgPath    = Join-Path $profileDir 'package.json'
$patchPath  = Join-Path $profileDir 'cordis.patch.yml'
$linkPath   = Join-Path $profileDir 'node_modules\dsh-drop-by'
$stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'

if (Test-Path $pkgPath)   { Copy-Item $pkgPath   "$pkgPath.bak-dropby-off-$stamp"   -Force }
if (Test-Path $patchPath) { Copy-Item $patchPath "$patchPath.bak-dropby-off-$stamp" -Force }

# ---- 1) junction ----
if (Test-Path $linkPath) {
  Remove-Item $linkPath -Force -Recurse
  Write-Host "junction    : 已删除"
} else {
  Write-Host "junction    : 本来就不在"
}

# ---- 2) package.json ----
if (Test-Path $pkgPath) {
  $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($pkg.dependencies -and ($pkg.dependencies.PSObject.Properties.Name -contains 'dsh-drop-by')) {
    $pkg.dependencies.PSObject.Properties.Remove('dsh-drop-by')
    Write-Host "dependencies: 已移除"
  }
  if ($pkg.dsh.profile.bundles) {
    $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-drop-by' })
    Write-Host "bundles     : 已移除"
  }
  $json = $pkg | ConvertTo-Json -Depth 30
  # ⚠ 同 install.ps1：5.1 的 Set-Content -Encoding UTF8 会写 BOM，Node 一 parse 就崩
  try { [void]($json | ConvertFrom-Json) } catch { throw "生成的 package.json 不是有效 JSON，已中止（原文件没动）" }
  [System.IO.File]::WriteAllText($pkgPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# ---- 3) cordis.patch.yml ----
if (Test-Path $patchPath) {
  $text = Get-Content $patchPath -Raw -Encoding UTF8
  # 匹配含 dsh-drop-by 的那一段：可选的注释行 + insert: + id/name 两行
  $pattern = '(?ms)(?:\r?\n)?# ── dsh-drop-by.*?\r?\n- insert:\s*\r?\n\s*- id: dsh-drop-by\s*\r?\n\s*name: dsh-drop-by\s*\r?\n'
  $new = [regex]::Replace($text, $pattern, "`r`n")
  # 兜底：没有注释头的那种写法
  $pattern2 = '(?ms)(?:\r?\n)?- insert:\s*\r?\n\s*- id: dsh-drop-by\s*\r?\n\s*name: dsh-drop-by\s*\r?\n'
  $new = [regex]::Replace($new, $pattern2, "`r`n")
  if ($new -ne $text) {
    [System.IO.File]::WriteAllText($patchPath, $new, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "patch       : 已删除 drop-by 段"
  } else {
    Write-Host "patch       : 没找到 drop-by 段（可能已经删过）"
  }
}

Write-Host ''
Write-Host "卸完了。设置文件还在：$env:USERPROFILE\.dsh\drop-by-config.json"
Write-Host '同上：没有重启任何东西，你自己重启 DSH 之后才算真正下线。'
