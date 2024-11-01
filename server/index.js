import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import pg from "pg";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fs from 'fs';
dotenv.config();

const app = express();
const PORT = 5000;

// Middleware setUp
app.use(cors());
app.use(bodyParser.json());

// Database information
const pool = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

// Load food data
const foodData = JSON.parse(fs.readFileSync('foodData.json'));

app.post('/calorie-log', async (req, res) => {
    const { food, quantity ,email} = req.body;
    const foodItem = foodData[0].Sheet1.find(item => item.Food.toLowerCase() === food.toLowerCase());

    if (foodItem) {
        const totalCalories = (foodItem.Calories * quantity)/foodItem.Serving;
        try{
            const client = await pool.connect();
            const query = 'SELECT id FROM users WHERE username = $1';
            const value = [email];
            const result = await client.query(query,value);
            if (result.rows.length > 0) {
                const userId = result.rows[0].id;
                const insertQuery = 'INSERT INTO food_log (user_id, food_name, quantity, calories, log_date) VALUES ($1, $2, $3, $4, $5)';
                const date = new Date().toISOString().split('T')[0];
                await client.query(insertQuery, [userId, food, quantity, totalCalories, date]);
                res.json({ food, quantity, totalCalories });
            } else {
                res.status(404).json({ error: "User not found" });
            }
            client.release();
        }
        catch(error){
            console.error('Error saving food log:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    } else {
        res.status(404).json({ error: "Food item not found" });
    }
});

app.get('/calorie-log', async (req, res) => {
    const {email} = req.query;
        try{
            const client = await pool.connect();
            const query = 'SELECT id FROM users WHERE username = $1';
            const value = [email];
            const result = await client.query(query,value);
            if (result.rows.length > 0) {
                const userId = result.rows[0].id;
                const selectQuery = 'SELECT * FROM food_log WHERE log_date = $1 AND user_id = $2';
                const date = new Date().toISOString().split('T')[0];
                const result2 = await client.query(selectQuery, [date, userId]);
                console.log(result2.rows);
                res.status(200).json(result2.rows);
            } else {
                res.status(404).json({ error: "User not found" });
            }
            client.release();
        }
        catch(error){
            console.error('Error saving food log:', error);
            res.status(500).json({ error: "Internal server error" });
        }
   
});

app.post('/calorie-log-similar-foods', (req, res) => {
    const { food, quantity } = req.body;
    const foodItem = foodData[0].Sheet1.filter(item => item.Food.toLowerCase().includes(food.toLowerCase()));
    if (foodItem) {
        res.json({ foodItem });
    } else {
        res.status(404).json({ error: "Food item not found" });
    }
});

// Sign up 
app.post('/api/signup', async (req , res) => {
    let data = req.body;
    console.log('Data received:', data);
    try {
        const client = await pool.connect();
        const query2 = 'SELECT * FROM users WHERE username = $1';
        const values2 = [req.body["email"]];
        const result2 = await client.query(query2, values2);
        if (result2.rows.length > 0) {
            res.status(401).json({ message: "email already exists" });
        }
        else {
            const query = 'INSERT INTO users (username, passwords) VALUES ($1, $2)';
            const values = [req.body["email"], req.body["password"]];
            await client.query(query, values);
            res.status(200).json({ message: "Account created" });
        }
        client.release();
    } catch (error) {
        console.error('Error processing form submission:', error);
        res.status(500).send('Internal server error');
    }
});

// Log In
app.post('/api/login', async(req,res) => {
    let data=req.data;
    try{
        const client = await pool.connect();
        const query = 'SELECT * FROM users WHERE username = $1';
        const value = req.body['email'];
        const result = await client.query(query, [value]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (user.passwords === req.body["password"]) {
                const token = jwt.sign(
                    { email: req.body["email"] },
                    process.env.JWT_SECRET,
                    { expiresIn: '1h' }
                );
                res.status(200).json({ message: 'Login successful', token });
            } else {
                res.status(401).json({ message: 'Incorrect password' });
            }
        } else {
            res.status(401).json({ message: 'email not found' });
        }
        client.release();
    } catch (error) {
        console.error('Error processing form submission:', error);
        res.status(500).send('Internal server error');
    }
});
// import jwt from 'jsonwebtoken';

// // Middleware to verify token and extract email
// const verifyToken = (req, res, next) => {
//     const token = req.headers['authorization']?.split(' ')[1];
//     if (!token) return res.status(403).send({ message: 'No token provided' });
    
//     jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
//         if (err) return res.status(500).send({ message: 'Failed to authenticate token' });
        
//         req.email = decoded.email;  // Save email in request object
//         next();
//     });
// };

// Post personal info with user_id lookup
app.post('/api/personalinfo', async (req, res) => {
    const { pname, age, gender, height, weight, goal } = req.body;
    const {email} = req.query;
    console.log('manisha-->',req.email);
    try {
        const client = await pool.connect();

        // Get user_id from email
        const userQuery = 'SELECT user_id FROM users WHERE username = $1';
        const userResult = await client.query(userQuery, [email]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const userId = userResult.rows[0].user_id;
        console.log('Found user_id:', userId);
        // Insert into personaldetails
        const insertQuery = 'INSERT INTO personaldetails (pname, age, gender, height, weight, goal, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        const values = [pname, age, gender, height, weight, goal, userId];
        
        await client.query(insertQuery, values);
        res.status(200).json({ message: "Personal info saved" });

        client.release();
    } catch (error) {
        console.error('Error processing personal info submission:', error);
        res.status(500).send('Internal server error');
    }
});


app.get('/goal-weight', async (req, res) => {
    console.log('Received request for goal weight:', req.query);
    const { email } = req.query;

    try {
        const client = await pool.connect();
        const query = 'SELECT user_id FROM users WHERE username = $1';
        const value = [email];
        const result = await client.query(query, value);
        console.log(result);
        if (result.rows.length > 0) {
            const userId = result.rows[0].user_id;
            const selectQuery = 'SELECT goal FROM personaldetails WHERE user_id = $1';
            const result2 = await client.query(selectQuery, [userId]);
            console.log("User goal data:", result2.rows);
            res.status(200).json(result2.rows);
        } else {
            res.status(404).json({ error: "User not found" });
        }
        client.release();
    } catch (error) {
        console.error('Error finding goal weight:', error);
        res.status(500).json({ error: "Internal server error" });
    }

});

app.get('/', (req, res) => {
    res.send('Server is working!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});