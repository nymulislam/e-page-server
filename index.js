const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

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
        // await client.connect();
        console.log("Connected to MongoDB!");

        const database = client.db("e-page_db");
        const ebooksCollection = database.collection("ebooks");
        const wishlistCollection = database.collection("wishlist");

        // 1. GET: (Public)
        app.get('/ebooks', async (req, res) => {
            const cursor = ebooksCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        });

        // 2. GET: (Dashboard- writer)
        app.get('/ebooks/writer/:email', async (req, res) => {
            const email = req.params.email;
            const query = { writerEmail: email };
            const result = await ebooksCollection.find(query).toArray();
            res.send(result);
        });

        // 3. GET: (Edit or Details)
        app.get('/ebooks/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ebooksCollection.findOne(query);
            if (result) res.send(result);
            else res.status(404).send({ message: "Ebook not found!" });
        });

        // 4. POST: new e-book
        app.post('/ebooks', async (req, res) => {
            const newEbook = req.body;
            //able to publish or unpublish by default
            newEbook.uploadDate = new Date();
            const result = await ebooksCollection.insertOne(newEbook);
            res.send(result);
        });

        // 5. PATCH: (Edit / Publish / Unpublish)
        app.patch('/ebooks/:id', async (req, res) => {
            const id = req.params.id;
            const updateData = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: updateData
            };
            const result = await ebooksCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // 6. DELETE: e-book
        app.delete('/ebooks/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await ebooksCollection.deleteOne(filter);
            res.send(result);
        });



        // ১. POST: add new book in wishlist
        app.post('/wishlist', async (req, res) => {
            const item = req.body;
            // check existing wishlist book
            const existingItem = await wishlistCollection.findOne({
                userEmail: item.userEmail,
                ebookId: item.ebookId
            });
            if (existingItem) {
                return res.send({ message: "Already in wishlist", insertedId: null });
            }
            const result = await wishlistCollection.insertOne(item);
            res.send(result);
        });

        // ২. GET: fetch
        app.get('/wishlist/:email', async (req, res) => {
            const email = req.params.email;
            const result = await wishlistCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });

        // ৩. GET: status check in details page
        app.get('/wishlist/check/:email/:ebookId', async (req, res) => {
            const { email, ebookId } = req.params;
            const result = await wishlistCollection.findOne({ userEmail: email, ebookId: ebookId });
            res.send({ isBookmarked: !!result });
        });

        // ৪. DELETE: from details page
        app.delete('/wishlist/:email/:ebookId', async (req, res) => {
            const { email, ebookId } = req.params;
            const result = await wishlistCollection.deleteOne({ userEmail: email, ebookId: ebookId });
            res.send(result);
        });

        // ৫. DELETE: by  _id
        app.delete('/wishlist/item/:id', async (req, res) => {
            const id = req.params.id;
            const result = await wishlistCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.get('/', (req, res) => {
            res.send('E-Page server is running!');
        });

        app.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });

    } catch (error) {
        console.error("Failed to connect", error);
    }
}
run().catch(console.dir);