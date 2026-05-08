require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto=require('crypto');
const express = require('express');
const path = require('path');
const app = express();
const Port =  process.env.PORT || 5000;
const fs =require('fs');
const mysql =require('mysql2');
const axios = require('axios');


const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

const initializePayment = async (customerEmail, finalAmount,cartItem) => {
    

    const payload = {
        email: customerEmail,
        amount: finalAmount * 100,
        currency: "GHS",
        reference: "PY_" + Date.now(),
        callback_url: `${host}/index.html?payment=success`,
        metadata:{
            cart:cartItem
        }
    }

    try {
        const response = await axios.post('https://api.paystack.co/transaction/initialize', payload, {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 
                'Content-Type': 'application/json'
            }
        });

        const paymentDoorUrl = response.data.data.authorization_url;
        console.log("Handshake Successful! Send user to:", paymentDoorUrl);
        
        return paymentDoorUrl;

    } catch (error) {
        console.error("Handshake Failed!");
        
        if (error.response) {
            console.error("Paystack says:", error.response.data.message);
        } else {
            console.error("Network Error:", error.message);
        }
    }
};

db.getConnection((err, connection) => {
    if (err) {
        console.error("CRITICAL: Database Connection Error",err.message);
        process.exit(1);
    } else {
        console.log("MySQL Connected  Successfully");
        connection.release();
    }
});
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
                       .update(req.body)
                       .digest('hex');

    if (hash === req.headers['x-paystack-signature']) {
        
        const event = JSON.parse(req.body);

       if (event.event === 'charge.success') {
            const customerEmail = event.data.customer.email;
            const amountPaid = event.data.amount / 100; 
            const referenceId = event.data.reference;

            const cartData=JSON.stringify(event.data.metadata.cart);

            const sql = "INSERT INTO transactions (email, amount, reference , cart_items ) VALUES (?, ?, ?,?)";
            
            db.query(sql, [customerEmail, amountPaid, referenceId, cartData], (err, results) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        console.log(`[SHIELD DEPLOYED] Paystack sent a duplicate receipt. Blocked Ref: ${referenceId}`);
                    } else {
                        console.error("[CRITICAL] Database failed to save money:", err);
                    }
                } else {
                    console.log(`\n[VAULT SECURED] 💰 ${amountPaid} GHS permanently logged for ${customerEmail}.`);
                    console.log(`Order Details: ${cartData}`);
                    console.log(`Ref: ${referenceId}\n`);
                }
            });
        }
    } else {

       console.log("\n--- 🚨 SECUR ITY DIAGNOSTICS 🚨 ---");
        console.log("Fake Webhook Attempt Blocked. Locks did not match.");
        console.log("1. Paystack's Lock :", req.headers['x-paystack-signature']);
        console.log("2. Our Server Lock :", hash);
        console.log("3. Secret Key Length:", process.env.PAYSTACK_SECRET_KEY.length, "characters");
        console.log("4. Is Body a Buffer?:", Buffer.isBuffer(req.body));
        console.log("5. Body Length     :", req.body ? req.body.length : 0, "bytes");
        console.log("----------------------------------\n");
    }

    res.sendStatus(200);
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.post('/create-account', async (req, res) => {
    const { firstname, lastname, email, password, password2 } = req.body;

    if (password !== password2) {
        return res.status(400).send("<h1>Error: Passwords do not match!</h1><a href='/form.html'>Try Again</a>");
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const sql="INSERT INTO users (firstname,lastname,email,password) VALUES (?,?,?,?)";
        
        db.query(sql, [firstname, lastname, email, hashedPassword], (err, results) => {
            if (err) {
                console.error(`${firstname} ${lastname} attempted`);
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).send("<h1>Error</h1><p>Email already exists</p>");
                }
                return res.status(500).send("Internal Server Error");
            }
        
            console.log(`${firstname} just created an account with a secure hash.`);
            res.send(`
            <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: 'Trebuchet MS', sans-serif;
            }

            body { 
                background-color: #F9F5F0;
                color: #333;
                display: flex; 
                flex-direction: column; 
                align-items: center;    
                justify-content: center; 
                height: 100vh; 
                margin: 0; 
            }

            header {
                position: absolute; 
                top: 0;
                left: 0;
                width: 100%;
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 15px;
                background-color: white;
                box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                z-index: 10;
            }

            .loader {
                border: 4px solid #333;
                border-top: 4px solid #E0BFB8;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 1s linear infinite;
                margin-bottom: 20px;
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            .logo {
                font-size: 24px;
                color: #E0BFB8;
                font-weight: bold;
            }
            </style>
            <header>
            <div class="logo">GlowUP</div>
            </header>
            <div class="loader"></div>
            <h1>Account Created, ${firstname}!</h1>
            <p>Preparing your GlowUP experience...</p>

            <script>
                setTimeout(() => {
                    window.location.href = '/Project Home Page.html';
                }, 10000);
            </script>
            `);
        });
    } catch (error) {
        console.error("Hashing failed:", error);
        res.status(500).send("Internal Server Error");
    }
});
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    const sql = "SELECT * FROM users WHERE email = ?";

    db.query(sql, [email], async (err, results) => {
        if (err) return res.status(500).json({ success: false, message: "System Error" });

        if (results.length > 0) {
            const user = results[0];

            const isMatch = await bcrypt.compare(password, user.password);

            if (isMatch) {
                res.json({ 
                    success: true, 
                    name: user.firstname,
                    email: user.email
                });
            } else {
                res.json({ success: false, message: "Invalid Email or Password" });
            }
        } else {
            res.json({ success: false, message: "Invalid Email or Password" });
        }
    });
});
app.post('/pay', async (req, res) => {
    try {

        const host = `${req.protocol}://${req.get('host')}`;
        
        const dynamicEmail = req.body.email;
        const dynamicAmount = req.body.amount;
        const dynamicCart = req.body.cart;

        const paymentDoorUrl = await initializePayment(dynamicEmail, dynamicAmount,dynamicCart);
        
        res.json({ doorUrl: paymentDoorUrl });

    } catch (error) {
        console.error("Payment Route Failed:", error.message);
        res.status(500).json({ error: "Payment system down" });
    }
});
app.get('/success', (req,res) => {
      res.send(`'/Project Home Page.html?payment=sucess`);
});
app.get('/build-cloud', (req, res) => {
    // 1. The Users Vault Blueprint
    const usersTable = `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        firstname VARCHAR(255),
        lastname VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

    // 2. The Transactions Vault Blueprint
    const transactionsTable = `CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        reference VARCHAR(100) NOT NULL UNIQUE,
        status VARCHAR(50) DEFAULT 'success',
        cart_items TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

    // 3. The Execution
    db.query(usersTable, (err) => {
        if (err) return res.send("<h1> Failed to build Users vault:</h1> <p>" + err.message + "</p>");
        
        db.query(transactionsTable, (err) => {
            if (err) return res.send("<h1> Failed to build Transactions vault:</h1> <p>" + err.message + "</p>");
            
            res.send("<h1>Cloud Vault Successfully Constructed! </h1><p>The database is ready for business.</p>");
        });
    });
});
app.listen(Port, () => {
    console.log(`GlowUP Backend active on http://localhost:${Port}`);
});

