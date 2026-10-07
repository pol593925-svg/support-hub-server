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
  isBanned: { type: Boolean, default: false },
  casinoBalance: { type: Number, default: null },   // 3.5.0 — банк казино (null = ещё не выданы стартовые 500)
  casinoLastDaily: { type: String, default: '' },    // дата последнего ежедневного бонуса
  lastActiveAt: { type: Date, default: null }        // 3.7.0 — последняя активность в приложении
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
  text: { type: String, default: '' },
  voice: { type: String, default: '' }, // base64 data URL аудио (3.6.0)
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

// Сменить пароль пользователю (админ, если юзер забыл)
app.post('/api/admin/password', verifyAdmin, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    const newPassword = String(req.body.newPassword || '');
    if (!target) return res.status(400).json({ success: false, message: 'Не указан ник' });
    if (newPassword.length < 4) return res.status(400).json({ success: false, message: 'Пароль минимум 4 символа' });

    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ success: true, username: user.username });
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
          lastText: (m.voice && !m.text) ? '🎤 Голосовое сообщение' : m.text,
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

// Отправить личное сообщение (текст и/или голосовое)
app.post('/api/messages', async (req, res) => {
  try {
    const from = (req.body.from || '').trim().toLowerCase();
    const to = (req.body.to || '').trim().toLowerCase();
    const text = String(req.body.text || '').trim().slice(0, 1000);
    const voice = String(req.body.voice || '').slice(0, 14_000_000); // data URL аудио
    if (!from || !to) return res.status(400).json({ success: false, message: 'Укажите отправителя и получателя' });
    if (!text && !voice) return res.status(400).json({ success: false, message: 'Пустое сообщение' });
    if (from === to) return res.status(400).json({ success: false, message: 'Себе писать нельзя' });
    const target = await User.findOne({ username: to });
    if (!target) return res.status(404).json({ success: false, message: 'Получатель не найден' });
    const msg = new Message({ from, to, text, voice });
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

  // Запрос скрина с экрана сотрудника (админ/ТЛ) — 3.6.0
  socket.on('admin_screenshot_request', async (data) => {
    try {
      if (!data || !data.targetNick) return;
      const admin = await User.findOne({ username: String(data.from || '').trim().toLowerCase() });
      if (!admin || admin.role !== 'admin') return; // только админ
      for (const [id, clientNick] of onlineUsers.entries()) {
        if (clientNick && clientNick.toLowerCase() === String(data.targetNick).toLowerCase()) {
          io.to(id).emit('screenshot_request', { by: admin.username });
        }
      }
    } catch (err) {
      console.error('Ошибка запроса скрина:', err.message);
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

// --- КАЗИНО (3.5.0): баланс, слот 4 барабана, рулетка, ежедневный бонус ---
const CASINO_SYMBOLS = ['7', '🍒', '🔔', '💎', '⭐', '🍋'];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CASINO_START_BALANCE = 500;
const CASINO_DAILY = 20;

// Один прокрут слота: реальные шансы, выплаты как в казино
function slotRoll() {
  const reels = [];
  for (let i = 0; i < 4; i++) {
    reels.push(Math.random() < 0.18 ? '7' : CASINO_SYMBOLS[1 + Math.floor(Math.random() * (CASINO_SYMBOLS.length - 1))]);
  }
  const counts = {};
  reels.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  const maxCount = Math.max(...Object.values(counts));
  let multiplier = 0;
  if (maxCount === 4) multiplier = reels[0] === '7' ? 100 : 25;   // джекпот 7777 или четвёрка
  else if (maxCount === 3) multiplier = 5;                        // три в ряд
  else {
    for (let i = 0; i < 3; i++) {                                 // пара рядом — возврат ставки
      if (reels[i] === reels[i + 1]) { multiplier = 1; break; }
    }
  }
  return { reels, multiplier };
}

// Баланс + доступность ежедневного бонуса
app.get('/api/casino/state', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    if (user.casinoBalance == null) { user.casinoBalance = CASINO_START_BALANCE; await user.save(); }
    res.json({
      success: true,
      balance: user.casinoBalance,
      dailyAvailable: user.casinoLastDaily !== todayStr()
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Ежедневный бонус +20$
app.post('/api/casino/daily', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    if (user.casinoBalance == null) user.casinoBalance = CASINO_START_BALANCE;
    if (user.casinoLastDaily === todayStr()) {
      return res.status(429).json({ success: false, message: 'Сегодня уже забирал — возвращайся завтра' });
    }
    user.casinoLastDaily = todayStr();
    user.casinoBalance += CASINO_DAILY;
    await user.save();
    res.json({ success: true, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Слот: ставка 5 или 10
app.post('/api/casino/spin', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const bet = Number(req.body.bet) === 10 ? 10 : 5;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    if (user.casinoBalance == null) user.casinoBalance = CASINO_START_BALANCE;
    if (user.casinoBalance < bet) {
      return res.status(400).json({ success: false, message: 'Не хватает денег — забирай ежедневный бонус 🎁' });
    }
    const last = await Event.findOne({ user: username, type: 'casino' }).sort({ createdAt: -1 });
    if (last && (Date.now() - last.createdAt.getTime()) < 12000) {
      return res.status(429).json({ success: false, message: 'Крути не быстрее раза в 12 секунд' });
    }

    user.casinoBalance -= bet;
    const { reels, multiplier } = slotRoll();
    const winnings = bet * multiplier;
    user.casinoBalance += winnings;

    let prize = '';
    if (multiplier === 100) {
      prize = '👑 ДЖЕКПОТ ×100! ⏰ на час позже на работу · 💎 +1 трюфель · ⚠️ налог −20$';
    }

    await user.save();
    await new Event({
      date: todayStr(),
      type: 'casino',
      user: username,
      data: { reels, bet, multiplier, winnings, prize, balance: user.casinoBalance }
    }).save();

    res.json({ success: true, reels, multiplier, winnings, prize, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Рулетка (европейская 0–36): color x2, parity x2, dozen x3, number x35
app.post('/api/casino/roulette', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const bet = Number(req.body.bet) === 10 ? 10 : 5;
    const { type, value } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    if (user.casinoBalance == null) user.casinoBalance = CASINO_START_BALANCE;
    if (user.casinoBalance < bet) {
      return res.status(400).json({ success: false, message: 'Не хватает денег — забирай ежедневный бонус 🎁' });
    }
    const last = await Event.findOne({ user: username, type: 'roulette' }).sort({ createdAt: -1 });
    if (last && (Date.now() - last.createdAt.getTime()) < 8000) {
      return res.status(429).json({ success: false, message: 'Рулетка не быстрее раза в 8 секунд' });
    }

    const num = Math.floor(Math.random() * 37);
    const color = num === 0 ? 'green' : (RED_NUMBERS.has(num) ? 'red' : 'black');

    let win = false;
    let multiplier = 0;
    if (type === 'color' && (value === 'red' || value === 'black')) {
      win = color === value; multiplier = 2;
    } else if (type === 'parity' && (value === 'even' || value === 'odd')) {
      win = num !== 0 && ((num % 2 === 0) === (value === 'even')); multiplier = 2;
    } else if (type === 'dozen' && ['1', '2', '3'].includes(String(value))) {
      win = num > 0 && Math.ceil(num / 12) === Number(value); multiplier = 3;
    } else if (type === 'number') {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 0 || n > 36) {
        return res.status(400).json({ success: false, message: 'Число от 0 до 36' });
      }
      win = num === n; multiplier = 35;
    } else {
      return res.status(400).json({ success: false, message: 'Неизвестная ставка' });
    }

    user.casinoBalance -= bet;
    const winnings = win ? bet * multiplier : 0;
    user.casinoBalance += winnings;
    await user.save();
    await new Event({
      date: todayStr(),
      type: 'roulette',
      user: username,
      data: { bet, type, value: String(value), num, color, multiplier, winnings, balance: user.casinoBalance }
    }).save();

    res.json({ success: true, num, color, win, multiplier, winnings, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Топ богачей казино
app.get('/api/casino/top', async (req, res) => {
  try {
    const users = await User.find({ casinoBalance: { $ne: null } }, { username: 1, casinoBalance: 1 })
      .sort({ casinoBalance: -1 }).limit(10);
    res.json({ success: true, top: users.map(u => ({ username: u.username, balance: u.casinoBalance })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Лента последних ставок (слот + рулетка)
app.get('/api/casino/feed', async (req, res) => {
  try {
    const events = await Event.find({ type: { $in: ['casino', 'roulette'] } }).sort({ createdAt: -1 }).limit(30);
    res.json({
      success: true,
      spins: events.map(e => ({
        user: e.user,
        kind: e.type,
        bet: (e.data && e.data.bet) || 0,
        reels: (e.data && e.data.reels) || [],
        rType: (e.data && e.data.type) || '',
        rValue: (e.data && e.data.value) || '',
        num: (e.data && typeof e.data.num === 'number') ? e.data.num : null,
        color: (e.data && e.data.color) || '',
        winnings: (e.data && e.data.winnings) || 0,
        prize: (e.data && e.data.prize) || '',
        time: e.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.6.0: МАГАЗИН ПРИЗОВ ====================

const SHOP_ITEMS = {
  sleep_hour:  { name: '⏰ +1 час ко сну',   price: 2000 },
  fine_cancel: { name: '🛡 Отмена штрафа',   price: 1000 },
  top_geo_log: { name: '🌍 1 лог топ гео',   price: 100 }
};

const purchaseSchema = new mongoose.Schema({
  username: { type: String, required: true, lowercase: true },
  item: { type: String, required: true },
  price: { type: Number, required: true },
  done: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Purchase = mongoose.model('Purchase', purchaseSchema);

// Список призов
app.get('/api/shop/items', async (req, res) => {
  res.json({
    success: true,
    items: Object.entries(SHOP_ITEMS).map(([id, it]) => ({ id, name: it.name, price: it.price }))
  });
});

// Купить приз: списываем бабки, заявка уходит админам на выполнение
app.post('/api/shop/buy', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const itemId = String(req.body.item || '');
    const item = SHOP_ITEMS[itemId];
    if (!item) return res.status(400).json({ success: false, message: 'Такого приза нет' });

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Игрок не найден' });
    const balance = (user.casinoBalance === null || user.casinoBalance === undefined) ? 500 : user.casinoBalance;
    if (balance < item.price) {
      return res.status(400).json({ success: false, message: `Не хватает бабок: нужно ${item.price}$, у тебя ${balance}$` });
    }

    user.casinoBalance = balance - item.price;
    await user.save();

    const purchase = new Purchase({ username, item: itemId, price: item.price });
    await purchase.save();

    // Живое оповещение админам о покупке
    io.emit('shop_purchase', { user: username, item: item.name, price: item.price, id: String(purchase._id) });

    res.json({ success: true, balance: user.casinoBalance, item: item.name });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Заявки на покупки (админ)
app.get('/api/admin/purchases', verifyAdmin, async (req, res) => {
  try {
    const purchases = await Purchase.find().sort({ createdAt: -1 }).limit(100);
    res.json({
      success: true,
      purchases: purchases.map(p => ({
        id: String(p._id), username: p.username,
        item: (SHOP_ITEMS[p.item] && SHOP_ITEMS[p.item].name) || p.item,
        price: p.price, done: p.done, time: p.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Отметить покупку выполненной (админ)
app.post('/api/admin/purchases/done', verifyAdmin, async (req, res) => {
  try {
    const p = await Purchase.findById(req.body.id);
    if (!p) return res.status(404).json({ success: false, message: 'Заявка не найдена' });
    p.done = true;
    await p.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Начислить/списать бабки в казино (админ): amount +100 или -50
app.post('/api/admin/casino/grant', verifyAdmin, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    const amount = Math.floor(Number(req.body.amount) || 0);
    if (!target) return res.status(400).json({ success: false, message: 'Не указан ник' });
    if (!amount || Math.abs(amount) > 100000) {
      return res.status(400).json({ success: false, message: 'Сумма от -100000 до 100000 (не 0)' });
    }

    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    user.casinoBalance = bal + amount;
    await user.save();
    res.json({ success: true, username: user.username, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.6.0: ТОПЫ (рез серчи / защеканы) ====================

const topsSchema = new mongoose.Schema({
  key: { type: String, default: 'main' },
  searchers: { type: [String], default: [] },
  checkers: { type: [String], default: [] }
});
const Tops = mongoose.model('Tops', topsSchema);

// Публично: оба топа
app.get('/api/tops', async (req, res) => {
  try {
    const t = await Tops.findOne({ key: 'main' }) || { searchers: [], checkers: [] };
    res.json({ success: true, searchers: t.searchers, checkers: t.checkers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Задать топ (админ): list = 'searchers' | 'checkers', usernames = [ник, ...]
app.post('/api/admin/tops', verifyAdmin, async (req, res) => {
  try {
    const list = req.body.list;
    if (!['searchers', 'checkers'].includes(list)) {
      return res.status(400).json({ success: false, message: 'list должен быть searchers или checkers' });
    }
    const usernames = (Array.isArray(req.body.usernames) ? req.body.usernames : [])
      .map(u => String(u).trim().toLowerCase()).filter(Boolean).slice(0, 50);

    let t = await Tops.findOne({ key: 'main' });
    if (!t) { t = new Tops({ key: 'main' }); }
    t[list] = usernames;
    await t.save();
    res.json({ success: true, searchers: t.searchers, checkers: t.checkers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.6.0: СКРИНЫ ПО КНОПКЕ ====================

const screenshotSchema = new mongoose.Schema({
  username: { type: String, required: true, lowercase: true },
  image: { type: String, required: true }, // base64 data URL JPEG
  createdAt: { type: Date, default: Date.now }
});
const Screenshot = mongoose.model('Screenshot', screenshotSchema);

// Сотрудник загружает скрин (прилетел запрос с админки)
app.post('/api/screenshot', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const image = String(req.body.image || '');
    if (!username || !image.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: 'Плохой скрин' });
    }
    if (image.length > 14_000_000) {
      return res.status(400).json({ success: false, message: 'Скрин слишком большой' });
    }
    await new Screenshot({ username, image }).save();
    // Храним последние 20 на юзера
    const mine = await Screenshot.find({ username }).sort({ createdAt: -1 });
    if (mine.length > 20) {
      const oldIds = mine.slice(20).map(s => s._id);
      await Screenshot.deleteMany({ _id: { $in: oldIds } });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Скрины юзера (админ): ?username= — последние 10, без username — последние 30 всех
app.get('/api/admin/screenshots', verifyAdmin, async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const filter = username ? { username } : {};
    const shots = await Screenshot.find(filter).sort({ createdAt: -1 }).limit(username ? 10 : 30);
    res.json({
      success: true,
      screenshots: shots.map(s => ({ id: String(s._id), username: s.username, image: s.image, time: s.createdAt }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.7.0: ДУЭЛЬ СЛОТАМИ ====================

const activeDuels = new Map(); // id -> {from, to, bet, createdAt}
let duelSeq = 1;
const SYM_VALUE = { '7': 6, '💎': 5, '⭐': 4, '🔔': 3, '🍒': 2, '🍋': 1 };

function emitToUser(nick, event, payload) {
  for (const [id, clientNick] of onlineUsers.entries()) {
    if (clientNick && clientNick.toLowerCase() === String(nick).toLowerCase()) {
      io.to(id).emit(event, payload);
    }
  }
}

// Ранг прокрута для дуэли: класс комбинации + старший символ (для tiebreak)
function duelRank(roll) {
  const counts = {};
  roll.reels.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  let top = '', topC = 0;
  for (const [s, c] of Object.entries(counts)) {
    if (c > topC || (c === topC && (SYM_VALUE[s] || 0) > (SYM_VALUE[top] || 0))) { top = s; topC = c; }
  }
  const cls = (topC === 4 && top === '7') ? 5 : topC; // 5 = джекпот 7777
  return { cls, sym: SYM_VALUE[top] || 0 };
}

// Вызвать на дуэль
app.post('/api/casino/duel/challenge', async (req, res) => {
  try {
    const from = (req.body.from || '').trim().toLowerCase();
    const to = (req.body.to || '').trim().toLowerCase();
    const bet = Math.floor(Number(req.body.bet) || 0);
    if (!from || !to) return res.status(400).json({ success: false, message: 'Укажи соперника' });
    if (from === to) return res.status(400).json({ success: false, message: 'Сам с собой скучно' });
    if (bet < 5 || bet > 100) return res.status(400).json({ success: false, message: 'Ставка дуэли: 5–100$' });

    const fromUser = await User.findOne({ username: from });
    const toUser = await User.findOne({ username: to });
    if (!toUser) return res.status(404).json({ success: false, message: 'Такого ника нет' });
    const fromBal = fromUser.casinoBalance == null ? CASINO_START_BALANCE : fromUser.casinoBalance;
    const toBal = toUser.casinoBalance == null ? CASINO_START_BALANCE : toUser.casinoBalance;
    if (fromBal < bet) return res.status(400).json({ success: false, message: `У тебя нет ${bet}$` });
    if (toBal < bet) return res.status(400).json({ success: false, message: `У ${to} нет ${bet}$` });

    const id = 'd' + (duelSeq++) + '_' + Date.now();
    activeDuels.set(id, { id, from, to, bet, createdAt: Date.now() });
    emitToUser(to, 'duel_challenge', { id, from, bet });
    setTimeout(() => {
      if (activeDuels.has(id)) {
        activeDuels.delete(id);
        emitToUser(from, 'duel_result', { tie: false, expired: true, message: `${to} не ответил на вызов` });
        emitToUser(to, 'duel_result', { tie: false, expired: true, message: `Пропустил вызов от ${from}` });
      }
    }, 90000);

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Ответ на вызов
app.post('/api/casino/duel/respond', async (req, res) => {
  try {
    const id = String(req.body.id || '');
    const username = (req.body.username || '').trim().toLowerCase();
    const duel = activeDuels.get(id);
    if (!duel) return res.status(404).json({ success: false, message: 'Вызов протух' });
    if (duel.to !== username) return res.status(403).json({ success: false, message: 'Не твой вызов' });
    activeDuels.delete(id);

    if (!req.body.accept) {
      emitToUser(duel.from, 'duel_result', { tie: false, declined: true, message: `${duel.to} отказался от дуэли` });
      return res.json({ success: true });
    }

    // Обе ставки списываем, крутим обоим
    const fromUser = await User.findOne({ username: duel.from });
    const toUser = await User.findOne({ username: duel.to });
    fromUser.casinoBalance = (fromUser.casinoBalance == null ? CASINO_START_BALANCE : fromUser.casinoBalance) - duel.bet;
    toUser.casinoBalance = (toUser.casinoBalance == null ? CASINO_START_BALANCE : toUser.casinoBalance) - duel.bet;

    const rollA = slotRoll();
    const rollB = slotRoll();
    const rankA = duelRank(rollA);
    const rankB = duelRank(rollB);

    let winner = null;
    if (rankA.cls !== rankB.cls) winner = rankA.cls > rankB.cls ? duel.from : duel.to;
    else if (rankA.sym !== rankB.sym) winner = rankA.sym > rankB.sym ? duel.from : duel.to;
    // полное равенство — ничья, возврат

    let fromBal = fromUser.casinoBalance, toBal = toUser.casinoBalance;
    if (winner === duel.from) { fromBal += duel.bet * 2; fromUser.casinoBalance = fromBal; }
    else if (winner === duel.to) { toBal += duel.bet * 2; toUser.casinoBalance = toBal; }
    else { fromUser.casinoBalance += duel.bet; toUser.casinoBalance += duel.bet; }

    await fromUser.save();
    await toUser.save();

    const base = { bet: duel.bet, winner, tie: !winner, reelsA: rollA.reels, reelsB: rollB.reels };
    emitToUser(duel.from, 'duel_result', { ...base, you: duel.from, opp: duel.to, yourReels: rollA.reels, oppReels: rollB.reels, youWin: winner === duel.from, balance: fromUser.casinoBalance });
    emitToUser(duel.to, 'duel_result', { ...base, you: duel.to, opp: duel.from, yourReels: rollB.reels, oppReels: rollA.reels, youWin: winner === duel.to, balance: toUser.casinoBalance });

    res.json({ success: true, winner, tie: !winner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.7.0: КРАШ ====================

let crash = { round: 0, phase: 'idle', crashPoint: 1, bets: new Map(), betEndAt: 0, runStart: 0 };
let crashHistory = [];

function genCrashPoint() {
  const r = Math.random();
  if (r < 0.04) return 1.0;
  return Math.min(50, Math.floor((0.96 / (1 - r)) * 100) / 100);
}

function crashMult() {
  const t = (Date.now() - crash.runStart) / 1000;
  return Math.floor(Math.exp(0.09 * t) * 100) / 100;
}

function startCrashRound() {
  crash.round++;
  crash.phase = 'bet';
  crash.crashPoint = genCrashPoint();
  crash.bets = new Map();
  crash.betEndAt = Date.now() + 6000;
  io.emit('crash_phase', { phase: 'bet', round: crash.round, endsAt: crash.betEndAt });
  setTimeout(runCrashRound, 6000);
}

function runCrashRound() {
  if (crash.phase !== 'bet') return;
  crash.phase = 'run';
  crash.runStart = Date.now();
  io.emit('crash_phase', { phase: 'run', round: crash.round });
  const tick = setInterval(async () => {
    try {
      const mult = crashMult();
      if (mult >= crash.crashPoint) {
        clearInterval(tick);
        crash.phase = 'done';
        crashHistory.unshift({ round: crash.round, crashPoint: crash.crashPoint });
        if (crashHistory.length > 20) crashHistory.pop();
        io.emit('crash_phase', { phase: 'done', round: crash.round, crashPoint: crash.crashPoint, history: crashHistory });
        setTimeout(startCrashRound, 5000);
      } else {
        io.emit('crash_tick', { round: crash.round, mult });
      }
    } catch (e) { clearInterval(tick); }
  }, 100);
}

// Текущее состояние краша
app.get('/api/casino/crash/state', (req, res) => {
  res.json({
    success: true,
    round: crash.round,
    phase: crash.phase,
    endsAt: crash.phase === 'bet' ? crash.betEndAt : 0,
    mult: crash.phase === 'run' ? crashMult() : 1,
    history: crashHistory,
    myBet: crash.bets.has((req.query.username || '').trim().toLowerCase())
      ? (() => { const b = crash.bets.get((req.query.username || '').trim().toLowerCase()); return { bet: b.bet, cashed: b.cashed, mult: b.cashMult || 0 }; })()
      : null
  });
});

// Ставка в краш (только фаза ставок)
app.post('/api/casino/crash/bet', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const amount = Math.floor(Number(req.body.amount) || 0);
    if (crash.phase !== 'bet') return res.status(400).json({ success: false, message: 'Ставки закрыты, жди след раунд' });
    if (amount < 5 || amount > 100) return res.status(400).json({ success: false, message: 'Ставка: 5–100$' });
    if (crash.bets.has(username)) return res.status(400).json({ success: false, message: 'Ты уже поставил в этом раунде' });

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Игрок не найден' });
    const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    if (bal < amount) return res.status(400).json({ success: false, message: `Не хватает бабок: ${bal}$` });

    user.casinoBalance = bal - amount;
    await user.save();
    crash.bets.set(username, { bet: amount, cashed: false, cashMult: 0 });
    res.json({ success: true, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Забрать до краха
app.post('/api/casino/crash/cashout', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    if (crash.phase !== 'run') return res.status(400).json({ success: false, message: 'Уже не докрутишь' });
    const b = crash.bets.get(username);
    if (!b) return res.status(404).json({ success: false, message: 'Ты не ставил в этом раунде' });
    if (b.cashed) return res.status(400).json({ success: false, message: 'Уже забрал' });

    const mult = crashMult();
    const winnings = Math.floor(b.bet * mult);
    b.cashed = true;
    b.cashMult = mult;

    const user = await User.findOne({ username });
    user.casinoBalance = (user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance) + winnings;
    await user.save();
    res.json({ success: true, mult, winnings, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.7.0: АКТИВНОСТЬ + «ДНО ДНЯ» ====================

// Пинг активности из приложения (раз в минуту)
app.post('/api/activity', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ success: false });
    await User.updateOne({ username }, { $set: { lastActiveAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Отчёт «дно дня»: минимум трюфелей/апрувов + самый долгий AFK
app.get('/api/admin/dayreport', verifyAdmin, async (req, res) => {
  try {
    const date = (req.query.date || '').trim() || todayStr();
    const stats = await DailyStat.find({ date });
    const users = await User.find({}, { username: 1, team: 1, lastActiveAt: 1, role: 1 });

    const now = Date.now();
    const rows = users.filter(u => u.role !== 'admin').map(u => {
      const s = stats.find(x => x.username === u.username);
      const idleMin = u.lastActiveAt ? Math.floor((now - new Date(u.lastActiveAt).getTime()) / 60000) : null;
      return {
        username: u.username,
        team: u.team || '',
        truffles: s ? s.truffles : 0,
        approves: s ? s.approves : 0,
        idleMin
      };
    });

    const pick = (arr, key, max) => {
      const withVal = arr.filter(r => r[key] !== null);
      if (!withVal.length) return null;
      return (max ? withVal.reduce((a, b) => a[key] > b[key] ? a : b) : withVal.reduce((a, b) => a[key] < b[key] ? a : b)).username;
    };

    res.json({
      success: true,
      date,
      rows,
      bottoms: {
        truffles: pick(rows, 'truffles', false),
        approves: pick(rows, 'approves', false),
        idle: pick(rows.filter(r => r.idleMin !== null), 'idleMin', true)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.7.0: КАРМА (похвала/пожар) ====================

const karmaSchema = new mongoose.Schema({
  from: { type: String, required: true, lowercase: true },
  to: { type: String, required: true, lowercase: true },
  week: { type: String, required: true },  // '2026-W41'
  value: { type: Number, required: true }, // +1 или -1
  createdAt: { type: Date, default: Date.now }
});
karmaSchema.index({ from: 1, to: 1, week: 1 }, { unique: true });
const Karma = mongoose.model('Karma', karmaSchema);

// Текущая ISO-неделя
function currentWeekStr(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + '-W' + week;
}

// Голос в карму: одно голосование «от→кому» в неделю (переголосовать можно)
app.post('/api/karma', async (req, res) => {
  try {
    const from = (req.body.from || '').trim().toLowerCase();
    const to = (req.body.to || '').trim().toLowerCase();
    const value = Number(req.body.value) > 0 ? 1 : -1;
    if (!from || !to) return res.status(400).json({ success: false, message: 'Укажи ники' });
    if (from === to) return res.status(400).json({ success: false, message: 'Себе нельзя' });
    const target = await User.findOne({ username: to });
    if (!target) return res.status(404).json({ success: false, message: 'Такого ника нет' });

    const week = currentWeekStr();
    await Karma.updateOne({ from, to, week }, { $set: { value } }, { upsert: true });
    res.json({ success: true, week });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Итоги недели + мои голоса
app.get('/api/karma', async (req, res) => {
  try {
    const week = (req.query.week || '').trim() || currentWeekStr();
    const voter = (req.query.voter || '').trim().toLowerCase();

    const totals = await Karma.aggregate([
      { $match: { week } },
      { $group: { _id: '$to', total: { $sum: '$value' }, votes: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]);

    let myVotes = [];
    if (voter) {
      myVotes = await Karma.find({ week, from: voter }, { to: 1, value: 1 });
      myVotes = myVotes.map(v => ({ to: v.to, value: v.value }));
    }

    res.json({ success: true, week, totals: totals.map(t => ({ username: t._id, total: t.total, votes: t.votes })), myVotes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер Support Hub v3 запущен на порту ${PORT}`);
  // Краш-игра: первый раунд через 8 сек после старта
  setTimeout(startCrashRound, 8000);
  // Морской бой: возврат ставок в зависших играх (перезапуск сервера)
  (async () => {
    try {
      const stuck = await Battleship.find({ phase: { $in: ['placement', 'battle'] } });
      for (const g of stuck) {
        for (const p of [g.playerA, g.playerB]) {
          await User.updateOne({ username: p }, { $inc: { casinoBalance: g.bet } });
        }
        g.phase = 'refunded';
        await g.save();
      }
      if (stuck.length) console.log('Морской бой: возвращено ставок в играх —', stuck.length);
    } catch (e) { console.error('Возврат МБ:', e.message); }
  })();
});

// ==================== 3.8.0: МОРСКОЙ БОЙ ====================

const BS_SHIPS = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]; // палубы кораблей
const BS_PLACE_MS = 120000;  // на расстановку
const BS_SHOT_MS = 30000;    // на выстрел

const bsSchema = new mongoose.Schema({
  playerA: { type: String, lowercase: true },
  playerB: { type: String, lowercase: true },
  bet: { type: Number, default: 0 },
  phase: { type: String, default: 'placement' }, // placement | battle | done | declined | refunded
  shipsA: { type: Array, default: [] },   // [[{x,y}...], ...]
  shipsB: { type: Array, default: [] },
  shotsA: { type: Array, default: [] },   // [{x,y,result}] выстрелы A по B
  shotsB: { type: Array, default: [] },
  turn: { type: String, default: '' },
  winner: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Battleship = mongoose.model('Battleship', bsSchema);

const bsChallenges = new Map(); // id -> {id, from, to, bet}
const bsTimers = new Map();     // gameId -> {placeA, placeB, shot}
let bsSeq = 1;

// Валидация расстановки: классические правила (корабли не касаются)
function bsValidateShips(ships) {
  if (!Array.isArray(ships) || ships.length !== BS_SHIPS.length) return null;
  const cellOwner = new Map();
  for (let i = 0; i < ships.length; i++) {
    const cells = ships[i];
    if (!Array.isArray(cells) || cells.length !== BS_SHIPS[i]) return null;
    const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
    if (new Set(xs).size !== 1 && new Set(ys).size !== 1) return null; // прямо по линии
    const sorted = cells.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
    for (let j = 1; j < sorted.length; j++) {
      if (Math.abs(sorted[j].x - sorted[j - 1].x) + Math.abs(sorted[j].y - sorted[j - 1].y) !== 1) return null;
    }
    for (const c of cells) {
      if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.x > 9 || c.y < 0 || c.y > 9) return null;
      const k = c.x + ',' + c.y;
      if (cellOwner.has(k)) return null;
      cellOwner.set(k, i);
    }
  }
  for (const [k, owner] of cellOwner) {
    const [x, y] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nk = (x + dx) + ',' + (y + dy);
      if (cellOwner.has(nk) && cellOwner.get(nk) !== owner) return null;
    }
  }
  return BS_SHIPS.map((_, i) => ships[i].map(c => ({ x: c.x, y: c.y })));
}

// Случайная расстановка
function bsRandomShips() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const occupied = new Set();
    const ships = [];
    let ok = true;
    for (const len of BS_SHIPS) {
      let placed = false;
      for (let t = 0; t < 150; t++) {
        const horiz = Math.random() < 0.5;
        const x = Math.floor(Math.random() * (horiz ? 11 - len : 10));
        const y = Math.floor(Math.random() * (horiz ? 10 : 11 - len));
        const cells = [];
        for (let i = 0; i < len; i++) cells.push({ x: x + (horiz ? i : 0), y: y + (horiz ? 0 : i) });
        let free = true;
        for (const c of cells) {
          for (let dx = -1; dx <= 1 && free; dx++) for (let dy = -1; dy <= 1; dy++) {
            if (occupied.has((c.x + dx) + ',' + (c.y + dy))) { free = false; break; }
          }
        }
        if (free) {
          cells.forEach(c => occupied.add(c.x + ',' + c.y));
          ships.push(cells);
          placed = true;
          break;
        }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return ships;
  }
  return null;
}

// Вид игрока (без чужих кораблей)
function bsView(g, username) {
  const me = g.playerA === username ? 'A' : 'B';
  const opp = me === 'A' ? 'B' : 'A';
  const myShips = g['ships' + me] || [];
  const oppShots = g['shots' + opp] || [];
  const myShots = g['shots' + me] || [];
  const hitOnMe = new Set(oppShots.filter(s => s.result === 'hit').map(s => s.x + ',' + s.y));
  const myHit = new Set(myShots.filter(s => s.result === 'hit').map(s => s.x + ',' + s.y));
  const oppShips = g['ships' + opp] || [];
  const sunkShips = oppShips.filter(ship => ship.every(c => myHit.has(c.x + ',' + c.y)));
  return {
    id: String(g._id),
    phase: g.phase,
    bet: g.bet,
    opponent: me === 'A' ? g.playerB : g.playerA,
    myTurn: g.turn === username && g.phase === 'battle',
    winner: g.winner,
    myShips: myShips.map(ship => ship.map(c => ({ ...c, hit: hitOnMe.has(c.x + ',' + c.y) }))),
    incoming: oppShots,
    myShots: myShots,
    sunkShips: sunkShips,
    serverTime: Date.now()
  };
}

function bsPushUpdate(g) {
  emitToUser(g.playerA, 'bs_update', bsView(g, g.playerA));
  emitToUser(g.playerB, 'bs_update', bsView(g, g.playerB));
}

function bsClearTimers(id) {
  const t = bsTimers.get(id);
  if (t) {
    if (t.placeA) clearTimeout(t.placeA);
    if (t.placeB) clearTimeout(t.placeB);
    if (t.shot) clearTimeout(t.shot);
    bsTimers.delete(id);
  }
}

// Таймер выстрела: не выстрелил за 30 сек — случайный выстрел
function bsArmShotTimer(g) {
  const t = bsTimers.get(String(g._id)) || {};
  if (t.shot) clearTimeout(t.shot);
  t.shot = setTimeout(async () => {
    try {
      const cur = await Battleship.findById(g._id);
      if (!cur || cur.phase !== 'battle' || !cur.turn) return;
      const me = cur.playerA === cur.turn ? 'A' : 'B';
      const shots = cur['shots' + me];
      const taken = new Set(shots.map(s => s.x + ',' + s.y));
      const free = [];
      for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
        if (!taken.has(x + ',' + y)) free.push({ x, y });
      }
      if (!free.length) return;
      const cell = free[Math.floor(Math.random() * free.length)];
      await bsDoShot(cur, cur.turn, cell.x, cell.y);
    } catch (e) { console.error('МБ авто-выстрел:', e.message); }
  }, BS_SHOT_MS);
  bsTimers.set(String(g._id), t);
}

// Выстрел: возвращает true если игра закончена
async function bsDoShot(g, shooter, x, y) {
  const me = g.playerA === shooter ? 'A' : 'B';
  const opp = me === 'A' ? 'B' : 'A';
  const shots = g['shots' + me];
  if (shots.some(s => s.x === x && s.y === y)) return false;

  const oppShips = g['ships' + opp];
  const isHit = oppShips.some(ship => ship.some(c => c.x === x && c.y === y));
  shots.push({ x, y, result: isHit ? 'hit' : 'miss' });

  let gameOver = false;
  if (isHit) {
    const hitSet = new Set(shots.filter(s => s.result === 'hit').map(s => s.x + ',' + s.y));
    gameOver = oppShips.every(ship => ship.every(c => hitSet.has(c.x + ',' + c.y)));
  }

  if (gameOver) {
    g.phase = 'done';
    g.winner = shooter;
    const user = await User.findOne({ username: shooter });
    if (user) {
      user.casinoBalance = (user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance) + g.bet * 2;
      await user.save();
    }
  } else {
    g.turn = isHit ? shooter : (me === 'A' ? g.playerB : g.playerA);
  }
  await g.save();
  bsPushUpdate(g);
  if (!gameOver) bsArmShotTimer(g);
  else bsClearTimers(String(g._id));
  return gameOver;
}

// Вызов на морской бой
app.post('/api/battleship/challenge', async (req, res) => {
  try {
    const from = (req.body.from || '').trim().toLowerCase();
    const to = (req.body.to || '').trim().toLowerCase();
    const bet = Math.floor(Number(req.body.bet) || 0);
    if (!from || !to) return res.status(400).json({ success: false, message: 'Укажи соперника' });
    if (from === to) return res.status(400).json({ success: false, message: 'Сам с собой скучно' });
    if (bet < 5 || bet > 100) return res.status(400).json({ success: false, message: 'Ставка: 5–100$' });

    const fromUser = await User.findOne({ username: from });
    const toUser = await User.findOne({ username: to });
    if (!toUser) return res.status(404).json({ success: false, message: 'Такого ника нет' });
    const fromBal = fromUser.casinoBalance == null ? CASINO_START_BALANCE : fromUser.casinoBalance;
    const toBal = toUser.casinoBalance == null ? CASINO_START_BALANCE : toUser.casinoBalance;
    if (fromBal < bet) return res.status(400).json({ success: false, message: `У тебя нет ${bet}$` });
    if (toBal < bet) return res.status(400).json({ success: false, message: `У ${to} нет ${bet}$` });

    const id = 'b' + (bsSeq++) + '_' + Date.now();
    bsChallenges.set(id, { id, from, to, bet });
    emitToUser(to, 'bs_challenge', { id, from, bet });
    setTimeout(() => {
      if (bsChallenges.has(id)) {
        bsChallenges.delete(id);
        emitToUser(from, 'bs_update', { phase: 'expired', opponent: to });
      }
    }, 90000);

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Ответ на вызов
app.post('/api/battleship/respond', async (req, res) => {
  try {
    const id = String(req.body.id || '');
    const username = (req.body.username || '').trim().toLowerCase();
    const ch = bsChallenges.get(id);
    if (!ch) return res.status(404).json({ success: false, message: 'Вызов протух' });
    if (ch.to !== username) return res.status(403).json({ success: false, message: 'Не твой вызов' });
    bsChallenges.delete(id);

    if (!req.body.accept) {
      emitToUser(ch.from, 'bs_update', { phase: 'declined', opponent: ch.to });
      return res.json({ success: true });
    }

    const fromUser = await User.findOne({ username: ch.from });
    const toUser = await User.findOne({ username: ch.to });
    fromUser.casinoBalance = (fromUser.casinoBalance == null ? CASINO_START_BALANCE : fromUser.casinoBalance) - ch.bet;
    toUser.casinoBalance = (toUser.casinoBalance == null ? CASINO_START_BALANCE : toUser.casinoBalance) - ch.bet;
    await fromUser.save();
    await toUser.save();

    const g = new Battleship({ playerA: ch.from, playerB: ch.to, bet: ch.bet, phase: 'placement' });
    await g.save();

    // Таймеры расстановки
    const timers = {};
    for (const [side, nick] of [['placeA', ch.from], ['placeB', ch.to]]) {
      timers[side] = setTimeout(async () => {
        try {
          const cur = await Battleship.findById(g._id);
          if (!cur || cur.phase !== 'placement') return;
          const s = side === 'placeA' ? 'A' : 'B';
          if (!cur['ships' + s].length) {
            const auto = bsRandomShips();
            if (auto) {
              cur['ships' + s] = auto;
              await cur.save();
              bsMaybeStartBattle(cur);
            }
          }
        } catch (e) { console.error('МБ авто-расстановка:', e.message); }
      }, BS_PLACE_MS);
    }
    bsTimers.set(String(g._id), timers);

    emitToUser(ch.from, 'bs_update', bsView(g, ch.from));
    emitToUser(ch.to, 'bs_update', bsView(g, ch.to));
    res.json({ success: true, gameId: String(g._id) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Старт боя, когда оба расставили
async function bsMaybeStartBattle(g) {
  const fresh = await Battleship.findById(g._id);
  if (!fresh || fresh.phase !== 'placement') return;
  if (fresh.shipsA.length && fresh.shipsB.length) {
    fresh.phase = 'battle';
    fresh.turn = Math.random() < 0.5 ? fresh.playerA : fresh.playerB;
    await fresh.save();
    const t = bsTimers.get(String(g._id)) || {};
    if (t.placeA) clearTimeout(t.placeA);
    if (t.placeB) clearTimeout(t.placeB);
    bsTimers.set(String(g._id), t);
    bsPushUpdate(fresh);
    bsArmShotTimer(fresh);
  }
}

// Расстановка кораблей
app.post('/api/battleship/place', async (req, res) => {
  try {
    const id = String(req.body.id || '');
    const username = (req.body.username || '').trim().toLowerCase();
    const g = await Battleship.findById(id);
    if (!g || g.phase !== 'placement') return res.status(404).json({ success: false, message: 'Игра не найдена' });
    const me = g.playerA === username ? 'A' : 'B';
    if (g.playerA !== username && g.playerB !== username) return res.status(403).json({ success: false, message: 'Не твоя игра' });
    if (g['ships' + me].length) return res.status(400).json({ success: false, message: 'Уже расставлено' });

    const ships = bsValidateShips(req.body.ships);
    if (!ships) return res.status(400).json({ success: false, message: 'Расстановка невалидна: корабли не должны касаться' });

    g['ships' + me] = ships;
    await g.save();
    await bsMaybeStartBattle(g);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Состояние игры для игрока
app.get('/api/battleship/state', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const username = (req.query.username || '').trim().toLowerCase();
    const g = await Battleship.findById(id);
    if (!g) return res.status(404).json({ success: false, message: 'Игра не найдена' });
    if (g.playerA !== username && g.playerB !== username) return res.status(403).json({ success: false, message: 'Не твоя игра' });
    res.json({ success: true, game: bsView(g, username) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Выстрел
app.post('/api/battleship/shot', async (req, res) => {
  try {
    const id = String(req.body.id || '');
    const username = (req.body.username || '').trim().toLowerCase();
    const x = Math.floor(Number(req.body.x));
    const y = Math.floor(Number(req.body.y));
    const g = await Battleship.findById(id);
    if (!g || g.phase !== 'battle') return res.status(400).json({ success: false, message: 'Бой не идёт' });
    if (g.turn !== username) return res.status(400).json({ success: false, message: 'Не твой ход' });
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 9 || y < 0 || y > 9) {
      return res.status(400).json({ success: false, message: 'Мимо поля' });
    }
    await bsDoShot(g, username, x, y);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
