import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import pg from "pg";
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import axios from 'axios';
import cron from "node-cron";

const VULTR_API_KEY = process.env.VULTR_API_KEY;
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
    port: process.env.DB_PORT,
   
    
});
// pool.connect()
//   .then(client => {
//     console.log('Connected to PostgreSQL on Vultr');
//     client.release();
//   })
//   .catch(err => console.error('Connection error', err.stack));


// Load food data
const foodData = JSON.parse(fs.readFileSync('foodData.json'));

cron.schedule("0 0 * * *", async () => {
    try {
        await pool.query("DELETE FROM food_log WHERE log_date = CURRENT_DATE");
        console.log("Food log table reset for the day");
    } catch (error) {
        console.error("Error resetting food log table:", error);
    }
});

app.post('/chat', async (req, res) => {
    const { message } = req.body;
    console.log("---->user message",message);
    try {
      const response = await axios.post(
        'https://api.vultrinference.com/v1/chat/completions/RAG',
        {
          collection: 'fitsync',
          model: 'llama2-7b-chat-Q5_K_M',
          messages: [{ role: 'user', content: message }],
          max_tokens: 512,
          temperature: 0.8,
          top_k: 40,
          top_p: 0.9
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.VULTR_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const chatbotResponse = response.data.choices[0].message.content;
     console.log("-->c",chatbotResponse);
    res.json({ response: chatbotResponse });
    } catch (error) {
      console.error('Error communicating with Vultr API:', error);
      res.status(500).send('Error generating chatbot response');
    }
  });
app.post('/water_intake', async (req, res) => {
    const { email, glasses } = req.body;  // Updated to use req.body instead of req.query
    const date = new Date().toISOString().split('T')[0];

    try {
        const client = await pool.connect();
        
        // Step 1: Find user ID based on email
        const userQuery = 'SELECT user_id FROM users WHERE username = $1';
        const userResult = await client.query(userQuery, [email]);
        
        if (userResult.rows.length > 0) {
            const userId = userResult.rows[0].user_id;
            
            // Step 2: Update if exists, otherwise insert a new row
            const upsertQuery = `
                INSERT INTO daily_log (user_id, water_glasses, log_date)
                VALUES ($1, $2, $3)
                ON CONFLICT (user_id, log_date) 
                DO UPDATE SET water_glasses = $2;
            `;
            await client.query(upsertQuery, [userId, glasses, date]);
            client.release();
            
            res.status(200).json({ message: "Water intake updated successfully" });
        } else {
            res.status(404).json({ error: "User not found" });
        }
    } catch (error) {
        console.error('Error updating water intake:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});


app.get('/water_intake', async(req, res) => {
    const {email} = req.query;
    try {
        const client = await pool.connect();
        const query = 'SELECT user_id FROM users WHERE username = $1';
        const value = [email];
        const result = await client.query(query, value);
        if (result.rows.length > 0) {
            const userId = result.rows[0].user_id;
            const selectQuery = 'SELECT water_glasses FROM daily_log WHERE log_date = $1 AND user_id = $2';
            const date = new Date().toISOString().split('T')[0];
            const result2 = await client.query(selectQuery, [date, userId]);
            if (result2.rows.length > 0) {
                res.status(200).json(result2.rows[0].water_glasses);
            } else {
                res.status(200).json(0);
            }
        } else {
            res.status(404).json({ error: "User not found" });
        }
        client.release();
    }
    catch (error) {
        console.error('Error saving daily_log:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/calorie-log', async (req, res) => {
    const { food, quantity, email } = req.body;
    const foodItem = foodData[0].Sheet1.find(item => item.Food.toLowerCase() === food.toLowerCase());

    if (foodItem) {
        const totalCalories = (foodItem.Calories * quantity) / foodItem.Serving;
        try {
            const client = await pool.connect();
            const query = 'SELECT user_id FROM users WHERE username = $1';
            const value = [email];
            const result = await client.query(query, value);
            if (result.rows.length > 0) {
                const userId = result.rows[0].user_id;
                // inserting into food_log table 
                const insertQuery = 'INSERT INTO food_log (user_id, food_name, quantity, calories, log_date) VALUES ($1, $2, $3, $4, $5)';
                const date = new Date().toISOString().split('T')[0];
                await client.query(insertQuery, [userId, food, quantity, totalCalories, date]);

                //inserting into daily_log table
                const getCalorieQuery = 'SELECT calories from daily_log WHERE user_id = $1 AND log_date = $2';
                const calorieResult = await client.query(getCalorieQuery, [userId, date]);
                if (calorieResult.rows.length > 0) {
                    const calories = calorieResult.rows[0].calories + totalCalories;
                    const updateQuery = 'UPDATE daily_log SET calories = $1 WHERE user_id = $2 AND log_date = $3';
                    await client.query(updateQuery, [calories, userId, date]);
                }
                else{
                    const insertCalorieQuery = 'INSERT INTO daily_log (user_id,calories,log_date) VALUES ($1,$2,$3)';
                    await client.query(insertCalorieQuery, [userId, totalCalories, date]);
                }
                res.json({ food, quantity, totalCalories });
            } else {
                res.status(404).json({ error: "User not found" });
            }
            client.release();
        }
        catch (error) {
            console.error('Error saving food log:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    } else {
        res.status(404).json({ error: "Food item not found" });
    }
});

app.get('/calorie-log', async (req, res) => {
    const { email } = req.query;
    try {
        const client = await pool.connect();
        const query = 'SELECT user_id FROM users WHERE username = $1';
        const value = [email];
        const result = await client.query(query, value);
        if (result.rows.length > 0) {
            const userId = result.rows[0].user_id;
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
    catch (error) {
        console.error('Error saving food log:', error);
        res.status(500).json({ error: "Internal server error" });
    }

});

app.get('/total_calories', async(req, res) => {
    const {email} = req.query;
    try {
        const client = await pool.connect();
        const query = 'SELECT user_id FROM users WHERE username = $1';
        const value = [email];
        const result = await client.query(query, value);
        if (result.rows.length > 0) {
            const userId = result.rows[0].user_id;
            const selectQuery = 'SELECT calories FROM daily_log WHERE log_date = $1 AND user_id = $2';
            const date = new Date().toISOString().split('T')[0];
            const result2 = await client.query(selectQuery, [date, userId]);
            if (result2.rows.length > 0) {
                const totalCalories = result2.rows[0].calories;
                res.status(200).json(totalCalories); // Returning only the calorie value
            } else {
                res.status(200).json(0); // No calories logged for today, returning 0
            }
        } else {
            res.status(404).json({ error: "User not found" });
        }
        client.release();
    }
    catch (error) {
        console.error('Error saving daily_log:', error);
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
app.get('/daily-log', async (req, res) => {
    const { email, date } = req.query; // Accept date as a query parameter
    console.log("email-->",email);
    console.log("date-->",date);
    try {
        const client = await pool.connect();

        // Query to fetch the user ID based on the provided email
        const query = 'SELECT user_id FROM users WHERE username = $1'; // Corrected from 'username' to 'email'
        const value = [email];
        const result = await client.query(query, value);

        if (result.rows.length > 0) {
            const userId = result.rows[0].user_id;

            // Query to fetch the daily log for the specified date and user ID
            const selectQuery = 'SELECT * FROM daily_log WHERE log_date = $1 AND user_id = $2';
            const result2 = await client.query(selectQuery, [date, userId]); // Use provided date

            console.log(result2);
            res.status(200).json(result2.rows);
        } else {
            res.status(404).json({ error: "User not found" });
        }

        client.release();
    } catch (error) {
        console.error('Error fetching daily log:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});


app.post('/workout-calorie', async (req, res) => {
    const { calories_burned, email } = req.body;
        try {
            const client = await pool.connect();
            const query = 'SELECT user_id FROM users WHERE username = $1';
            const value = [email];
            const result = await client.query(query, value);
            if (result.rows.length > 0) {
                const userId = result.rows[0].user_id;
                const date = new Date().toISOString().split('T')[0];
                const getCalorieQuery = 'SELECT calories from daily_log WHERE user_id = $1 AND log_date = $2';
                const calorieResult = await client.query(getCalorieQuery, [userId, date]);
                if (calorieResult.rows.length > 0) {
                    const calories = calorieResult.rows[0].calories - calories_burned;
                    const updateQuery = 'UPDATE daily_log SET calories = $1 WHERE user_id = $2 AND log_date = $3';
                    await client.query(updateQuery, [calories, userId, date]);
                }
                else{
                    calories_burned *= -1;
                    const insertCalorieQuery = 'INSERT INTO daily_log (user_id,calories,log_date) VALUES ($1,$2,$3)';
                    await client.query(insertCalorieQuery, [userId, calories_burned, date]);
                }
                res.status(200);
            } else {
                res.status(404).json({ error: "User not found" });
            }
            client.release();
        }
        catch (error) {
            console.error('error saving calories burned by workout:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

// Sign up 
app.post('/api/signup', async (req, res) => {
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
            const token = jwt.sign(
                { email: req.body["email"] },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            res.status(200).json({ message: 'account created', token });
        }
        client.release();
    } catch (error) {
        console.error('Error processing form submission:', error);
        res.status(500).send('Internal server error');
    }
});

// Log In
app.post('/api/login', async (req, res) => {
    let data = req.data;
    try {
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
app.listen(process.env.PORT, () => {
    console.log(`Server is running on http://localhost:${process.env.PORT}`);
});