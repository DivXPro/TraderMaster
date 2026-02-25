// Prediction Constants
export const PREDICTION_DURATION = 30; // 预测持续时长（秒）
export const PREDICTION_PRICE_HEIGHT = 1; // 预测价格高度（价格单位）
export const PREDICTION_GENERATION_INTERVAL = 30; // 预测生成间隔（秒）（若不重叠则匹配持续时间，若重叠则更小）
export const PREDICTION_LAYERS = 12; // 预测层数（上下层数）
export const PREDICTION_INITIAL_COLUMNS = 16; // 初始预生成列数（覆盖图表右侧区域）
export const PREDICTION_BET_LOCK_WINDOW = 40; // 投注锁定窗口（秒）（必须在格子开始时间前多少秒完成投注，防止临期投注）
