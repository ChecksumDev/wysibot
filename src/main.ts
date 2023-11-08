import { Logger, createLogger, format, transports } from 'winston';
import { TwitchService } from './services/TwitchService';
import { TwitterService } from './services/TwitterService';
import Database from 'bun:sqlite';
import fs from 'fs';

class Client {
    // logger
    private logger: Logger;

    // database
    private db: Database;

    // services
    private ws: WebSocket | null = null;
    private twitchService: TwitchService;
    private twitterService: TwitterService;

    constructor() {
        this.logger = createLogger({
            level: 'debug',
            format: format.combine(
                format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss',
                }),
                format.errors({ stack: true }),
                format.splat(),
                format.json()
            ),
            defaultMeta: { service: 'client' },
            transports: [
                new transports.File({ filename: 'error.log', level: 'error' }),
                new transports.File({ filename: 'combined.log' }),
            ],
        });

        if (process.env.NODE_ENV !== 'production') {
            this.logger.add(
                new transports.Console({
                    format: format.combine(
                        format.colorize(),
                        format.simple()
                    ),
                })
            );
        }

        fs.mkdirSync('data', { recursive: true });

        this.db = new Database('data/db.sqlite');
        this.initDatabase();

        // initialize services
        this.twitchService = new TwitchService(this.logger, this.db);
        this.twitterService = new TwitterService(this.logger, this.db);
    }


    private initDatabase() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS twitchAuth (
                twitchId INTEGER PRIMARY KEY,
                tokenData TEXT NOT NULL
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS twitterAuth (
                twitterId INTEGER PRIMARY KEY,
                tokenData TEXT NOT NULL
            );
        `);
    }

    private connectWebSocket(): void {
        this.ws = new WebSocket('wss://api.beatleader.xyz/scores');

        this.ws.addEventListener('open', () => {
            this.logger.info('Connected to BeatLeader');
        });

        this.ws.addEventListener('message', async (event: any) => {
            let score = JSON.parse(event.data);
            await this.onScore(score);
        });

        this.ws.addEventListener('close', () => {
            this.logger.info('Disconnected from BeatLeader, reconnecting in 5 seconds...');
            setTimeout(() => this.connectWebSocket(), 5000);
        })
    }

    public async onScore(score: any): Promise<void> {
        const rawAcc = (Math.round(score.accuracy * 10000) / 100).toString();
        const acc = rawAcc.replace('.', '');

        if (!acc.includes('727')) {
            this.logger.debug(`Skipping score ${score.id} by ${score.player.name} (${rawAcc}%)`)
            return;
        }

        this.logger.info(`New score ${score.id} by ${score.player.name} (${rawAcc}%)`)

        let player = await fetch(`https://api.beatleader.xyz/player/${score.playerId}?stats=true`).then(res => res.json());

        let twitchSocial = player.socials.find((social: any) => social.service === 'Twitch');
        let twitterSocial = player.socials.find((social: any) => social.service === 'Twitter');

        let username = player.name;
        let url = `https://replay.beatleader.xyz/?scoreId=${score.id}`;
        
        if (twitchSocial) {
            let twitchUrl = await this.twitchService.parseScore(twitchSocial, score);
            if (twitchUrl) url = twitchUrl;
        }
        if (twitterSocial) {
            username = `@${twitterSocial.link.split("/")[3]}`;
        }
        
        let tweet = `#WYSI ${username} just got ${rawAcc}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) on #BeatSaber! ${url}`;

        await this.twitterService.twitterClient?.v2.tweet(tweet);
        await this.twitchService.chatClient.say(
            "#wysibot",
            `${score.player.name} just scored ${rawAcc}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) ${url}`
        );
    }


    public async run(): Promise<void> {
        // validate environment variables
        this.validateEnvironmentVariables();

        // run services
        await this.twitchService.run();
        await this.twitterService.run();

        this.connectWebSocket();
    }

    private validateEnvironmentVariables(): void {
        const requiredVariables = [
            // twitch
            'TWITCH_USER_ID',
            'TWITCH_CLIENT_ID',
            'TWITCH_CLIENT_SECRET',
            // twitter
            'TWITTER_CLIENT_ID',
            'TWITTER_CLIENT_SECRET',
        ];

        const missingVariables = requiredVariables.filter(
            (variable) => !process.env[variable]
        );

        if (missingVariables.length > 0) {
            this.logger.error(
                `Missing environment variables: ${missingVariables.join(', ')}`
            );
            process.exit(1);
        }
    }
}

const client = new Client();
await client.run();
