// For mongodb DNS error
const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

// importing necessary modules
const express = require('express')
const dotenv = require('dotenv')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

// initializing express app and dotenv
const app = express()
dotenv.config()

// setting up port and uri from environment variables
const port = process.env.PORT;
const uri = process.env.MONGO_DB_URI;


app.use(cors())
app.use(express.json())

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});



// get token from backend 
const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);

// middleware for authentication
const middleware = async (req, res, next) => {
    // receiving token from client side
    const authHeader = req?.headers.authorization;
    if (!authHeader) {
        console.log("[Middleware] No Authorization header provided");
        return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader?.split(" ")[1];
    if (!token || token === "null" || token === "undefined") {
        console.log("[Middleware] Token is missing, null, or undefined");
        return res.status(401).json({ message: "Unauthorized" });
    }

    // verify token with jose-cjs
    try {
        const { payload } = await jwtVerify(token, JWKS);

        req.user = payload;

        next();

    } catch (error) {
        console.error("[Middleware] Token verification failed:", error.message);
        return res.status(403).json({ message: "Forbidden" });
    }
};



async function run() {
    try {
        // await client.connect();

        const db = client.db(process.env.MONGO_DB_NAME);
        const recipesCollection = db.collection("recipes");



        // Public endpoint to get featured recipes with pagination
        app.get('/recipes/featured', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 6;
                const skip = (page - 1) * limit;

                const query = { isFeatured: true };

                const total = await recipesCollection.countDocuments(query);
                const recipes = await recipesCollection.find(query)
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.json({
                    recipes,
                    total,
                    totalPages: Math.ceil(total / limit),
                    currentPage: page
                });
            } catch (error) {
                console.error("Error fetching featured recipes:", error);
                res.status(500).json({ error: "Failed to fetch featured recipes" });
            }
        });

        // Add recipe endpoint
        app.post('/recipes', middleware,
            async (req, res) => {
                try {
                    const recipeData = req.body;

                    console.log("[POST /recipes] User payload:", req.user);

                    // Attach author information and metadata
                    recipeData.authorId = req.user.id || req.user.sub || req.user.uid || "";
                    recipeData.authorName = req.user.name || "";
                    recipeData.authorEmail = req.user.email || "";
                    recipeData.likesCount = 0;
                    recipeData.isFeatured = false;
                    recipeData.status = "pending";
                    recipeData.createdAt = new Date();
                    recipeData.updatedAt = new Date();

                    const result = await recipesCollection.insertOne(recipeData);
                    res.status(201).json(result);
                } catch (error) {
                    console.error("Error creating recipe:", error);
                    res.status(500).json({ error: "Failed to create recipe" });
                }
            }
        );

        // Get user's own recipes
        app.get('/recipes/my', middleware,
            async (req, res) => {
                try {
                    const email = req.user.email;
                    const result = await recipesCollection.find({ authorEmail: email }).toArray();
                    res.json(result);
                } catch (error) {
                    console.error("Error fetching user recipes:", error);
                    res.status(500).json({ error: "Failed to fetch recipes" });
                }
            }
        );

        // Support dashboard overview listing count
        app.get('/my-listings', middleware,
            async (req, res) => {
                try {
                    const email = req.user.email;
                    const result = await recipesCollection.find({ authorEmail: email }).toArray();
                    res.json(result);
                } catch (error) {
                    console.error("Error fetching my-listings:", error);
                    res.status(500).json({ error: "Failed to fetch listings" });
                }
            }
        );

        // Update recipe by ID
        app.put('/recipes/:id', middleware,
            async (req, res) => {
                try {
                    const { id } = req.params;
                    const updatedData = req.body;
                    const email = req.user.email;

                    // Verify ownership
                    const recipe = await recipesCollection.findOne({ _id: new ObjectId(id) });
                    if (!recipe) {
                        return res.status(404).json({ message: "Recipe not found" });
                    }
                    if (recipe.authorEmail !== email) {
                        return res.status(403).json({ message: "Forbidden: You do not own this recipe" });
                    }

                    // Prevent changing protected fields
                    delete updatedData._id;
                    delete updatedData.authorId;
                    delete updatedData.authorEmail;
                    delete updatedData.authorName;
                    delete updatedData.createdAt;

                    updatedData.updatedAt = new Date();

                    const result = await recipesCollection.updateOne(
                        { _id: new ObjectId(id) },
                        { $set: updatedData }
                    );

                    res.json(result);
                } catch (error) {
                    console.error("Error updating recipe:", error);
                    res.status(500).json({ error: "Failed to update recipe" });
                }
            }
        );

        // Delete recipe by ID
        app.delete('/recipes/:id', middleware,
            async (req, res) => {
                try {
                    const { id } = req.params;
                    const email = req.user.email;

                    // Verify ownership
                    const recipe = await recipesCollection.findOne({ _id: new ObjectId(id) });
                    if (!recipe) {
                        return res.status(404).json({ message: "Recipe not found" });
                    }
                    if (recipe.authorEmail !== email) {
                        return res.status(403).json({ message: "Forbidden: You do not own this recipe" });
                    }

                    const result = await recipesCollection.deleteOne({ _id: new ObjectId(id) });
                    res.json(result);
                } catch (error) {
                    console.error("Error deleting recipe:", error);
                    res.status(500).json({ error: "Failed to delete recipe" });
                }
            }
        );



        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('SpiceBook - server is running successfully!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})