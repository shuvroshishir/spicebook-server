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
        return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    // verify token with jose-cjs
    try {
        const { payload } = await jwtVerify(token, JWKS);

        req.user = payload;

        next();

    } catch (error) {
        return res.status(403).json({ message: "Forbidden" });
    }
};



async function run() {
    try {
        // await client.connect();

        const db = client.db("petora");
        const petsCollection = db.collection("pets");
        const adoptionsCollection = db.collection("adoptions");


        // Pets collection
        app.get("/pets", async (req, res) => {

            const { search, species, sort } = req.query;

            const query = {};

            // Search by pet name
            if (search) {
                query.petName = {
                    $regex: search,
                    $options: "i",
                };
            }

            // Filter by species
            if (species) {
                query.species = {
                    $in: [species],
                };
            }

            // Sorting
            let sortOption = {};

            if (sort === "LowToHigh") {
                sortOption = {
                    adoptionFee: 1,
                };
            }

            else if (sort === "HighToLow") {
                sortOption = {
                    adoptionFee: -1,
                };
            }

            const result = await petsCollection
                .find(query)
                .sort(sortOption)
                .toArray();

            res.json(result);
        });



        app.get('/pets/:id', middleware,
            async (req, res) => {
                const { id } = req.params;

                const result = await petsCollection.findOne({ _id: new ObjectId(id) });
                res.json(result);
            }
        );


        // my listings
        app.get('/my-listings', middleware,
            async (req, res) => {
                const email = req.user.email;

                const result = await petsCollection.find({ ownerEmail: email }).toArray();
                res.json(result);
            }
        );


        app.post('/pets', middleware,
            async (req, res) => {
                const petData = req.body;

                const result = await petsCollection.insertOne(petData);
                res.json(result);
            }
        );

        app.patch('/pets/:id', middleware,
            async (req, res) => {
                const { id } = req.params;
                const updatedData = req.body;

                const result = await petsCollection.updateOne(
                    { _id: new ObjectId(id) },  //detect - jeta update korbo
                    { $set: updatedData }  //notun data 
                );
                res.json(result);
            }
        );

        app.delete('/pets/:id', middleware,
            async (req, res) => {
                const { id } = req.params;

                const result = await petsCollection.deleteOne({ _id: new ObjectId(id) });
                res.json(result);
            }
        );




        // Adoptions Collection ---------------->
        app.get('/adoptions', middleware,
            async (req, res) => {
                const result = await adoptionsCollection.find({}).toArray();
                res.json(result);
            }
        );

        // pet's all requests
        app.get("/adoptions/pet/:petId", middleware,
            async (req, res) => {
                const petId = req.params.petId;

                const requests = await adoptionsCollection.find({ petId }).toArray();
                res.json(requests);
            }
        );


        // my requests
        app.get('/my-requests', middleware,
            async (req, res) => {
                const email = req.user.email;

                const result = await adoptionsCollection.find({ adopterEmail: email }).toArray();
                res.json(result);
            }
        );

        // is adoption request already submit
        app.get("/adoptions/existing",
            async (req, res) => {
                const { petId, email } = req.query;

                const existingRequest = await adoptionsCollection.findOne({
                    petId,
                    adopterEmail: email,
                });

                res.json(existingRequest);
            }
        );

        app.post('/adoptions', middleware,
            async (req, res) => {
                const adoptionData = req.body;

                const result = await adoptionsCollection.insertOne(adoptionData);
                res.json(result);
            }
        );

        app.delete('/adoptions/:id', middleware,
            async (req, res) => {
                const { id } = req.params;

                const result = await adoptionsCollection.deleteOne({ _id: new ObjectId(id) });
                res.json(result);
            }
        );





        // request approve
        app.patch("/adoptions/approve/:id", middleware,
            async (req, res) => {

                const id = req.params.id;

                // find selected request person
                const adoption = await adoptionsCollection.findOne({
                    _id: new ObjectId(id),
                });

                // update status = approve 
                await adoptionsCollection.updateOne(
                    { _id: new ObjectId(id), },
                    {
                        $set: {
                            status: "approved",
                        },
                    }
                );

                // reject other requests
                await adoptionsCollection.updateMany(
                    {
                        petId: adoption.petId,

                        _id: {
                            $ne: new ObjectId(id),
                        },
                    },
                    {
                        $set: {
                            status: "rejected",
                        },
                    }
                );

                // mark pet adopted
                await petsCollection.updateOne(
                    { _id: new ObjectId(adoption.petId), },
                    {
                        $set: {
                            adoptionStatus:
                                "adopted",
                        },
                    }
                );

                res.json({
                    success: true,
                });
            }
        );


        // request reject
        app.patch("/adoptions/reject/:id", middleware,
            async (req, res) => {

                const id = req.params.id;

                const result =
                    await adoptionsCollection.updateOne(
                        { _id: new ObjectId(id), },
                        {
                            $set: {
                                status: "rejected",
                            },
                        }
                    );

                res.json(result);
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