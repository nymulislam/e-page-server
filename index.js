const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
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

       
        app.get('/', (req, res) => {
            res.send('E-Page server is running and database is connected!');
        });

     
        app.listen(port, () => {
            console.log(`Example app listening on port ${port}`);
        });

    } catch (error) {
        console.error("Failed to connect to MongoDB", error);
    }
}

run().catch(console.dir);