import { MarketRoomConfig, PREDICTION_DURATION, PREDICTION_LAYERS } from "@trader-master/shared";

export interface RoomTemplate extends Partial<MarketRoomConfig> {
    roomId?: string; // Optional custom ID if needed, though Colyseus generates one usually
}

export const roomTemplates: Record<string, RoomTemplate> = {
    'default': {
        symbol: 'XAUUSD',
        predictionDuration: PREDICTION_DURATION,
        predictionPriceHeight: 10,
        predictionLayers: 6, // Optimized for performance (was 12)
        predictionInitialColumns: 8, // Optimized for performance (was 16)
    },
    'btc': {
        symbol: 'BTCUSD',
        predictionDuration: 60,
        predictionPriceHeight: 100,
        predictionLayers: 8
    }
};
