# Project Status

## 当前版本：StoreSnapper 0.4.21（TikTok 按 ID 勾选待真实验收；1688 product schema 5 待用户/Muse 回归）

- 1688 导出已按 Muse 的采集精简清单收敛：保留 offer_id、source_url、原始标题、完整 gallery/SKU/detail 图片与 image_order、SKU 维度组合/单价/重量、商品级 package、六项属性白名单；shipping_origin 只顺手保留原文。
- 删除供应商、sku_id、销量、库存、常规阶梯价、SKU/pack 明细 join 和对应 warnings。仅当 SKU 全无单价时导出 `price_fallback`。warnings 仅保留图片失败、规格标签无 SKU 图、商品级包裹字段缺失三类。
- SKU 图片仍按第一维度映射标签与路径；image_order schema 2 保留位置顺序、ZIP 路径、MD5、duplicate/duplicate_of 和规格标签。package 长宽高仅在源值一致时汇总；统一 pack 重量可补到每条 SKU，SKU 自有重量优先。
- 1688 采集悬浮窗可选择本机下载或指定本机文件夹。通过 Chrome 文件夹选择器授权目录并记住目录句柄，ZIP 分块写入所选目录；选择 Google Drive for Desktop 同步目录后，由其客户端负责同步。Google OAuth、Drive API 和对应权限已移除。Chrome 撤销写权限时，采集失败页和导出设置均显示恢复入口，继续在扩展设置页请求用户授权。
- 待用户重导并交 Muse 检查：`1098266654765`（单维度）、`591770681285`（多 SKU）、`783937409751`（多型号手机壳）。真实扩展重载和 ZIP 回归尚未完成，不视为验收通过。

## 其他模块状态

- Muse 批量图搜：合并版菜单、文件选择、模拟拖放和 ZIP 下载已做本机检查；真实 1688 批量搜图仍待用户验收。旧独立版已由用户反馈前 20 条跑通。
- TikTok Seller Center：主采集和分页状态按本机实现保留。新增独立的按 ID 勾选模式，可读取在售商品 ID 索引并复用、导入 XLSX/CSV、下载文本列 XLSX 模板、每轮最多勾选当前页 30 件；只操作勾选框。登录页面的索引分页、复用、勾选保持及批量操作前核对仍待真实验收。

## 本轮验证与下一步

- TikTok 按 ID 勾选代码和界面已加入；JavaScript 语法、manifest JSON 与差异检查通过。当前浏览器访问商品管理页转到登录页，无法进行登录态实测，功能标为待验。
- 下一步：在真实登录页面先用一件商品验证索引、同一行勾选和滚动后保持，再尝试少量清单；若首个链路失败，优先定位，不继续扩大批量。1688 文件夹权限恢复与三商品 Muse 回归仍待用户验收。
