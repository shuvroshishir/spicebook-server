const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const { MongoClient } = require("mongodb");
require("dotenv").config();

async function run() {
    const client = new MongoClient(process.env.MONGO_DB_URI);
    try {
        await client.connect();
        const db = client.db(process.env.MONGO_DB_NAME);
        const recipes = await db.collection("recipes").find({ isPremiumRecipe: true }).sort({ createdAt: -1 }).limit(10).toArray();
        console.log(JSON.stringify(recipes, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

run();
