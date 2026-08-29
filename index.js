const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

        // Database & Collection reference
        const database = client.db("e-page_db");
        const ebooksCollection = database.collection("ebooks");

        // 1. GET API:
        app.get('/ebooks', async (req, res) => {
            try {
                const cursor = ebooksCollection.find();
                const result = await cursor.toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch ebooks", error: error.message });
            }
        });

        // 2. GET API:
        app.get('/ebooks/:id', async (req, res) => {
            try {
                const id = req.params.id;
               
                const query = { _id: new ObjectId(id) }; 
                const result = await ebooksCollection.findOne(query);
                
                if (result) {
                    res.send(result);
                } else {
                    res.status(404).send({ message: "Ebook not found!" });
                }
            } catch (error) {
                res.status(500).send({ message: "Invalid ID or failed to fetch", error: error.message });
            }
        });

        // Root Route
        app.get('/', (req, res) => {
            res.send('E-Page server is running and database is connected!');
        });

        app.listen(port, () => {
            console.log(`E-Page server listening on port ${port}`);
        });

    } catch (error) {
        console.error("Failed to connect to MongoDB", error);
    }
}

run().catch(console.dir);