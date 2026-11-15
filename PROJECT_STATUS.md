# Project Status

## 当前版本：StoreSnapper 0.4.19（1688 product schema 5，待用户/Muse 回归）

- 1688 导出已按 Muse 的采集精简清单收敛：保留 offer_id、source_url、原始标题、完整 gallery/SKU/detail 图片与 image_order、SKU 维度组合/单价/重量、商品级 package、六项属性白名单；shipping_origin 只顺手保留原文。
- 删除供应商、sku_id、销量、库存、常规阶梯价、SKU/pack 明细 join 和对应 warnings。仅当 SKU 全无单价时导出 `price_fallback`。warnings 仅保留图片失败、规格标签无 SKU 图、商品级包裹字段缺失三类。
- SKU 图片仍按第一维度映射标签与路径；image_order schema 2 保留位置顺序、ZIP 路径、MD5、duplicate/duplicate_of 和规格标签。package 长宽高仅在源值一致时汇总；统一 pack 重量可补到每条 SKU，SKU 自有重量优先。
- 1688 采集悬浮窗可选择本机下载或指定本机文件夹。通过 Chrome 文件夹选择器授权目录并记住目录句柄，ZIP 分块写入所选目录；选择 Google Drive for Desktop 同步目录后，由其客户端负责同步。Google OAuth、Drive API 和对应权限已移除；浏览器重启后的权限恢复由设置页提供。
- 待用户重导并交 Muse 检查：`1098266654765`（单维度）、`591770681285`（多 SKU）、`783937409751`（多型号手机壳）。真实扩展重载和 ZIP 回归尚未完成，不视为验收通过。

## 其他模块状态

- Muse 批量图搜：合并版菜单、文件选择、模拟拖放和 ZIP 下载已做本机检查；真实 1688 批量搜图仍待用户验收。旧独立版已由用户反馈前 20 条跑通。
- TikTok Seller Center：主采集和分页状态按本机实现保留；真实页面操作仍待验收。

## 本轮验证与下一步

- 已将 1688 专用导出改为本机文件夹选择与直写；其他导出模式保持原路径。README 已更新使用说明。
- 已通过修改文件的 JavaScript 语法检查、manifest JSON 解析和 `git diff --check`；未运行自动测试，尚未在 Chrome 实际选择目录、写入 ZIP 或验收 Google Drive for Desktop 同步。
- 下一步：完成静态检查后，用户重载扩展、选择 `StoreSnapper 待处理` 本机同步目录并导出一个 ZIP 验收；三商品 Muse 回归仍待重导。
