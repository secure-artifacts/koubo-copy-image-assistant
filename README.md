# 口播文案图片助手

浏览器端的英文口播文案质检 + 图片匹配工具。纯前端运行，不依赖任何后端服务。

AI API Key 由用户在界面中自行填写，保存在浏览器本地（localStorage），不会发送到除对应 AI 服务商以外的任何地方。

## 功能概览

### 文案质检

将中英文对照文案粘贴到输入框，AI 逐条检查英文文案的拼写、大小写、标点和格式问题，输出修正结果并高亮标注差异（绿色 = 新增/修改，红色删除线 = 删除/替换前）。

支持的质检维度（可单独开关）：

| 维度 | 说明 |
|------|------|
| 拼写检查 | 纠正明显拼写错误，保留口语缩写、圣经版本引用、英美拼写差异 |
| 大小写 | 纠正句首大小写和神学专有名词，智能判断代词指代对象（上帝/人） |
| 标点符号 | 补全缺失句末标点、修复引号配对，保留口语强调标点 |
| 序号格式 | 清理序号段落中的多余空格和换行 |
| 自定义规则 | 用户自行编写额外的检查规则 |

**特色**：质检规则针对基督教口播文案场景做了大量特化 —— 圣经经文引用不改、敬拜短句不补全、代词大写按指代对象判断。

### 图片匹配

质检完成后，从本地文件夹加载 Avatar 图片库，将图片拖入对应文案的配图槽位完成 1:1 匹配。匹配状态持久化在浏览器 IndexedDB 中，刷新页面不丢失。

- 图片不够时允许一图多用，缩略图右上角显示引用次数
- 支持从配图槽位直接拖拽到 Heygen 等第三方网站的上传区，等价于从本地文件夹拖入
- 支持批量拖拽：勾选多条文案后，从任一槽位拖出即携带所有已勾选的配图

### 导出打包

质检和配图完成后，一键导出 ZIP 包，包含所有配图文件和文案 TSV，可直接用于后续视频制作流程。

## 支持的输入格式

**内联格式**（序号 + 中文 + 英文，空格分隔）：
```
1. 感谢主 Thank the Lord
2. 阿门 Amen
```

**TSV 格式**（Tab 分隔，支持多行引号字段）：
```
1	"中文文案"	"English text"
2	"另一条"	"Another one"
```

## AI 引擎配置

在界面左侧边栏「AI 引擎配置」中选择引擎并填入 API Key：

| 引擎 | 说明 |
|------|------|
| **Gemini** | 浏览器直连 Google Generative Language API，默认模型 gemini-2.5-flash |
| **OpenRouter** | 浏览器直连 OpenRouter API，可选择免费多模态模型 |
| **Meta AI** | 浏览器直连 Meta AI API |

所有 API 调用均从浏览器直接发出，不经过任何中间服务器。

## 快速开始

### 在线使用

从 [Releases](https://github.com/secure-artifacts/koubo-copy-image-assistant/releases) 下载最新的 ZIP 包解压，或使用 `build:standalone` 构建的单文件 HTML，双击用 Chrome 打开即可运行。

### 本地开发

**前置要求**：Node.js 20+

```bash
npm install
npm run dev
```

启动后访问 `http://localhost:3000`。无需配置环境变量；AI 功能需要在界面中填入 API Key，留空则仅做排版分段。

### 构建

```bash
npm run build            # 多文件产物 → dist/
npm run build:standalone # 单文件 HTML → dist-standalone/index.html
```

`build:standalone` 产出的单个 HTML 文件可直接用浏览器双击打开运行，无需部署服务器，Windows / Mac 通用。

## 技术栈

- **前端框架**：React 19 + TypeScript
- **样式**：Tailwind CSS 4
- **构建工具**：Vite 6
- **图标**：Lucide React
- **动画**：Motion (Framer Motion)
- **打包**：JSZip（导出 ZIP）/ vite-plugin-singlefile（单文件构建）

## 浏览器兼容性

- **推荐**：Chrome / Edge（Chromium 内核）
- 图片库功能依赖 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)，仅 Chromium 内核浏览器支持
- Safari / Firefox 可使用质检功能，但图片库不可用

## 隐私说明

- 所有数据（API Key、文案内容、匹配状态）均存储在浏览器本地（localStorage / IndexedDB）
- API 调用仅发往用户选择的 AI 服务商（Google / OpenRouter / Meta），不经过任何第三方服务器
- 本工具不收集、不上传、不存储任何用户数据

## License

Apache-2.0
