param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath
)

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class DeskLockWindowActivation {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachState);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);

    public static bool ForceActivate(IntPtr target) {
        IntPtr foreground = GetForegroundWindow();
        uint foregroundThread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
        uint targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
        bool attached = false;
        try {
            if (foregroundThread != 0 && targetThread != 0 && foregroundThread != targetThread) {
                attached = AttachThreadInput(foregroundThread, targetThread, true);
            }
            ShowWindowAsync(target, 9);
            BringWindowToTop(target);
            SetForegroundWindow(target);
            SetFocus(target);
            SwitchToThisWindow(target, true);
        } finally {
            if (attached) AttachThreadInput(foregroundThread, targetThread, false);
        }
        System.Threading.Thread.Sleep(180);
        return GetForegroundWindow() == target;
    }
}
"@

Add-Type -TypeDefinition $signature
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $resolvedTarget = [IO.Path]::GetFullPath($TargetPath)
    if (-not (Test-Path -LiteralPath $resolvedTarget)) {
        throw "找不到应用文件。"
    }

    $running = Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
            if ($_.MainWindowHandle -eq 0) { return $false }
            try { [IO.Path]::GetFullPath($_.Path) -ieq $resolvedTarget } catch { $false }
        } |
        Select-Object -First 1

    if ($running) {
        $activated = [DeskLockWindowActivation]::ForceActivate($running.MainWindowHandle)
        if (-not $activated) {
            try {
                [void](New-Object -ComObject WScript.Shell).AppActivate([int]$running.Id)
                Start-Sleep -Milliseconds 180
                $activated = [DeskLockWindowActivation]::GetForegroundWindow() -eq $running.MainWindowHandle
            } catch { $activated = $false }
        }
        if ($activated) {
            [pscustomobject]@{ opened = $true; activated = $true; launched = $false; pid = [int]$running.Id } | ConvertTo-Json -Compress
            exit 0
        }

        $started = Start-Process -FilePath $resolvedTarget -PassThru
        [pscustomobject]@{ opened = $true; activated = $false; launched = $true; pid = [int]$started.Id; fallback = "new-window" } | ConvertTo-Json -Compress
        exit 0
    }

    $started = Start-Process -FilePath $resolvedTarget -PassThru
    [pscustomobject]@{ opened = $true; activated = $false; launched = $true; pid = [int]$started.Id } | ConvertTo-Json -Compress
} catch {
    [pscustomobject]@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
