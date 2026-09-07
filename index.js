const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require('stripe');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
        const purchasesCollection = database.collection("purchases");


        //  CREATE CHECKOUT SESSION
        // ============================================
        app.post('/api/create-checkout-session', async (req, res) => {
            try {
                const { ebookId, userEmail, userName } = req.body;

                const ebook = await ebooksCollection.findOne({ _id: new ObjectId(ebookId) });
                if (!ebook) {
                    return res.status(404).json({ error: 'Ebook not found' });
                }

                // check book already purchased?
                const existingPurchase = await purchasesCollection.findOne({
                    userEmail: userEmail,
                    ebookId: ebookId
                });
                if (existingPurchase) {
                    return res.status(400).json({ error: 'Already purchased' });
                }

                const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    customer_email: userEmail,
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                product_data: {
                                    name: ebook.title,
                                    description: ebook.description?.slice(0, 100) || '',
                                    images: [ebook.cover],
                                },
                                unit_amount: Math.round(ebook.price * 100),
                            },
                            quantity: 1,
                        },
                    ],
                    mode: 'payment',
                    success_url: `${clientUrl}/checkout/purchase-success?session_id={CHECKOUT_SESSION_ID}&ebook_id=${ebookId}`,
                    cancel_url: `${clientUrl}/ebooks/${ebookId}`,
                    client_reference_id: ebookId,
                    metadata: {
                        userEmail: userEmail,
                        ebookId: ebookId,
                        ebookTitle: ebook.title,
                    },
                });

                res.json({ sessionId: session.id, url: session.url });
            } catch (error) {
                console.error('Stripe error:', error);
                res.status(500).json({ error: 'Failed to create checkout session' });
            }
        });

        // ============================================
        //  VERIFY PAYMENT (Success Page )
        // ============================================
        app.get('/api/verify-payment', async (req, res) => {
            try {
                const { session_id, ebook_id, user_email } = req.query;

                if (!session_id || !ebook_id || !user_email) {
                    return res.status(400).json({ error: 'Missing parameters' });
                }

                // Stripe session detail
                const session = await stripe.checkout.sessions.retrieve(session_id);

                if (session.payment_status === 'paid') {

                    const ebook = await ebooksCollection.findOne({
                        _id: new ObjectId(ebook_id)

                    })

                    // payment success – purchase record save
                    const purchaseRecord = {
                        userEmail: user_email,
                        ebookId: ebook_id,
                        ebookTitle: ebook?.title || session.metadata?.ebookTitle || 'Unknown',
                        ebookCover: ebook?.cover || '',
                        ebookDescription: ebook?.description || '',
                        amount: session.amount_total / 100,
                        currency: session.currency,
                        stripeSessionId: session_id,
                        purchaseDate: new Date(),
                        status: 'completed',
                    };

                    await purchasesCollection.insertOne(purchaseRecord);

                    await ebooksCollection.updateOne(
                        { _id: new ObjectId(ebook_id) },
                        { $inc: { salesCount: 1 } }
                    );

                    return res.json({ success: true, message: 'Payment verified and recorded' });
                } else {
                    return res.status(400).json({ success: false, error: 'Payment not completed' });
                }
            } catch (error) {
                console.error('Verification error:', error);
                res.status(500).json({ error: 'Verification failed' });
            }
        });

        // ============================================

        //  GET: purchase check
        // ============================================
        app.get('/api/purchases/check/:email/:ebookId', async (req, res) => {
            const { email, ebookId } = req.params;
            const result = await purchasesCollection.findOne({
                userEmail: email,
                ebookId: ebookId,
                status: 'completed'
            });
            res.send({ purchased: !!result });
        });


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



        // 1. POST: add new book in wishlist
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

        // 2. GET: fetch
        app.get('/wishlist/:email', async (req, res) => {
            const email = req.params.email;
            const result = await wishlistCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });

        // 4. GET: status check in details page
        app.get('/wishlist/check/:email/:ebookId', async (req, res) => {
            const { email, ebookId } = req.params;
            const result = await wishlistCollection.findOne({ userEmail: email, ebookId: ebookId });
            res.send({ isBookmarked: !!result });
        });

        // 1. DELETE: by _id 
        app.delete('/wishlist/item/:id', async (req, res) => {
            const id = req.params.id;
            try {

                const result = await wishlistCollection.deleteOne({ _id: id });
                res.send(result);
            } catch (error) {
                console.error("Delete error:", error);
                res.status(500).send({ error: "Delete failed" });
            }
        });

        // 2. DELETE: from details page
        app.delete('/wishlist/:email/:ebookId', async (req, res) => {
            const { email, ebookId } = req.params;
            const result = await wishlistCollection.deleteOne({ userEmail: email, ebookId: ebookId });
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