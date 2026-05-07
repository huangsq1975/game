/* ═══════════════════════════════════════════════════════
   兵種配置
   name  : 顯示名稱
   ch    : 單字圖示
   clr   : 顏色（0xRRGGBB）
   beats : 克制的兵種
   loses : 被克制的兵種
   spd   : 移動間隔（ms，越小越快）
   atk   : 基礎攻擊力
   hp    : 初始血量
   cost  : 金幣費用
   r     : 圖示半徑（px）
   ═══════════════════════════════════════════════════════ */
const UDEFS = {
    cavalry: {
        name:'騎兵', ch:'騎', clr:0xFFAA22,
        beats:'infantry', loses:'archer',
        spd:680, atk:18, hp:80, cost:35, r:11,
    },
    archer: {
        name:'弓箭手', ch:'弓', clr:0x33CC66,
        beats:'cavalry', loses:'infantry',
        spd:1100, atk:24, hp:55, cost:25, r:10,
    },
    infantry: {
        name:'步兵', ch:'步', clr:0x5599EE,
        beats:'archer', loses:'cavalry',
        spd:900, atk:14, hp:120, cost:20, r:12,
    },
};
