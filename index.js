const express = require('express');
const app = express()
const port = process.env.PORT || 5000;
const jwt = require('jsonwebtoken');
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config()

const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)

// middleware
app.use(cors())
app.use(express.json())

// send payment confirmation email
// let transporter = nodemailer.createTransport({
//     host: 'smtp.sendgrid.net',
//     port: 587,
//     auth: {
//         user: "apikey",
//         pass: process.env.SENDGRID_API_KEY
//     }
// })
// This is your API key that you retrieve from www.mailgun.com/cp (free up to 10K monthly emails)
const auth = {
    auth: {
        api_key: process.env.EMAIL_PRIVATE,
        domain: process.env.EMAIL_DOMAIN
    }
}

const transporter = nodemailer.createTransport(mg(auth));
const sendPaymentConfirmationEmail = payment => {
    transporter.sendMail({
        from: "mdalve1091@gmail.com", // verified sender email
        to:'mdalve1091@gmail.com', // recipient email
        subject: "Your order is confirmed.Class start soon", // Subject line
        text: "Write Here!", // plain text body
        html: `
            <html>
                <head>
                    <style>
                        /* Add your custom styles here */
                    </style>
                </head>
                <body>
                    <h1>Payment Confirmation</h1>
                    <p>Dear Customer,</p>
                    <p>We are pleased to inform you that your payment has been successfully received and your order is confirmed.</p>
                    <p>Class Details:</p>
                    <ul>
                        <li>Course: ${payment.className}</li>
                        <li>Date: ${payment.date}</li>
                        <li>Transaction Id: ${payment.TransactionId}</li>
                        <li>Location: [Insert location]</li>
                    </ul>
                    <p>We look forward to seeing you in the class. Should you have any questions or require further assistance, please don't hesitate to contact us.</p>
                    <p>Thank you for choosing our services.</p>
                    <p>Best regards,</p>
                    <p>The Sportopia Team</p>
                </body>
            </html>
        `, // html body
    }, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}



// jwt verify
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
        if (error) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}

// mongodb code

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.c9irx2a.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        const userCollection = client.db('SportopiaDB').collection('Users')
        const classCollection = client.db('SportopiaDB').collection('classes')
        const selectedClassCollection = client.db('SportopiaDB').collection('selectedClasses')
        const paymentCollection = client.db('SportopiaDB').collection('payment')
        const feedbackCollection = client.db('SportopiaDB').collection('feedback')

        // json web token
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
            res.send({ token })
        })

        // home page: get popular classes
        app.get('/popularClasses', async (req, res) => {
            const result = await classCollection.find().sort({ enrolledStudents: -1 })
                .limit(6).toArray()
            res.send(result)
        })

        // home page: get popular instructor
        app.get('/popularInstructor', async (req, res) => {
            const query = { role: 'instructor' }
            const result = await userCollection.find(query).limit(6).toArray()
            res.send(result)
        })

        // verify admin
        // Warning: use verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email
            const query = { email: email }
            const user = await userCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next();
        }
        // verify Instructor
        // Warning: use verifyJWT before using verifyInstructor
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email
            const query = { email: email }
            const user = await userCollection.findOne(query)
            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next();
        }
        // admin : manage classes
        app.get('/manageClasses', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const result = await classCollection.find().toArray()
            res.send(result)
        })
        app.patch('/approve/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    status: 'approve'
                },
            };
            console.log(updateDoc);
            const result = await classCollection.updateOne(filter, updateDoc)

            res.send(result);
        })
        app.patch('/deny/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    status: 'denied'
                },
            };
            const result = await classCollection.updateOne(filter, updateDoc)
            res.send(result);
        })
        // admin feedback
        app.post('/feedback', async (req, res) => {
            const feedback = req.body;
            const result = await feedbackCollection.insertOne(feedback)
            res.send(result)
        })
        // get feedback to show the instructor page
        app.get('/getFeedback', async (req, res) => {
            const email = req.query.email
            const query = { instructorEmail: email }
            const result = await feedbackCollection.find(query).toArray()
            res.send(result)
        })

        // user collection api starts
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existUser = await userCollection.findOne(query)
            if (existUser) {
                return res.send({ message: 'User already exist' })
            }
            const result = await userCollection.insertOne(user)
            res.send(result)
        })
        app.post('/selectClass', async (req, res) => {
            const selectedClassInfo = req.body;
            const result = await selectedClassCollection.insertOne(selectedClassInfo);
            res.send(result)
        })
        // get student or user selected class
        app.get('/selectedClasses', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const result = await selectedClassCollection.find({ userEmail: email }).toArray()
            res.send(result)
        })

        app.get('/getUsers', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const result = await userCollection.find().toArray();
            res.send(result)
        })
        // get single user by email
        app.get('/singleUser', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const result = await userCollection.findOne({ email: email })
            res.send(result)
        })
        // get all classes to show the classes page
        app.get('/classes', async (req, res) => {
            const query = { status: 'approve' }
            const result = await classCollection.find(query).toArray()
            res.send(result)
        })

        // check admin
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req?.decoded?.email !== email) {
                res.send({ admin: false })
            }
            const query = { email: email }
            const user = await userCollection.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })

        // check instructor
        app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req?.decoded?.email !== email) {
                res.send({ admin: false })
            }
            const query = { email: email }
            const user = await userCollection.findOne(query)
            const result = { instructor: user?.role === 'instructor' }
            res.send(result)
        })

        //   make admin
        app.patch('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc)
            res.send(result);
        })

        //   make instructor
        app.patch('/users/instructor/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'instructor'
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc)
            res.send(result);
        })
        app.delete('/selectedClass/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const filter = { _id: new ObjectId(id) }
            const result = await selectedClassCollection.deleteOne(filter)
            res.send(result)
        })
        // user collection api ends

        // instructor api starts
        app.post('/addClass', verifyJWT, verifyInstructor, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const newClass = req.body;
            const result = await classCollection.insertOne(newClass)
            res.send(result)
        })

        app.get('/myClasses', verifyJWT, verifyInstructor, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const query = { email: email }
            const result = await classCollection.find(query).toArray()
            res.send(result)
        })
        // get all the instructor
        app.get('/instructor', async (req, res) => {
            const query = { role: 'instructor' }
            const result = await userCollection.find(query).toArray()
            res.send(result)
        })
        // instructor api ends


        // payment api
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.post('/payment', verifyJWT, async (req, res) => {
            const payment = req.body;
            const { itemId, selectedItemId } = payment;
            try {
                // Insert payment into paymentCollection
                const paymentResult = await paymentCollection.insertOne(payment);

                // Update classCollection to decrease availableSeats and increase enrolledStudents
                const classFilter = { _id: new ObjectId(itemId) };
                const classUpdate = {
                    $inc: {
                        availableSeats: -1,
                        enrolledStudents: 1
                    }
                };
                const classUpdateResult = await classCollection.updateOne(classFilter, classUpdate);

                // Delete the selected item from selectedClassCollection
                const selectedClassFilter = { _id: new ObjectId(selectedItemId) };
                const deleteResult = await selectedClassCollection.deleteOne(selectedClassFilter);

                // send an email confirming payment
                sendPaymentConfirmationEmail(payment)

                res.send({ paymentResult, classUpdateResult, deleteResult });
            } catch (error) {
                console.error('Error updating class collection:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // payment history api
        app.get('/paymentHistory', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const sortOptions = { date: -1 }; // Sort in descending order based on the 'date' field
            const result = await paymentCollection.find(query).sort(sortOptions).toArray();
            res.send(result);
        });



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Sportopia running')
})
app.listen(port, () => {
    console.log('Sportopia running on the port', port);
})