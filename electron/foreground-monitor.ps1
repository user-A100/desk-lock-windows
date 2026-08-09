$signature = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class TomatoForeground {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

Add-Type -TypeDefinition $signature
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$lastHandle = [IntPtr]::Zero
$lastSentAt = [DateTime]::MinValue

while ($true) {
    try {
        $handle = [TomatoForeground]::GetForegroundWindow()
        $heartbeatDue = ((Get-Date) - $lastSentAt).TotalMilliseconds -ge 1000
        if ($handle -ne [IntPtr]::Zero -and ($handle -ne $lastHandle -or $heartbeatDue)) {
            $processId = [uint32]0
            [void][TomatoForeground]::GetWindowThreadProcessId($handle, [ref]$processId)
            $titleBuilder = New-Object System.Text.StringBuilder 512
            [void][TomatoForeground]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            $pathValue = ""
            try { $pathValue = $process.Path } catch { $pathValue = "" }
            [pscustomobject]@{
                handle = [long]$handle.ToInt64()
                pid = [int]$processId
                name = if ($process) { $process.ProcessName + ".exe" } else { "" }
                path = $pathValue
                title = $titleBuilder.ToString()
            } | ConvertTo-Json -Compress
            $lastHandle = $handle
            $lastSentAt = Get-Date
        }
    } catch {
        # The monitor is advisory. Access-denied windows are skipped safely.
    }
    Start-Sleep -Milliseconds 350
}
