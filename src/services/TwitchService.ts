import { RefreshingAuthProvider, exchangeCode } from "@twurple/auth"
import { insertOrUpdateToken } from "../utils"
import { ApiClient } from "@twurple/api"
import { ChatClient } from "@twurple/chat"
import { Logger } from "winston"
import Database from "bun:sqlite"
import TDResult from "../TDResult"

export class TwitchService {
    private logger: Logger
    private authProvider: RefreshingAuthProvider
    public apiClient: ApiClient
    public chatClient: ChatClient
    private db: Database

    constructor(logger: Logger, db: Database) {
        this.logger = logger.child({ service: "twitch" })
        this.db = db

        this.authProvider = new RefreshingAuthProvider({
            clientId: process.env.TWITCH_CLIENT_ID!,
            clientSecret: process.env.TWITCH_CLIENT_SECRET!,
        })

        this.authProvider.onRefresh((id: number, newTokenData: any) => {
            insertOrUpdateToken(this.db, id, newTokenData, "twitchAuth")
            this.logger.info(`Refreshed Twitch token for user ${id}`)
        })

        this.authProvider.onRefreshFailure((id: number) => {
            this.logger.error(`Failed to refresh Twitch token for user ${id}`)
        })

        this.apiClient = new ApiClient({ authProvider: this.authProvider })
        this.chatClient = new ChatClient({
            authProvider: this.authProvider,
            channels: ["wysibot"],
        })
    }

    private async setupAuthProvider() {
        const tokenQuery = this.db.prepare("SELECT * FROM twitchAuth WHERE id = ?")
        let result = tokenQuery.get(process.env.TWITCH_USER_ID!) as TDResult | undefined

        if (!result) {
            this.logger.info("No token data found, please authorize with the following URL:")
            this.logger.info(`https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${process.env.TWITCH_CLIENT_ID!}&redirect_uri=http://localhost:3000&scope=clips:edit+chat:read+chat:edit+whispers:read+whispers:edit+channel:bot+user:bot`)
            this.logger.info("Then paste the code from the redirect URL here:")

            let code = await new Promise<string>((resolve, _) => {
                process.stdin.resume()
                process.stdin.once("data", (data) => {
                    resolve(data.toString().trim())
                })
                1
            })

            const tokenData = await exchangeCode(
                process.env.TWITCH_CLIENT_ID!,
                process.env.TWITCH_CLIENT_SECRET!,
                code,
                "http://localhost:3000"
            )

            this.authProvider.addUser(process.env.TWITCH_USER_ID!, tokenData, ["chat"])
            insertOrUpdateToken(this.db, process.env.TWITCH_USER_ID!, tokenData, "twitchAuth")
        } else {
            this.authProvider.addUser(process.env.TWITCH_USER_ID!, JSON.parse(result.tokenData), ["chat"])
        }
    }

    public async parseScore(social: any, score: any): Promise<string | undefined> {
        let user = await this.apiClient.users.getUserById(social.userId)
        if (!user) return

        let url = `https://twitch.tv/${user.name}`
        let stream = await this.apiClient.streams.getStreamByUserId(user.id)
        if (stream) {
            await this.apiClient.asUser(process.env.TWITCH_USER_ID!, async (apiClient) => {
                try {
                    let clip = await apiClient.clips.createClip({
                        channel: user!.id,
                        createAfterDelay: true,
                    })

                    if (clip) url = `https://clips.twitch.tv/${clip}`
                } catch (e) {
                    this.logger.warn(`Failed to create clip for ${user!.displayName}!`)
                }
            })
        }

        await this.chatClient.join(user.name)
        await this.chatClient.say(
            user.name,
            `! WHEN YOU SEE IT! You just got a ${(Math.round(score.accuracy * 10000) / 100)}% on ${score.leaderboard.song.name} (${score.leaderboard.difficulty.difficultyName}) ${url}`
        )

        return url
    }

    async run(): Promise<void> {
        this.logger.info("Starting up...")
        await this.setupAuthProvider()
        this.chatClient.connect()
    }
}
