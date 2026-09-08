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
        console.log("Connected to MongoDB!");

        const database = client.db("e-page_db");
        const usersCollection = database.collection("user");
        const ebooksCollection = database.collection("ebooks");
        const wishlistCollection = database.collection("wishlist");
        const purchasesCollection = database.collection("purchases");

        // --- Stripe & Checkout Routes ---
        app.post('/api/create-checkout-session', async (req, res) => {
            try {
                const { ebookId, userEmail } = req.body;
                const ebook = await ebooksCollection.findOne({ _id: new ObjectId(ebookId) });

                if (!ebook) {
                    return res.status(404).json({ error: 'Ebook not found' });
                }

                const existingPurchase = await purchasesCollection.findOne({ userEmail, ebookId });
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
                        userEmail,
                        ebookId,
                        ebookTitle: ebook.title,
                    },
                });

                res.json({ sessionId: session.id, url: session.url });
            } catch (error) {
                console.error('Stripe error:', error);
                res.status(500).json({ error: 'Failed to create checkout session' });
            }
        });

        app.get('/api/verify-payment', async (req, res) => {
            try {
                const { session_id, ebook_id, user_email } = req.query;

                if (!session_id || !ebook_id || !user_email) {
                    return res.status(400).json({ error: 'Missing parameters' });
                }

                const session = await stripe.checkout.sessions.retrieve(session_id);

                if (session.payment_status === 'paid') {
                    const ebook = await ebooksCollection.findOne({ _id: new ObjectId(ebook_id) });

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

        app.get('/api/purchases/check/:email/:ebookId', async (req, res) => {
            const { email, ebookId } = req.params;
            const result = await purchasesCollection.findOne({
                userEmail: email,
                ebookId: ebookId,
                status: 'completed'
            });
            res.send({ purchased: !!result });
        });

        app.get('/api/purchases/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await purchasesCollection
                    .find({ userEmail: email })
                    .sort({ purchaseDate: -1 })
                    .toArray();
                res.send(result);
            } catch (error) {
                console.error("Failed to fetch purchases:", error);
                res.status(500).send({ error: "Failed to fetch purchase history" });
            }
        });


        // --- Admin Transactions Route ---
        app.get('/api/admin/transactions', async (req, res) => {
            try {
                const purchases = await purchasesCollection
                    .find({})
                    .sort({ purchaseDate: -1 })
                    .toArray();

                // Transaction Data Format
                const transactions = purchases.map((p) => ({
                    id: p.stripeSessionId ? `TRX-${p.stripeSessionId.slice(-8).toUpperCase()}` : `TRX-${p._id.toString().slice(-8).toUpperCase()}`,
                    type: 'purchase',
                    email: p.userEmail || 'N/A',
                    amount: `+ $${Number(p.amount || 0).toFixed(2)}`,
                    date: p.purchaseDate ? new Date(p.purchaseDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    }) : 'N/A'
                }));

                res.send(transactions);
            } catch (error) {
                console.error("Error fetching transactions:", error);
                res.status(500).send({ message: "Failed to fetch transactions" });
            }
        });

        // --- Ebooks Routes ---
        app.get('/ebooks/admin', async (req, res) => {
            try {
                const result = await ebooksCollection.find({}).toArray();
                res.send(result);
            } catch (error) {
                console.error("Error fetching admin ebooks:", error);
                res.status(500).send({ message: "Failed to fetch ebooks" });
            }
        });

        app.get('/ebooks/writer/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await ebooksCollection.find({ writerEmail: email }).toArray();
                res.send(result);
            } catch (error) {
                console.error("Error fetching writer ebooks:", error);
                res.status(500).send({ message: "Failed to fetch ebooks" });
            }
        });

        app.get('/ebooks', async (req, res) => {
            try {
                const result = await ebooksCollection.find({ isSold: false }).toArray();
                res.send(result);
            } catch (error) {
                console.error("Error fetching public ebooks:", error);
                res.status(500).send({ message: "Failed to fetch ebooks" });
            }
        });

        app.get('/ebooks/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const result = await ebooksCollection.findOne({ _id: new ObjectId(id) });
                if (!result) {
                    return res.status(404).send({ message: "Ebook not found!" });
                }
                res.send(result);
            } catch (error) {
                console.error("Error fetching ebook details:", error);
                res.status(500).send({ message: "Failed to fetch ebook details" });
            }
        });

        app.post('/ebooks', async (req, res) => {
            try {
                const newEbook = req.body;
                newEbook.uploadDate = new Date();

                const result = await ebooksCollection.insertOne(newEbook);
                res.send(result);
            } catch (error) {
                console.error("Error adding ebook:", error);
                res.status(500).send({ message: "Failed to add ebook" });
            }
        });

        app.patch('/ebooks/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;

                const result = await ebooksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );
                res.send(result);
            } catch (error) {
                console.error("Error updating ebook:", error);
                res.status(500).send({ message: "Failed to update ebook" });
            }
        });

        app.delete('/ebooks/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const result = await ebooksCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                console.error("Error deleting ebook:", error);
                res.status(500).send({ message: "Failed to delete ebook" });
            }
        });


        // --- Admin Dashboard Stats Route ---
        app.get('/api/admin/dashboard-stats', async (req, res) => {
            try {
                const allPurchases = await purchasesCollection.find({ status: 'completed' }).toArray();
                const allEbooks = await ebooksCollection.find({}).toArray();

                const totalUsers = await usersCollection.estimatedDocumentCount();

                const uniqueWriters = new Set(allEbooks.map(e => e.writerEmail).filter(Boolean));
                const totalWriters = uniqueWriters.size;

                const totalRevenue = allPurchases.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                const ebooksSold = allPurchases.length;

                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const salesByMonth = {};

                allPurchases.forEach(p => {
                    if (p.purchaseDate) {
                        const date = new Date(p.purchaseDate);
                        const month = monthNames[date.getMonth()];
                        salesByMonth[month] = (salesByMonth[month] || 0) + (Number(p.amount) || 0);
                    }
                });

                const salesData = monthNames.map(month => ({
                    name: month,
                    total: Number((salesByMonth[month] || 0).toFixed(2))
                }))

                const genreCounts = {};
                allEbooks.forEach(e => {
                    const genre = e.category || e.genre || 'Others';
                    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                });

                const genreData = Object.keys(genreCounts).map(genre => ({
                    name: genre,
                    value: genreCounts[genre]
                }));

                res.send({
                    stats: { totalUsers, totalWriters, ebooksSold, totalRevenue },
                    salesData: salesData.length ? salesData : [{ name: 'No Data', total: 0 }],
                    genreData: genreData.length ? genreData : [{ name: 'No Data', value: 1 }]
                });

            } catch (error) {
                console.error("Error fetching dashboard stats:", error);
                res.status(500).send({ message: "Failed to fetch dashboard stats" });
            }
        });

        // --- Writer Sales History Route ---
        app.get('/api/sales/writer/:email', async (req, res) => {
            try {
                const writerEmail = req.params.email;

                const writerEbooks = await ebooksCollection.find({ writerEmail }).toArray();

                const ebookIds = writerEbooks.map(ebook => ebook._id.toString());

                const purchases = await purchasesCollection
                    .find({
                        ebookId: { $in: ebookIds },
                        status: 'completed'
                    })
                    .sort({ purchaseDate: -1 })
                    .toArray();
                console.log("Purchases found:", purchases.length);

                const salesData = purchases.map(p => ({
                    title: p.ebookTitle || 'Unknown Ebook',
                    buyer: p.userEmail || 'N/A',
                    date: p.purchaseDate ? new Date(p.purchaseDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    }) : 'N/A',
                    amount: `$${Number(p.amount || 0).toFixed(2)}`
                }));

                res.send(salesData);
            } catch (error) {
                console.error("Error fetching writer sales:", error);
                res.status(500).send({ error: "Failed to fetch sales history" });
            }
        });


        // --- Wishlist Routes ---
        app.post('/wishlist', async (req, res) => {
            try {
                const item = req.body;
                const existingItem = await wishlistCollection.findOne({
                    userEmail: item.userEmail,
                    ebookId: item.ebookId
                });

                if (existingItem) {
                    return res.send({ message: "Already in wishlist", insertedId: null });
                }

                const result = await wishlistCollection.insertOne(item);
                res.send(result);
            } catch (error) {
                console.error("Wishlist add error:", error);
                res.status(500).send({ message: "Failed to add to wishlist" });
            }
        });

        app.get('/wishlist/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await wishlistCollection.find({ userEmail: email }).toArray();
                res.send(result);
            } catch (error) {
                console.error("Wishlist fetch error:", error);
                res.status(500).send({ message: "Failed to fetch wishlist" });
            }
        });

        app.get('/wishlist/check/:email/:ebookId', async (req, res) => {
            try {
                const { email, ebookId } = req.params;
                const result = await wishlistCollection.findOne({ userEmail: email, ebookId: ebookId });
                res.send({ isBookmarked: !!result });
            } catch (error) {
                console.error("Wishlist check error:", error);
                res.status(500).send({ message: "Failed to check wishlist" });
            }
        });

        app.delete('/wishlist/item/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const result = await wishlistCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                console.error("Delete wishlist error:", error);
                res.status(500).send({ error: "Delete failed" });
            }
        });

        app.delete('/wishlist/:email/:ebookId', async (req, res) => {
            try {
                const { email, ebookId } = req.params;
                const result = await wishlistCollection.deleteOne({ userEmail: email, ebookId: ebookId });
                res.send(result);
            } catch (error) {
                console.error("Delete wishlist error:", error);
                res.status(500).send({ error: "Delete failed" });
            }
        });


        // --- Base Route & Server Listener ---
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