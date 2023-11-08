import Database from "bun:sqlite";

export function insertOrUpdateToken(db: Database, id: number | string, tokenData: any, tableName: string) {
    db.exec(
        `INSERT OR REPLACE INTO ${tableName} (id, tokenData) VALUES (?, ?)`,
        [id, JSON.stringify(tokenData)]
    );
}