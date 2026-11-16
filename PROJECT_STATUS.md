# Project Status

## 当前版本：StoreSnapper 0.4.20（1688 product schema 5，待用户/Muse 回归）

- 1688 导出已按 Muse 的采集精简清单收敛：保留 offer_id、source_url、原始标题、完整 gallery/SKU/detail 图片与 image_order、SKU 维度组合/单价/重量、商品级 package、六项属性白名单；shipping_origin 只顺手保留原文。
- 删除供应商、sku_id、销量、库存、常规阶梯价、SKU/pack 明细 join 和对应 warnings。仅当 SKU 全无单价时导出 `price_fallback`。warnings 仅保留图片失败、规格标签无 SKU 图、商品级包裹字段缺失三类。
- SKU 图片仍按第一维度映射标签与路径；image_order schema 2 保留位置顺序、ZIP 路径、MD5、duplicate/duplicate_of 和规格标签。package 长宽高仅在源值一致时汇总；统一 pack 重量可补到每条 SKU，SKU 自有重量优先。
- 1688 采集悬浮窗可选择本机下载或指定本机文件夹。通过 Chrome 文件夹选择器授权目录并记住目录句柄，ZIP 分块写入所选目录；选择 Google Drive for Desktop 同步目录后，由其客户端负责同步。Google OAuth、Drive API 和对应权限已移除。Chrome 撤销写权限时，采集失败页和导出设置均显示恢复入口，继续在扩展设置页请求用户授权。
- 待用户重导并交 Muse 检查：`1098266654765`（单维度）、`591770681285`（多 SKU）、`783937409751`（多型号手机壳）。真实扩展重载和 ZIP 回归尚未完成，不视为验收通过。

## 其他模块状态

- Muse 批量图搜：合并版菜单、文件选择、模拟拖放和 ZIP 下载已做本机检查；真实 1688 批量搜图仍待用户验收。旧独立版已由用户反馈前 20 条跑通。
- TikTok Seller Center：主采集和分页状态按本机实现保留；真实页面操作仍待验收。

## 本轮验证与下一步

- 已补充文件夹写权限失效后的明显恢复入口；README 已更新使用说明。
- JavaScript 语法、manifest JSON 和 `git diff --check` 通过；尚未在 Chrome 实际验收权限恢复流程。未运行自动测试。
- 下一步：用户重载扩展后，在报错页点“恢复文件夹写入权限”，于打开的页面点“恢复此文件夹的访问权限”，然后重试保存；确认完整恢复流程后再关闭此缺陷。三商品 Muse 回归仍待重导。
