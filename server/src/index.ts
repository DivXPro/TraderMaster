import express from 'express';
import { matchMaker, defineServer, defineRoom } from 'colyseus';
import { monitor } from '@colyseus/monitor';
import { playground } from "@colyseus/playground";
import { Encoder } from "@colyseus/schema";
import cors from 'cors';
import { MarketRoom } from './rooms/MarketRoom';

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

        app.post('/matchmake/joinOrCreate/:roomName', async (req, res) => {
            try {
                console.log(`[MatchMaker] joinOrCreate request for ${req.params.roomName}`);
                const seat = await matchMaker.joinOrCreate(req.params.roomName, req.body || {});
                console.log(`[MatchMaker] seat reserved:`, JSON.stringify(seat));
                res.json(seat);
            } catch (e: any) {
                console.error(`[MatchMaker] error:`, e);
                res.status(e.code || 500).json({ code: e.code, message: e.message });
            }
        });

        app.post('/matchmake/join/:roomName', async (req, res) => {
            try {
                const seat = await matchMaker.join(req.params.roomName, req.body || {});
                res.json(seat);
            } catch (e: any) {
                res.status(e.code || 500).json({ code: e.code, message: e.message });
            }
        });

        app.post('/matchmake/joinById/:roomId', async (req, res) => {
            try {
                const seat = await matchMaker.joinById(req.params.roomId, req.body || {});
                res.json(seat);
            } catch (e: any) {
                res.status(e.code || 500).json({ code: e.code, message: e.message });
            }
        });

        app.post('/matchmake/create/:roomName', async (req, res) => {
            try {
                const seat = await matchMaker.create(req.params.roomName, req.body || {});
                res.json(seat);
            } catch (e: any) {
                res.status(e.code || 500).json({ code: e.code, message: e.message });
            }
        });
    },
    rooms: {
        market: defineRoom(MarketRoom),
    }
});




server.listen(port).then(() => {
    console.log(`Listening on ws://localhost:${port}`);
});
