import Database from "bun:sqlite"

export function insertScore(db: Database, score: any) {
    db.exec(`INSERT INTO scores (id, songid, playerid, score, accuracy, timestamp) VALUES (?, ?, ?, ?, ?, ?)`, [
        score.id,
        score.leaderboard.song.id,
        score.player.id,
        score.modifiedScore,
        score.accuracy,
        score.timepost
    ])
}

export function insertOrUpdateToken(db: Database, id: number | string, tokenData: any, tableName: string) {
    db.exec(
        `INSERT OR REPLACE INTO ${tableName} (id, tokenData) VALUES (?, ?)`,
        [id, JSON.stringify(tokenData)]
    )
}