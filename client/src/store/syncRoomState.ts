import * as Colyseus from '@colyseus/sdk';
import { MarketState } from '@trader-master/shared';
import { useGameStore, type PlayerData } from './useGameStore';

export function syncRoomState(room: Colyseus.Room<MarketState>) {
    const callbacks = Colyseus.Callbacks.get(room);
    const unsubs: (() => void)[] = [];

    console.log("Setting up Colyseus state callbacks...");

    // Helpers
    const attachCell = (cell: any) => {
        useGameStore.getState().addPredictionCell(cell.toJSON());
        // Watch cell changes
        unsubs.push(callbacks.onChange(cell, () => {
            useGameStore.getState().updatePredictionCell(cell.toJSON());
        }));
    };

    const attachBet = (player: any, bet: any) => {
        useGameStore.getState().addBet(bet.toJSON());
        // If this bet belongs to current user, mark cell as 'bet_placed'
        if (bet.ownerId === room.sessionId && bet.cellId) {
            useGameStore.getState().updatePredictionCellStatus(bet.cellId, 'bet_placed');
        }
        // Watch bet changes
        unsubs.push(callbacks.onChange(bet, () => {
            useGameStore.getState().updateBet(bet.toJSON());
        }));
    };

    // Sync PredictionCells (add/remove + initial)
    unsubs.push(callbacks.onAdd('predictionCells', (cell: any) => {
        attachCell(cell);
    }));
    unsubs.push(callbacks.onRemove('predictionCells', (cell: any) => {
        useGameStore.getState().removePredictionCell(cell.id);
    }));
    // Initial existing cells
    room.state.predictionCells?.forEach((cell: any) => attachCell(cell));

    // Sync Players
    unsubs.push(callbacks.onAdd('players', (player: any) => {
        // We only care about the current user for the main 'player' state
        if (player.id !== room.sessionId) return;
        
        console.log("Current player joined state:", player.id);
        
        const updatePlayer = () => {
             const playerData: PlayerData = {
                 id: player.id,
                 balance: player.balance,
                 connected: player.connected
             };
             useGameStore.getState().setPlayer(playerData);
        };

        // Initial Set
        updatePlayer();

        // Listen for changes on player object (balance, connected)
        unsubs.push(callbacks.onChange(player, () => {
             updatePlayer();
        }));

        // Sync Bets (nested in player)
        unsubs.push(callbacks.onAdd(player, 'bets', (bet: any) => {
            attachBet(player, bet);
        }));
        // Remove bets
        if ('onRemove' in callbacks) {
            unsubs.push(callbacks.onRemove(player, 'bets', (bet: any) => {
                useGameStore.getState().removeBet(bet.id);
            }));
        }
        // Initial existing bets
        player.bets?.forEach((bet: any) => attachBet(player, bet));
    }));
    
    // Player removed (timeout)
    if ('onRemove' in callbacks) {
        unsubs.push(callbacks.onRemove('players', (player: any) => {
            if (player.id === room.sessionId) {
                useGameStore.getState().setPlayer(null);
            }
        }));
    }

    return () => {
        console.log("Cleaning up Colyseus callbacks...");
        unsubs.forEach(unsub => unsub());
    };
}
