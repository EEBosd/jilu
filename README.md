# 一起走过

手机优先的多人出游记录网页。任何持有完整分享链接的人都可以浏览、新建、编辑和删除记录，无需账号。照片、视频和记录 JSON 均保存在 `EEBosd/jilu` GitHub 仓库中。

## 组成

- `docs/`：GitHub Pages 静态网页，固定地址为 `https://eebosd.github.io/jilu/`。
- `worker/`：Cloudflare Worker API。它验证分享链接中的凭证，保管 GitHub 写入密钥，并读写仓库文件。
- `data/trips.json`：出游记录。照片通过与 PicGo GitHub 图床相同的仓库、分支和目录方式上传；视频保存在同仓库的 GitHub Release 附件中。

PicGo 桌面程序无需在访问者电脑上运行。网站后台直接连接其 GitHub 存储目标；如果你的 PicGo 配置使用其他目录，请修改 `worker/wrangler.toml` 的 `PICGO_PATH`。

## 部署

1. 用对 `EEBosd/jilu` 有写入权限的 GitHub 账号推送本仓库至 `main`。在仓库 Settings → Pages 中将 Source 设为 **GitHub Actions**；网站工作流会部署 `docs/`。
2. 在 Cloudflare 创建 Worker，进入 `worker/` 执行 `npm install`、`npx wrangler login`。
3. 创建一个仅授权此仓库 **Contents: Read and write** 的 GitHub fine-grained token。在 `worker/` 执行 `npx wrangler secret put GITHUB_TOKEN`，按隐藏输入提示粘贴。不要把 token 写进文件或聊天。
4. 生成至少 32 个随机字符的分享凭证，在 `worker/` 执行 `npx wrangler secret put SHARE_TOKEN` 并通过隐藏输入设置。此凭证不要写入仓库。运行 `npm run deploy`。
5. 将部署返回的 Worker HTTPS 地址填入 `docs/config.js` 的 `window.DM_API_BASE`，提交并推送。最终分享 **`https://eebosd.github.io/jilu/#access=你的分享凭证`**。网址中的 `#access=` 部分必须一并分享；网页不会显示登录页。

GitHub Pages 地址在首次部署前无法实际访问。Cloudflare Worker 地址也需要在创建后才能确定。两者都不需要购买自有域名。

## 本地检查

在 `worker/` 执行 `npm test`。前端是原生 HTML、CSS、JavaScript，无需构建。部署前可运行 `node --check docs/app.js` 和 `node --check worker/src/index.js`。

## 使用限制

- 单张照片最多 20 MB；支持 JPG、PNG、WebP。单个视频最多 50 MB；支持 MP4、MOV。
- 视频优先使用 GitHub Release 地址在线播放；格式或网络不兼容时可点击“下载视频”。无法保证 GitHub 视频在所有浏览器及中国大陆网络下稳定在线播放。
- 当前仓库为公开仓库，GitHub 中的照片、视频及记录 JSON 也可被直接访问。分享凭证只保护网站的读写接口，**不提供媒体隐私**。
- 删除记录会从网页和 `data/trips.json` 移除它；已上传文件及 GitHub 历史仍保留，需要在 GitHub 手动清理。未保存成功的上传也可能留下孤立文件。
- 同一条记录被两人同时编辑时，后保存的一方会收到冲突提示，需刷新后重试。页面每 15 秒同步一次，并在重新切回页面时刷新。
