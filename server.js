const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// === ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ===
// Новая строка подключения MongoDB вставляется ниже (или через переменную окружения MONGO_URI на Render)
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://sashabriginets8_db_user:L0WmfQD7AfSRHYox@cluster0.swcowbh.mongodb.net/?appName=Cluster0';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' })); // картинки ленты и аватарки приходят base64 в JSON

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
  team: { type: String, default: '' },     // команда (из списка команд админа)
  position: { type: String, default: '' }, // должность (ставит админ в админке)
  email: { type: String, default: '' },    // почта сотрудника (админ вбивает; для уведомлений)
  avatar: { type: String, default: '' },   // аватарка (data URL, ставит сам)
  isMuted: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

// Схема команды (Штаб). Админ добавляет, при регистрации выбирают
const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true }
});
const Team = mongoose.model('Team', teamSchema);

// Схема записи справочника бирж
const exchangeSchema = new mongoose.Schema({
  section: { type: String, enum: ['yes', 'condition', 'no'], required: true },
  name: { type: String, required: true, trim: true },
  condition: { type: String, default: '' }
});
exchangeSchema.index({ section: 1, name: 1 }, { unique: true });
const Exchange = mongoose.model('Exchange', exchangeSchema);

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

// Схема задачи чек-листа дня
const taskSchema = new mongoose.Schema({
  date: { type: String, required: true },   // YYYY-MM-DD
  text: { type: String, required: true },
  createdBy: { type: String, default: '' },
  done: { type: [String], default: [] }     // ники, кто отметил выполненным
});
const Task = mongoose.model('Task', taskSchema);

// Схема записи ленты картинок
const feedItemSchema = new mongoose.Schema({
  user: { type: String, required: true },
  dataUrl: { type: String, required: true },
  caption: { type: String, default: '' },
  likes: { type: [String], default: [] },
  dislikes: { type: [String], default: [] },
  comments: { type: [{ user: String, text: String, time: String }], default: [] },
  pinned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const FeedItem = mongoose.model('FeedItem', feedItemSchema);

// Схема личного сообщения
const messageSchema = new mongoose.Schema({
  from: { type: String, required: true, lowercase: true },
  to: { type: String, required: true, lowercase: true },
  text: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
messageSchema.index({ from: 1, to: 1, createdAt: -1 });
const Message = mongoose.model('Message', messageSchema);

// Схема свайп-оценки (Дайсерчвинчик): один голос «от→кому»
const swipeSchema = new mongoose.Schema({
  from: { type: String, required: true, lowercase: true },
  to: { type: String, required: true, lowercase: true },
  kind: { type: String, enum: ['like', 'dislike'], required: true },
  createdAt: { type: Date, default: Date.now }
});
swipeSchema.index({ from: 1, to: 1 }, { unique: true });
const Swipe = mongoose.model('Swipe', swipeSchema);

// Схема зарплатной ведомости (вносит ТЛ своей команде) — 3.3.0
const salarySchema = new mongoose.Schema({
  month: { type: String, required: true },              // 'YYYY-MM'
  username: { type: String, required: true, lowercase: true },
  team: { type: String, default: '' },
  weeks: { type: [Number], default: [0, 0, 0, 0] },     // суммы за недели 1–4
  fines: { type: [{ amount: Number, reason: String, date: String, by: String }], default: [] },
  updatedBy: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});
salarySchema.index({ month: 1, username: 1 }, { unique: true });
const Salary = mongoose.model('Salary', salarySchema);

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

// Проверка, что запрос делает ТЛ (ник совпадает с названием команды) — 3.3.0
async function verifyTL(req, res, next) {
  try {
    const tlName = (req.query.tl || req.body.tl || '').trim().toLowerCase();
    if (!tlName) {
      return res.status(401).json({ success: false, message: 'Не указан ТЛ' });
    }
    const team = await Team.findOne({ name: new RegExp('^' + tlName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
    if (!team) {
      return res.status(403).json({ success: false, message: 'Нет команды с таким ником — вы не ТЛ' });
    }
    req.tlName = tlName;
    req.tlTeam = team.name;
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Среднее время между чеками (события типа 'log') пользователя за месяц, в минутах — 3.3.0
async function avgCheckTimeMin(username, month) {
  const start = new Date(month + '-01T00:00:00');
  if (isNaN(start.getTime())) return 0;
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const logs = await Event.find({
    user: username,
    type: 'log',
    createdAt: { $gte: start, $lt: end }
  }).sort({ createdAt: 1 }).limit(2000);
  if (logs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < logs.length; i++) {
    sum += (logs[i].createdAt - logs[i - 1].createdAt) / 60000;
  }
  return Math.round(sum / (logs.length - 1));
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

    // Команда (проверяем, что она существует в списке команд)
    let team = '';
    if (req.body.team) {
      const teamName = String(req.body.team).trim();
      const teamDoc = await Team.findOne({ name: new RegExp(`^${teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
      if (!teamDoc) {
        return res.status(400).json({ success: false, message: 'Такой команды не существует!' });
      }
      team = teamDoc.name;
    }

    const newUser = new User({
      username,
      password: hashedPassword,
      role,
      team
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
      team: user.team || '',
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

    // Уведомляем ТЛ команды: ТЛ — пользователь, чей ник совпадает с названием команды
    if (['call', 'leave', 'shift', 'bug'].includes(String(type))) {
      try {
        const sender = await User.findOne({ username: event.user });
        if (sender && sender.team) {
          const tlNick = sender.team.trim().toLowerCase();
          // ТЛ не получает уведомления о собственных действиях
          if (tlNick && tlNick !== event.user) {
            const payload = {
              type: String(type),
              user: event.user,
              data: fields,
              time: new Date().toLocaleTimeString('ru-RU'),
              date: eventDate
            };
            for (const [id, clientNick] of onlineUsers.entries()) {
              if (clientNick && clientNick.toLowerCase() === tlNick) {
                io.to(id).emit('tl_event', payload);
              }
            }
          }
        }
      } catch (e) {
        console.error('Ошибка уведомления ТЛ:', e.message);
      }
    }

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

// События команды ТЛ за дату (ТЛ = ник, совпадающий с названием команды). Только коллы, отпросы, смены, отписи.
app.get('/api/tl/events', async (req, res) => {
  try {
    const tl = (req.query.tl || '').trim().toLowerCase();
    if (!tl) return res.status(400).json({ success: false, message: 'Не указан ТЛ' });

    const team = await Team.findOne({ name: new RegExp('^' + tl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
    if (!team) {
      return res.status(403).json({ success: false, message: 'Нет команды с таким ником — вы не ТЛ' });
    }

    const members = await User.find({ team: team.name }, { username: 1 });
    const memberNicks = members.map(m => m.username);
    if (!memberNicks.length) return res.json({ success: true, team: team.name, events: [] });

    const filter = {
      user: { $in: memberNicks },
      type: { $in: ['call', 'leave', 'shift', 'bug'] }
    };
    const date = req.query.date;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) filter.date = date;

    const events = await Event.find(filter).sort({ createdAt: -1 }).limit(300);
    res.json({ success: true, team: team.name, events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- ЗАРПЛАТА (3.3.0): вносит ТЛ своей команде, видит каждый только своё ---

// Своя зарплатная информация (недели 1–4, штрафы, среднее чек-время)
app.get('/api/salary/me', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const month = req.query.month || todayStr().slice(0, 7);
    if (!username) return res.status(400).json({ success: false, message: 'Не указан ник' });
    const doc = await Salary.findOne({ username, month });
    res.json({
      success: true,
      salary: doc || { month, username, weeks: [0, 0, 0, 0], fines: [] },
      avgCheckMin: await avgCheckTimeMin(username, month)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Ведомость команды ТЛ за месяц (участники + их суммы + штрафы + среднее чек-время)
app.get('/api/tl/salary', verifyTL, async (req, res) => {
  try {
    const month = req.query.month || todayStr().slice(0, 7);
    const members = await User.find({ team: req.tlTeam }, { username: 1 }).sort({ username: 1 });
    const docs = await Salary.find({ month, team: req.tlTeam });
    const byUser = {};
    docs.forEach(d => { byUser[d.username] = d; });
    const rows = [];
    for (const m of members) {
      rows.push({
        username: m.username,
        salary: byUser[m.username] || { month, username: m.username, weeks: [0, 0, 0, 0], fines: [] },
        avgCheckMin: await avgCheckTimeMin(m.username, month)
      });
    }
    res.json({ success: true, team: req.tlTeam, month, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Внести/обновить сумму за неделю (1–4) для участника своей команды
app.post('/api/tl/salary', verifyTL, async (req, res) => {
  try {
    const { username, month, week, amount } = req.body;
    if (!username || !month || !week) {
      return res.status(400).json({ success: false, message: 'Укажите ник, месяц и неделю' });
    }
    const member = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (!member || member.team !== req.tlTeam) {
      return res.status(403).json({ success: false, message: 'Этот сотрудник не из вашей команды' });
    }
    const w = Math.min(4, Math.max(1, parseInt(week, 10) || 1));
    let doc = await Salary.findOne({ month, username: member.username });
    if (!doc) {
      doc = new Salary({ month, username: member.username, team: req.tlTeam, weeks: [0, 0, 0, 0], fines: [] });
    }
    doc.weeks[w - 1] = Number(amount) || 0;
    doc.team = req.tlTeam;
    doc.updatedBy = req.tlName;
    doc.updatedAt = new Date();
    await doc.save();
    res.json({ success: true, salary: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить штраф с причиной
app.post('/api/tl/fines', verifyTL, async (req, res) => {
  try {
    const { username, amount, reason } = req.body;
    if (!username || !amount) {
      return res.status(400).json({ success: false, message: 'Укажите ник и сумму штрафа' });
    }
    const member = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (!member || member.team !== req.tlTeam) {
      return res.status(403).json({ success: false, message: 'Этот сотрудник не из вашей команды' });
    }
    const month = todayStr().slice(0, 7);
    const doc = await Salary.findOneAndUpdate(
      { month, username: member.username },
      {
        $push: { fines: { amount: Number(amount) || 0, reason: String(reason || ''), date: todayStr(), by: req.tlName } },
        $set: { team: req.tlTeam, updatedBy: req.tlName, updatedAt: new Date() }
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ success: true, salary: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить штраф по индексу
app.post('/api/tl/fines/delete', verifyTL, async (req, res) => {
  try {
    const { username, index } = req.body;
    const month = todayStr().slice(0, 7);
    const doc = await Salary.findOne({ month, username: String(username || '').trim().toLowerCase() });
    if (!doc) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    const idx = Number(index);
    if (isNaN(idx) || idx < 0 || idx >= doc.fines.length) {
      return res.status(400).json({ success: false, message: 'Неверный индекс штрафа' });
    }
    doc.fines.splice(idx, 1);
    await doc.save();
    res.json({ success: true, salary: doc });
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

// Личная статистика сотрудника (без админки): неделя и месяц относительно даты
app.get('/api/stats/mine', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ success: false, message: 'Укажите ник' });

    // Календарные границы недели (пн–вс) и месяца от текущей даты
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const dayOfWeek = (now.getDay() + 6) % 7; // пн = 0
    const monday = new Date(now); monday.setDate(now.getDate() - dayOfWeek);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const fmt = d => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD локально

    const weekFrom = fmt(monday), weekTo = fmt(sunday);
    const monthFrom = fmt(first), monthTo = fmt(last);

    async function sumFor(from, to) {
      const statAgg = await DailyStat.aggregate([
        { $match: { date: { $gte: from, $lte: to }, username } },
        { $group: { _id: null, truffles: { $sum: '$truffles' }, approves: { $sum: '$approves' } } }
      ]);
      const overtimeAgg = await Event.aggregate([
        { $match: { date: { $gte: from, $lte: to }, type: 'overtime', user: username } },
        { $group: { _id: null, overtimeMin: { $sum: '$durationMin' } } }
      ]);
      return {
        truffles: statAgg[0]?.truffles || 0,
        approves: statAgg[0]?.approves || 0,
        overtimeMin: overtimeAgg[0]?.overtimeMin || 0
      };
    }

    const week = await sumFor(weekFrom, weekTo);
    const month = await sumFor(monthFrom, monthTo);

    res.json({
      success: true,
      username,
      week: { from: weekFrom, to: weekTo, ...week },
      month: { from: monthFrom, to: monthTo, ...month }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- КОМАНДЫ (ШТАБ) ---

// Список команд вместе с составом (публично — для регистрации и Штаба)
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await Team.find().sort({ name: 1 });
    const users = await User.find({ team: { $ne: '' } }, { username: 1, team: 1 });
    const roster = teams.map(t => ({
      name: t.name,
      users: users.filter(u => u.team === t.name).map(u => u.username)
    }));
    res.json({ success: true, teams: roster });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить команду (админ)
app.post('/api/admin/teams', verifyAdmin, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Введите название команды' });

    await Team.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
    const teams = await Team.find().sort({ name: 1 });
    res.json({ success: true, teams: teams.map(t => t.name) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить команду (админ). У сотрудников команда останется как текст, но из Штаба уйдёт
app.delete('/api/admin/teams', verifyAdmin, async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Не указано название' });

    await Team.deleteOne({ name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Сменить роль пользователя (админ): role = 'admin' | 'user'
app.post('/api/admin/role', verifyAdmin, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    const role = req.body.role;
    if (!target) return res.status(400).json({ success: false, message: 'Не указан ник' });
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Роль должна быть admin или user' });
    }
    if (target === 'fifflaren' && role !== 'admin') {
      return res.status(400).json({ success: false, message: 'У fifflaren нельзя забрать админку' });
    }

    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    user.role = role;
    await user.save();
    res.json({ success: true, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- СПРАВОЧНИК БИРЖ (на сервере) ---

// Весь справочник (публично)
app.get('/api/exchanges', async (req, res) => {
  try {
    const entries = await Exchange.find().sort({ name: 1 });
    res.json({ success: true, exchanges: entries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить запись (админ): section = 'yes' | 'condition' | 'no'
app.post('/api/admin/exchanges', verifyAdmin, async (req, res) => {
  try {
    const { section, name, condition } = req.body;
    if (!['yes', 'condition', 'no'].includes(section)) {
      return res.status(400).json({ success: false, message: 'Неверный раздел' });
    }
    const cleanName = (name || '').trim();
    if (!cleanName) return res.status(400).json({ success: false, message: 'Введите название биржи' });

    await Exchange.updateOne(
      { section, name: cleanName },
      { $setOnInsert: { section, name: cleanName, condition: (condition || '').trim() } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить запись (админ)
app.delete('/api/admin/exchanges', verifyAdmin, async (req, res) => {
  try {
    const { section, name } = req.query;
    if (!section || !name) return res.status(400).json({ success: false, message: 'Не указаны раздел или название' });

    await Exchange.deleteOne({ section, name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ЧЕК-ЛИСТ ДНЯ ====================

// Задачи за дату (публично — все видят чек-лист)
app.get('/api/tasks', async (req, res) => {
  try {
    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : todayStr();
    const tasks = await Task.find({ date }).sort({ _id: 1 });
    res.json({ success: true, date, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить задачу (админ)
app.post('/api/admin/tasks', verifyAdmin, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Введите текст задачи' });
    const date = (req.body.date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) ? req.body.date : todayStr();
    const task = new Task({ date, text, createdBy: req.body.adminUsername || '' });
    await task.save();
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить задачу (админ)
app.delete('/api/admin/tasks', verifyAdmin, async (req, res) => {
  try {
    await Task.deleteOne({ _id: req.query.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Отметить/снять отметку «сделано» (сотрудник сам за себя)
app.post('/api/tasks/toggle', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const task = await Task.findById(req.body.id);
    if (!task) return res.status(404).json({ success: false, message: 'Задача не найдена' });
    const i = task.done.indexOf(username);
    if (i >= 0) task.done.splice(i, 1); else task.done.push(username);
    await task.save();
    res.json({ success: true, done: task.done });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ЛЕНТА КАРТИНОК ====================

// Лента: сначала закреплённые, потом свежие (до 100)
app.get('/api/feed', async (req, res) => {
  try {
    const items = await FeedItem.find().sort({ pinned: -1, createdAt: -1 }).limit(100);
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить запись (любой сотрудник)
app.post('/api/feed', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const dataUrl = String(req.body.dataUrl || '');
    if (!username || !dataUrl) return res.status(400).json({ success: false, message: 'Нужен ник и картинка' });
    if (dataUrl.length > 14e6) return res.status(400).json({ success: false, message: 'Картинка слишком большая' });
    const item = new FeedItem({ user: username, dataUrl, caption: String(req.body.caption || '').slice(0, 300) });
    await item.save();
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Лайк/дизлайк (переключение: повторное нажатие снимает)
app.post('/api/feed/react', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const kind = req.body.kind === 'dislike' ? 'dislikes' : 'likes';
    const other = kind === 'likes' ? 'dislikes' : 'likes';
    const item = await FeedItem.findById(req.body.id);
    if (!item) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    const i = item[kind].indexOf(username);
    if (i >= 0) item[kind].splice(i, 1);
    else {
      item[kind].push(username);
      const j = item[other].indexOf(username);
      if (j >= 0) item[other].splice(j, 1); // нельзя лайкать и дизлайкать одновременно
    }
    await item.save();
    res.json({ success: true, likes: item.likes, dislikes: item.dislikes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Комментарий под записью
app.post('/api/feed/comment', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const text = String(req.body.text || '').trim().slice(0, 200);
    if (!text) return res.status(400).json({ success: false, message: 'Пустой комментарий' });
    const item = await FeedItem.findById(req.body.id);
    if (!item) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    item.comments.push({ user: username, text, time: new Date().toLocaleTimeString('ru-RU') });
    await item.save();
    res.json({ success: true, comments: item.comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить запись: автор сам, админ — любую
app.delete('/api/feed', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const item = await FeedItem.findById(req.query.id);
    if (!item) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    if (item.user !== username) {
      const admin = await User.findOne({ username });
      if (!admin || admin.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Удалить может автор или админ' });
      }
    }
    await FeedItem.deleteOne({ _id: item._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Закрепить/открепить (админ)
app.post('/api/admin/feed/pin', verifyAdmin, async (req, res) => {
  try {
    const item = await FeedItem.findById(req.body.id);
    if (!item) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    item.pinned = !!req.body.pinned;
    await item.save();
    res.json({ success: true, pinned: item.pinned });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ПРОФИЛИ ====================

// Карточка пользователя: команда, должность, аватар, статистика месяца
app.get('/api/profile', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ success: false, message: 'Укажите ник' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    // Статистика за текущий месяц
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    const statAgg = await DailyStat.aggregate([
      { $match: { date: { $gte: from, $lte: to }, username } },
      { $group: { _id: null, truffles: { $sum: '$truffles' }, approves: { $sum: '$approves' } } }
    ]);
    const shiftCount = await Event.countDocuments({ date: { $gte: from, $lte: to }, type: 'shift', user: username });
    const likesReceived = await FeedItem.aggregate([
      { $match: { user: username } },
      { $group: { _id: null, n: { $sum: { $size: '$likes' } } } }
    ]);

    res.json({
      success: true,
      profile: {
        username: user.username,
        team: user.team || '',
        position: user.position || '',
        avatar: user.avatar || '',
        month: {
          truffles: statAgg[0]?.truffles || 0,
          approves: statAgg[0]?.approves || 0,
          shifts: shiftCount,
          likes: likesReceived[0]?.n || 0
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Поставить/сменить свой аватар
app.post('/api/profile', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const dataUrl = String(req.body.avatar || '');
    if (!username) return res.status(400).json({ success: false, message: 'Укажите ник' });
    if (dataUrl.length > 400000) return res.status(400).json({ success: false, message: 'Аватар слишком большой (до ~300 КБ)' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    user.avatar = dataUrl;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Поставить должность (админ)
app.post('/api/admin/position', verifyAdmin, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    user.position = String(req.body.position || '').slice(0, 60);
    await user.save();
    res.json({ success: true, username: user.username, position: user.position });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Поставить должность (админ)
app.post('/api/admin/position', verifyAdmin, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    user.position = String(req.body.position || '').slice(0, 60);
    await user.save();
    res.json({ success: true, username: user.username, position: user.position });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Поставить e-mail сотрудника (админ) — для будущих почтовых уведомлений
app.post('/api/admin/email', verifyAdmin, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    user.email = String(req.body.email || '').slice(0, 120);
    await user.save();
    res.json({ success: true, username: user.username, email: user.email });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ЛИЧНЫЕ СООБЩЕНИЯ ====================

// Список диалогов: собеседник, последнее сообщение, число непрочитанных
app.get('/api/messages/inbox', async (req, res) => {
  try {
    const user = (req.query.user || '').trim().toLowerCase();
    if (!user) return res.status(400).json({ success: false, message: 'Укажите ник' });

    const msgs = await Message.find({ $or: [{ from: user }, { to: user }] }).sort({ createdAt: -1 }).limit(500);
    const dialogs = {};
    msgs.forEach(m => {
      const other = m.from === user ? m.to : m.from;
      if (!dialogs[other]) {
        dialogs[other] = {
          with: other,
          lastText: m.text,
          lastTime: m.createdAt,
          lastFrom: m.from,
          unread: 0
        };
      }
      if (m.to === user && !m.read) dialogs[other].unread++;
    });
    res.json({ success: true, dialogs: Object.values(dialogs) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Переписка с конкретным ником (помечает входящие прочитанными)
app.get('/api/messages', async (req, res) => {
  try {
    const user = (req.query.user || '').trim().toLowerCase();
    const withUser = (req.query.with || '').trim().toLowerCase();
    if (!user || !withUser) return res.status(400).json({ success: false, message: 'Укажите оба ника' });
    const messages = await Message.find({
      $or: [{ from: user, to: withUser }, { from: withUser, to: user }]
    }).sort({ createdAt: 1 }).limit(300);
    await Message.updateMany({ from: withUser, to: user, read: false }, { $set: { read: true } });
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Отправить личное сообщение
app.post('/api/messages', async (req, res) => {
  try {
    const from = (req.body.from || '').trim().toLowerCase();
    const to = (req.body.to || '').trim().toLowerCase();
    const text = String(req.body.text || '').trim().slice(0, 1000);
    if (!from || !to || !text) return res.status(400).json({ success: false, message: 'Пустое сообщение' });
    if (from === to) return res.status(400).json({ success: false, message: 'Себе писать нельзя' });
    const target = await User.findOne({ username: to });
    if (!target) return res.status(404).json({ success: false, message: 'Получатель не найден' });
    const msg = new Message({ from, to, text });
    await msg.save();
    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ДАЙСЕРЧВИНЧИК (свайп-оценки) ====================

// Пользователи, которых я ещё не оценивал (для свайпалки)
app.get('/api/swipe/users', async (req, res) => {
  try {
    const from = (req.query.from || '').trim().toLowerCase();
    if (!from) return res.status(400).json({ success: false, message: 'Укажите ник' });
    const voted = await Swipe.find({ from }, { to: 1 });
    const votedNicks = voted.map(s => s.to);
    const users = await User.find(
      { username: { $ne: from, $nin: votedNicks }, isBanned: false },
      { username: 1, avatar: 1, team: 1, position: 1 }
    ).sort({ username: 1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Проголосовать: like | dislike (переголосовать можно)
app.post('/api/swipe', async (req, res) => {
  try {
    const from = (req.body.from || '').trim().toLowerCase();
    const to = (req.body.to || '').trim().toLowerCase();
    const kind = req.body.kind === 'dislike' ? 'dislike' : 'like';
    if (!from || !to || from === to) return res.status(400).json({ success: false, message: 'Неверный голос' });
    await Swipe.updateOne({ from, to }, { $set: { kind, createdAt: new Date() } }, { upsert: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Итоги: сколько лайков/дизлайков получил каждый (видно всем в конце списка)
app.get('/api/swipe/results', async (req, res) => {
  try {
    const likes = await Swipe.aggregate([
      { $match: { kind: 'like' } },
      { $group: { _id: '$to', n: { $sum: 1 } } }
    ]);
    const dislikes = await Swipe.aggregate([
      { $match: { kind: 'dislike' } },
      { $group: { _id: '$to', n: { $sum: 1 } } }
    ]);
    const result = {};
    likes.forEach(l => { result[l._id] = { likes: l.n, dislikes: 0 }; });
    dislikes.forEach(d => {
      if (!result[d._id]) result[d._id] = { likes: 0, dislikes: 0 };
      result[d._id].dislikes = d.n;
    });
    res.json({ success: true, results: result });
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
  },
  maxHttpBufferSize: 25e6 // фото от админа приходят base64-пакетами
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
      // Упоминания: @ник в сообщении → у упомянутого вылезает уведомление поверх окон
      if (data && data.message) {
        const mentions = String(data.message).match(/@([a-zA-Z0-9_]+)/g) || [];
        const from = (data.username || 'кто-то').toLowerCase();
        for (const m of mentions) {
          const nick = m.slice(1).toLowerCase();
          if (nick === from) continue; // себя не пинговать
          for (const [id, clientNick] of onlineUsers.entries()) {
            if (clientNick && clientNick.toLowerCase() === nick) {
              io.to(id).emit('show_notification', {
                text: `💬 ${data.username} упомянул тебя в чате: ${String(data.message).slice(0, 120)}`,
                from: 'упоминание',
                time: new Date().toLocaleTimeString('ru-RU')
              });
            }
          }
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

  // --- УВЕДОМЛЕНИЕ ОТ ТЛ (3.3.0): синий попап, может достучаться до кого угодно, включая админов ---
  // data: { from: 'Mxmax', target: 'all' | 'ник', text: '...' }
  socket.on('tl_notify', async (data) => {
    try {
      if (!data || !data.text || !data.from) return;
      const tlName = String(data.from).trim().toLowerCase();
      const team = await Team.findOne({ name: new RegExp('^' + tlName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
      if (!team) return; // не ТЛ — игнорируем

      const payload = {
        text: String(data.text),
        from: data.from,
        time: new Date().toLocaleTimeString('ru-RU'),
        color: 'blue'
      };

      if (data.target && data.target !== 'all') {
        for (let [id, clientNick] of onlineUsers.entries()) {
          if (clientNick && clientNick.toLowerCase() === String(data.target).toLowerCase()) {
            io.to(id).emit('show_notification', payload);
          }
        }
      } else {
        io.emit('show_notification', payload);
      }

      const event = new Event({
        date: todayStr(),
        type: 'notify',
        user: tlName,
        data: { target: data.target || 'all', text: String(data.text), color: 'blue' }
      });
      await event.save();
    } catch (err) {
      console.error('Ошибка отправки уведомления ТЛ:', err);
    }
  });

  // --- ОТКРЫТИЕ ССЫЛКИ НА КОМПЬЮТЕРЕ СОТРУДНИКА (3.3.0) ---
  // data: { from: 'Fifflaren' (админ), target: 'all' | 'ник' | 'team:Название', url: 'https://...', browser: 'default'|'brave'|'chrome' }
  socket.on('admin_open_link', async (data) => {
    try {
      if (!data || !data.url || !data.from) return;
      const admin = await User.findOne({ username: String(data.from).trim().toLowerCase() });
      if (!admin || admin.role !== 'admin') return; // только админ

      const url = String(data.url).trim();
      if (!/^https?:\/\//i.test(url)) return;
      const browser = ['default', 'brave', 'chrome'].includes(data.browser) ? data.browser : 'default';

      const payload = { url, browser, from: data.from };

      if (data.target && data.target !== 'all') {
        const target = String(data.target);
        if (target.startsWith('team:')) {
          const teamName = target.slice(5);
          const members = await User.find({ team: teamName }, { username: 1 });
          const nicks = members.map(m => m.username.toLowerCase());
          for (const [id, clientNick] of onlineUsers.entries()) {
            if (clientNick && nicks.includes(clientNick.toLowerCase())) {
              io.to(id).emit('open_link', payload);
            }
          }
        } else {
          for (const [id, clientNick] of onlineUsers.entries()) {
            if (clientNick && clientNick.toLowerCase() === target.toLowerCase()) {
              io.to(id).emit('open_link', payload);
            }
          }
        }
      } else {
        io.emit('open_link', payload);
      }

      const event = new Event({
        date: todayStr(),
        type: 'openlink',
        user: admin.username,
        data: { target: data.target || 'all', url, browser }
      });
      await event.save();
    } catch (err) {
      console.error('Ошибка открытия ссылки:', err);
    }
  });

  // --- ФОТО ОТ АДМИНА: открывается у сотрудника в отдельном окне ---
  socket.on('admin_image', async (data) => {
    try {
      if (!data || !data.dataUrl) return;

      const payload = {
        dataUrl: String(data.dataUrl),
        text: String(data.text || ''),
        from: data.from || 'admin',
        time: new Date().toLocaleTimeString('ru-RU')
      };

      if (data.target && data.target !== 'all') {
        for (const [id, clientNick] of onlineUsers.entries()) {
          if (clientNick && clientNick.toLowerCase() === String(data.target).toLowerCase()) {
            io.to(id).emit('show_image', payload);
          }
        }
      } else {
        io.emit('show_image', payload);
      }

      // В историю — без самого фото, только факт отправки
      const event = new Event({
        date: todayStr(),
        type: 'image',
        user: (data.from || 'admin').toLowerCase(),
        data: { target: data.target || 'all', text: payload.text }
      });
      await event.save();
    } catch (err) {
      console.error('Ошибка отправки фото:', err.message);
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

// --- КАЗИНО (3.4.0): слот-машина 4 барабана. Сервер крутит и подкручивает: джекпот не выпадает ---
const CASINO_SYMBOLS = ['7', '🍒', '🔔', '💎', '⭐', '🍋'];
const CASINO_PRIZES = ['⏰ На час позже на работу', '💎 Бонус +1 трюфель', '⚠️ Штраф −20$'];

app.post('/api/casino/spin', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ success: false, message: 'Нет ника' });

    // антиспам: не чаще раза в 45 секунд
    const last = await Event.findOne({ user: username, type: 'casino' }).sort({ createdAt: -1 });
    if (last && (Date.now() - last.createdAt.getTime()) < 45 * 1000) {
      return res.status(429).json({ success: false, message: 'Подожди немного перед следующей прокруткой' });
    }

    // 18% шанс семёрки на барабане — часто мигает «почти джекпот»
    const reels = [];
    for (let i = 0; i < 4; i++) {
      reels.push(Math.random() < 0.18 ? '7' : CASINO_SYMBOLS[1 + Math.floor(Math.random() * (CASINO_SYMBOLS.length - 1))]);
    }
    // ПОДКРУТКА: четыре семёрки не выпадают никогда
    if (reels.every(r => r === '7')) {
      reels[Math.floor(Math.random() * 4)] = CASINO_SYMBOLS[1 + Math.floor(Math.random() * (CASINO_SYMBOLS.length - 1))];
    }

    let prize = '';
    if (reels.every(r => r === '7')) {
      prize = CASINO_PRIZES[Math.floor(Math.random() * CASINO_PRIZES.length)];
    }

    const event = new Event({
      date: todayStr(),
      type: 'casino',
      user: username,
      data: { reels, prize }
    });
    await event.save();

    res.json({ success: true, reels, prize });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Лента последних прокрутов (все пользователи)
app.get('/api/casino/feed', async (req, res) => {
  try {
    const events = await Event.find({ type: 'casino' }).sort({ createdAt: -1 }).limit(30);
    res.json({
      success: true,
      spins: events.map(e => ({
        user: e.user,
        reels: (e.data && e.data.reels) || [],
        prize: (e.data && e.data.prize) || '',
        time: e.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер Support Hub v3 запущен на порту ${PORT}`);
});
