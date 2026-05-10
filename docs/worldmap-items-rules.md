# 世界地圖球體物品放置規則

## 概述

球體上的物品（如 Barringer Crater）由 `worldmap-items.js` 的 `WorldMapItems` 類負責配置與放置，規則由 `config/worldmap_items.json` 驅動。

---

## 配置檔欄位（`config/worldmap_items.json`）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `tile` | string | Tilesets atlas 中的 frame key |
| `atlasImage` | string | 圖集圖片路徑（UITexture/Tilesets.png）|
| `atlasFrame` | object | 圖集中的 `{x, y, w, h}` 像素位置 |
| `landOnly` | boolean | 只放在陸地（目前固定 true）|
| `neighborRadius` | number | 鄰居搜尋半徑（格子步數，預設 3）|
| `maxPairs` | number | 最多放置的「對」數，每對 2 個（預設 8）|
| `displaySize` | object | 在 overlay canvas 上的繪製大小 `{w, h}`（px）|

---

## 放置規則

### 規則 1：陸地限制（海洋不放）

- 物品只放在**陸地格**：Perlin 3D fbm 高度 ≥ `LAND_THRESHOLD = 0.50`
- 海洋格（高度 < 0.50）、海岸格一律排除
- 高度計算與球體紋理 `_drawEarth` 完全一致：
  - 使用相同的 `terrainSeed`（來自 `GC.worldMap.terrainSeed`）
  - 使用相同的 Perlin 3D fbm（7 倍頻，係數 2.2）
  - **Y 軸翻轉**：`_drawEarth` 的紋理頂端（py=0）對應 Perlin 南緯（lat=−π/2），
    而球體 UV 的 v=0 是北極（sphere y=+1），因此查詢時對 Y 取反（`-sy`）以匹配視覺

### 規則 2：成對放置與鄰居約束

- 物品以「**對**」為單位放置：每對包含格子 A 與格子 B
- A 與 B 必須在彼此的 `neighborRadius` 步（BFS）之內
- 每對放置完畢後，A 和 B 各自的 `neighborRadius` 格範圍全部標記為**禁止**
- 結果：每個放置物在 `neighborRadius` 步內恰好有 **1 個**同類鄰居（成對關係）
- 外部不會有第三個物品進入任何已放置物品的搜尋範圍，保證鄰居數恆為 1

### 規則 3：第一個放置點排除南北極

- 極區判定：格子中心的球面 Y 座標 `|y| ≥ POLAR_EXCLUDE = 0.85`
- 第一對的 A 點（即整批次的第一個放置物）必須在緯度安全區（|y| < 0.85）
- 後續各對無此限制

### 規則 4：最後一對放在第一點的球體對面（Antipodal）

- 記錄第一對的 A 點坐標 `(ax, ay, az)`
- 計算其球體對面：`(-ax, -ay, -az)`
- 在所有未禁止的陸地格中，找**球面距離最近**（點積最大）的格子作為最後一對的 A 點
- 最後一對仍遵守鄰居約束（在 radius 步內找搭檔 B）
- 若對面找不到搭檔，退化為單放一個點（仍置於列表最末）

### 規則 5：放置順序

```
第 1 對   → A1（非極區、陸地）+ B1（A1 的 radius 步內陸地格）
第 2 對   → A2 + B2
  ⋮
第 N-1 對 → A(N-1) + B(N-1)
第 N 對   → antipodal(A1) + 其搭檔
```

最多 `maxPairs` 對，放置順序即 `items` 陣列順序。

---

## 座標系說明

- 球體中心 `(0, 0, 0)`，半徑 `1`（單位球）
- `y = +1`：北極；`y = −1`：南極
- `y = 0`：赤道平面
- 格子坐標來自截斷二十面體（Goldberg polyhedron）頂點，經 BFS 分配 `(ring, position)` 坐標

---

## 檔案對應

| 檔案 | 用途 |
|------|------|
| `worldmap-items.js` | `WorldMapItems` 類，負責載入、放置、繪製 |
| `config/worldmap_items.json` | 物品定義與放置參數 |
| `docs/worldmap-items-rules.md` | 本文件，放置規則說明 |
| `index.html` → `WorldMap` | 在 `_initGL` 後建立 `WorldMapItems` 實例並呼叫 `load()` |
