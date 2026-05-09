# 六邊形戰閃電戰

基於瀏覽器的六邊形網格即時戰略遊戲，無需安裝，直接開啟 `index.html` 即可遊玩。

---

## 項目結構

```
game/
├── index.html              # 主入口，遊戲全部邏輯與渲染
├── units.js                # UDEFS 全局聲明（數據由 config/units.json 加載）
├── convert_atlas.py        # 工具：LibGDX .atlas → Free Texture Packer JSON
├── split_tilesets.py       # 工具：依 atlas 把貼圖集拆成單張 PNG
│
├── config/
│   ├── game.json           # 遊戲全局數值配置（帶注釋）
│   ├── units.json          # 兵種屬性配置
│   ├── map.json            # 地圖配置（基地、要塞、路由、地塊）
│   ├── Tilesets.atlas      # LibGDX 原始 atlas 描述文件
│   └── Tilesets.json       # 轉換後的 Free Texture Packer JSON（由 convert_atlas.py 生成）
│
└── UITexture/
    ├── Tilesets.png        # 貼圖集源文件（2048×2048 RGBA8888）
    ├── Plains.png          # 網格邊界裝飾底圖
    ├── UIBack.png          # 底部 UI 面板背景
    └── Tilesets/           # 拆分後的單張地塊 PNG（由 split_tilesets.py 生成）
        └── TileSets/
            ├── HexaRealm/
            │   ├── Tiles/          # 基礎地塊（平原、沙漠、雪地…）
            │   └── Edges/          # 地形過渡邊緣（15 種組合，每種 6 個方向）
            │       ├── Beach-Coast/
            │       ├── Beach-Desert/
            │       ├── Beach-Grassland/
            │       ├── Beach-Mountain/
            │       ├── Beach-Plains/
            │       ├── Beach-Snow/
            │       ├── Beach-Tundra/
            │       ├── Fresh-Desert/
            │       ├── Fresh-Grassland/
            │       ├── Fresh-Lakes/
            │       ├── Fresh-Mountain/
            │       ├── Fresh-Plains/
            │       ├── Fresh-Snow/
            │       ├── Fresh-Tundra/
            │       └── Water-Ocean/
            ├── FantasyHex/         # 幻想風格地塊（334 個 sprite）
            └── Minimal/            # 極簡風格地塊（38 個 sprite）
```

---

## 遊戲玩法

### 目標
占領敵方基地（左上角），或時間結束時擁有更多要塞。

### 基本規則
- 點擊右下角**己方基地**部署選中兵種
- 兵種會沿箭頭路線自動前進
- 點擊 ★**要塞**可切換進攻方向（最近 2 個上方要塞）
- 每局 **5 分鐘**，時間到比較占領要塞數決定勝負

### 兵種克制（石頭剪刀布）

| 兵種 | 克制 | 被克制 | 費用 | HP | 攻擊 |
|------|------|--------|------|----|------|
| 騎兵 | 步兵 | 弓箭手 | 35 | 80 | 18 |
| 弓箭手 | 騎兵 | 步兵 | 25 | 55 | 24 |
| 步兵 | 弓箭手 | 騎兵 | 20 | 120 | 14 |

- 克制時傷害 ×1.6，被克制時傷害 ×0.6，每次附加 -2~+3 隨機浮動

### 金幣系統
- 雙方每秒基礎回收 10 金幣，上限 200
- 每個己方占領的要塞額外 +6/秒
- 玩家每秒自動嘗試出兵一次（金幣不足則跳過）

### 後方流血
單位經過的要塞若被敵方重新占領，每 1.5 秒扣 5 血（每個淪陷要塞各計一次）。

---

## 配置文件說明

### `config/game.json`
遊戲所有數值均從此文件讀取，在 Phaser 初始化前同步加載（XHR）、掛載到全局 `GC`。
以 `"_"` 開頭的鍵為行內注釋，代碼不訪問，不影響邏輯。

| 區塊 | 說明 |
|------|------|
| `canvas` | 畫布寬高（390×780 px） |
| `grid` | 六邊形網格幾何：列數、行數、hex 半徑、偏移量 |
| `economy` | 金幣初始值、上限、回收速率、要塞加成、觸發間隔 |
| `timer` | 對局時長、警示倒計時閾值 |
| `player` | 玩家自動出兵間隔 |
| `ai` | AI 換線間隔、出兵間隔（簡單/普通/困難）、金幣倍率 |
| `combat` | 攻擊間隔、克制倍率、傷害浮動範圍、流血傷害參數 |
| `render` | HP 條尺寸、單位偏移係數、插值參數、迷霧縮進、點擊容差、UI 按鈕尺寸 |

### `config/units.json`
三個兵種的屬性定義。`clr` 為 6 位 hex 字串，`create()` 時轉為整數。

| 字段 | 說明 |
|------|------|
| `name` | 顯示名稱 |
| `ch` | 單字圖示（地圖上渲染） |
| `clr` | 顏色（hex 字串，如 `"FFAA22"`） |
| `beats` / `loses` | 克制 / 被克制的兵種 key |
| `spd` | 移動間隔（ms），越小越快 |
| `atk` | 基礎攻擊力 |
| `hp` | 初始血量 |
| `cost` | 部署費用 |
| `r` | 渲染圓圈半徑（px） |

### `config/map.json`
地圖所有數據，含地塊配置與遊戲邏輯。Phaser `preload()` 異步加載。

| 字段 | 說明 |
|------|------|
| `cols` / `rows` | 遊戲邏輯邊界（7×12） |
| `renderColMin~Max` / `renderRowMin~Max` | 實際渲染範圍，含邊界裝飾格（共 153 個格子） |
| `defaultTile` | 未指定格子使用的默認地塊 key |
| `tiles` | 每個格子的地塊 key（`"c,r": "TileSets/..."` 格式） |
| `enemyBase` / `playerBase` | 敵我基地坐標 |
| `forts` | 11 個要塞坐標列表 |
| `fixedForts` | 不可點擊切換方向的固定要塞（外圍 6 個） |
| `arrowPlayerOverrides` | 覆蓋默認「向上一格」的玩家路由節點 |
| `arrowEnemy` | 敵方完整路由表（左路 / 中路 / 右路三條進攻線） |
| `aiLaneTargets` | AI 換線時路口（3,1）的三個目標坐標 |

---

## 設置選項

點擊右上角 **⚙** 開啟設置面板（自動暫停遊戲）：

| 選項 | 說明 |
|------|------|
| 戰爭迷霧 | 開（默認）/ 關。關閉後敵軍全程可見 |
| AI 難易度 | 簡單（只出步兵，出兵慢，金幣×0.6）/ 普通（默認）/ 困難（精準反制，出兵快，金幣×1.5） |
| 顯示座標 | 開（默認）/ 關。切換格子 `c,r` 坐標標籤可見性 |

---

## 視圖切換

點擊螢幕底部 **🌍 世界地圖** 切換至三維地球視圖，點擊 **⚔ 返回戰鬥** 切回。

### 技術實現（純原生 WebGL，無第三方 3D 庫）

三個渲染通道：

| 通道 | MVP | 混合模式 | 說明 |
|------|-----|----------|------|
| 星空（`gl.POINTS`）| P×V | 加法 | 4000 顆隨機分佈，點大小各異 |
| 球體 | P×V×R | 標準 alpha | 地球貼圖 + Phong 光照 |
| 大氣層 | P×V（不跟隨旋轉）| 加法 | rim glow：邊緣 α 最大，中心透明 |

- **地球貼圖**：Canvas 2D 程序生成（2048×1024），包含海洋漸變、大陸輪廓、沙漠、雲層、冰蓋
- **矩陣數學**：自實現列優先 4×4 矩陣（`_mul` / `_persp` / `_rotX` / `_rotY` / `_trans`）
- **控制**：滑鼠拖拽 / 單指滑動旋轉，滾輪 / 雙指捏合縮放（1.4x~8x），靜止時自動自轉

---

## 工具腳本

### `convert_atlas.py`
將 LibGDX `.atlas` 格式轉換為 Free Texture Packer JSON（JSON Hash 格式）。

```bash
python3 convert_atlas.py config/Tilesets.atlas config/Tilesets.json
# 輸出：1015 個 sprite frame
```

處理細節：
- `rotate: true` 的 sprite，frame w/h 對調，`spriteSourceSize` 相應計算
- trim 偏移從 LibGDX bottom-left 轉為 top-left
- 同名 sprite 加 `_2`、`_3` 後綴去重

### `split_tilesets.py`
依 atlas 描述把 `UITexture/Tilesets.png` 拆分為單張 PNG，保留完整目錄結構。

```bash
# 需要 Pillow
pip install Pillow
python3 split_tilesets.py
# 輸出至 UITexture/Tilesets/，共 1015 張
```

處理細節：
- `rotate: true`：裁出後逆時針旋轉 90° 復原打包前的方向
- 有 trim 的 sprite：貼回原始尺寸透明畫布，保留正確偏移位置
- 同名 sprite 加後綴避免覆蓋

---

## 技術棧

| 組件 | 用途 |
|------|------|
| [Phaser 3.60](https://phaser.io) | 遊戲主框架（場景管理、輸入、Canvas 渲染） |
| 原生 WebGL | 世界地圖三維球體渲染 |
| Canvas 2D API | 地球貼圖程序生成 |
| Python 3 + Pillow | 離線資源處理工具 |

---

## 快速開始

需要本地 HTTP 服務器（瀏覽器安全策略禁止直接從文件系統加載 JSON / 圖片）：

```bash
python3 -m http.server 8080
# 訪問 http://localhost:8080
```
