# Stella Kiosk - block ALL keyboard input via WH_KEYBOARD_LL + disable Task Manager.
# Must run in the interactive user session (not Session 0).
# Ctrl+Alt+Del cannot be swallowed by hooks (Secure Attention Sequence);
# DisableTaskMgr removes Task Manager from that screen and blocks Ctrl+Shift+Esc path.
# Stops when ProgramData\StellaKiosk\STOPPED exists or BLOCK_KEYBOARD is 0/false/off.
$ErrorActionPreference = "Stop"

$root = Join-Path $env:ProgramData "StellaKiosk"
$stopFlag = Join-Path $root "STOPPED"
$blockFlag = Join-Path $root "BLOCK_KEYBOARD"

function Should-Run {
  if (Test-Path -LiteralPath $stopFlag) { return $false }
  if (Test-Path -LiteralPath (Join-Path $root "LOCKDOWN_SUPPRESS")) { return $false }
  if (-not (Test-Path -LiteralPath $blockFlag)) { return $false }
  try {
    $v = (Get-Content -LiteralPath $blockFlag -Raw -ErrorAction Stop).Trim().ToLowerInvariant()
    if ($v -eq "0" -or $v -eq "false" -or $v -eq "off") { return $false }
  } catch {}
  return $true
}

function Set-TaskMgrPolicy([bool]$Disable) {
  $paths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
  )
  foreach ($p in $paths) {
    try {
      if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
      if ($Disable) {
        New-ItemProperty -Path $p -Name "DisableTaskMgr" -Value 1 -PropertyType DWord -Force | Out-Null
      } else {
        Remove-ItemProperty -Path $p -Name "DisableTaskMgr" -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}

if (-not (Should-Run)) {
  Set-TaskMgrPolicy $false
  Write-Output "keyblock skipped"
  exit 0
}

Set-TaskMgrPolicy $true

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class StellaHotkeyBlock {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_KEYUP = 0x0101;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int WM_SYSKEYUP = 0x0105;
  private const uint WM_QUIT = 0x0012;

  private static IntPtr _hook = IntPtr.Zero;
  private static LowLevelKeyboardProc _proc = HookCallback;
  private static uint _threadId;

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  private struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG {
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int pt_x;
    public int pt_y;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);

  [DllImport("user32.dll")]
  private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref MSG lpMsg);

  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage(ref MSG lpMsg);

  [DllImport("user32.dll")]
  private static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();

  private static bool KeepRunning(string stopFlag, string blockFlag) {
    try {
      if (File.Exists(stopFlag)) return false;
      if (!File.Exists(blockFlag)) return true;
      string v = File.ReadAllText(blockFlag).Trim().ToLowerInvariant();
      if (v == "0" || v == "false" || v == "off") return false;
    } catch {}
    return true;
  }

  // Swallow every key — kiosk is touch-only while BLOCK_KEYBOARD is on.
  // Note: Ctrl+Alt+Del is handled by winlogon before this hook and cannot be eaten.
  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      int msg = wParam.ToInt32();
      if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN || msg == WM_KEYUP || msg == WM_SYSKEYUP) {
        return (IntPtr)1;
      }
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }

  public static void Run(string stopFlag, string blockFlag) {
    using (Process cur = Process.GetCurrentProcess())
    using (ProcessModule mod = cur.MainModule) {
      _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(mod.ModuleName), 0);
    }
    if (_hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    _threadId = GetCurrentThreadId();

    Thread watcher = new Thread(() => {
      while (KeepRunning(stopFlag, blockFlag)) Thread.Sleep(800);
      if (_threadId != 0) PostThreadMessage(_threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    });
    watcher.IsBackground = true;
    watcher.Start();

    try {
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
        TranslateMessage(ref msg);
        DispatchMessage(ref msg);
      }
    } finally {
      if (_hook != IntPtr.Zero) {
        UnhookWindowsHookEx(_hook);
        _hook = IntPtr.Zero;
      }
    }
  }
}
"@ -Language CSharp

Write-Output "keyblock starting (all keys)"
try {
  [StellaHotkeyBlock]::Run($stopFlag, $blockFlag)
} finally {
  Set-TaskMgrPolicy $false
  Write-Output "keyblock stopped"
}
