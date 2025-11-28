const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
// middle ware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// firebase admin sdk initialize;

const admin = require("firebase-admin");

const serviceAccount = require("./zap-shift-auth-a3dd7-firebase-adminsdk-fbsvc-79903a08ea.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// firebase token validation;

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  console.log("Firebase token", token);
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

// client domain
const CLIENT_DOMAIN = "http://localhost:5173";

// generate tracking ID;

const generateTrackingId = () => {
  const timestamp = Date.now().toString(36); // base36 timestamp
  const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `${timestamp}-${randomStr}`;
};

// mongodb

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster4.bhysdxj.mongodb.net/?appName=Cluster4`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // connect the client to the server;
    await client.connect();

    //create database and collection;
    const database = client.db("zapShift");
    const parcelCollection = database.collection("parcels");
    const paymentCollection = database.collection("payments");
    const userCollection = database.collection("users");
    const riderCollection = database.collection("riders");

    // verify admin;
    // Must be used after verifyFBToken middleware;

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "Admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }

      next();
    };

    //get API

    app.get("/", (req, res) => {
      res.send("zap shift server is running");
    });

    app.get("/parcels", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.senderEmail = email;
      }
      const cursor = parcelCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
        // check email address;

        if (req.decoded_email !== email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
      }
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/riders", async (req, res) => {
      const cursor = riderCollection.find().sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/user/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    //post API

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;

      const userExits = await userCollection.findOne({ email: email });

      if (userExits) {
        return res.send({ message: "This user already exits" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "Pending";
      rider.createdAt = new Date();

      const result = await riderCollection.insertOne(rider);
      res.send(result);
    });

    // update api;

    // set rider status;

    app.patch("/riders/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updateDoc = {
        $set: {
          status: status,
        },
      };
      const result = await riderCollection.updateOne(query, updateDoc);

      if (status === "Approved") {
        const updateRider = {
          $set: {
            role: "Rider",
          },
        };

        const resultRider = await riderCollection.updateOne(query, updateRider);
      }
      res.send(result);
    });

    // set user role

    app.patch("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body.role;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: roleInfo,
        },
      };

      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Delete API;

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    app.delete("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await riderCollection.deleteOne(query);
      res.send(result);
    });

    // create API for checkout session;

    app.post("/create-checkout-session", async (req, res) => {
      try {
        const parcel = req.body;
        console.log("after request checkout api", parcel);
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          customer_email: parcel.email,
          mode: "payment",

          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: parseInt(parcel.cost) * 100,
                product_data: {
                  name: parcel.name,
                },
              },
              quantity: 1,
            },
          ],

          metadata: {
            parcelId: parcel.parcelId,
          },

          success_url: `${CLIENT_DOMAIN}/dashboard/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${CLIENT_DOMAIN}/cancel`,
        });
        res.json({ url: session.url });
      } catch (error) {
        console.log("Error creating checkout session", error);
        res.status(500).json({ error: error.message });
      }
    });

    // stripe session verify API;
    // I can use get for read data from mongodb and update data for stripe payment verification.
    app.get("/session-status", async (req, res) => {
      try {
        const { session_id } = req.query;
        // stripe session retrieve;
        const session = await stripe.checkout.sessions.retrieve(session_id);

        console.log("session result", session);

        const trackingId = generateTrackingId();

        // save data ot mongodb

        const paymentInfo = {
          payment: session.payment_status,
          amount: session.amount_total,
          date: new Date(),
          transactionId: session.payment_intent,
          parcelId: session.metadata.parcelId,
          email: session.customer_email,
        };

        const existingPayment = await paymentCollection.findOne({
          transactionId: session.payment_intent,
        });

        if (!existingPayment) {
          const result = await paymentCollection.insertOne(paymentInfo);
        }

        // update database;

        if (session.payment_status === "paid") {
          const parcelId = session.metadata.parcelId;
          const query = { _id: new ObjectId(parcelId) };
          const update = {
            $set: {
              paymentStatus: "paid",
              paymentDate: new Date(),
              transactionId: session.payment_intent,
              trackingId: trackingId,
            },
          };

          const result = await parcelCollection.updateOne(query, update);

          // Attach tracking to session for frontend;
          session.trackingId = trackingId;
        }
        res.json(session);
      } catch (error) {
        console.log("Error fetching session", error);
        res.status(500).json({ error: error.message });
      }
    });

    // send a ping to confirm a successful connection;
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment.You successfully connected to the mongodb"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //     await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`zap shift server is running on port ${port}`);
});
