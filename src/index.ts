import { TwitterApi, TwitterApiReadWrite } from 'twitter-api-v2';
import { RefreshingAuthProvider, exchangeCode } from '@twurple/auth';
import { Database } from "bun:sqlite";
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';

interface Data {
    value: string;
}

class WYSIBot {
    private twitter: TwitterApi;
    private twitterClient: TwitterApiReadWrite | null = null;

    // twitch
    private twitchAuthProvider: RefreshingAuthProvider;
    private twitchApi: ApiClient;
    private twitchChat: ChatClient;

    private websocket: WebSocket | undefined;
    private db: Database;

    constructor() {
        if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
            throw new Error('Please set TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET environment variables.');
        }

        this.twitter = new TwitterApi({
            clientId: process.env.TWITTER_CLIENT_ID,
            clientSecret: process.env.TWITTER_CLIENT_SECRET,
        });

        this.twitchAuthProvider = new RefreshingAuthProvider(
            {
                clientId: process.env.TWITCH_CLIENT_ID!,
                clientSecret: process.env.TWITCH_CLIENT_SECRET!,
            }
        );

        this.twitchAuthProvider.onRefresh(async (user_id: number, newTokenData: any) => {
            console.log('Refreshing Twitch tokens...');
            this.updateTokens('twitch', newTokenData);
        });

        this.twitchApi = new ApiClient({ authProvider: this.twitchAuthProvider });

        this.twitchChat = new ChatClient({
            authProvider: this.twitchAuthProvider,
            channels: ['wysibot'],
        });

        this.db = new Database('./data/db.sqlite', { create: true });
        this.db.exec(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );`);
    }

    connectBeatLeader() {
        this.websocket = new WebSocket('wss://api.beatleader.xyz/scores')

        this.websocket.onopen = () => {
            console.log('Connected to BeatLeader.');
        }

        this.websocket.onclose = () => {
            console.log('Disconnected from BeatLeader, reconnecting...');
            setTimeout(() => {
                this.connectBeatLeader()
            }, 1000);
        }

        this.websocket.onmessage = async (event) => {
            let data = event.data instanceof Buffer ? event.data.toString() : event.data;
            let score = JSON.parse(data);
            await this.onScore(score);
        }
    }

    async run() {
        console.log('Starting...');
        await this.initTwitch();
        await this.initTwitter();

        if (!this.twitterClient) {
            throw new Error('No client available.');
        }

        this.twitchApi = new ApiClient({ authProvider: this.twitchAuthProvider });
        this.twitchChat.connect();

        this.connectBeatLeader()
    }

    private async onScore(score: any) {
        let acc = (Math.round(score.accuracy * 10000) / 100).toString();
        let accString = acc.replace('.', '');
        if (!accString.includes('727')) return

        let player = await fetch(`https://api.beatleader.xyz/player/${score.playerId}?stats=true`)
            .then(response => response.json())
            .then(data => data);

        let url = `https://replay.beatleader.xyz/?scoreId=${score.id}`;

        const twitter = player.socials.find((social: any) => social.service === 'Twitter');
        const playername = twitter ? `@${twitter.link.split('/')[3]}` : player.name;

        const twitch = player.socials.find((social: any) => social.service === 'Twitch');

        if (twitch) {
            let twitch_username = await this.twitchApi.users.getUserById(twitch.userId).then(user => user?.name);
            if (twitch_username) {
                let stream = await this.twitchApi.streams.getStreamByUserName(twitch_username).then(stream => stream);

                if (stream) {
                    url = `https://twitch.tv/${twitch_username}`;

                    try {
                        let clip = await this.twitchApi.clips.createClip({ channel: stream.userId })
                        url = clip;
                    } catch (e) {
                        console.log(e);
                    }
                }

                await this.twitchChat.join(twitch_username);
                await this.twitchChat.say(twitch_username, `! WHEN YOU SEE IT! You just got ${acc}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) ${url}`);
            }
        }

        let tweet = `#WYSI ${playername} just got ${acc}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) on #BeatSaber! ${url}`;
        await this.twitterClient?.v2.tweet(tweet);
        await this.twitchChat.say('wysibot', `${score.player.name} just got ${acc}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) ${url}`);

        console.log(tweet);
    }
    private updateTokens(type: string, data: string) {
        let acq = this.db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('${type}', $data)`);
        acq.all({ $data: data });
    }

    private getTokens(type: string): any {
        let data = this.db.prepare(`SELECT value FROM settings WHERE key = '${type}'`).all() as Data[];
        if (data.length === 0) {
            return null;
        }

        return JSON.parse(data[0]!.value);
    }

    private async initTwitch() {
        let tokenData = this.getTokens('twitch');

        if (!tokenData) {
            console.log('No tokens found, starting OAuth2 flow...');
            return await this.getFirstTwitchRefreshToken();
        }

        this.twitchAuthProvider.addUser(process.env.TWITCH_USER_ID!, tokenData, ['chat'])
    }

    private async getFirstTwitchRefreshToken() {
        console.log(`https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=http://localhost:3000&scope=analytics:read:extensions+user:edit+user:read:email+clips:edit+bits:read+analytics:read:games+user:edit:broadcast+user:read:broadcast+chat:read+chat:edit+channel:moderate+channel:read:subscriptions+whispers:read+whispers:edit+moderation:read+channel:read:redemptions+channel:edit:commercial+channel:read:hype_train+channel:read:stream_key+channel:manage:extensions+channel:manage:broadcast+user:edit:follows+channel:manage:redemptions+channel:read:editors+channel:manage:videos+user:read:blocked_users+user:manage:blocked_users+user:read:subscriptions+user:read:follows+channel:manage:polls+channel:manage:predictions+channel:read:polls+channel:read:predictions+moderator:manage:automod+channel:manage:schedule+channel:read:goals+moderator:read:automod_settings+moderator:manage:automod_settings+moderator:manage:banned_users+moderator:read:blocked_terms+moderator:manage:blocked_terms+moderator:read:chat_settings+moderator:manage:chat_settings+channel:manage:raids+moderator:manage:announcements+moderator:manage:chat_messages+user:manage:chat_color+channel:manage:moderators+channel:read:vips+channel:manage:vips+user:manage:whispers+channel:read:charity+moderator:read:chatters+moderator:read:shield_mode+moderator:manage:shield_mode+moderator:read:shoutouts+moderator:manage:shoutouts+moderator:read:followers+channel:read:guest_star+channel:manage:guest_star+moderator:read:guest_star+moderator:manage:guest_star`);
        console.log('Please enter the code from the URL:');
        let code = await new Promise<string>((resolve, _) => {
            process.stdin.resume();
            process.stdin.once('data', (data) => {
                resolve(data.toString().trim());
            });
            1
        });

        let tokenData = await exchangeCode(process.env.TWITCH_CLIENT_ID!, process.env.TWITCH_CLIENT_SECRET!, code, 'http://localhost:3000');
        this.updateTokens('twitch', JSON.stringify(tokenData));

        this.twitchAuthProvider.addUser(process.env.TWITCH_USER_ID!, tokenData);
    }

    private async initTwitter() {
        let tokenData = this.getTokens('twitter');

        console.log('Checking for existing tokens...');
        if (tokenData) {
            console.log('Tokens found, refreshing...');
            const { client: refreshedClient, accessToken: newAccessToken, refreshToken: newRefreshToken } = await this.twitter.refreshOAuth2Token(tokenData.refreshToken);

            if (newAccessToken && newRefreshToken) {
                this.updateTokens('twitter', JSON.stringify({ accessToken: newAccessToken, refreshToken: newRefreshToken }));
            }

            this.twitterClient = refreshedClient.readWrite;
        } else {
            console.log('No tokens found, starting OAuth2 flow...');
            return await this.getFirstTwitterRefreshToken();
        }
    }

    private async getFirstTwitterRefreshToken() {
        let oauth = this.twitter.generateOAuth2AuthLink('http://localhost:3000', { scope: ['offline.access', 'users.read', 'tweet.read', 'tweet.write'] });
        console.log(oauth.url);
        console.log('Please enter the code from the URL:');

        let code = await new Promise<string>((resolve, _) => {
            process.stdin.resume();
            process.stdin.once('data', (data) => {
                resolve(data.toString().trim());
            });
        });

        const { client: newClient, accessToken, refreshToken } = await this.twitter.loginWithOAuth2({ code: code, redirectUri: 'http://localhost:3000', codeVerifier: oauth.codeVerifier });
        this.twitterClient = newClient.readWrite;

        if (accessToken && refreshToken) {
            this.updateTokens('twitter', JSON.stringify({ accessToken: accessToken, refreshToken: refreshToken }));
        }
    }


}

const bot = new WYSIBot();
bot.run();