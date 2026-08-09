param(
    [ValidateSet("running", "installed")]
    [string]$Kind = "running"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$items = @()

if ($Kind -eq "running") {
    $items = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        ForEach-Object {
            $processPath = ""
            try { $processPath = $_.Path } catch { $processPath = "" }
            if ($processPath -and (Test-Path -LiteralPath $processPath)) {
                $productName = ""
                try { $productName = $_.MainModule.FileVersionInfo.ProductName } catch { $productName = "" }
                [pscustomobject]@{
                    name = if ($productName) { $productName } else { $_.ProcessName }
                    path = $processPath
                    pid = [int]$_.Id
                    running = $true
                }
            }
        } |
        Sort-Object path -Unique
} else {
    $shortcutShell = New-Object -ComObject WScript.Shell
    $programRoots = @(
        [Environment]::GetFolderPath("Programs"),
        [Environment]::GetFolderPath("CommonPrograms")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $items = Get-ChildItem -LiteralPath $programRoots -Filter *.lnk -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object {
            try {
                $shortcut = $shortcutShell.CreateShortcut($_.FullName)
                $target = [Environment]::ExpandEnvironmentVariables($shortcut.TargetPath)
                if ($target -and [IO.Path]::GetExtension($target) -ieq ".exe" -and (Test-Path -LiteralPath $target) -and $_.BaseName -notmatch "^(Uninstall|卸载)") {
                    [pscustomobject]@{
                        name = $_.BaseName
                        path = $target
                        running = $false
                    }
                }
            } catch {
                # Broken shortcuts are ignored.
            }
        } |
        Sort-Object path -Unique
}

@($items) | ConvertTo-Json -Compress
