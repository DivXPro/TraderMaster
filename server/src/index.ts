import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Market } from './market';
import { Bet as SharedBet } from '@trader-master/shared';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const market = new Market(100.0);

interface Bet extends SharedBet {
    socketId: string;
}

let bets: Bet[] = [];

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send initial history
    socket.emit('history', market.getHistory());

    // Send existing bets to new user (so they can see others' bets? 
    // For MVP let's send all active bets to everyone)
    socket.emit('active_bets', bets);

    socket.on('place_bet', (betData: Omit<Bet, 'id' | 'status' | 'socketId'>) => {
        const newBet: Bet = {
            ...betData,
            id: Math.random().toString(36).substring(7),
            status: 'pending',
            socketId: socket.id
        };
        bets.push(newBet);
        console.log(`New bet placed: ${newBet.id} by ${socket.id}`);
        
        // Broadcast to all clients
        io.emit('bet_placed', newBet);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Market Tick Loop
setInterval(() => {
    const candle = market.tick();
    io.emit('price', candle);

    // Check Bets
    const now = candle.time;
    let betsChanged = false;

    bets.forEach(bet => {
        if (bet.status === 'pending') {
            // Check if active (time is within range)
            if (now >= bet.startTime && now <= bet.endTime) {
                // Instant Win Rule: If K-line passes through (intersects) the box
                // Check intersection of [candle.low, candle.high] and [bet.lowPrice, bet.highPrice]
                const overlap = Math.max(candle.low, bet.lowPrice) <= Math.min(candle.high, bet.highPrice);
                
                if (overlap) {
                    bet.status = 'won';
                    io.emit('bet_update', bet);
                    betsChanged = true;
                    return; // Stop processing this bet
                }
            }

            // Check if bet expired and still pending (meaning it didn't win)
            if (now >= bet.endTime) {
                bet.status = 'lost';
                io.emit('bet_update', bet);
                betsChanged = true;
            }
        }
    });

    // Clean up old bets (keep them for a while to show result)
    if (betsChanged) {
        // Optional: remove very old bets to free memory
        const cutoff = now - 60; // Keep for 1 minute after result
        const oldLen = bets.length;
        bets = bets.filter(b => b.status === 'pending' || b.endTime > cutoff);
        if (bets.length !== oldLen) {
            // Maybe sync full list periodically?
        }
    }

}, 1000); // 1 tick per second

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
