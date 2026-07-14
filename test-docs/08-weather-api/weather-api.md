# WeatherSense 天气数据 REST API v2.3 参考手册

> **API 版本**：v2.3  
> **基础 URL**：`https://api.weathersense.io/v2.3`  
> **协议**：HTTPS only  
> **内容类型**：`application/json; charset=utf-8`  
> **当前状态**：GA（General Availability）  

---

## 1. 认证方式

所有 API 请求必须包含有效的 API Key。

### 1.1 请求头认证

```http
GET /v2.3/weather/current?lat=39.9042&lon=116.4074 HTTP/1.1
Host: api.weathersense.io
X-API-Key: wsk_live_3f8a9b2c1d4e5f6a7b8c9d0e1f2a3b4c
Accept: application/json
```

### 1.2 错误响应码

| HTTP 状态码 | 错误码 | 说明 |
|------------|--------|------|
| 401 | `invalid_api_key` | API Key 无效或已过期 |
| 403 | `quota_exceeded` | 超出请求配额 |
| 429 | `rate_limited` | 请求频率超限 |

---

## 2. 核心接口

### 2.1 实时天气

**端点**：`GET /weather/current`

**请求参数**：

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| `lat` | float | ✅ | 纬度（-90 到 90） | `39.9042` |
| `lon` | float | ✅ | 经度（-180 到 180） | `116.4074` |
| `units` | string | ❌ | 单位制（默认 `metric`） | `metric` / `imperial` |
| `lang` | string | ❌ | 语言（默认 `en`） | `zh-CN` / `en` / `ja` |

**响应示例**：

```json
{
  "status": "ok",
  "data": {
    "location": {
      "city": "北京",
      "country": "CN",
      "lat": 39.9042,
      "lon": 116.4074,
      "timezone": "Asia/Shanghai"
    },
    "current": {
      "timestamp": "2026-07-13T09:30:00+08:00",
      "temperature": {
        "value": 32.5,
        "feels_like": 36.2,
        "unit": "°C"
      },
      "humidity": 68,
      "pressure": 1008,
      "wind": {
        "speed": 3.6,
        "direction": 180,
        "gust": 7.2,
        "unit": "m/s"
      },
      "visibility": 8000,
      "uv_index": 6.5,
      "weather": {
        "code": 800,
        "main": "Clear",
        "description": "晴天",
        "icon": "01d"
      },
      "aqi": {
        "value": 72,
        "level": "良",
        "primary_pollutant": "PM2.5"
      }
    }
  },
  "meta": {
    "request_id": "req_a1b2c3d4e5f6",
    "response_time_ms": 142
  }
}
```

### 2.2 天气预报

**端点**：`GET /weather/forecast`

**请求参数**：

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| `lat` | float | ✅ | 纬度 | — |
| `lon` | float | ✅ | 经度 | — |
| `days` | integer | ❌ | 预报天数（1-16） | `7` |
| `hourly` | boolean | ❌ | 是否包含逐小时数据 | `false` |
| `alerts` | boolean | ❌ | 是否包含天气预警 | `true` |

**响应示例（简化）**：

```json
{
  "status": "ok",
  "data": {
    "forecast": [
      {
        "date": "2026-07-14",
        "sunrise": "04:56",
        "sunset": "19:42",
        "temp": { "min": 24.0, "max": 33.0 },
        "weather": { "code": 801, "main": "Clouds", "description": "少云" },
        "precipitation_probability": 15,
        "humidity": 55
      },
      {
        "date": "2026-07-15",
        "temp": { "min": 22.5, "max": 28.0 },
        "weather": { "code": 500, "main": "Rain", "description": "小雨" },
        "precipitation_probability": 80,
        "precipitation_amount": 12.5
      }
    ],
    "alerts": [
      {
        "type": "heat_wave",
        "severity": "yellow",
        "title": "高温黄色预警",
        "description": "预计未来三天最高气温将超过35°C",
        "effective_from": "2026-07-13T08:00:00+08:00",
        "effective_to": "2026-07-16T20:00:00+08:00"
      }
    ]
  },
  "meta": {
    "request_id": "req_f1e2d3c4b5a6",
    "response_time_ms": 198
  }
}
```

### 2.3 历史天气

**端点**：`GET /weather/history`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `lat` | float | ✅ | 纬度 |
| `lon` | float | ✅ | 经度 |
| `date` | string | ✅ | 日期（YYYY-MM-DD） |
| `fields` | string | ❌ | 返回字段（逗号分隔） |

---

## 3. 高级特性

### 3.1 地理编码

**端点**：`GET /geo/search`

```json
// GET /geo/search?q=上海&limit=3
{
  "data": [
    {
      "name": "上海",
      "lat": 31.2304,
      "lon": 121.4737,
      "country": "CN",
      "admin1": "上海市",
      "type": "city"
    }
  ]
}
```

### 3.2 批量查询

**端点**：`POST /weather/bulk`

```json
// POST /weather/bulk
{
  "locations": [
    {"id": "beijing", "lat": 39.9042, "lon": 116.4074},
    {"id": "shanghai", "lat": 31.2304, "lon": 121.4737},
    {"id": "shenzhen", "lat": 22.5431, "lon": 114.0579}
  ],
  "fields": ["temperature", "humidity", "weather"]
}
```

*单次批量最多支持 **50 个**地点。*

---

## 4. 速率限制

| 套餐 | 每分钟请求数 | 每天请求数 | 批量查询折算 |
|------|-------------|-----------|-------------|
| Free | 30 | 1,000 | 1 次 = 1 个地点 |
| Starter | 300 | 50,000 | 1 次 = 最多 10 个地点 |
| Pro | 1,200 | 500,000 | 1 次 = 最多 50 个地点 |
| Enterprise | 自定义 | 自定义 | 自定义 |

---

## 5. SDK 示例

### 5.1 Python SDK

```python
from weathersense import WeatherSenseClient

client = WeatherSenseClient(api_key="wsk_live_YOUR_API_KEY")

# 获取实时天气
current = client.weather.current(lat=39.9042, lon=116.4074, lang="zh-CN")
print(f"{current.location.city}: {current.temperature.value}°C, {current.weather.description}")

# 获取 7 天预报
forecast = client.weather.forecast(lat=31.2304, lon=121.4737, days=7, hourly=True)
for day in forecast.days:
    print(f"{day.date}: {day.weather.main}, {day.temp.min}~{day.temp.max}°C")
```

### 5.2 JavaScript SDK

```javascript
import { WeatherSense } from 'weathersense-js';

const ws = new WeatherSense({ apiKey: 'wsk_live_YOUR_API_KEY' });

// 异步获取天气预警
const { alerts } = await ws.weather.forecast({
  lat: 22.5431,
  lon: 114.0579,
  alerts: true,
});

alerts.forEach((alert) => {
  console.warn(`[${alert.severity.toUpperCase()}] ${alert.title}`);
});
```

---

## 6. 变更日志

| 版本 | 发布日 | 变更内容 |
|------|--------|----------|
| v2.3 | 2026-06-01 | 新增 AQI 字段和地理编码接口 |
| v2.2 | 2026-03-15 | 批量查询从 20 个扩展到 50 个地点 |
| v2.1 | 2025-12-01 | 新增逐小时预报和天气预警字段 |
| v2.0 | 2025-08-20 | 重构认证机制，弃用 query param 方式的 API Key |

---

## 7. 联系与支持

- 📧 技术支持：support@weathersense.io
- 📖 开发者社区：https://community.weathersense.io
- 🐛 Bug 报告：https://github.com/weathersense/api/issues

---

*WeatherSense API 致力于提供准确、可靠的气象数据服务。*
