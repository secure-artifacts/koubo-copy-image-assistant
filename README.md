# 口播文案图片助手

浏览器端的英文口播文案质检 + 图片匹配工具。纯前端运行，不依赖任何后端服务；Gemini/OpenRouter/Meta AI 的 API Key 由用户在界面里自行填写并保存在浏览器本地（localStorage），不会发送到除对应 AI 服务商以外的任何地方。

## 本地开发

**依赖：** Node.js

```bash
npm install
npm run dev
```

无需配置任何环境变量即可运行；AI 质检功能需要在界面里填入自己的 Gemini（或 OpenRouter / Meta AI）API Key，留空则仅做排版分段。

## 构建

```bash
npm run build            # 多文件产物，输出到 dist/
npm run build:standalone # 单文件 HTML，输出到 dist-standalone/index.html
```

`build:standalone` 产出的单个 HTML 文件可以直接用 Chrome 或 Firefox 双击打开运行，无需部署、无需服务器，Windows/Mac 通用。
