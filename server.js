import express from 'express';
import mysql from 'mysql2/promise';
import winston from 'winston';
import { format } from 'winston';
const { combine, timestamp, printf } = format;

// กำหนดรูปแบบของ log
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

// สร้าง logger
const logger = winston.createLogger({
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // บันทึกลง console
    new winston.transports.Console(),
    // บันทึกลงไฟล์
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const app = express();
app.use(express.json());

async function connectToDb() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'gaebagepoint'
    });
    logger.info('Successfully connected to database');
    return connection;
  } catch (error) {
    logger.error('Database connection error:', error);
    throw error;
  }
}

async function insertTrashHistory(userId, amount) {
  try {
    const db = await connectToDb();
    await db.query(
      'INSERT INTO trashhistory (userid, date, amount) VALUES (?, NOW(), ?)',
      [userId, amount]
    );
    logger.info(`Trash history recorded - UserID: ${userId}, Amount: ${amount}`);
  } catch (error) {
    logger.error(`Error inserting trash history - UserID: ${userId}, Error: ${error.message}`);
    throw error;
  }
}

app.post('/submit', async (req, res) => {
  const { phone, trash_amount } = req.body;
  logger.info(`New submission received - Phone: ${phone}, Amount: ${trash_amount}`);

  try {
    const db = await connectToDb();
    const [rows] = await db.query('SELECT * FROM user WHERE phone = ?', [phone]);

    if (rows.length > 0) {
      const updatedGarbage = rows[0].garbage + trash_amount;
      const updatedPoints = updatedGarbage * 5;

      await db.query('UPDATE user SET garbage = ?, point = ? WHERE phone = ?', 
        [updatedGarbage, updatedPoints, phone]
      );
      logger.info(`User updated - Phone: ${phone}, New Garbage: ${updatedGarbage}, New Points: ${updatedPoints}`);

      await insertTrashHistory(rows[0].id, trash_amount);

      res.status(200).json({ message: 'Data updated', phone, updatedGarbage, updatedPoints });
    } else {
      await db.query('INSERT INTO user (phone, garbage, point) VALUES (?, ?, ?)', 
        [phone, trash_amount, trash_amount * 5]
      );
      logger.info(`New user created - Phone: ${phone}, Garbage: ${trash_amount}, Points: ${trash_amount * 5}`);
      
      res.status(200).json({ message: 'Data inserted', phone, garbage: trash_amount, point: trash_amount * 5 });
    }
  } catch (error) {
    logger.error(`Database error: ${error.message}`);
    res.status(500).json({ message: 'Database error', error });
  }
});

app.listen(3000, () => {
  logger.info('Server started on port 3000');
});