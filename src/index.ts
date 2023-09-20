import { TwitterApi, TwitterApiReadWrite } from "twitter-api-v2";
import { TwitterApiAutoTokenRefresher } from "@twitter-api-v2/plugin-token-refresher";
import { RefreshingAuthProvider, exchangeCode } from "@twurple/auth";
import { Database } from "bun:sqlite";
import { ApiClient } from "@twurple/api";
import { ChatClient } from "@twurple/chat";

interface Data {
  value: string;
}

class WYSIBot {
  private twitterClient: TwitterApiReadWrite | undefined;

  // twitch
  private twitchAuthProvider: RefreshingAuthProvider;
  private twitchApi: ApiClient;
  private twitchChat: ChatClient;

  private db: Database;

  constructor() {
    if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
      throw new Error(
        "Please set TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET environment variables."
      );
    }

    this.twitchAuthProvider = new RefreshingAuthProvider({
      clientId: process.env.TWITCH_CLIENT_ID!,
      clientSecret: process.env.TWITCH_CLIENT_SECRET!,
    });

    this.twitchAuthProvider.onRefresh(async (_: number, newTokenData: any) => {
      this.updateTokens("twitch", JSON.stringify(newTokenData));
    });

    this.twitchApi = new ApiClient({ authProvider: this.twitchAuthProvider });

    this.twitchChat = new ChatClient({
      authProvider: this.twitchAuthProvider,
      channels: ["wysibot"],
    });

    this.db = new Database("./data/db.sqlite", { create: true });
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );`);
  }

  connectBeatLeader() {
    let websocket = new WebSocket("wss://api.beatleader.xyz/scores");

    websocket.onopen = () => {
      console.log("Connected to BeatLeader.");
    };

    websocket.onclose = () => {
      console.log("Disconnected from BeatLeader, reconnecting...");
      setTimeout(() => {
        this.connectBeatLeader();
      }, 1000);
    };

    websocket.onmessage = async (event) => {
      let data =
        event.data instanceof Buffer ? event.data.toString() : event.data;
      let score = JSON.parse(data);
      await this.onScore(score);
    };
  }

  async run() {
    console.log("Starting...");
    await this.initTwitch();
    await this.initTwitter();

    this.twitchApi = new ApiClient({ authProvider: this.twitchAuthProvider });
    this.twitchChat.connect();

    this.connectBeatLeader();
  }

  private async onScore(score: any) {
    try {
      const acc = (Math.round(score.accuracy * 10000) / 100).toString();
      const accString = acc.replace(".", "");
      if (!accString.includes("727")) return;

      const response = await fetch(
        `https://api.beatleader.xyz/player/${score.playerId}?stats=true`
      );

      const player = await response.json();

      let url = `https://replay.beatleader.xyz/?scoreId=${score.id}`;

      const twitterSocial = player.socials.find(
        (social: any) => social.service === "Twitter"
      );

      const playername = twitterSocial
        ? `@${twitterSocial.link.split("/")[3]}`
        : player.name;

      const twitchSocial = player.socials.find(
        (social: any) => social.service === "Twitch"
      );

      if (twitchSocial) {
        let twitchUser = await this.twitchApi.users.getUserById(
          twitchSocial.userId
        );
        if (twitchUser?.name) {
          let stream = await this.twitchApi.streams.getStreamByUserName(
            twitchUser.name
          );

          if (stream) {
            url = `https://twitch.tv/${twitchUser.name}`;

            try {
              let clip = await this.twitchApi.clips.createClip({
                channel: twitchSocial.userId,
              });
              if (clip) {
                url = clip;
              }
            } catch (e) {
              console.error(e);
            }
          }

          await this.twitchChat.join(twitchUser.name);
          await this.twitchChat.say(
            twitchUser.name,
            `! WHEN YOU SEE IT! You just got ${acc}% on ${
              score.leaderboard.song.name
            } (${score.leaderboard.difficulty.difficultyName}) ${
              stream ? url : ""
            }`
          );
        }
      }

      let tweet = `#WYSI ${playername} just got ${acc}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) on #BeatSaber! ${url}`;
      await this.twitchChat.say(
        "wysibot",
        `${score.player.name} just got ${acc}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) ${url}`
      );

      if (this.twitterClient) await this.twitterClient.v2.tweet(tweet);

      console.log(tweet);
    } catch (error) {
      console.error("Error in onScore:", error);
    }
  }

  private updateTokens(type: string, data: string) {
    let existing = this.db
      .prepare(`SELECT value FROM settings WHERE key = '${type}'`)
      .all() as Data[];
    if (existing.length === 0) {
      this.db
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('${type}', '${data}')`
        )
        .run();
    } else {
      this.db
        .prepare(`UPDATE settings SET value = '${data}' WHERE key = '${type}'`)
        .run();
    }
  }

  private getTokens(type: string): any | null {
    let existing = this.db
      .prepare(`SELECT value FROM settings WHERE key = '${type}'`)
      .all() as Data[];
    if (existing.length === 0) {
      return null;
    }

    return JSON.parse(existing[0].value);
  }

  private async initTwitch(): Promise<any> {
    let tokenData = this.getTokens("twitch");

    if (!tokenData) {
      console.log("No tokens found, starting OAuth2 flow...");
      return await this.getFirstTwitchRefreshToken();
    }

    this.twitchAuthProvider.addUser(process.env.TWITCH_USER_ID!, tokenData, [
      "chat",
    ]);
  }

  private async getFirstTwitchRefreshToken() {
    console.log(
      `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=http://localhost:3000&scope=analytics:read:extensions+user:edit+user:read:email+clips:edit+bits:read+analytics:read:games+user:edit:broadcast+user:read:broadcast+chat:read+chat:edit+channel:moderate+channel:read:subscriptions+whispers:read+whispers:edit+moderation:read+channel:read:redemptions+channel:edit:commercial+channel:read:hype_train+channel:read:stream_key+channel:manage:extensions+channel:manage:broadcast+user:edit:follows+channel:manage:redemptions+channel:read:editors+channel:manage:videos+user:read:blocked_users+user:manage:blocked_users+user:read:subscriptions+user:read:follows+channel:manage:polls+channel:manage:predictions+channel:read:polls+channel:read:predictions+moderator:manage:automod+channel:manage:schedule+channel:read:goals+moderator:read:automod_settings+moderator:manage:automod_settings+moderator:manage:banned_users+moderator:read:blocked_terms+moderator:manage:blocked_terms+moderator:read:chat_settings+moderator:manage:chat_settings+channel:manage:raids+moderator:manage:announcements+moderator:manage:chat_messages+user:manage:chat_color+channel:manage:moderators+channel:read:vips+channel:manage:vips+user:manage:whispers+channel:read:charity+moderator:read:chatters+moderator:read:shield_mode+moderator:manage:shield_mode+moderator:read:shoutouts+moderator:manage:shoutouts+moderator:read:followers+channel:read:guest_star+channel:manage:guest_star+moderator:read:guest_star+moderator:manage:guest_star`
    );
    console.log("Please enter the code from the URL:");
    let code = await new Promise<string>((resolve, _) => {
      process.stdin.resume();
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
      });
      1;
    });

    let tokenData = await exchangeCode(
      process.env.TWITCH_CLIENT_ID!,
      process.env.TWITCH_CLIENT_SECRET!,
      code,
      "http://localhost:3000"
    );
    this.updateTokens("twitch", JSON.stringify(tokenData));

    return await this.initTwitch();
  }

  private async initTwitter(): Promise<any> {
    let tokenData = this.getTokens("twitter");

    console.log("Checking for existing tokens...");
    if (!tokenData) {
      console.log("No tokens found, starting OAuth2 flow...");
      return await this.getFirstTwitterRefreshToken();
    } else {
      const autoRefresherPlugin = new TwitterApiAutoTokenRefresher({
        refreshToken: this.getTokens("twitter")?.refreshToken,
        refreshCredentials: {
          clientId: process.env.TWITTER_CLIENT_ID!,
          clientSecret: process.env.TWITTER_CLIENT_SECRET!,
        },
        onTokenUpdate: (token) => {
          console.log("Refreshing Twitter tokens...");
          let tokenData = {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
          };
          this.updateTokens("twitter", JSON.stringify(tokenData));
        },
        onTokenRefreshError: (error) => {
          console.error("Refresh error", error);
        },
      });

      const twitter = new TwitterApi(
        {
          clientId: process.env.TWITTER_CLIENT_ID!,
          clientSecret: process.env.TWITTER_CLIENT_SECRET!,
        },
        {
          plugins: [autoRefresherPlugin],
        }
      );

      this.twitterClient = twitter.readWrite;
    }
  }

  private async getFirstTwitterRefreshToken() {
    const temporary_twitter = new TwitterApi({
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!,
    });

    let oauth = temporary_twitter.generateOAuth2AuthLink(
      "http://localhost:3000",
      { scope: ["offline.access", "users.read", "tweet.read", "tweet.write"] }
    );
    console.log(oauth.url);
    console.log("Please enter the code from the URL:");

    let code = await new Promise<string>((resolve, _) => {
      process.stdin.resume();
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
      });
    });

    const {
      client: _,
      accessToken,
      refreshToken,
    } = await temporary_twitter.loginWithOAuth2({
      code: code,
      redirectUri: "http://localhost:3000",
      codeVerifier: oauth.codeVerifier,
    });
    let tokenData = { accessToken: accessToken, refreshToken: refreshToken };
    this.updateTokens("twitter", JSON.stringify(tokenData));

    return await this.initTwitter();
  }
}

const bot = new WYSIBot();
bot.run();
