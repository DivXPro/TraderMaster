// Grid settings
export const TIME_GRID_STEP = 60; // seconds
export const PRICE_GRID_STEP = 0.5;

// Helper to generate unique ID for a grid cell
export const getGridId = (startTime: number, lowPrice: number) => {
    return `cell_${startTime}_${lowPrice.toFixed(2)}`;
};
