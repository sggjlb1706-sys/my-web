# 圣光会论坛部署

论坛页面位于 `/forum`。访客可阅读；受邀成员可发帖、回复、修改或撤回自己的内容，并可举报；管理员可生成一次性邀请码、关闭或移除主题、移除回复、处理举报。论坛数据保存在 Cloudflare D1，不使用浏览器本地存储保存帖子。

## Cloudflare Pages 正式部署

1. 将整个 `shengguang-tech` 项目更新到 GitHub。Cloudflare Pages 的根目录仍为 `shengguang-tech`，构建命令仍为 `npm run build`，输出目录仍为 `dist`。
2. 在 Cloudflare 控制台创建 D1 数据库，建议名称 `shengguang-forum`。在该数据库的 SQL 控制台执行 [db/schema.sql](db/schema.sql) 的全部内容。
3. 在 **Workers & Pages → 你的 Pages 项目 → Settings → Bindings** 添加 D1 绑定，变量名准确填写 `FORUM_DB`，选择刚创建的数据库。预览环境如需测试，也要单独配置对应绑定。
4. 在 Pages 项目的变量和机密设置中创建机密 `FORUM_BOOTSTRAP_KEY`，值使用至少 24 位的随机字符串；生产环境与预览环境分别配置。不要放进 GitHub 或以 `VITE_` 开头。
5. 重新部署 Pages 项目，使 D1 绑定和机密生效。访问 `https://你的域名/forum`，点击“初始化”，用密钥和至少 12 位密码创建首位管理员。
6. 登录管理员后，在“管理”里生成一次性邀请码并交给成员。邀请码 7 天有效，仅可使用一次。

数据库未绑定或未执行建表脚本时，论坛会显示错误。首页仍可正常访问。

## 本地验证

使用 Node.js 20 或更新版本安装依赖。复制 `.dev.vars.example` 为 `.dev.vars`，换成随机的本地初始化密钥；再复制 `wrangler.local.jsonc` 为 `wrangler.jsonc`。这两个本地文件都已被 Git 忽略，不会影响 Cloudflare 上使用的真实 D1 绑定。

```sh
pnpm install
cp .dev.vars.example .dev.vars
cp wrangler.local.jsonc wrangler.jsonc
pnpm run db:local:init
pnpm run dev:forum
```

Wrangler 本地论坛默认在 `http://127.0.0.1:8788/forum`。本地数据与 Cloudflare 生产数据库完全分开。运行 `pnpm test` 可检查账号、发帖和审核权限。
Windows 也可以在完成上面的初始化后双击 `start-forum.cmd` 启动完整论坛；原来的 `start-site.cmd` 只启动静态页面，不运行论坛 API。

## 运营注意

- 初始化密钥只用于创建第一位管理员。创建完成后，建议从 Pages 项目中删除 `FORUM_BOOTSTRAP_KEY`。
- 请定期在 D1 控制台导出备份，并指定实际负责审核举报的管理员。
- 论坛目前只支持纯文本，不支持上传图片、邮件找回密码或公开自由注册。丢失密码需要管理员通过数据库处理；开放公众注册之前应先接入成熟的邮件认证服务。
