# 圣光会论坛部署

论坛页面位于 `/forum`。访客可阅读；受邀成员可发帖、回复、修改或撤回自己的内容，并可举报；管理员可生成一次性邀请码、关闭或移除主题、移除回复、处理举报。论坛数据保存在 Cloudflare D1，不使用浏览器本地存储保存帖子。

## Cloudflare Pages 正式部署

1. 将整个 `shengguang-tech` 项目更新到 GitHub。Cloudflare Pages 的根目录仍为 `shengguang-tech`，构建命令仍为 `npm run build`，输出目录仍为 `dist`。
2. 在 Cloudflare 控制台创建 D1 数据库，建议名称 `shengguang-forum`。在该数据库的 SQL 控制台执行 [db/schema.sql](db/schema.sql) 的全部内容。
3. 在 **Workers & Pages → 你的 Pages 项目 → Settings → Bindings** 添加 D1 绑定，变量名准确填写 `FORUM_DB`，选择刚创建的数据库。预览环境如需测试，也要单独配置对应绑定。
4. 在 Pages 项目的变量和机密设置中创建机密 `FORUM_BOOTSTRAP_KEY`，值使用至少 24 位的随机字符串；生产环境与预览环境分别配置。不要放进 GitHub 或以 `VITE_` 开头。
5. 重新部署 Pages 项目，使 D1 绑定和机密生效。访问 `https://你的域名/forum`，点击“初始化”，用密钥和至少 12 位密码创建首位管理员。
6. 登录管理员后，在“管理”里生成一次性邀请码并交给成员。邀请码 7 天有效，仅可使用一次。

## 已上线论坛升级

现有 D1 数据库执行过旧版 `db/schema.sql` 时，推送新版网页前必须先升级表结构；重新执行 `CREATE TABLE IF NOT EXISTS` 不会增加旧表字段。

1. 先在 Cloudflare D1 控制台导出当前数据库备份。
2. 在生产数据库的 SQL 控制台执行 [db/migrations/001_forum_controls.sql](db/migrations/001_forum_controls.sql)，只执行一次。它会给旧成员回填公开昵称，并给主题增加置顶状态；不会删除帖子或举报。
3. 分别运行 `PRAGMA table_info(forum_members);` 和 `PRAGMA table_info(forum_topics);`，确认出现 `display_name` 和 `is_pinned`。迁移执行到一半报错时，先检查这两项及三个新索引，只补执行缺失的语句，不要从头重复运行 `ALTER TABLE`。
4. 再推送新版项目到 GitHub，等待 Cloudflare Pages 自动部署完成。

管理员可同时置顶最多 3 条可见主题。昵称可修改且不可与其他成员重复，登录时仍填写原登录名。成功登录、注册或管理员生成邀请码时，系统会清理过期邀请码、会话和限流记录；已使用的邀请码注册成功后也会删除。帖子和举报记录不会被自动永久删除。

## 公式输入

发帖和回复时可选中 LaTeX 源码，点击“∑ 行内”或“∑ 独立”插入公式标记，并点击“预览”检查排版。也支持直接输入 `\(E=mc^2\)`、`\[\int_0^1 x^2\,dx\]`，以及 `$...$`、`$$...$$`。正文始终以原始文本保存到 D1；公式无法解析时会显示原文，方便继续编辑。AxMath 导出的 LaTeX 可直接粘贴到公式标记内。

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
如果本地已有旧版 D1 数据库，先运行一次 `pnpm run db:local:migrate`，不要对旧库重复运行新的建表脚本。

## 运营注意

- 初始化密钥只用于创建第一位管理员。创建完成后，建议从 Pages 项目中删除 `FORUM_BOOTSTRAP_KEY`。
- 请定期在 D1 控制台导出备份，并指定实际负责审核举报的管理员。
- 论坛支持纯文本与 LaTeX 公式排版，不支持上传图片、邮件找回密码或公开自由注册。丢失密码需要管理员通过数据库处理；开放公众注册之前应先接入成熟的邮件认证服务。
