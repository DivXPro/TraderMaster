import type { MarketRoomConfig } from "@trader-master/shared";
export interface RoomListing {
    roomId: string;
    clients: number;
    maxClients: number;
    metadata: any;
}

const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const host = window.location.host;
const API_BASE_URL = `${protocol === 'wss' ? 'https' : 'http'}://${host}/api`;

export const getRoomMetadata = async (roomId: string): Promise<MarketRoomConfig | null> => {
    try {
        const response = await fetch(`${API_BASE_URL}/room/${roomId}/metadata`);
        if (!response.ok) {
            throw new Error(`Failed to fetch metadata: ${response.statusText}`);
        }
        const metadata = await response.json();
        return metadata as MarketRoomConfig;
    } catch (error) {
        console.error("Error fetching room metadata:", error);
        return null;
    }
};

export const getAvailableRooms = async (roomName: string): Promise<RoomListing[]> => {
    try {
        const response = await fetch(`${API_BASE_URL}/rooms/${roomName}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch rooms: ${response.statusText}`);
        }
        const rooms = await response.json();
        return rooms as RoomListing[];
    } catch (error) {
        console.error("Error fetching available rooms:", error);
        return [];
    }
};
