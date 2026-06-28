const dns = require('node:dns/promises');
dns.setServers(['1.1.1.1', '8.8.8.8']);

const { MongoClient } = require('mongodb');

async function main() {
    const uri = "mongodb+srv://spice_book:Zuc6zWBvzH3jxIR3@shishir.gtfukgt.mongodb.net/?appName=Shishir";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db("spicebook");
        
        const email = "shuvroshishirx@gmail.com";
        const result = await db.collection("user").updateOne(
            { email: email },
            { $set: { isPremium: true } }
        );
        
        console.log("Matched documents:", result.matchedCount);
        console.log("Modified documents:", result.modifiedCount);
        
        // Let's check the updated user document
        const user = await db.collection("user").findOne({ email: email });
        console.log("User updated doc:", user);
    } catch(e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

main();
