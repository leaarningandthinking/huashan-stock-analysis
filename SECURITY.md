# Security Policy

## Supported Versions

当前项目处于早期开发阶段，仅维护 `main` 分支。

## Reporting a Vulnerability

请不要在公开 Issue 中提交 API Key、Token、数据库连接串或用户隐私数据。

如发现安全问题，请通过 GitHub Security Advisory 私下报告，或在 Issue 中只描述可复现路径和影响范围，不贴敏感信息。

## Secret Handling

- `.env` 已被 `.gitignore` 排除。
- LLM API Key 保存在浏览器 localStorage，后端不落库。
- 分享报告前请确认报告内容不包含个人账户、真实持仓隐私或密钥。
