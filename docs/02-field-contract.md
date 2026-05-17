# 字段口径

推荐字段：

| 字段 | 说明 |
|---|---|
| `state` | 州或大区 |
| `district` | 城市、区或目标列表页名称 |
| `city` | 详情页解析出的城市 |
| `industry` | 页面公开展示的行业或分类 |
| `company_name` | 公司名称 |
| `email` | FirmenABC 页面公开展示的邮箱 |
| `address` | 页面公开展示的地址 |
| `phone` | 电话 |
| `website` | 公司官网 |
| `source_url` | FirmenABC 详情页 URL |
| `scraped_at` | 采集时间 |
| `status` | `ok`、`no_email`、`parse_failed`、`request_failed` |
| `note` | 字段缺失或异常说明 |

## 状态规则

- `ok`：识别到公司名称和邮箱。
- `no_email`：识别到公司名称，页面公开区没有邮箱。
- `parse_failed`：详情页打开了，但公司名称等核心字段解析失败。
- `request_failed`：详情页请求失败、超时或被限制。

## 邮箱规则

邮箱只取 FirmenABC 详情页公开展示内容。页面没有公开邮箱时，保留企业记录，`email` 留空。

## 去重规则

优先使用：

1. `source_url`
2. `company_name + address`
3. `company_name + email`

同一家公司出现在多个地区时，交付前要保留来源地区信息。

