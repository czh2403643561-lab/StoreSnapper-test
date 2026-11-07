# StoreSnapper · Muse 批量图搜（待真实验收）

这是与原版分开的 Chrome Manifest V3 扩展。原版仍在仓库 `extension/`；Muse 版可安装目录是本目录下的 `extension/`。Muse 云端不需要访问本机浏览器或 1688 账号，只接收用户导出的结果文件。

## 安装和前 20 条验收

1. 在 Chrome 扩展管理页启用开发者模式，选择“加载已解压的扩展程序”，选中 `muse-edition/extension/`。它的名称是“StoreSnapper · Muse 批量图搜”，不向 Temu/1688 商品页注入放大镜，可与原版同时安装。
2. 在同一个浏览器打开 1688 并由用户本人登录。点击 Muse 版工具栏图标，打开批量图搜页。
3. 导入用户提供的 `sample-first20-sanitized.csv`；页面应显示 20 条。点击“开始／继续”，扩展按 rank 顺序逐条搜图，两条之间默认间隔 5 秒，可设为 3–60 秒。
4. 遇到登录失效、滑块或安全验证时，批次暂停。用户本人在 1688 页面处理后，回到批量页点“开始／继续”，重试未完成条目。普通失败也暂停并显示该条原因。关闭或刷新批量页后，已完成记录保留在本机，重新打开可续跑。
5. 20 条全部完成后导出 CSV、JSON 和缩略图 HTML，核对字段、原图及候选图链接；通过后再导入全量 200 条。请把这三种文件上传给 Muse，由 Muse 进行相似度和品牌/IP 筛选。

导入支持 `.csv` 和 `.xlsx`（第一个工作表），必需表头为 `rank`、`product_name`（也接受 `title`）、`image`。当前图片域名只授权 `*.tiktokcdn-eu.com`；其他域名会在导入时明确报错。导入新文件会替换当前批次，请先导出旧结果。

## 导出约定

CSV/JSON 一行一个候选，保留 1688 接口返回的原始顺序，最多 5 个；不做相似度、品牌/IP、地区或库存预筛选。字段为：

`source_rank, source_title, source_image_url, candidate_no, candidate_image_url, candidate_1688_url, candidate_title, candidate_price_cny, candidate_moq, candidate_sales, supplier_name, supplier_city, similar_total, status`

没有候选时保留一行，`status=无`、`similar_total=0`、候选字段留空；其他缺失字段填“未提供”，不推测供应商城市。`similar_total` 是本次 1688 搜图接口实际返回的候选条数，不声称是平台所有货源总数。HTML 用原始 HTTPS 图片 URL 展示缩略图，图片链接能否由 Muse 云端打开需在前 20 条验收时核对。

本版只搜集和导出，不自动收藏或下单。批次数据保存在扩展本地存储。现有搜图链路使用用户本机的 1688 登录态，令牌只用于当前请求签名，不写入日志或批次存储；图片和带登录态的请求发往 1688，不把 Cookie、令牌或密码发给 Muse 或开发者服务器。

## 当前检查与限制

- 已用提供的 CSV 验证 20 条导入，三个 TikTok 图片主机的抽样链接从本机网络返回 `200 image/jpeg`；这不等于扩展内搜图或 Muse 云端读图已成功。
- 已用同样 20 条生成 XLSX 并检查导入，CSV/JSON/HTML 导出规则及项目自动检查通过。
- **尚未在用户已登录的 1688 浏览器中跑前 20 条，也未核对真实候选图链接。** 此版是待验收版本；全量 200 条应在前 20 条通过后再跑。

## 来源

搜图后台与结果解析从本仓库原版 `extension/background.js`、`extension/core.mjs` 独立复制并按批量场景调整。XLSX 解压使用 [fflate 0.8.3](https://www.npmjs.com/package/fflate)；其 MIT 许可见 `extension/vendor/fflate-LICENSE.txt`。
