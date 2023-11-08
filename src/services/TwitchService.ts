import { RefreshingAuthProvider, exchangeCode } from "@twurple/auth";
import { ApiClient } from "@twurple/api";
import { ChatClient } from "@twurple/chat";
import { Logger } from "winston";
import Database from "bun:sqlite";

interface TokenResult {
    twitchId: number;
    tokenData: string; // JSON string
}


export class TwitchService {
    private logger: Logger;
    private authProvider: RefreshingAuthProvider;
    public apiClient: ApiClient;
    public chatClient: ChatClient;
    private db: Database;

    constructor(logger: Logger, db: Database) {
        this.logger = logger;
        this.db = db;

        this.authProvider = new RefreshingAuthProvider({
            clientId: process.env.TWITCH_CLIENT_ID!,
            clientSecret: process.env.TWITCH_CLIENT_SECRET!,
        });

        this.authProvider.onRefresh((twitchId: number, newTokenData: any) => {
            this.insertOrUpdateToken(twitchId, newTokenData);
            this.logger.info(`Refreshed token for user ${twitchId}`);
        });

        this.authProvider.onRefreshFailure((twitchId: number) => {
            this.logger.error(`Failed to refresh token for user ${twitchId}`);
        });

        this.apiClient = new ApiClient({ authProvider: this.authProvider });
        this.chatClient = new ChatClient({
            authProvider: this.authProvider,
            channels: ["#wysibot"],
        });
    }

    private insertOrUpdateToken(twitchId: number | string, tokenData: any) {
        this.db.exec(
            "INSERT OR REPLACE INTO twitchAuth (twitchId, tokenData) VALUES (?, ?)",
            [twitchId, JSON.stringify(tokenData)]
        );
    }

    private async setupAuthProvider() {
        const tokenQuery = this.db.prepare("SELECT * FROM twitchAuth WHERE twitchId = ?")
        let result = tokenQuery.get(process.env.TWITCH_USER_ID!) as TokenResult | undefined;

        if (!result) {
            this.logger.info("No token data found, please authorize with the following URL:");
            this.logger.info(`https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=http://localhost:3000&scope=analytics:read:extensions+user:edit+user:read:email+clips:edit+bits:read+analytics:read:games+user:edit:broadcast+user:read:broadcast+chat:read+chat:edit+channel:moderate+channel:read:subscriptions+whispers:read+whispers:edit+moderation:read+channel:read:redemptions+channel:edit:commercial+channel:read:hype_train+channel:read:stream_key+channel:manage:extensions+channel:manage:broadcast+user:edit:follows+channel:manage:redemptions+channel:read:editors+channel:manage:videos+user:read:blocked_users+user:manage:blocked_users+user:read:subscriptions+user:read:follows+channel:manage:polls+channel:manage:predictions+channel:read:polls+channel:read:predictions+moderator:manage:automod+channel:manage:schedule+channel:read:goals+moderator:read:automod_settings+moderator:manage:automod_settings+moderator:manage:banned_users+moderator:read:blocked_terms+moderator:manage:blocked_terms+moderator:read:chat_settings+moderator:manage:chat_settings+channel:manage:raids+moderator:manage:announcements+moderator:manage:chat_messages+user:manage:chat_color+channel:manage:moderators+channel:read:vips+channel:manage:vips+user:manage:whispers+channel:read:charity+moderator:read:chatters+moderator:read:shield_mode+moderator:manage:shield_mode+moderator:read:shoutouts+moderator:manage:shoutouts+moderator:read:followers+channel:read:guest_star+channel:manage:guest_star+moderator:read:guest_star+moderator:manage:guest_star`)
            this.logger.info("Then paste the code from the redirect URL here:");

            let code = await new Promise<string>((resolve, _) => {
                process.stdin.resume();
                process.stdin.once("data", (data) => {
                    resolve(data.toString().trim());
                });
                1;
            });

            const tokenData = await exchangeCode(
                process.env.TWITCH_CLIENT_ID!,
                process.env.TWITCH_CLIENT_SECRET!,
                code,
                "http://localhost:3000"
            );

            this.authProvider.addUser(process.env.TWITCH_USER_ID!, tokenData, ["chat"]);
            this.insertOrUpdateToken(process.env.TWITCH_USER_ID!, tokenData);
        } else {
            // token data found, add user to auth provider
            this.authProvider.addUser(process.env.TWITCH_USER_ID!, JSON.parse(result.tokenData), ["chat"]);
        }
    }

    public async parseScore(social: any, score: any): Promise<string | undefined> {
        let user = await this.apiClient.users.getUserById(social.userId)
        if (!user) return;

        let url = `https://twitch.tv/${user.name}`
        let stream = await this.apiClient.streams.getStreamByUserId(user.id)
        if (stream) {
            await this.apiClient.asUser(process.env.TWITCH_USER_ID!, async (apiClient) => {
                try {
                    let clip = await apiClient.clips.createClip({
                        channel: user!.id,
                        createAfterDelay: true,
                    });

                    if (clip) url = `https://clips.twitch.tv/${clip}`
                } catch (e) {
                    this.logger.warn(`Failed to create clip for ${user!.displayName}!`);
                }
            });

        }

        await this.chatClient.join(user.name);
        await this.chatClient.say(
            user.name,
            `! WHEN YOU SEE IT! You just got a ${(Math.round(score.accuracy * 10000) / 100)}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) ${url}`
        );

        return url;
    }

    async run(): Promise<void> {
        await this.setupAuthProvider();
        this.chatClient.connect()
    }
}
