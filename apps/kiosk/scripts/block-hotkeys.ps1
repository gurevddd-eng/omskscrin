# Stella Kiosk - block keyboard input via WH_KEYBOARD_LL (touch-only kiosk).
# Must run in the interactive user session (not Session 0).
# Ctrl+Alt+Del cannot be swallowed by hooks (Secure Attention Sequence).
# Service access: Ctrl+Shift+Esc (Task Manager), Win+R (Run), Win+E (File Explorer).
# Typing allowed in File Explorer / Run / TaskMgr / other service apps — not on desktop/taskbar.
# Stops when ProgramData\StellaKiosk\STOPPED exists or BLOCK_KEYBOARD is 0/false/off.
$ErrorActionPreference = "Stop"

$root = Join-Path $env:ProgramData "StellaKiosk"
$stopFlag = Join-Path $root "STOPPED"
$blockFlag = Join-Path $root "BLOCK_KEYBOARD"
$pidFile = Join-Path $root "KEYBLOCK.pid"

function Write-KeyblockPid {
  try {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII -Force
  } catch {}
}

function Clear-KeyblockPid {
  try {
    if (Test-Path -LiteralPath $pidFile) {
      $cur = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
      if (-not $cur -or $cur -eq [string]$PID) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

Write-KeyblockPid

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

function Clear-TaskMgrPolicy {
  $paths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
  )
  foreach ($p in $paths) {
    try {
      if (Test-Path $p) {
        Remove-ItemProperty -Path $p -Name "DisableTaskMgr" -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}

if (-not (Should-Run)) {
  Clear-TaskMgrPolicy
  Clear-KeyblockPid
  Write-Output "keyblock skipped"
  exit 0
}

Clear-TaskMgrPolicy

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

  private const uint VK_SHIFT = 0x10;
  private const uint VK_CONTROL = 0x11;
  private const uint VK_ESCAPE = 0x1B;
  private const uint VK_LWIN = 0x5B;
  private const uint VK_RWIN = 0x5C;
  private const uint VK_E = 0x45;
  private const uint VK_R = 0x52;
  private const uint VK_LSHIFT = 0xA0;
  private const uint VK_RSHIFT = 0xA1;
  private const uint VK_LCONTROL = 0xA2;
  private const uint VK_RCONTROL = 0xA3;

  private static IntPtr _hook = IntPtr.Zero;
  private static LowLevelKeyboardProc _proc = HookCallback;
  private static uint _threadId;
  private static bool _ctrlDown;
  private static bool _shiftDown;
  private static bool _winDown;

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

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  private static bool KeepRunning(string stopFlag, string blockFlag) {
    try {
      if (File.Exists(stopFlag)) return false;
      if (!File.Exists(blockFlag)) return true;
      string v = File.ReadAllText(blockFlag).Trim().ToLowerInvariant();
      if (v == "0" || v == "false" || v == "off") return false;
    } catch {}
    return true;
  }

  private static bool IsCtrlShift(uint vk) {
    return vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL
        || vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT;
  }

  private static bool IsWin(uint vk) {
    return vk == VK_LWIN || vk == VK_RWIN;
  }

  private static void UpdateModifiers(uint vk, bool down) {
    if (vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL) _ctrlDown = down;
    if (vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT) _shiftDown = down;
    if (vk == VK_LWIN || vk == VK_RWIN) _winDown = down;
  }

  // Allow keyboard outside Stella Edge (full Explorer / Run / TaskMgr / tools).
  private static bool ForegroundAllowsKeyboard() {
    try {
      IntPtr hwnd = GetForegroundWindow();
      if (hwnd == IntPtr.Zero) return false;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid == 0) return false;
      using (Process p = Process.GetProcessById((int)pid)) {
        string name = (p.ProcessName || "").ToLowerInvariant();
        if (name == "msedge" || name == "msedgewebview2" || name == "chrome") return false;
        return true;
      }
    } catch {
      return false;
    }
  }

  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      int msg = wParam.ToInt32();
      if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN || msg == WM_KEYUP || msg == WM_SYSKEYUP) {
        KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        bool down = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
        UpdateModifiers(info.vkCode, down);

        if (ForegroundAllowsKeyboard()) {
          return CallNextHookEx(_hook, nCode, wParam, lParam);
        }

        if (IsCtrlShift(info.vkCode) || IsWin(info.vkCode)) {
          return CallNextHookEx(_hook, nCode, wParam, lParam);
        }
        if (info.vkCode == VK_ESCAPE && _ctrlDown && _shiftDown) {
          return CallNextHookEx(_hook, nCode, wParam, lParam);
        }
        if (info.vkCode == VK_R && _winDown) {
          return CallNextHookEx(_hook, nCode, wParam, lParam);
        }
        if (info.vkCode == VK_E && _winDown) {
          return CallNextHookEx(_hook, nCode, wParam, lParam);
        }
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

Write-Output "keyblock starting (allow Ctrl+Shift+Esc, Win+R, Win+E)"
try {
  [StellaHotkeyBlock]::Run($stopFlag, $blockFlag)
} finally {
  Clear-TaskMgrPolicy
  Clear-KeyblockPid
  Write-Output "keyblock stopped"
}
