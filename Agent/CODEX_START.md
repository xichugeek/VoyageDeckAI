# 直接发给 Codex 的启动指令

请在 Windows 项目目录 `D:\Project\Web\VoyageDeckAI` 开展开发。

1. 先完整阅读 `Agent/Development_Spec.md`，将其作为本期唯一主需求；同时查看 `Agent/Reference/reference-ui.png`，这是核心视觉参考（只用于本地开发，不可推送 GitHub）。
2. 核查现有目录和 Git 状态。仓库应为 `https://github.com/xichugeek/VoyageDeckAI.git`。保护已有文件，不可用清空目录的方式初始化；先确保 `.gitignore` 排除参考图、密钥、数据库及日志。
3. 按规格书 M0 到 M5 依次实施。优先把“高级暗黑科幻指挥台”做到能截图演示，然后构建真正可交互的六智能体工作流和可靠的数据来源。
4. 可以自主完成本地编码、依赖安装、编译、测试和安全的 Git 提交。每阶段提供修改文件、运行命令、测试结果、实际截图和剩余风险，不允许仅报告“完成”。
5. 不得擅自修改 VPS、Forge、WordPress、已有反代和任何生产项目；没有用户明确授权不要部署到 `voyagedeck.demo.xichugeek.com`。所有真实电商/广告/支付副作用一律禁止，所有模拟数据必须明确标识。
6. 开源仓库不能存 API Key、凭据、生产日志或第三方参考截图。不提供有效 AI Key 时使用 Mock Provider，不允许把模拟执行称为真实推理。
7. 遇到非关键问题自主选择合理实现并记录，避免不断停下来反问。现在先完成环境核验和 M0，然后继续推进 M1。
