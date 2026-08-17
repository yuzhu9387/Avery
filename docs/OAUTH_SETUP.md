# 让 Google / Lark 登录和日历连接活过来

账户体系已经完整可用(邮箱密码注册/登录)。Google / Lark 按钮是完整的授权流,但需要
你各注册一个应用拿到凭据 —— 这一步只有你能做。没配之前,按钮会显示"未配置"和原因,
不影响其它任何功能。

## 环境变量

写进 `Avery/backend/.env`(pydantic-settings 会读),然后重启后端:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
LARK_APP_ID=cli_...
LARK_APP_SECRET=...
# 前端地址,回调最终跳回这里;本地开发保持默认即可
OAUTH_REDIRECT_BASE=http://localhost:5173
```

## Google(登录 + 以后的 Calendar)

1. https://console.cloud.google.com/ → 新建项目(或用现有的)。
2. **APIs & Services → OAuth consent screen**:External,填应用名,把你自己的
   Google 账号加进 Test users(不发布的话只有 test users 能登录,个人用足够)。
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs 加一条:
     `http://localhost:5173/api/auth/oauth/google/callback`
     (回调打到前端源,Vite 的 `/api` 代理转给后端 —— 所以 URI 用 5173,不是 8001。)
4. 拿到的 Client ID / Client secret 填进 `.env`。
5. 以后做日历同步时,同一个项目里再启用 **Google Calendar API** 即可,凭据不用换。

## Lark / 飞书

1. https://open.feishu.cn/ (国际版 https://open.larksuite.com/) → 开发者后台 →
   创建企业自建应用。
2. **安全设置 → 重定向 URL** 加:
   `http://localhost:5173/api/auth/oauth/lark/callback`
3. **权限管理**:登录需要 `获取用户基本信息`,**以及 `contact:user.email:readonly`
   (获取用户邮箱)**。少了邮箱权限,Lark 不会返回邮箱,每次登录都会掉到"请输入邮箱"
   那一步而无法自动匹配已有账户。以后日历同步再加 Calendar 相关权限。
4. App ID / App Secret 填进 `.env`。

## 配好之后的行为

- 登录页的 "Continue with Google/Lark" 直接跳转授权。
- OAuth 回来时,如果 provider 给了**它自己验证过的邮箱**(Google 总是给;Lark 在授予
  邮箱权限后给),会直接匹配已有账户并登录 —— 不出现任何额外页面,也不用输密码。
- 只有 provider 完全没给邮箱时,才会出现"请输入邮箱"那一步;输入的地址若已有账户就
  并入它,没有就新建。**注意**:这一步不做地址归属校验,单机自用没问题,公开部署前
  必须加上(见 `oauth_link` 里的注释)。
- Account 面板分成 **Sign-in methods**(身份)和 **Calendar**(读写日历权限)两块,
  各自独立连接和断开。

## Google 处于 Testing 状态的两个限制

1. **只有白名单里的账号能授权。** Console → OAuth consent screen → Test users 里
   要把每个要用的 Google 账号都加进去,否则会看到
   `Access blocked: Avery has not completed the Google verification process`
   (Error 403: access_denied)。
2. **refresh token 只有 7 天有效期。** 所以日历连接大约每周会失效一次,需要回到
   Account 重新点一次 Connect。代码会把它当成"未连接"而不是报错,不会有静默的
   错误数据。要摆脱这个限制得转 In production,但日历属于敏感权限,要走 Google 的
   验证审核 —— 个人自用不值当。

## 还没建的部分(下一步)

**写回(Avery → Google)**。读取已经做完:连接后 Google 事件会以只读虚线卡片叠在周
视图上,左侧出现该账户的开关,且这些事件永不入库、不计入任何比例。`calendar.events`
权限已一并申请,所以将来加写回不需要第二次授权页。
