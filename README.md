# 0.4 试用版新增：Figma 插件排列

当前增加 figma-plugin 目录，使用真实 Figma 节点进行位置修改，旧属性面板排列不再调用。

优先试用路径：Aside 捕获 → 本地助手 → Figma 客户端中的本地开发插件。官方本地开发插件需要桌面客户端运行，不能承诺导入 manifest 后能在网页版启动。

安装与试用步骤见 figma-plugin/README.md。先导入插件、在客户端目标文件运行、开启接收并隐藏，再把浏览器目标设置为客户端。客户端接收间隔在插件内设置，默认500。

网页 iframe 连接代码已提供，但属于实验性通路，需要在插件可于网页运行时再验证。未连接会停止粘贴，不退回旧排序。

已通过自动化模拟测试，尚未完成真实 Figma 端到端验收。停止插件接收可在 Figma 关闭正在运行的插件。

---

# Web → Figma 本地助手版 0.2

当前浏览器扩展的网页版粘贴已改为调用本地助手，使用 Windows SendInput 发送 Ctrl+V。捕获和系统剪贴板格式保持原有流程。自动排列暂时停用。

## 当前状态

- 助手已编译；Native Messaging ping、报文长度、未知命令拒绝、64 位输入结构检查通过。
- 浏览器脚本语法、图片资源接口格式测试通过。
- 注册需要明确批准，目前被自动审批阻止，尚未完成注册。
- Aside 连接和真实连续导入尚未通过验收。Aside 对 Native Messaging 注册位置的兼容性也待连接检测确认。

## 使用

1. 完成当前用户的助手注册。根目录“安装本地助手.cmd”针对当前扩展 ID：kibgoidckblnppejfjpjmiobcodkiajo。不同扩展 ID 使用 native-host/install.ps1 的 ExtensionId 参数。
2. 加载 extension 文件夹；已加载的扩展应用更新。
3. 在扩展设置点击“检测本地助手连接”，确认显示 0.2.0。
4. 绑定已打开的 Figma 网页设计文件。
5. 点击来源网页 F↗。来源页刷新、滚动加载、捕获并核对剪贴板，切换 Figma，聚焦画布键盘入口，然后调用系统粘贴。
6. 网页版等待新增图层再确认成功；超时不自动重复粘贴。客户端模式仍只能确认系统按键已发送。

程序由浏览器按任务启动，无 Electron、无常驻窗口。当前构建依赖 .NET 10 运行时（本机已有），不是可在任意电脑直接使用的独立安装包。

## 注册范围

注册主机 com.webfigma.helper，manifest 位于 native-host/com.webfigma.helper.json；仅允许当前扩展 ID。程序路径为 native-host/bin/Release/net10.0-windows/publish/WebFigmaHelper.exe。

注册脚本仅写入当前用户 HKCU 下以下浏览器 NativeMessagingHosts/com.webfigma.helper 项：Google/Chrome、Microsoft/Edge、Aside、Aside/Aside。Aside 路径兼容性尚待实测，未确认的路径不代表浏览器必然支持。

助手只支持 ping、Figma 客户端粘贴、浏览器 Figma 窗口粘贴，不提供任意命令执行。窗口不唯一、未在前台、修饰键正在按下时拒绝发送；SendInput 返回值也进行检查。

## 复用来源

extension/vendor/capture.js 复用用户提供的竞品/Figma 1.3.27.crx 中 js/h2d_toolbar.js，保留采集、编码及剪贴板输出，替换工具栏入口并增加数据验证。原包解压在 research/competitors。未找到覆盖整体捕获代码的明确开源许可，当前仅为本地研究验证产物，尚未确认分发许可。

## 检查命令

- dotnet publish native-host/WebFigmaHelper.csproj -c Release --no-self-contained
- node tests/asset-recovery.mjs
- node --check extension/background.js
