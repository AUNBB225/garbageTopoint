import express from 'express';
import mysql from 'mysql2/promise';
import winston from 'winston';
import { format } from 'winston';
import os from 'os';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import path from 'path';
import session from 'express-session';

// สร้าง __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// โหลด environment variables
dotenv.config();

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
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

function getNetworkAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface_ of interfaces[name]) {
      if (interface_.family === 'IPv4' && !interface_.internal) {
        return interface_.address;
      }
    }
  }
  return 'localhost';
}

const app = express();
app.use(express.json());

async function connectToDb() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });
    
    console.log('\x1b[32m%s\x1b[0m', '✓ เชื่อมต่อฐานข้อมูลสำเร็จ!');
    logger.info('Successfully connected to database');
    return connection;
  } catch (error) {
    console.log('\x1b[31m%s\x1b[0m', '✗ ไม่สามารถเชื่อมต่อฐานข้อมูลได้!');
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
    await db.end();
  } catch (error) {
    logger.error(`Error inserting trash history - UserID: ${userId}, Error: ${error.message}`);
    throw error;
  }
}

app.post('/submit', async (req, res) => {
  const { phone, trash_amount } = req.body;

  if (!phone || !trash_amount || trash_amount < 0) {
    return res.status(400).json({ 
      message: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบข้อมูลที่ส่งมา',
      error: 'INVALID_INPUT'
    });
  }

  logger.info(`New submission received - Phone: ${phone}, Amount: ${trash_amount}`);

  try {
    const db = await connectToDb();
    const [rows] = await db.query('SELECT * FROM user WHERE phone = ?', [phone]);

    if (rows.length > 0) {
      // คำนวณคะแนนจากขยะที่ทิ้งครั้งนี้
      const pointsEarned = trash_amount * parseInt(process.env.POINTS_PER_GARBAGE);
      
      // อัพเดทโดยบวกค่าเข้าไปในคอลัมน์ที่มีอยู่
      await db.query(
        'UPDATE user SET garbage = garbage + ?, point = point + ? WHERE phone = ?', 
        [trash_amount, pointsEarned, phone]
      );

      // ดึงข้อมูลล่าสุดหลังอัพเดท
      const [updatedUser] = await db.query('SELECT garbage, point FROM user WHERE phone = ?', [phone]);
      
      logger.info(`User updated - Phone: ${phone}, Added Garbage: ${trash_amount}, Points Added: ${pointsEarned}, Total Points: ${updatedUser[0].point}`);

      await insertTrashHistory(rows[0].id, trash_amount);
      await db.end();

      res.status(200).json({ 
        message: 'Data updated', 
        phone, 
        totalGarbage: updatedUser[0].garbage,
        pointsEarned: pointsEarned,
        totalPoints: updatedUser[0].point
      });
    } else {
      await db.end();
      
      logger.info(`User not found - Phone: ${phone}`);
      res.status(404).json({ 
        message: 'ไม่พบผู้ใช้ในระบบ กรุณาลงทะเบียนก่อนใช้งาน',
        error: 'USER_NOT_FOUND'
      });
    }
  } catch (error) {
    logger.error(`Database error: ${error.message}`);
    res.status(500).json({ message: 'Database error', error });
  }
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
const networkAddress = getNetworkAddress();

app.listen(PORT, () => {
  console.log('\n=== Garbage Point Server ===');
  console.log('\x1b[36m%s\x1b[0m', `✓ Server is running on:`);
  console.log(`  • Local:     http://localhost:${PORT}`);
  console.log(`  • Network:   http://${networkAddress}:${PORT}\n`);
  console.log('Attempting to connect to database...\n');
  
  connectToDb().catch(err => {
    console.error('Failed to establish initial database connection');
  });
});

//--------------------------------------------------------------------------------------------------------------------------



// ตั้งค่า session
app.use(session({
  secret: '6a7f61a6c37d9d344d3c1a4f60a48107d84d44c5e9c64b3ff52d330f72e832b4', // คีย์สำหรับเข้ารหัส session
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // สำหรับ development; ใช้ true สำหรับ production กับ HTTPS
}));

// Middleware ตรวจสอบสถานะการล็อกอิน
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login'); // ถ้าไม่ได้ล็อกอินให้ไปที่หน้า Login
}



app.set('view engine', 'ejs');
app.set('views', './views');

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// เส้นทางสำหรับ Login
app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/views/login.html');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      message: 'กรุณากรอก Username และ Password',
      error: 'INVALID_INPUT'
    });
  }

  try {
    const db = await connectToDb();
    const [rows] = await db.query(
      'SELECT * FROM user WHERE username = ?',
      [username]
    );

    if (rows.length > 0) {
      const storedHashedPassword = rows[0].password;

      // ตรวจสอบรหัสผ่าน
      const isMatch = await bcrypt.compare(password, storedHashedPassword);

      if (isMatch) {
        // บันทึกข้อมูลผู้ใช้ใน session
        req.session.user = { id: rows[0].id, username: rows[0].username };

        res.redirect('/index'); // หลังจากล็อกอินสำเร็จให้ไปที่หน้า index
      } else {
        res.status(401).json({
          message: 'Password ไม่ถูกต้อง',
          error: 'INVALID_CREDENTIALS'
        });
      }
    } else {
      res.status(404).json({
        message: 'ไม่พบ Username ในระบบ',
        error: 'USER_NOT_FOUND'
      });
    }

    await db.end();
  } catch (error) {
    logger.error(`Login error: ${error.message}`);
    res.status(500).json({
      message: 'เกิดข้อผิดพลาดในระบบ',
      error: error.message
    });
  }
});

// เส้นทางสำหรับ Register
app.get('/register', (req, res) => {
  res.sendFile(__dirname + '/public/views/register.html');
});
app.post('/register', async (req, res) => {
  const { phone, firstName, lastName, username, password, email } = req.body;

  if (!phone || !firstName || !lastName || !username || !password || !email) {
    return res.status(400).json({
      message: 'กรุณากรอกข้อมูลให้ครบถ้วน',
      error: 'INVALID_INPUT'
    });
  }

  try {
    const db = await connectToDb();

    // ตรวจสอบว่า phone หรือ username ซ้ำหรือไม่
    const [existingUsers] = await db.query(
      'SELECT * FROM user WHERE phone = ? OR username = ?',
      [phone, username]
    );

    if (existingUsers.length > 0) {
      res.status(409).json({
        message: 'เบอร์โทรหรือ Username นี้มีอยู่แล้วในระบบ',
        error: 'DUPLICATE_USER'
      });
    } else {
      // แฮชรหัสผ่านก่อนบันทึก
      const hashedPassword = await bcrypt.hash(password, 10);

      // เพิ่มข้อมูลผู้ใช้ใหม่
      await db.query(
        'INSERT INTO user (firstName, lastName, username, phone, password, email) VALUES (?, ?, ?, ?, ?, ?)',
        [firstName, lastName, username, phone, hashedPassword, email]
      );

      // บันทึกข้อมูลผู้ใช้ใน session
      req.session.user = { username, firstName, lastName };

      res.redirect('/index'); // หลังจากสร้างบัญชีสำเร็จให้ไปที่หน้า index
    }

    await db.end();
  } catch (error) {
    logger.error(`Register error: ${error.message}`);
    res.status(500).json({
      message: 'เกิดข้อผิดพลาดในระบบ',
      error: error.message
    });
  }
});

// เส้นทางสำหรับ Index
app.get('/index', isAuthenticated, (req, res) => {
  res.sendFile(__dirname + '/public/views/index.html');
});

// เส้นทาง Logout
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Error destroying session:', err);
    }
    res.redirect('/login'); // กลับไปหน้า Login หลัง Logout
  });
});