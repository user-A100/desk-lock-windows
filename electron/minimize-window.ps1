param(
    [Parameter(Mandatory = $true)]
    [long]$Handle
)

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class DeskLockWindowControl {
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

Add-Type -TypeDefinition $signature
$window = [IntPtr]::new($Handle)
if ([DeskLockWindowControl]::IsWindow($window)) {
    [void][DeskLockWindowControl]::ShowWindowAsync($window, 6)
}
