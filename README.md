# dsh-reply-card

DeepSeek Harness 插件：把一条回复导出成竖版长图。

## 安装

从市场安装（上架后）：

```bash
dsh plugin --profile <profile> add dsh-reply-card
```

或直接从源码装：

```bash
dsh plugin --profile <profile> add git+https://github.com/Aquarius2323/dsh-reply-card.git
```

国内网络可用 Gitee 镜像：

```bash
dsh plugin --profile <profile> add git+https://gitee.com/Shao_Aquarius/dsh-reply-card.git
```

DSH 桌面端也可以：插件 → 添加插件 → 选择本地目录。

安装后**刷新界面**，会话标题栏右侧出现「分享长图」。

## 使用

会话标题栏点「分享长图」→ 预览 → 复制或下载。

## 长会话

浏览器 canvas 有高度上限（约 16384px），超过后 `toDataURL()` 会返回空数据。
插件会自动把内容切成多页（每页正文 ≤ 8600px），预览里可以翻页、逐页下载或全部下载。

## 实现

纯客户端插件：读取会话事件（`ctx.sessions.using`），用 canvas 排版绘制，落到剪贴板或文件。无网络请求、无数据外传。

## 许可

MIT
