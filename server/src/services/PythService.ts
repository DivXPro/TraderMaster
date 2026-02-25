import { EventEmitter } from 'events';
import { HermesClient } from "@pythnetwork/hermes-client";

const HERMES_URL = 'https://hermes.pyth.network';
const XAU_USD_PRICE_ID = '765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2';

export class PythService extends EventEmitter {
    private client: HermesClient;
    private eventSource: EventSource | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private latestPrice: number = 0;
    private latestConf: number = 0;
    private lastUpdateTime: number = 0;
    private isConnected: boolean = false;

    constructor() {
        super();
        this.client = new HermesClient(HERMES_URL, { timeout: 30000 });
    }

    public async start() {
        if (this.eventSource) {
            return;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        console.log(`Connecting to Pyth Hermes: ${HERMES_URL}`);

        try {
            this.eventSource = await this.client.getPriceUpdatesStream([XAU_USD_PRICE_ID], { parsed: true });

            if (!this.eventSource) {
                this.scheduleReconnect();
                return;
            }

            this.eventSource.onopen = () => {
                console.log('Connected to Pyth Hermes stream');
                this.isConnected = true;
                this.emit('connected');
            };

            this.eventSource.onmessage = (event: any) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.parsed) {
                        const priceUpdate = data.parsed[0];
                        if (priceUpdate && priceUpdate.price) {
                            const price = Number(priceUpdate.price.price) * Math.pow(10, priceUpdate.price.expo);
                            const conf = Number(priceUpdate.price.conf) * Math.pow(10, priceUpdate.price.expo);
                            const publishTime = priceUpdate.price.publish_time;

                            this.latestPrice = price;
                            this.latestConf = conf;
                            this.lastUpdateTime = publishTime;

                            this.emit('price_update', {
                                price: this.latestPrice,
                                conf: this.latestConf,
                                time: this.lastUpdateTime
                            });
                        }
                    }
                } catch (err) {
                    console.error('Error parsing Pyth message:', err);
                }
            };

            this.eventSource.onerror = (err: any) => {
                console.error('Pyth Hermes connection error:', err);
                this.stop(); // Clean up existing connection
                this.scheduleReconnect();
            };

        } catch (error) {
            console.error('Failed to start Pyth stream:', error);
            this.scheduleReconnect();
        }
    }

    public stop() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.isConnected = false;
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimeout) return;
        
        console.log('Scheduling reconnection in 5s...');
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.start();
        }, 5000);
    }

    public getPrice() {
        return {
            price: this.latestPrice,
            conf: this.latestConf,
            time: this.lastUpdateTime
        };
    }
}
