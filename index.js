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

        // Query database to check if user is blocked
        const db = client.db(process.env.MONGO_DB_NAME);
        const userCollection = db.collection("user");
        const userId = payload.id || payload.sub || payload.uid || "";
        const email = payload.email || "";

        const queryConditions = [];
        if (userId) {
            queryConditions.push({ id: userId });
            try {
                queryConditions.push({ _id: new ObjectId(userId) });
            } catch (e) { }
        }
        if (email) {
            queryConditions.push({ email });
        }

        if (queryConditions.length > 0) {
            const userDoc = await userCollection.findOne({ $or: queryConditions });
            if (userDoc?.isBlocked === true) {
                console.log(`[Middleware] User ${email} is blocked`);
                return res.status(403).json({ message: "Your account is blocked by the administrator." });
            }
        }

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
        const favoritesCollection = db.collection("favorites");
        const reportsCollection = db.collection("reports");

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

        // Public endpoint to get popular recipes (most liked)
        app.get('/recipes/popular', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit) || 9;

                const recipes = await recipesCollection.find({})
                    .sort({ likesCount: -1 })
                    .limit(limit)
                    .toArray();

                res.json(recipes);
            } catch (error) {
                console.error("Error fetching popular recipes:", error);
                res.status(500).json({ error: "Failed to fetch popular recipes" });
            }
        });

        // Public endpoint to get all recipes with pagination and category filtering
        app.get('/recipes', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 9;
                const skip = (page - 1) * limit;

                let query = {};
                if (req.query.categories) {
                    const categoriesList = req.query.categories.split(",").filter(Boolean);
                    if (categoriesList.length > 0) {
                        query.category = { $in: categoriesList };
                    }
                }

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
                console.error("Error fetching recipes:", error);
                res.status(500).json({ error: "Failed to fetch recipes" });
            }
        });

        // Add recipe endpoint
        app.post('/recipes', middleware,
            async (req, res) => {
                try {
                    const recipeData = req.body;

                    console.log("[POST /recipes] User payload:", req.user);

                    const email = req.user.email || "";
                    const userId = req.user.id || req.user.sub || req.user.uid || "";

                    // Find user in database to check isPremium status
                    const userCollection = db.collection("user");
                    const queryConditions = [];
                    if (userId) {
                        queryConditions.push({ id: userId });
                        try {
                            queryConditions.push({ _id: new ObjectId(userId) });
                        } catch (e) { }
                    }
                    if (email) {
                        queryConditions.push({ email });
                    }

                    const userDoc = await userCollection.findOne({ $or: queryConditions });
                    const isPremium = userDoc?.isPremium === true;

                    if (!isPremium) {
                        // Count user's existing recipes
                        const count = await recipesCollection.countDocuments({ authorEmail: email });
                        if (count >= 2) {
                            return res.status(403).json({
                                error: "Recipe limit reached",
                                message: "Standard accounts are limited to 2 recipes. Please upgrade to premium for unlimited uploads."
                            });
                        }
                    }

                    // Attach author information and metadata
                    recipeData.authorId = userId;
                    recipeData.authorName = req.user.name || "";
                    recipeData.authorEmail = email;
                    recipeData.isAuthorPremium = isPremium;
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

        // Get user's favorites
        app.get('/recipes/favorites', middleware, async (req, res) => {
            try {
                const userId = req.user.id || req.user.sub || req.user.uid || "";
                const userEmail = req.user.email || "";

                if (!userId && !userEmail) {
                    return res.json([]);
                }

                const query = {};
                const orConditions = [];
                if (userId) orConditions.push({ userId });
                if (userEmail) orConditions.push({ userEmail });
                query.$or = orConditions;

                const favCollection = db.collection("favorites");
                const result = await favCollection.aggregate([
                    { $match: query },
                    {
                        $addFields: {
                            recipeObjectId: {
                                $cond: {
                                    if: { $eq: [{ $type: "$recipeId" }, "string"] },
                                    then: { $toObjectId: "$recipeId" },
                                    else: "$recipeId"
                                }
                            }
                        }
                    },
                    {
                        $lookup: {
                            from: "recipes",
                            localField: "recipeObjectId",
                            foreignField: "_id",
                            as: "recipeDetails"
                        }
                    },
                    {
                        $unwind: {
                            path: "$recipeDetails",
                            preserveNullAndEmptyArrays: true
                        }
                    },
                    {
                        $addFields: {
                            isPremiumRecipe: "$recipeDetails.isPremiumRecipe",
                            price: "$recipeDetails.price"
                        }
                    },
                    {
                        $project: {
                            recipeObjectId: 0,
                            recipeDetails: 0
                        }
                    }
                ]).toArray();
                res.json(result);
            } catch (error) {
                console.error("Error fetching favorites:", error);
                res.status(500).json({ error: "Failed to fetch favorite recipes" });
            }
        });

        // Get user's purchased recipes
        app.get('/recipes/purchased', middleware, async (req, res) => {
            try {
                const userId = req.user.id || req.user.sub || req.user.uid || "";
                const userEmail = req.user.email || "";

                if (!userId && !userEmail) {
                    return res.json([]);
                }

                const query = {};
                const orConditions = [];
                if (userId) orConditions.push({ userId });
                if (userEmail) orConditions.push({ userEmail });
                query.$or = orConditions;

                const purCollection = db.collection("purchases");
                const result = await purCollection.find(query).toArray();
                res.json(result);
            } catch (error) {
                console.error("Error fetching purchases:", error);
                res.status(500).json({ error: "Failed to fetch purchased recipes" });
            }
        });

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

        // Get single recipe details with user-specific context
        app.get('/recipes/:id', async (req, res) => {
            try {
                const recipeId = req.params.id;
                if (!ObjectId.isValid(recipeId)) {
                    return res.status(400).json({ error: "Invalid recipe ID" });
                }

                const recipe = await recipesCollection.findOne({ _id: new ObjectId(recipeId) });
                if (!recipe) {
                    return res.status(404).json({ error: "Recipe not found" });
                }

                let hasLiked = false;
                let isFavorite = false;
                let hasPurchased = false;

                const authHeader = req.headers.authorization;
                if (authHeader && authHeader.startsWith("Bearer ")) {
                    const token = authHeader.split(" ")[1];
                    try {
                        const { payload } = await jwtVerify(token, JWKS);
                        const userId = payload.id || payload.sub || payload.uid;
                        const userEmail = payload.email || "";

                        if (userId || userEmail) {
                            if (userId && recipe.likedBy && recipe.likedBy.includes(userId)) {
                                hasLiked = true;
                            }

                            const favoritesCollection = db.collection("favorites");
                            const fav = await favoritesCollection.findOne({
                                $or: [
                                    ...(userId ? [{ userId, recipeId }] : []),
                                    ...(userEmail ? [{ userEmail, recipeId }] : [])
                                ]
                            });
                            if (fav) isFavorite = true;

                            const purchasesCollection = db.collection("purchases");
                            const pur = await purchasesCollection.findOne({
                                $or: [
                                    ...(userId ? [{ userId, recipeId }] : []),
                                    ...(userEmail ? [{ userEmail, recipeId }] : [])
                                ]
                            });
                            if (pur) hasPurchased = true;
                        }
                    } catch (e) {
                        console.log("Could not decode auth header for recipe context:", e.message);
                    }
                }

                res.json({
                    ...recipe,
                    hasLiked,
                    isFavorite,
                    hasPurchased
                });
            } catch (error) {
                console.error("Error fetching recipe:", error);
                res.status(500).json({ error: "Failed to fetch recipe" });
            }
        });

        // Toggle like on recipe
        app.post('/recipes/:id/like', middleware, async (req, res) => {
            try {
                const recipeId = req.params.id;
                const userId = req.user.id || req.user.sub || req.user.uid || "";

                if (!ObjectId.isValid(recipeId)) {
                    return res.status(400).json({ error: "Invalid recipe ID" });
                }

                const recipe = await recipesCollection.findOne({ _id: new ObjectId(recipeId) });
                if (!recipe) {
                    return res.status(404).json({ error: "Recipe not found" });
                }

                const likedBy = recipe.likedBy || [];
                const hasLiked = likedBy.includes(userId);

                let update;
                if (hasLiked) {
                    update = {
                        $pull: { likedBy: userId },
                        $inc: { likesCount: -1 }
                    };
                } else {
                    update = {
                        $addToSet: { likedBy: userId },
                        $inc: { likesCount: 1 }
                    };
                }

                await recipesCollection.updateOne({ _id: new ObjectId(recipeId) }, update);

                const updatedRecipe = await recipesCollection.findOne({ _id: new ObjectId(recipeId) });
                res.json({
                    likesCount: updatedRecipe.likesCount || 0,
                    hasLiked: !hasLiked
                });
            } catch (error) {
                console.error("Error liking recipe:", error);
                res.status(500).json({ error: "Failed to like recipe" });
            }
        });

        // Toggle favorite recipe
        app.post('/recipes/:id/favorite', middleware, async (req, res) => {
            try {
                const recipeId = req.params.id;
                const userId = req.user.id || req.user.sub || req.user.uid || "";

                if (!ObjectId.isValid(recipeId)) {
                    return res.status(400).json({ error: "Invalid recipe ID" });
                }

                const recipe = await recipesCollection.findOne({ _id: new ObjectId(recipeId) });
                if (!recipe) {
                    return res.status(404).json({ error: "Recipe not found" });
                }

                const favoritesCollection = db.collection("favorites");
                const existing = await favoritesCollection.findOne({ userId, recipeId });

                if (existing) {
                    await favoritesCollection.deleteOne({ userId, recipeId });
                    res.json({ isFavorite: false, message: "Removed from favorites" });
                } else {
                    await favoritesCollection.insertOne({
                        userId,
                        userEmail: req.user.email || "",
                        recipeId,
                        recipeName: recipe.recipeName,
                        recipeImage: recipe.recipeImage,
                        category: recipe.category,
                        cuisineType: recipe.cuisineType,
                        preparationTime: recipe.preparationTime,
                        difficultyLevel: recipe.difficultyLevel,
                        likesCount: recipe.likesCount || 0,
                        isPremiumRecipe: recipe.isPremiumRecipe,
                        price: recipe.price,
                        addedAt: new Date()
                    });
                    res.json({ isFavorite: true, message: "Added to favorites" });
                }
            } catch (error) {
                console.error("Error toggling favorite:", error);
                res.status(500).json({ error: "Failed to toggle favorite" });
            }
        });

        // Report recipe
        app.post('/recipes/:id/report', middleware, async (req, res) => {
            try {
                const recipeId = req.params.id;
                const userId = req.user.id || req.user.sub || req.user.uid || "";
                const userEmail = req.user.email || "";
                const userName = req.user.name || "";
                const { reason, details } = req.body;

                if (!reason) {
                    return res.status(400).json({ error: "Reason is required" });
                }

                if (!ObjectId.isValid(recipeId)) {
                    return res.status(400).json({ error: "Invalid recipe ID" });
                }

                const recipe = await recipesCollection.findOne({ _id: new ObjectId(recipeId) });
                if (!recipe) {
                    return res.status(404).json({ error: "Recipe not found" });
                }


                await reportsCollection.insertOne({
                    recipeId,
                    recipeName: recipe.recipeName,
                    recipeImage: recipe.recipeImage,
                    userId,
                    userName,
                    reporterEmail: userEmail,
                    userEmail,
                    reason,
                    details: details || "",
                    status: "pending",
                    createdAt: new Date()
                });

                res.json({ success: true, message: "Report submitted successfully" });
            } catch (error) {
                console.error("Error submitting report:", error);
                res.status(500).json({ error: "Failed to submit report" });
            }
        });

        // Create Stripe Checkout Session for recipe purchase
        app.post('/create-checkout-session/recipe', middleware, async (req, res) => {
            try {
                const { recipeId } = req.body;
                const userId = req.user.id || req.user.sub || req.user.uid || "";
                const userEmail = req.user.email || "";

                if (!recipeId || !ObjectId.isValid(recipeId)) {
                    return res.status(400).json({ error: "Invalid recipe ID" });
                }

                const recipe = await recipesCollection.findOne({ _id: new ObjectId(recipeId) });
                if (!recipe) {
                    return res.status(404).json({ error: "Recipe not found" });
                }

                const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_spicebook");
                const priceInCents = recipe.price && recipe.price > 0 ? Math.round(recipe.price * 100) : 499;

                // Validate and sanitize image URL for Stripe checkout validation
                const stripeImages = [];
                if (recipe.recipeImage && (recipe.recipeImage.startsWith("http://") || recipe.recipeImage.startsWith("https://"))) {
                    stripeImages.push(recipe.recipeImage);
                } else {
                    // Fallback to a default high-quality food placeholder image
                    stripeImages.push("https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=600&auto=format&fit=crop");
                }

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [{
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: recipe.recipeName,
                                images: stripeImages,
                                description: `Unlock recipe: ${recipe.recipeName}`,
                            },
                            unit_amount: priceInCents,
                        },
                        quantity: 1,
                    }],
                    mode: 'payment',
                    success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard/purchased-recipes?session_id={CHECKOUT_SESSION_ID}&recipeId=${recipeId}`,
                    cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/recipe/${recipeId}`,
                    customer_email: userEmail,
                    metadata: {
                        recipeId,
                        userId,
                        type: "recipe_purchase"
                    }
                });

                res.json({ id: session.id, url: session.url });
            } catch (error) {
                console.error("Error creating checkout session:", error);
                res.status(500).json({ error: "Failed to create checkout session" });
            }
        });

        // Verify Stripe Purchase session
        app.post('/recipes/verify-purchase', middleware, async (req, res) => {
            try {
                const { sessionId } = req.body;
                const userId = req.user.id || req.user.sub || req.user.uid || "";
                const userEmail = req.user.email || "";

                if (!sessionId) {
                    return res.status(400).json({ error: "Session ID is required" });
                }

                const purchasesCollection = db.collection("purchases");
                const existing = await purchasesCollection.findOne({ sessionId });
                if (existing) {
                    return res.json({ success: true, message: "Purchase already verified" });
                }

                const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_spicebook");
                const session = await stripe.checkout.sessions.retrieve(sessionId);

                if (session.payment_status === "paid") {
                    const recipeId = session.metadata.recipeId;
                    const recipe = await recipesCollection.findOne({ _id: new ObjectId(recipeId) });

                    if (!recipe) {
                        return res.status(404).json({ error: "Recipe not found" });
                    }

                    await purchasesCollection.insertOne({
                        userId,
                        recipeId,
                        recipeName: recipe.recipeName,
                        recipeImage: recipe.recipeImage,
                        category: recipe.category,
                        cuisineType: recipe.cuisineType,
                        preparationTime: recipe.preparationTime,
                        difficultyLevel: recipe.difficultyLevel,
                        likesCount: recipe.likesCount || 0,
                        price: session.amount_total / 100,
                        currency: session.currency,
                        sessionId,
                        purchasedAt: new Date()
                    });

                    // Save transaction to payments collection
                    const paymentsCollection = db.collection("payments");
                    await paymentsCollection.insertOne({
                        userEmail,
                        userId,
                        amount: session.amount_total / 100,
                        recipeId,
                        transactionId: sessionId,
                        paymentStatus: "paid",
                        paidAt: new Date()
                    });

                    res.json({ success: true, message: "Purchase verified successfully" });
                } else {
                    res.status(400).json({ error: "Payment not completed" });
                }
            } catch (error) {
                console.error("Error verifying purchase:", error);
                res.status(500).json({ error: "Failed to verify purchase" });
            }
        });

        // Get user premium status from database
        app.get('/users/status', middleware, async (req, res) => {
            try {
                const email = req.user.email || "";
                const userId = req.user.id || req.user.sub || req.user.uid || "";

                const userCollection = db.collection("user");
                const queryConditions = [];
                if (userId) {
                    queryConditions.push({ id: userId });
                    try {
                        queryConditions.push({ _id: new ObjectId(userId) });
                    } catch (e) { }
                }
                if (email) {
                    queryConditions.push({ email });
                }

                const userDoc = await userCollection.findOne({ $or: queryConditions });
                res.json({ isPremium: userDoc?.isPremium === true });
            } catch (error) {
                console.error("Error fetching user status:", error);
                res.status(500).json({ error: "Failed to fetch user status" });
            }
        });

        // Create Stripe Checkout Session for Premium membership upgrade
        app.post('/create-checkout-session/premium', middleware, async (req, res) => {
            try {
                const userId = req.user.id || req.user.sub || req.user.uid || "";
                const userEmail = req.user.email || "";
                const { redirectPath } = req.body;

                const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_spicebook");
                const priceInCents = 999; // Flat $9.99 for lifetime premium

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [{
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: "SpiceBook Premium Membership",
                                description: "Unlock lifetime access to all premium recipes, guides, and priority badges.",
                            },
                            unit_amount: priceInCents,
                        },
                        quantity: 1,
                    }],
                    mode: 'payment',
                    success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard/payment-success?upgrade_success=true&session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}${redirectPath || '/dashboard/profile'}`,
                    customer_email: userEmail,
                    metadata: {
                        userId,
                        userEmail,
                        type: "premium_upgrade"
                    }
                });

                res.json({ id: session.id, url: session.url });
            } catch (error) {
                console.error("Error creating premium checkout session:", error);
                res.status(500).json({ error: "Failed to create checkout session" });
            }
        });

        // Verify Stripe Premium membership upgrade session
        app.post('/users/verify-premium-upgrade', middleware, async (req, res) => {
            try {
                const { sessionId } = req.body;
                const userId = req.user.id || req.user.sub || req.user.uid || "";
                const userEmail = req.user.email || "";

                if (!sessionId) {
                    return res.status(400).json({ error: "Session ID is required" });
                }

                const paymentsCollection = db.collection("payments");
                const existing = await paymentsCollection.findOne({ transactionId: sessionId });
                if (existing) {
                    return res.json({ success: true, message: "Upgrade already processed" });
                }

                const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_spicebook");
                const session = await stripe.checkout.sessions.retrieve(sessionId);

                if (session.payment_status === "paid") {
                    // Update user.isPremium = true in MongoDB Better Auth user collection
                    const userCollection = db.collection("user");

                    const queryConditions = [];
                    if (userId) {
                        queryConditions.push({ id: userId });
                        try {
                            queryConditions.push({ _id: new ObjectId(userId) });
                        } catch (e) { }
                    }
                    if (userEmail) {
                        queryConditions.push({ email: userEmail });
                    }

                    await userCollection.updateOne(
                        { $or: queryConditions },
                        { $set: { isPremium: true, updatedAt: new Date() } }
                    );

                    // Update all recipes by this author to reflect their premium status
                    await recipesCollection.updateMany(
                        { authorEmail: userEmail },
                        { $set: { isAuthorPremium: true } }
                    );

                    // Insert payment record matching the requested database schema
                    await paymentsCollection.insertOne({
                        userEmail,
                        userId,
                        amount: session.amount_total / 100,
                        recipeId: null,
                        transactionId: sessionId,
                        paymentStatus: "paid",
                        paidAt: new Date()
                    });

                    res.json({ success: true, message: "Welcome to Premium Pro!" });
                } else {
                    res.status(400).json({ error: "Payment not completed" });
                }
            } catch (error) {
                console.error("Error verifying premium upgrade:", error);
                res.status(500).json({ error: "Failed to verify premium upgrade" });
            }
        });











        // Admin middleware array
        const adminMiddleware = [
            middleware,
            (req, res, next) => {
                if (req.user && req.user.role === 'admin') {
                    next();
                } else {
                    res.status(403).json({ error: "Forbidden: Admin access required" });
                }
            }
        ];

        // 1. Admin Stats Overview
        app.get('/admin/stats', adminMiddleware, async (req, res) => {
            try {
                const userCollection = db.collection("user");
                const recipesCollection = db.collection("recipes");
                const reportsCollection = db.collection("reports");

                const totalUsers = await userCollection.countDocuments();
                const totalRecipes = await recipesCollection.countDocuments();
                const totalPremiumMembers = await userCollection.countDocuments({ isPremium: true });
                const totalReports = await reportsCollection.countDocuments();

                res.json({
                    totalUsers,
                    totalRecipes,
                    totalPremiumMembers,
                    totalReports
                });
            } catch (error) {
                console.error("Error fetching admin stats:", error);
                res.status(500).json({ error: "Failed to fetch admin stats" });
            }
        });

        // 2. Manage Users - Get all users
        app.get('/admin/users', adminMiddleware, async (req, res) => {
            try {
                const userCollection = db.collection("user");
                const users = await userCollection.find().toArray();
                res.json(users);
            } catch (error) {
                console.error("Error fetching admin users:", error);
                res.status(500).json({ error: "Failed to fetch users" });
            }
        });

        // 3. Manage Users - Block user
        app.patch('/admin/users/:id/block', adminMiddleware, async (req, res) => {
            try {
                const userId = req.params.id;
                const userCollection = db.collection("user");

                let filter = { id: userId };
                try {
                    filter = { $or: [{ id: userId }, { _id: new ObjectId(userId) }] };
                } catch (e) { }

                await userCollection.updateOne(filter, { $set: { isBlocked: true } });
                res.json({ success: true, message: "User blocked successfully" });
            } catch (error) {
                console.error("Error blocking user:", error);
                res.status(500).json({ error: "Failed to block user" });
            }
        });

        // 4. Manage Users - Unblock user
        app.patch('/admin/users/:id/unblock', adminMiddleware, async (req, res) => {
            try {
                const userId = req.params.id;
                const userCollection = db.collection("user");

                let filter = { id: userId };
                try {
                    filter = { $or: [{ id: userId }, { _id: new ObjectId(userId) }] };
                } catch (e) { }

                await userCollection.updateOne(filter, { $set: { isBlocked: false } });
                res.json({ success: true, message: "User unblocked successfully" });
            } catch (error) {
                console.error("Error unblocking user:", error);
                res.status(500).json({ error: "Failed to unblock user" });
            }
        });

        // 5. Manage Recipes - Get all recipes (admin list)
        app.get('/admin/recipes', adminMiddleware, async (req, res) => {
            try {
                const recipesCollection = db.collection("recipes");
                const recipes = await recipesCollection.find().toArray();
                res.json(recipes);
            } catch (error) {
                console.error("Error fetching admin recipes:", error);
                res.status(500).json({ error: "Failed to fetch recipes" });
            }
        });

        // 6. Manage Recipes - Edit recipe
        app.put('/admin/recipes/:id', adminMiddleware, async (req, res) => {
            try {
                const recipeId = req.params.id;
                const recipesCollection = db.collection("recipes");
                const updatedData = req.body;

                delete updatedData._id;

                await recipesCollection.updateOne(
                    { _id: new ObjectId(recipeId) },
                    { $set: updatedData }
                );
                res.json({ success: true, message: "Recipe updated successfully" });
            } catch (error) {
                console.error("Error editing recipe:", error);
                res.status(500).json({ error: "Failed to update recipe" });
            }
        });

        // 7. Manage Recipes - Feature recipe
        app.patch('/admin/recipes/:id/feature', adminMiddleware, async (req, res) => {
            try {
                const recipeId = req.params.id;
                const recipesCollection = db.collection("recipes");

                const recipe = await recipesCollection.findOne({ _id: new ObjectId(recipeId) });
                if (!recipe) {
                    return res.status(404).json({ error: "Recipe not found" });
                }

                const newFeaturedStatus = !recipe.isFeatured;
                await recipesCollection.updateOne(
                    { _id: new ObjectId(recipeId) },
                    { $set: { isFeatured: newFeaturedStatus } }
                );

                res.json({
                    success: true,
                    isFeatured: newFeaturedStatus,
                    message: newFeaturedStatus ? "Recipe added to featured list" : "Recipe removed from featured list"
                });
            } catch (error) {
                console.error("Error toggling featured status:", error);
                res.status(500).json({ error: "Failed to toggle featured status" });
            }
        });

        // 8. Manage Recipes - Delete recipe
        app.delete('/admin/recipes/:id', adminMiddleware, async (req, res) => {
            try {
                const recipeId = req.params.id;
                const recipesCollection = db.collection("recipes");
                const reportsCollection = db.collection("reports");
                const favoritesCollection = db.collection("favorites");

                await recipesCollection.deleteOne({ _id: new ObjectId(recipeId) });
                await reportsCollection.deleteMany({ recipeId });
                await favoritesCollection.deleteMany({ recipeId });

                res.json({ success: true, message: "Recipe deleted successfully" });
            } catch (error) {
                console.error("Error deleting recipe:", error);
                res.status(500).json({ error: "Failed to delete recipe" });
            }
        });

        // 9. Recipe Reports - Get all reports with recipe details
        app.get('/admin/reports', adminMiddleware, async (req, res) => {
            try {
                const reportsCollection = db.collection("reports");
                const reports = await reportsCollection.aggregate([
                    {
                        $addFields: {
                            recipeObjectId: {
                                $cond: {
                                    if: { $eq: [{ $type: "$recipeId" }, "string"] },
                                    then: { $toObjectId: "$recipeId" },
                                    else: "$recipeId"
                                }
                            }
                        }
                    },
                    {
                        $lookup: {
                            from: "recipes",
                            localField: "recipeObjectId",
                            foreignField: "_id",
                            as: "recipeDetails"
                        }
                    },
                    {
                        $unwind: {
                            path: "$recipeDetails",
                            preserveNullAndEmptyArrays: true
                        }
                    },
                    {
                        $project: {
                            recipeObjectId: 0
                        }
                    }
                ]).toArray();
                res.json(reports);
            } catch (error) {
                console.error("Error fetching reports:", error);
                res.status(500).json({ error: "Failed to fetch reports" });
            }
        });

        // 10. Recipe Reports - Dismiss report
        app.patch('/admin/reports/:id/dismiss', adminMiddleware, async (req, res) => {
            try {
                const reportId = req.params.id;
                const reportsCollection = db.collection("reports");
                await reportsCollection.updateOne(
                    { _id: new ObjectId(reportId) },
                    { $set: { status: "dismissed" } }
                );
                res.json({ success: true, message: "Report dismissed successfully" });
            } catch (error) {
                console.error("Error dismissing report:", error);
                res.status(500).json({ error: "Failed to dismiss report" });
            }
        });

        // 11. Transactions - Get all payments with server-side pagination
        app.get('/admin/transactions', adminMiddleware, async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const paymentsCollection = db.collection("payments");
                const total = await paymentsCollection.countDocuments();
                const payments = await paymentsCollection.find()
                    .sort({ paidAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.json({
                    data: payments,
                    total,
                    page,
                    totalPages: Math.ceil(total / limit)
                });
            } catch (error) {
                console.error("Error fetching admin transactions:", error);
                res.status(500).json({ error: "Failed to fetch transactions" });
            }
        });

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