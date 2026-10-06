const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// === ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ===
// Новая строка подключения MongoDB вставляется ниже (или через переменную окружения MONGO_URI на Render)
const MONGO_URI = process.env.MONGO_URI || 'ВСТАВЬ_СЮДА_НОВУЮ_СТРОКУ_ПОДКЛЮЧЕНИЯ_MONGODB';

const app = express();
app.use(cors());
app.use(express.json()); // Обязательно для чтения JSON в req.body

mongoose.connect(MONGO_URI).then(() => {
  console.log("🟢 БАЗА ДАННЫХ ПОДКЛЮЧЕНА");
}).catch(err => {
  console.error("❌ Ошибка подключения к БД:", err);
});

// --- СХЕМЫ ---

// Схема пользователя
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' }, // 'admin' или 'user'
  isMuted: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

// Схема события (логи, отпросы, колы, баги, овертаймы, уведомления)
const eventSchema = new mongoose.Schema({
  date: { type: String, required: true },        // YYYY-MM-DD (локальная дата отправителя)
  createdAt: { type: Date, default: Date.now },
  type: { type: String, required: true },        // 'log' | 'leave' | 'call' | 'bug' | 'overtime' | 'notify'
  user: { type: String, default: '' },           // кто отправил
  data: { type: Object, default: {} },           // поля формы (ссылки, комментарии и т.д.)
  durationMin: { type: Number, default: 0 }      // для овертаймов — автоматический расчёт
});
eventSchema.index({ date: 1, type: 1 });
eventSchema.index({ user: 1, date: 1 });
const Event = mongoose.model('Event', eventSchema);

// Схема дневной статистики (трюфеля / апрувы, вбивает админ вручную)
const dailyStatSchema = new mongoose.Schema({
  date: { type: String, required: true },        // YYYY-MM-DD
  username: { type: String, required: true, lowercase: true },
  truffles: { type: Number, default: 0 },
  approves: { type: Number, default: 0 }
});
dailyStatSchema.index({ date: 1, username: 1 }, { unique: true });
const DailyStat = mongoose.model('DailyStat', dailyStatSchema);

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

// Проверка, что запрос делает админ (передаём ?admin=username в GET или adminUsername в body)
async function verifyAdmin(req, res, next) {
  try {
    const adminName = (req.query.admin || req.body.adminUsername || '').trim().toLowerCase();
    if (!adminName) {
      return res.status(401).json({ success: false, message: 'Не указан админ' });
    }
    const admin = await User.findOne({ username: adminName });
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Нет прав администратора' });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Автоматический расчёт длительности овертайма в минутах ("14:30" -> "16:00" = 90)
function calcDurationMin(from, to) {
  if (!from || !to) return 0;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  if (isNaN(fh) || isNaN(fm) || isNaN(th) || isNaN(tm)) return 0;
  let start = fh * 60 + fm;
  let end = th * 60 + tm;
  if (end < start) end += 24 * 60; // перешли через полночь
  return end - start;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
      { returnDocument: "after" }
    );

    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден в БД' });

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
      { returnDocument: "after" }
    );

    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден в БД' });

    io.emit('user_status_changed', { username: user.username, isMuted: user.isMuted, isBanned: user.isBanned });
    res.json({ success: true, isBanned: user.isBanned });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- АДМИН-РОУТЫ: ПОЛЬЗОВАТЕЛИ ---

// Список всех пользователей (для админки: мут/бан, счётчики)
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).sort({ username: 1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- СОБЫТИЯ (логи, отпросы, колы, баги, овертаймы) ---

// Приём события от приложения сотрудника
app.post('/api/events', async (req, res) => {
  try {
    const { user, type, date, ...fields } = req.body;
    if (!type) {
      return res.status(400).json({ success: false, message: 'Не указан тип события' });
    }

    const eventDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : todayStr();
    let durationMin = 0;

    // Овертайм: считаем длительность автоматически из полей from/to
    if (type === 'overtime') {
      durationMin = calcDurationMin(fields.from, fields.to);
    }

    const event = new Event({
      date: eventDate,
      type: String(type),
      user: (user || '').trim().toLowerCase(),
      data: fields,
      durationMin
    });

    await event.save();
    res.json({ success: true, id: event._id, durationMin });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// События за конкретную дату (админ жмякает на дату — видит всё, что было)
app.get('/api/events', verifyAdmin, async (req, res) => {
  try {
    const { date, type, user } = req.query;
    const filter = {};
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) filter.date = date;
    if (type) filter.type = type;
    if (user) filter.user = user.trim().toLowerCase();

    const events = await Event.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- АДМИН-РОУТЫ: СЧЁТЧИКИ ТРЮФЕЛЕЙ / АПРУВОВ (вбиваются вручную) ---

// Сохранить (или обновить) цифры за день для сотрудника
app.post('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    const { date, username, truffles, approves } = req.body;
    if (!username || !date) {
      return res.status(400).json({ success: false, message: 'Укажите дату и ник' });
    }

    const stat = await DailyStat.findOneAndUpdate(
      { date, username: username.trim().toLowerCase() },
      {
        truffles: Number(truffles) || 0,
        approves: Number(approves) || 0
      },
      { returnDocument: "after", upsert: true }
    );

    res.json({ success: true, stat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Цифры за один день (все сотрудники)
app.get('/api/admin/stats/day', verifyAdmin, async (req, res) => {
  try {
    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : todayStr();
    const stats = await DailyStat.find({ date });
    res.json({ success: true, date, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Сводка за период (неделя/месяц): трюфеля, апрувы и овертаймы суммируются автоматически
app.get('/api/admin/stats/summary', verifyAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ success: false, message: 'Укажите период from/to в формате YYYY-MM-DD' });
    }

    // Суммы трюфелей и апрувов по сотрудникам
    const statAgg = await DailyStat.aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $group: { _id: '$username', truffles: { $sum: '$truffles' }, approves: { $sum: '$approves' } } }
    ]);

    // Суммы овертаймов (автоматически посчитанных) по сотрудникам
    const overtimeAgg = await Event.aggregate([
      { $match: { date: { $gte: from, $lte: to }, type: 'overtime' } },
      { $group: { _id: '$user', overtimeMin: { $sum: '$durationMin' } } }
    ]);

    const result = {};
    statAgg.forEach(s => {
      result[s._id] = { truffles: s.truffles, approves: s.approves, overtimeMin: 0 };
    });
    overtimeAgg.forEach(o => {
      if (!result[o._id]) result[o._id] = { truffles: 0, approves: 0, overtimeMin: 0 };
      result[o._id].overtimeMin = o.overtimeMin;
    });

    res.json({ success: true, from, to, summary: result });
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

  // --- ТОЧЕЧНЫЙ ТРИГГЕР (старый формат) ---
  socket.on('admin_target_trigger', (data) => {
    for (let [id, clientNick] of onlineUsers.entries()) {
      if (clientNick && clientNick.toLowerCase() === data.targetNick.toLowerCase()) {
        io.to(id).emit('admin_trigger', { text: data.text });
        break;
      }
    }
  });

  // --- ГЛОБАЛЬНЫЙ ТРИГГЕР (старый формат) ---
  socket.on('admin_trigger', (data) => {
    io.emit('admin_trigger', data);
  });

  // --- УВЕДОМЛЕНИЕ ОТ АДМИНА (новое): всем или конкретному, поверх всех окон ---
  // data: { target: 'all' | 'ник', text: '...', from: 'Fifflaren' }
  socket.on('admin_notify', async (data) => {
    try {
      if (!data || !data.text) return;

      const payload = {
        text: String(data.text),
        from: data.from || 'Fifflaren',
        time: new Date().toLocaleTimeString('ru-RU')
      };

      // Рассылка: всем или одному конкретному нику
      if (data.target && data.target !== 'all') {
        for (let [id, clientNick] of onlineUsers.entries()) {
          if (clientNick && clientNick.toLowerCase() === String(data.target).toLowerCase()) {
            io.to(id).emit('show_notification', payload);
          }
        }
      } else {
        io.emit('show_notification', payload);
      }

      // Сохраняем в историю событий, чтобы админ видел, что отправлял
      const event = new Event({
        date: todayStr(),
        type: 'notify',
        user: (data.from || 'admin').toLowerCase(),
        data: { target: data.target || 'all', text: String(data.text) }
      });
      await event.save();
    } catch (err) {
      console.error('Ошибка отправки уведомления:', err);
    }
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
  console.log(`Сервер Support Hub v3 запущен на порту ${PORT}`);
});
