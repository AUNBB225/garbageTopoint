import express from 'express';
import mysql from 'mysql2/promise';

const app = express();
app.use(express.json());

async function connectToDb() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',    // hosting
      user: 'root',          // ชื่อผู้ใช้งาน MySQL
      password: '',          // รหัสผ่านฐานข้อมูล
      database: 'gaebagepoint'   // ชื่อฐานข้อมูล
    });
    return connection;
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}

// ฟังก์ชันบันทึกประวัติการทิ้งขยะ
async function insertTrashHistory(userId, amount) {
  try {
    const db = await connectToDb();
    await db.query(
      'INSERT INTO trashhistory (userid, date, amount) VALUES (?, NOW(), ?)',
      [userId, amount]
    );
    console.log('Trash history record inserted');
  } catch (error) {
    console.error('Error inserting trash history:', error);
  }
}

app.post('/submit', async (req, res) => {
  const { phone, trash_amount } = req.body;

  try {
    const db = await connectToDb();
    const [rows] = await db.query('SELECT * FROM user WHERE phone = ?', [phone]);

    if (rows.length > 0) {
      const updatedGarbage = rows[0].garbage + trash_amount;
      const updatedPoints = updatedGarbage * 5;

      await db.query('UPDATE user SET garbage = ?, point = ? WHERE phone = ?', [updatedGarbage, updatedPoints, phone]);

      // เรียกฟังก์ชันบันทึกประวัติการทิ้งขยะ
      await insertTrashHistory(rows[0].id, trash_amount);

      res.status(200).json({ message: 'Data updated', phone, updatedGarbage, updatedPoints });
    } else {
      await db.query('INSERT INTO user (phone, garbage, point) VALUES (?, ?, ?)', [phone, trash_amount, trash_amount * 5]);
      res.status(200).json({ message: 'Data inserted', phone, garbage: trash_amount, point: trash_amount * 5 });
    }
  } catch (error) {
    console.error('Error querying database:', error);
    res.status(500).json({ message: 'Database error', error });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
