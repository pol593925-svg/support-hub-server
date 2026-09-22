const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json()); // Обязательно для чтения JSON в req.body

// Подключение к MongoDB Atlas
mongoose.connect('mongodb+srv://pol593925-db_user:KyhBPWDTsl05Gi5x@cluster0.7qqrq30.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("🟢 БАЗА ДАННЫХ ПОДКЛЮЧЕНА");
}).catch(err => {
  console.error("❌ Ошибка подключения к БД:", err);
});

// Схема пользователя
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' }, // 'admin' или 'user'
  isMuted: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

// --- РОУТЫ АВТОРИЗАЦИИ И РЕГИСТРАЦИИ ---

// Регистрация
app.post('/api/register', async (req, res) => {
  try {
    let { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Заполните все поля!' });
    }

    username = username.trim().toLowerCase();

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Такой пользователь уже существует!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Если регистрируешься ты, автоматически даем права админа
    const role = (username === 'fifflaren') ? 'admin' : 'user';

    const newUser = new User({
      username,
      password: hashedPassword,
      role
    });

    await newUser.save();
    res.json({ success: true, message: 'Регистрация успешна!', role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Вход (Логин)
app.post('/api/login', async (req, res) => {
  try {
    let { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Заполните все поля!' });
    }

    username = username.trim().toLowerCase();

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Неверный логин или пароль!' });
    }

    if (user.isBanned) {
      return res.status(403).json({ success: false, message: 'Ваш аккаунт заблокирован администратором!' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Неверный логин или пароль!' });
    }

    res.json({ 
      success: true, 
      message: 'Успешный вход!', 
      username: user.username, 
      role: user.role,
      isMuted: user.isMuted 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- РОУТЫ МОДЕРАЦИИ (Мут / Бан) ---

// Мут / Размут пользователя
app.post('/api/moderate/mute', async (req, res) => {
  try {
    let { username, isMuted } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Не указан пользователь' });

    username = username.trim().toLowerCase();
    const user = await User.findOneAndUpdate(
      { username },
      { isMuted },
      { new: true }
    );

    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден в БД' });

    // Рассылаем обновленный статус всем подключенным клиентам
    io.emit('user_status_changed', { username: user.username, isMuted: user.isMuted, isBanned: user.isBanned });
    res.json({ success: true, isMuted: user.isMuted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Бан / Разбан пользователя
app.post('/api/moderate/ban', async (req, res) => {
  try {
    let { username, isBanned } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Не указан пользователь' });

    username = username.trim().toLowerCase();
    const user = await User.findOneAndUpdate(
      { username },
      { isBanned },
      { new: true }
    );

    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден в БД' });

    // Рассылаем обновленный статус всем подключенным клиентам
    io.emit('user_status_changed', { username: user.username, isMuted: user.isMuted, isBanned: user.isBanned });
    res.json({ success: true, isBanned: user.isBanned });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- СЕРВЕР И СОКЕТЫ ---

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Список активных пользователей в чате
let onlineUsers = new Map(); // socket.id -> nick

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // Пользователь представился ником при входе в чат
  socket.on('join_chat', (nick) => {
    if (!nick) return;
    onlineUsers.set(socket.id, nick);
    broadcastOnlineUsers();
  });

  // Получаем сообщение от клиента и рассылаем всем (проверяем, не в муте ли)
  socket.on('chat_message', async (data) => {
    try {
      if (data && data.username) {
        const user = await User.findOne({ username: data.username.toLowerCase() });
        if (user && user.isMuted) {
          socket.emit('chat_error', { message: 'Вы получили мут и не можете писать в чат!' });
          return;
        }
        if (user && user.isBanned) {
          return;
        }
      }
      io.emit('chat_message', data);
    } catch (err) {
      console.error('Ошибка при проверке прав сообщения:', err);
    }
  });

  // --- ТОЧЕЧНЫЙ ТРИГГЕР ---
  socket.on('admin_target_trigger', (data) => {
    for (let [id, clientNick] of onlineUsers.entries()) {
      if (clientNick && clientNick.toLowerCase() === data.targetNick.toLowerCase()) {
        io.to(id).emit('admin_trigger', { text: data.text });
        break;
      }
    }
  });

  // --- ГЛОБАЛЬНЫЙ ТРИГГЕР ---
  socket.on('admin_trigger', (data) => {
    io.emit('admin_trigger', data);
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
  });
});

function broadcastOnlineUsers() {
  const uniqueNicks = Array.from(new Set(onlineUsers.values()));
  io.emit('update_chat_users', uniqueNicks);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер чата запущен на порту ${PORT}`);
});