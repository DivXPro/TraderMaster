import express from 'express';
import { matchMaker, defineServer, defineRoom } from 'colyseus';
import { monitor } from '@colyseus/monitor';
import { playground } from "@colyseus/playground";
import { Encoder } from "@colyseus/schema";
import cors from 'cors';
import { MarketRoom } from './rooms/MarketRoom';
import { roomTemplates } from './config/roomTemplates';

// Increase Colyseus Schema buffer size to handle large state (e.g. many prediction cells)
Encoder.BUFFER_SIZE = 1024 * 1024; // 1 MB

const port = Number(process.env.PORT || 3000);

const server = defineServer({
    devMode: false,
    express: (app) => {
        //
        // Include express middlewares (e.g. JSON body parser)
        //
        app.use(cors());
        app.use(express.json({ limit: "100kb" }));
        app.use('/monitor', monitor());
        app.use('/playground', playground());

        // API to get room metadata by roomId
        app.get('/room/:roomId/metadata', async (req, res) => {
            try {
                // query matchmaker for room presence
                const rooms = await matchMaker.query({ roomId: req.params.roomId });
                if (rooms.length > 0) {
                    res.json(rooms[0].metadata || {});
                } else {
                    res.status(404).json({ error: "Room not found" });
                }
            } catch (e: any) {
                res.status(e.code || 500).json({ code: e.code, message: e.message });
            }
        });

        // Custom room listing API
        app.get('/rooms/:roomName', async (req, res) => {
            try {
                const rooms = await matchMaker.query({ name: req.params.roomName });
                const result = rooms.map((r: any) => ({
                    roomId: r.roomId,
                    clients: r.clients,
                    maxClients: r.maxClients,
                    metadata: r.metadata || {}
                }));
                res.json(result);
            } catch (e: any) {
                res.status(e.code || 500).json({ code: e.code, message: e.message });
            }
        });

        // Debug API to inspect rooms
        app.get('/debug/rooms', async (req, res) => {
            try {
                const rooms = await matchMaker.query({});
                res.json(rooms);
            } catch (e: any) {
                res.status(500).json({ error: e.message });
            }
        });
    },
    rooms: {
        market: defineRoom(MarketRoom),
    }
});



server.listen(port).then(async () => {
    console.log(`Listening on ws://localhost:${port}`);
    try {
        // Create rooms based on templates
        const defaultRoom = 'market';
        const template = roomTemplates['default'];
        
        const existing = await matchMaker.query({ name: defaultRoom });
        if (existing.length === 0) {
            console.log(`Creating default room: ${defaultRoom} with template:`, template);
            await matchMaker.create(defaultRoom, {
                ...template,
                // Do not pass 'roomName' in options as it is reserved
            });
            console.log('Created default market room.');
        }
    } catch (e) {
        console.error('Failed to ensure default room:', e);
    }
});
