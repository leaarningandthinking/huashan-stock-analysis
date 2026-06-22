# Changelog

## Unreleased

- Removed the Cloud SaaS and Aliyun-specific deployment skeleton; commercial deployment is maintained separately.
- Bundled the `huashan-lungu-v2` runtime skill so a fresh clone can load all 16 master profiles without external symlinks.
- Added standalone short-term analysis for A 股 technical review, including task history, share links, Markdown/PDF export, recent stock shortcuts, and K-line support/resistance charting.
- Added GitHub-ready project documentation and templates.
- Separated Next.js dev and production build outputs with `.next-dev` and `.next-build`.
- Added SSE progress polling fallback for long-running diagnosis tasks.
- Improved Hong Kong and US stock fundamentals handling with yfinance data.
