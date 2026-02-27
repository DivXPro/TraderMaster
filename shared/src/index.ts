export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BetData {
    id: string;
    cellId: string;
    startTime: number;
    endTime: number;
    highPrice: number;
    lowPrice: number;
    amount: number;
    odds: number;
    payout: number;
    status: string;
    ownerId: string;
}

export interface PredictionCellData {
    id: string;
    startTime: number;
    endTime: number;
    highPrice: number;
    lowPrice: number;
    probability: number;
    odds: number;
    status?: string;
}

export interface PlayerData {
    id: string;
    balance: number;
    connected: boolean;
}

export interface MarketRoomConfig {
    roomName: string;
    symbol: string;
    /** 预测持续时长（秒） */
    predictionDuration?: number;
    /** 预测价格高度（价格单位） */
    predictionPriceHeight?: number;
    /** 预测生成间隔（秒）（若不重叠则匹配持续时间，若重叠则更小） */
    predictionGenerationInterval?: number;
    /** 默认显示层数（前端控制缩放） */
    predictionLayers?: number;
    /** 初始预生成列数（覆盖图表右侧区域） */
    predictionInitialColumns?: number;
    /** 投注锁定窗口（秒）（必须在格子开始时间前多少秒完成投注，防止临期投注） */
    predictionBetLockWindow?: number;
}

export * from './schema/MarketState';
export * from './constants';
export * from './messages';
