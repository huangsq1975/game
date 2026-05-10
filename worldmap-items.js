'use strict';

/**
 * WorldMapItems — 世界地圖球體物品配置與放置
 *
 * 規則摘要（詳見 docs/worldmap-items-rules.md）：
 *   1. 只放在陸地格（Perlin 高度 ≥ 0.50），海洋格不放
 *   2. 成對放置；每個物品在 neighborRadius 步內恰好有 1 個同類
 *   3. 第一個放置點排除南北極（|y| ≥ POLAR_EXCLUDE）
 *   4. 最後一對的第一點為第一對第一點的球體對面（antipodal）最近陸地格
 *   5. 每對放置後禁止雙方 radius 格範圍，防止外部干擾
 */

const LAND_THRESHOLD = 0.50;   // Perlin 高度 ≥ 此值視為陸地
const POLAR_EXCLUDE  = 0.85;   // |y| ≥ 此值視為南北極，第一點排除

class WorldMapItems {

    constructor(cellCentroids, cellAdj, cellCoords, terrainSeed) {
        this._centroids   = cellCentroids;   // Float32Array[][]  球面格子中心
        this._adj         = cellAdj;          // number[][]        格子鄰接表
        this._cellCoords  = cellCoords;       // {x,y,cen}[]       格子坐標（BFS ring/pos）
        this._terrainSeed = terrainSeed;      // number            Perlin 種子
        this._perm        = null;             // Uint8Array(512)   快取置換表
        this._items       = [];               // 放置結果列表
        this.capturedVis  = new Set();        // 已占領放置點的 vi 集合
        this._fogDist     = null;             // Int16Array：每個 vi 到最近占領點的 BFS 距離
    }

    /* ── 多源 BFS：計算每格到最近占領點的距離 ──────── */
    recomputeFog() {
        const n    = this._centroids.length;
        const dist = new Int16Array(n).fill(-1);
        const queue = [];
        for (const vi of this.capturedVis) { dist[vi] = 0; queue.push(vi); }
        let head = 0;
        while (head < queue.length) {
            const cur = queue[head++], d = dist[cur];
            for (const nb of this._adj[cur]) {
                if (dist[nb] < 0) { dist[nb] = d + 1; queue.push(nb); }
            }
        }
        this._fogDist = dist;
    }

    /* ── 取格子迷霧透明度 ────────────────────────────
     *  d ≤ 2 : 0.00（清晰）
     *  d = 3 : 0.35（輕半透明）
     *  d = 4 : 0.65（中半透明）
     *  d = 5 : 0.88（重半透明，近迷霧）
     *  d ≥ 6 : 1.00（完全迷霧，不可點擊）
     */
    getFogAlpha(vi) {
        if (!this._fogDist) return 0.0;  // 尚未載入：不阻擋點擊、不遮霧
        const d = this._fogDist[vi];
        if (d < 0) return 1.0;           // 完全未到達：全霧
        if (d <= 2) return 0.0;          // 占領核心：清晰
        if (d >= 6) return 1.0;          // 遠端：完全迷霧
        return [0.35, 0.65, 0.88][d - 3];
    }

    /* ── Perlin 置換表（與 _drawEarth 同種子）─────────── */
    _buildPerm() {
        if (this._perm) return this._perm;
        let _s = this._terrainSeed >>> 0 || 1;
        const rng = () => {
            _s ^= _s << 13; _s ^= _s >> 17; _s ^= _s << 5;
            return (_s >>> 0) / 0x100000000;
        };
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const t = p[i]; p[i] = p[j]; p[j] = t;
        }
        const pm = new Uint8Array(512);
        for (let i = 0; i < 512; i++) pm[i] = p[i & 255];
        return (this._perm = pm);
    }

    /* ── Perlin 3D fbm 高度（與 _drawEarth 完全一致）──── */
    /* 注意 Y 軸翻轉：_drawEarth 的 py=0（頂端）對應 lat=-π/2（南緯），
     * 但球體 UV 的 v=0 是北極（y=+1），因此查詢時 Y 需取反以匹配視覺。 */
    _terrainHeight(sx, sy, sz) {
        const perm = this._buildPerm();
        const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
        const lerp  = (a, b, t) => a + t * (b - a);
        const G = [
            [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
            [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
            [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
            [1,1,0],[-1,1,0],[0,-1,1],[0,-1,-1]
        ];
        const n3 = (x, y, z) => {
            const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, zi = Math.floor(z) & 255;
            const xf = x - Math.floor(x), yf = y - Math.floor(y), zf = z - Math.floor(z);
            const u  = fade(xf), v = fade(yf), w = fade(zf);
            const A  = perm[xi]+yi, AA = perm[A]+zi, AB = perm[A+1]+zi;
            const B  = perm[xi+1]+yi, BA = perm[B]+zi, BB = perm[B+1]+zi;
            const dot = (i, dx, dy, dz) => { const g = G[perm[i] % 16]; return g[0]*dx + g[1]*dy + g[2]*dz; };
            return lerp(
                lerp(lerp(dot(AA,  xf,   yf,   zf),   dot(BA,  xf-1, yf,   zf),   u),
                     lerp(dot(AB,  xf,   yf-1, zf),   dot(BB,  xf-1, yf-1, zf),   u), v),
                lerp(lerp(dot(AA+1,xf,   yf,   zf-1), dot(BA+1,xf-1, yf,   zf-1), u),
                     lerp(dot(AB+1,xf,   yf-1, zf-1), dot(BB+1,xf-1, yf-1, zf-1), u), v),
                w);
        };
        const fbm = (x, y, z, oct) => {
            let v = 0, a = 0.5, f = 1, mx = 0;
            for (let i = 0; i < oct; i++) { v += n3(x*f, y*f, z*f)*a; mx += a; a *= 0.5; f *= 2; }
            return v / mx;
        };
        /* Y 取反，修正紋理 Y 軸翻轉問題 */
        return Math.max(0, Math.min(1, fbm(sx*2.2, -sy*2.2, sz*2.2, 7) * 1.4 + 0.5));
    }

    /* ── 判斷格子是否為陸地 ───────────────────────────── */
    _isLand(vi) {
        const [sx, sy, sz] = this._centroids[vi];
        return this._terrainHeight(sx, sy, sz) >= LAND_THRESHOLD;
    }

    /* ── BFS：取 vi 出發半徑 r 以內所有格子集合 ─────── */
    _bfsSet(vi, r) {
        const s = new Set([vi]);
        const q = [[vi, 0]]; let h = 0;
        while (h < q.length) {
            const [cur, d] = q[h++];
            if (d < r) for (const nb of this._adj[cur]) {
                if (!s.has(nb)) { s.add(nb); q.push([nb, d + 1]); }
            }
        }
        return s;
    }

    /* ── 找最近陸地格（最大球面點積 = 最短弧長）────────── */
    _nearestLand(cx, cy, cz, exclude) {
        let best = -Infinity, bestVi = -1;
        for (let vi = 0; vi < this._centroids.length; vi++) {
            if (exclude && exclude.has(vi)) continue;
            if (!this._isLand(vi)) continue;
            const [x, y, z] = this._centroids[vi];
            const dot = x*cx + y*cy + z*cz;
            if (dot > best) { best = dot; bestVi = vi; }
        }
        return bestVi;
    }

    /* ── 異步讀取配置並放置物品 ─────────────────────── */
    async load() {
        let cfg;
        try { cfg = await fetch('config/worldmap_items.json').then(r => r.json()); }
        catch (e) { console.warn('[WorldMapItems] 讀取配置失敗', e); return; }

        const result = [];
        if (!this._centroids || !this._adj) return;

        for (const itemDef of (cfg.items || [])) {

            /* 載入共用圖集圖片（所有 tile 共用同一張 atlas）*/
            const img = new Image();
            await new Promise(res => { img.onload = res; img.onerror = res; img.src = itemDef.atlasImage; });
            const frame    = itemDef.atlasFrame   || { x:0, y:0, w:64, h:56 };
            const dw       = (itemDef.displaySize || {}).w || 24;
            const dh       = (itemDef.displaySize || {}).h || 21;
            const radius   = itemDef.neighborRadius ?? 3;
            const maxPairs = itemDef.maxPairs || 8;

            /* override 允許替換特定點的圖示（tile/atlasFrame/displaySize）*/
            const mkItem = (vi, override) => {
                const ov    = override || {};
                const fr    = ov.atlasFrame  || frame;
                const odw   = (ov.displaySize || {}).w || dw;
                const odh   = (ov.displaySize || {}).h || dh;
                const tile  = ov.tile || itemDef.tile;
                return { vi, tile, cen: this._centroids[vi], img, frame: fr, dw: odw, dh: odh };
            };

            /* 建立 (x,y) → vi 查找表 */
            const coordToVi = new Map();
            for (let vi = 0; vi < this._centroids.length; vi++) {
                const c = this._cellCoords && this._cellCoords[vi];
                if (c) coordToVi.set(`${c.x},${c.y}`, vi);
            }

            /* 從 override 定義取固定 vi（若設有 cell.x/y）*/
            const resolveVi = ov => {
                if (!ov || !ov.cell) return -1;
                return coordToVi.get(`${ov.cell.x},${ov.cell.y}`) ?? -1;
            };
            const viFirst = resolveVi(itemDef.firstTile);
            const viLast  = resolveVi(itemDef.lastTile);

            /* 篩選陸地格（排除海洋）*/
            const landSet = new Set();
            for (let vi = 0; vi < this._centroids.length; vi++) {
                if (this._isLand(vi)) landSet.add(vi);
            }

            /* 固定種子打亂順序（保證每次結果一致）*/
            const landArr = [...landSet];
            let _rs = 0xdeadbeef >>> 0;
            const rs = () => { _rs ^= _rs<<13; _rs ^= _rs>>17; _rs ^= _rs<<5; return (_rs>>>0)/0x100000000; };
            for (let i = landArr.length - 1; i > 0; i--) {
                const j = Math.floor(rs() * (i + 1));
                [landArr[i], landArr[j]] = [landArr[j], landArr[i]];
            }

            /* 在 vi 的 radius 步內找未禁止的陸地格 */
            const findCandidates = (vi, forbidden) => {
                const cands = [];
                const qc = [[vi, 0]]; const vc = new Set([vi]); let hc = 0;
                while (hc < qc.length) {
                    const [cur, d] = qc[hc++];
                    if (d > 0 && landSet.has(cur) && !forbidden.has(cur)) cands.push(cur);
                    if (d < radius) for (const nb of this._adj[cur]) {
                        if (!vc.has(nb)) { vc.add(nb); qc.push([nb, d+1]); }
                    }
                }
                return cands;
            };

            /* 放置一對，並封鎖雙方 radius 範圍；ovA/ovB 為圖示 override */
            const forbidden = new Set();
            const placePair = (viA, viB, ovA, ovB) => {
                result.push(mkItem(viA, ovA), mkItem(viB, ovB));
                for (const anchor of [viA, viB]) {
                    for (const nb of this._bfsSet(anchor, radius)) forbidden.add(nb);
                }
            };

            /* ── 第一點：固定坐標 (firstTile.cell) ──────── */
            if (viFirst !== -1) {
                const cands = findCandidates(viFirst, forbidden);
                const viB = cands.length > 0 ? cands[Math.floor(rs() * cands.length)] : -1;
                if (viB !== -1) placePair(viFirst, viB, itemDef.firstTile, undefined);
                else { result.push(mkItem(viFirst, itemDef.firstTile)); for (const nb of this._bfsSet(viFirst, radius)) forbidden.add(nb); }
            }

            /* ── 中間各對：成對放置 ─────────────────────── */
            let pairCount = (viFirst !== -1) ? 1 : 0;
            for (const viA of landArr) {
                if (forbidden.has(viA)) continue;
                if (pairCount >= maxPairs - (viLast !== -1 ? 1 : 0)) break;
                const cands = findCandidates(viA, forbidden);
                if (cands.length === 0) continue;
                const viB = cands[Math.floor(rs() * cands.length)];
                placePair(viA, viB, undefined, undefined);
                pairCount++;
            }

            /* ── 最後一點：固定坐標 (lastTile.cell) ─────── */
            if (viLast !== -1 && !forbidden.has(viLast)) {
                const cands = findCandidates(viLast, forbidden);
                const viB = cands.length > 0 ? cands[Math.floor(rs() * cands.length)] : -1;
                if (viB !== -1) placePair(viLast, viB, itemDef.lastTile, undefined);
                else result.push(mkItem(viLast, itemDef.lastTile));
            } else if (viLast !== -1) {
                /* 若已被禁止，仍強制放置（覆蓋禁止）*/
                result.push(mkItem(viLast, itemDef.lastTile));
            }
        }

        this._items = result;
        /* 記錄第一個放置點的球面坐標，供 WorldMap 初始旋轉使用 */
        this.firstItemCen = result.length > 0 ? result[0].cen : null;
        /* 第一放置點默認占領，計算初始迷霧 */
        if (result.length > 0) {
            this.capturedVis.add(result[0].vi);
            this.recomputeFog();
        }
        /* 通知 WorldMap 更新坐標顯示（load 為非同步，可能晚於 show）*/
        if (typeof this.onLoaded === 'function') this.onLoaded();
    }

    /* ── 在 2D overlay 上繪製物品圖示 ───────────────── */
    draw(ctx, W, H, mvp, R) {
        if (!this._items.length) return;
        for (const item of this._items) {
            const [cx, cy, cz] = item.cen;
            /* 背面剔除（格子在球體背後不繪）*/
            const rz = R[2]*cx + R[6]*cy + R[10]*cz;
            if (rz < 0.12) continue;
            /* 投影到螢幕坐標 */
            const vx  = mvp[0]*cx + mvp[4]*cy + mvp[8]*cz  + mvp[12];
            const vy  = mvp[1]*cx + mvp[5]*cy + mvp[9]*cz  + mvp[13];
            const vw  = mvp[3]*cx + mvp[7]*cy + mvp[11]*cz + mvp[15];
            if (vw <= 0) continue;
            const sx = ( vx/vw * 0.5 + 0.5) * W;
            const sy = (-vy/vw * 0.5 + 0.5) * H;
            /* 依深度縮放 */
            const scale = Math.max(0.5, Math.min(1, rz));
            const dw = item.dw * scale, dh = item.dh * scale;
            const f  = item.frame;
            if (item.img && item.img.complete && item.img.naturalWidth > 0) {
                ctx.drawImage(item.img, f.x, f.y, f.w, f.h, sx - dw/2, sy - dh/2, dw, dh);
            } else {
                /* 圖片未就緒時的備用標記 */
                ctx.beginPath(); ctx.arc(sx, sy, 4*scale, 0, Math.PI*2);
                ctx.fillStyle = 'rgba(255,120,40,0.85)'; ctx.fill();
                ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 1; ctx.stroke();
            }
        }
    }

    get items() { return this._items; }
}
