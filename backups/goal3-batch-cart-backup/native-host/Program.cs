using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

class Program {
    delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int x,y;public uint mouseData,flags,time;public UIntPtr extra; }
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] input,int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    static INPUT Key(ushort key,bool up=false)=>new INPUT {type=1,data=new INPUTUNION {keyboard=new KEYBDINPUT {key=key,flags=up?2u:0u}}};
    static void Paste() {
        if(new[]{0x10,0x11,0x12,0x5B,0x5C}.Any(k=>(GetAsyncKeyState(k)&0x8000)!=0))throw new Exception("检测到修饰键按下，请松开键盘后重试");
        var keys=new[]{Key(0x11),Key(0x56),Key(0x56,true),Key(0x11,true)};
        if(SendInput(4,keys,Marshal.SizeOf<INPUT>())!=4) {
            SendInput(2,new[]{Key(0x56,true),Key(0x11,true)},Marshal.SizeOf<INPUT>());
            throw new Exception("Windows 未完整接收粘贴按键，错误码："+Marshal.GetLastWin32Error());
        }
    }
    static void Main() {
        using var input=Console.OpenStandardInput(); using var output=Console.OpenStandardOutput();
        while(true) {
            var header=new byte[4]; int first=input.Read(header,0,4); if(first==0)return;
            if(first<4) input.ReadExactly(header.AsSpan(first));
            int length=BitConverter.ToInt32(header); if(length<1 || length>65536)return;
            var bytes=new byte[length];input.ReadExactly(bytes);
            object result;
            try {
                using var doc=JsonDocument.Parse(bytes);
                string? action=doc.RootElement.GetProperty("action").GetString();
                if(action=="ping") { var pong=JsonSerializer.SerializeToUtf8Bytes(new {ok=true,version="0.3.0",inputSize=Marshal.SizeOf<INPUT>()});output.Write(BitConverter.GetBytes(pong.Length));output.Write(pong);output.Flush();continue;}
                if(action=="focusBrowser") {
                    var browserMatches=new List<IntPtr>();
                    EnumWindows((h,p)=>{
                        if(!IsWindowVisible(h))return true;
                        GetWindowThreadProcessId(h,out var pid);
                        try {
                            string process=System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
                            if(new[]{"Aside","chrome","msedge"}.Contains(process,StringComparer.OrdinalIgnoreCase)) {
                                var text=new StringBuilder(1024);GetWindowText(h,text,1024);
                                if(text.Length>0) browserMatches.Add(h);
                            }
                        } catch { }
                        return true;
                    },IntPtr.Zero);
                    if(browserMatches.Count>0) {
                        var bTarget=browserMatches[0];
                        if(!IsIconic(bTarget)) {
                            SetForegroundWindow(bTarget);
                        }
                    }
                    var fbResp=JsonSerializer.SerializeToUtf8Bytes(new {ok=true});
                    output.Write(BitConverter.GetBytes(fbResp.Length));output.Write(fbResp);output.Flush();
                    continue;
                }
                if(action!="paste" && action!="webpaste" && action!="coordinate")throw new Exception("不支持的操作");
                string title=doc.RootElement.GetProperty("title").GetString()??"";
                var matches=new List<IntPtr>();
                EnumWindows((h,p)=>{
                    if(!IsWindowVisible(h))return true;
                    GetWindowThreadProcessId(h,out var pid);
                    try {
                        string process=System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
                        bool allowed=action=="paste" ? process.Equals("Figma",StringComparison.OrdinalIgnoreCase) :
                            new[]{"Aside","chrome","msedge"}.Contains(process,StringComparer.OrdinalIgnoreCase);
                        if(!allowed)return true;
                        var text=new StringBuilder(1024);GetWindowText(h,text,1024);
                        if(text.Length>0 && text.ToString().Contains(title,StringComparison.OrdinalIgnoreCase) &&
                            (action=="paste" || text.ToString().Contains("Figma",StringComparison.OrdinalIgnoreCase))) matches.Add(h);
                    } catch { }
                    return true;
                },IntPtr.Zero);
                if(matches.Count == 0) throw new Exception("未找到目标 Figma 窗口");
                IntPtr target = matches[0];
                if(matches.Count > 1) {
                    long maxArea = -1;
                    foreach(var h in matches) {
                        if(GetWindowRect(h, out RECT wr)) {
                            long area = (long)(wr.Right - wr.Left) * (wr.Bottom - wr.Top);
                            if(area > maxArea) {
                                maxArea = area;
                                target = h;
                            }
                        }
                    }
                }
                if(IsIconic(target)) throw new Exception("目标窗口已最小化，请先打开窗口；助手不会调整窗口状态或大小");
                if(GetForegroundWindow() != target) {
                    uint curThread = GetCurrentThreadId();
                    uint targetThread = GetWindowThreadProcessId(target, out _);
                    AttachThreadInput(curThread, targetThread, true);
                    BringWindowToTop(target);
                    SetForegroundWindow(target);
                    AttachThreadInput(curThread, targetThread, false);
                }
                Thread.Sleep(120);
                if(GetForegroundWindow() != target) {
                    SetForegroundWindow(target);
                    Thread.Sleep(80);
                }
                if(GetForegroundWindow() != target) throw new Exception("目标窗口未获得焦点，已取消粘贴");

                if(action=="coordinate") {
                    string value=doc.RootElement.GetProperty("value").GetString()??"";
                    if(!System.Text.RegularExpressions.Regex.IsMatch(value,@"^-?\d{1,9}(\.\d{1,6})?$"))throw new Exception("无效坐标");
                    var keys=new List<INPUT>{Key(0x11),Key(0x41),Key(0x41,true),Key(0x11,true)};
                    foreach(char c in value){keys.Add(new INPUT{type=1,data=new INPUTUNION{keyboard=new KEYBDINPUT{scan=c,flags=4}}});keys.Add(new INPUT{type=1,data=new INPUTUNION{keyboard=new KEYBDINPUT{scan=c,flags=6}}});}
                    keys.Add(Key(13));keys.Add(Key(13,true));
                    if(SendInput((uint)keys.Count,keys.ToArray(),Marshal.SizeOf<INPUT>())!=keys.Count)throw new Exception("坐标输入未完整发送");
                } else {
                    Paste();
                }
                result=new {ok=true,confirmed=false};
            } catch(Exception e) { result=new {ok=false,error=e.Message}; }
            var response=JsonSerializer.SerializeToUtf8Bytes(result);
            output.Write(BitConverter.GetBytes(response.Length));output.Write(response);output.Flush();
        }
    }
}
