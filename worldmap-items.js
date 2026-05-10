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

    constructor(cellCentroids, cellAdj, terrainSeed) {
        this._centroids   = cellCentroids;   // Float32Array[][]  球面格子中心
        this._adj         = cellAdj;          // number[][]        格子鄰接表
        this._terrainSeed = terrainSeed;      // number            Perlin 種子
        this._perm        = null;             // Uint8Array(512)   快取置換表
        this._items       = [];               // 放置結果列表
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

            /* 載入圖集圖片 */
            const img = new Image();
            await new Promise(res => { img.onload = res; img.onerror = res; img.src = itemDef.atlasImage; });
            const frame    = itemDef.atlasFrame   || { x:0, y:0, w:64, h:56 };
            const dw       = (itemDef.displaySize || {}).w || 24;
            const dh       = (itemDef.displaySize || {}).h || 21;
            const radius   = itemDef.neighborRadius ?? 3;
            const maxPairs = itemDef.maxPairs || 8;
            const mkItem   = vi => ({ vi, tile:itemDef.tile, cen:this._centroids[vi], img, frame, dw, dh });

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

            /* 放置一對，並封鎖雙方 radius 範圍 */
            const forbidden = new Set();
            const placePair = (viA, viB) => {
                result.push(mkItem(viA), mkItem(viB));
                for (const anchor of [viA, viB]) {
                    for (const nb of this._bfsSet(anchor, radius)) forbidden.add(nb);
                }
            };

            /* ── 成對放置（保留最後一對給 antipodal）─── */
            let firstA  = -1;
            let pairCount = 0;

            for (const viA of landArr) {
                if (forbidden.has(viA)) continue;
                if (pairCount >= maxPairs - 1) break; // 最後一對留給 antipodal

                /* 規則3：第一個點不能在南北極 */
                if (firstA === -1 && Math.abs(this._centroids[viA][1]) >= POLAR_EXCLUDE) continue;

                const cands = findCandidates(viA, forbidden);
                if (cands.length === 0) continue;

                const viB = cands[Math.floor(rs() * cands.length)];
                if (firstA === -1) firstA = viA;
                placePair(viA, viB);
                pairCount++;
            }

            /* ── 最後一對：antipodal of firstA ────────── */
            if (firstA !== -1 && pairCount < maxPairs) {
                const [ax, ay, az] = this._centroids[firstA];
                /* 球體對面 = (-ax, -ay, -az)，找最近陸地格 */
                const antiVi = this._nearestLand(-ax, -ay, -az, forbidden);
                if (antiVi !== -1) {
                    const cands = findCandidates(antiVi, forbidden);
                    if (cands.length > 0) {
                        const viB = cands[Math.floor(rs() * cands.length)];
                        placePair(antiVi, viB);
                    } else {
                        /* 找不到搭檔時退化為單放（仍放在最後）*/
                        result.push(mkItem(antiVi));
                    }
                }
            }
        }

        this._items = result;
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
