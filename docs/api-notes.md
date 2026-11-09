# 汽水接口笔记（实测 / 待验证）

> 最后更新：2026-11-09。仅记录字段与调用方式，不保存任何凭据。

## 1. 登录

### 1.1 取二维码（已实测 200）

```
GET https://api.qishui.com/passport/web/get_qrcode/
  ?passport_jssdk_version=2.4.13
  &passport_jssdk_type=normal
  &is_from_ttaccountsdk=1
  &aid=386088
  &next=https://api.qishui.com
```

返回：

```json
{"message":"success","data":{
  "token":"...","qrcode":"data:image/png;base64,...",
  "expire_time":1794179829,"qrcode_index_url":"https://bff-pc.qishui.com/...",
  "error_code":0,"description":"","web_name":"..."
}}
```

### 1.2 轮询（待真实扫码验证）

```
POST https://api.qishui.com/passport/web/check_qrconnect/
  ?passport_jssdk_version=2.4.13&passport_jssdk_type=normal&is_from_ttaccountsdk=1
  &aid=386088&iid=<随机或设备 iid>
content-type: application/x-www-form-urlencoded

need_logo=false&need_short_url=false&is_frontier=true&token=<token>&is_new_login=1&next=https://api.qishui.com
```

- `data.status`：`new` → `scanned` → `confirmed`
- `sessionid` 优先取 `Set-Cookie`；兜底 `data.sessionid` 或 `data.redirect_url` 的 query。
- 建议轮询 2s，二维码过期（`expire_time`）后自动刷新。

### 1.3 验证登录

```
GET https://api.qishui.com/luna/pc/me?aid=386088&...
```

- 成功：`my_info`（昵称/头像/uid）
- 失效：`status_code = 1000016`，`status_msg = 登录状态已失效，请重新登录`

## 2. 曲目

### 2.1 track_v2（已实测，需要签名）

```
POST https://api.qishui.com/luna/pc/track_v2?<query>
content-type: application/json; charset=utf-8
cookie: sessionid=<sid>
user-agent: LunaPC/3.5.1(30050100)
X-Helios / X-Medusa  ← bdms.generateHttpSignatureHeaders(url, headersStr)

{"track_id":"...","media_type":"track","queue_type":"search_one_track","scene_name":"search"}
```

- 签名 URL / 头必须与实际发送完全一致；一次一签。
- 失效态仍可能返回 200 + 试听数据，**必须**用 `video_duration` 与 `track.duration` 比对。
- `track.bit_rates`：数组，含 quality = medium/higher/highest/lossless/spatial/hi_res。
- `track.label_info.only_vip_playable / quality_map`：判断账号权限，用于 UI 提示。
- `track_player.video_model` 是 JSON 字符串，需二次 parse；`video_list[].encrypt_info.spade_a` 是解密密钥来源。

### 2.2 搜索（待验证）

```
GET https://api.qishui.com/luna/pc/search/track?q=...&cursor=0&...   （需要签名）
```

## 3. 歌单（待登录后验证字段）

```
GET https://api.qishui.com/luna/pc/me/playlist?aid=386088&iid=...&version_code=30050100
GET https://api.qishui.com/luna/pc/me/collection/mixed?aid=386088
GET https://api.qishui.com/luna/pc/playlist/detail?aid=386088&playlist_id=...&cursor=&count=15
GET https://api.qishui.com/luna/pc/me/collection/artist?aid=386088
```

- 文档记录：`/luna/pc/me/playlist` 需要签名；优先用签名器请求，失败再回退 cookie-only。
- 返回字段参考 PopDownloader：`playlists[] { id, title, count_tracks, owner }`、`media_resources[]`、`has_more / next_cursor`。

## 4. 音频容器

- FLAC：`stsd` 内 `dfLa`；`stsz` 样本大小；`senc` 每样本 8 字节 IV；`mdat` 样本数据。
- 输出：`"fLaC" + dfLa[4:] + 所有解密样本`。
- AAC：`enca` + `esds`；待验证解密后能否按 ADTS 组装并交给 ffmpeg。

## 5. 错误对照

| 现象 | 原因 |
|---|---|
| track_v2 200 + 空 body | 签名缺失/失效，或 device_id 与签名器不一致 |
| 只有 30s / 60s | 账号无完整播放权限，或登录态失效（仍可能返回数据） |
| 只有 AAC | 该曲目无 FLAC 变体 |
| senc 数量 ≠ stsz | MP4 结构假设错误 |
| key 非 32 位 hex | spade_a 取错（应为 variant.encrypt_info.spade_a） |
