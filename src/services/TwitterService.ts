import { TwitterApi, TwitterApiReadWrite } from "twitter-api-v2"
import { TwitterApiAutoTokenRefresher } from "@twitter-api-v2/plugin-token-refresher"
import { Logger } from "winston"
import Database from "bun:sqlite"
import { insertOrUpdateToken } from "../utils"
import TDResult from "../TDResult"

export class TwitterService {
    private logger: Logger
    private db: Database
    public twitterClient: TwitterApiReadWrite

    constructor(logger: Logger, db: Database) {
        this.logger = logger.child({ service: "twitter" })
        this.db = db

        this.twitterClient = new TwitterApi({
            clientId: process.env.TWITTER_CLIENT_ID!,
            clientSecret: process.env.TWITTER_CLIENT_SECRET!,
        })
    }

    private createTwitterClient(refreshToken: string): TwitterApiReadWrite {
        return new TwitterApi({
            clientId: process.env.TWITTER_CLIENT_ID!,
            clientSecret: process.env.TWITTER_CLIENT_SECRET!,
        }, {
            plugins: [new TwitterApiAutoTokenRefresher({
                refreshToken: refreshToken,
                refreshCredentials: {
                    clientId: process.env.TWITTER_CLIENT_ID!,
                    clientSecret: process.env.TWITTER_CLIENT_SECRET!,
                },
                onTokenUpdate: (newTokenData) => {
                    insertOrUpdateToken(this.db, 0, newTokenData, "twitterAuth")
                    this.logger.info("Refreshed Twitter token!")
                },
                onTokenRefreshError: (error) => {
                    this.logger.error("Failed to refresh Twitter token!")
                    this.logger.error(error)
                }
            })]
        }).readWrite
    }


    private async initTwitter(): Promise<any> {
        const tokenQuery = this.db.prepare("SELECT * FROM twitterAuth WHERE id = ?")
        let result = tokenQuery.get(0) as TDResult | undefined

        if (!result) {
            let auth = this.twitterClient.generateOAuth2AuthLink("http://localhost:3000", { scope: ["offline.access", "users.read", "tweet.read", "tweet.write"] })

            this.logger.info("No token data found, please authorize with the following URL:")
            this.logger.info(auth.url)
            this.logger.info("Then paste the code from the redirect URL here:")

            let code = await new Promise<string>((resolve, _) => {
                process.stdin.resume()
                process.stdin.once("data", (data) => {
                    resolve(data.toString().trim())
                })
                1
            })

            const { client: _, accessToken, refreshToken } = await this.twitterClient.loginWithOAuth2({
                code: code,
                codeVerifier: auth.codeVerifier,
                redirectUri: "http://localhost:3000"
            })

            let tokenData = { accessToken, refreshToken }
            insertOrUpdateToken(this.db, 0, tokenData, "twitterAuth")
            this.twitterClient = this.createTwitterClient(refreshToken!) // exists because of offline.access scope
        } else {
            this.twitterClient = this.createTwitterClient(JSON.parse(result.tokenData).refreshToken)
        }
    }

    public async run(): Promise<void> {
        await this.initTwitter()
    }
}