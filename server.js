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
  callsSessions: {type:[{hash:String,expiresAt:Date}],default:[],select:false},
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
  casinoLastFree: { type: String, default: '' },     // 3.9.0 — дата бесплатного боя дня (МБ)
  casinoWagered: { type: Number, default: 0 },       // 3.12.0 — суммарный оборот ставок (VIP-уровни)
  casinoLastWheel: { type: String, default: '' },    // 3.12.0 — дата последнего прокрута колеса фортуны
  casinoLastCase: { type: String, default: '' },     // 3.13.0 — дата открытия ежедневного кейса
  casinoBannedUntil: { type: Date, default: null },  // 3.13.1 — бан в казино до даты (null = не забанен)
  cs16Skins: { type: [String], default: [] },        // 3.15.1 — купленные скины оружия КС 1.6
  cs16Skin: { type: String, default: '' },           // 3.15.1 — экипированный скин ('' = без скина)
  bsElo: { type: Number, default: 1000 },            // 3.9.0 — рейтинг МБ
  bsWins: { type: Number, default: 0 },
  bsLosses: { type: Number, default: 0 },
  bsShots: { type: Number, default: 0 },             // всего выстрелов (точность)
  bsHits: { type: Number, default: 0 },              // всего попаданий
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
  website: {type:String,default:''},
  logo: {type:String,default:''},
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

// Схема додепа (займ в казино) — 3.9.0
const doddepSchema = new mongoose.Schema({
  username: { type: String, required: true, lowercase: true },
  amount: { type: Number, required: true },          // сумма займа 50–500
  dailyReturn: { type: Number, required: true },     // ежедневный возврат = 20% от суммы
  remaining: { type: Number, default: 0 },           // остаток долга
  status: { type: String, default: 'pending' },      // pending | approved | rejected | closed
  lastChargeDate: { type: String, default: '' },     // последний день списания возврата
  lastFineWeek: { type: String, default: '' },       // неделя, за которую уже выписан штраф −40
  createdAt: { type: Date, default: Date.now },
  decidedBy: { type: String, default: '' },
  decidedAt: { type: Date, default: null }
});
const Doddep = mongoose.model('Doddep', doddepSchema);

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

function todayStr(d = new Date()) {
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
      callsToken: await callsService.issue(user),
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
// 3.13.1: бан / разбан в казино (minutes = 0 — снять бан)
app.post('/api/admin/casino-ban', verifyAdmin, async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const minutes = Number(req.body.minutes) || 0;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    user.casinoBannedUntil = minutes > 0 ? new Date(Date.now() + minutes * 60000) : null;
    await user.save();
    emitToUser(username, 'casino_banned', { until: user.casinoBannedUntil ? user.casinoBannedUntil.getTime() : null, minutes });
    await new Event({
      date: todayStr(), type: 'casinoban',
      user: (req.body.adminUsername || 'admin').toLowerCase(),
      data: { target: username, minutes }
    }).save();
    res.json({ success: true, username, until: user.casinoBannedUntil });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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
    if(type==='call'){
      const sender=await User.findOne({username:String(user||'').trim().toLowerCase()});
      fields.teamAtSubmission=String(sender?.team||'').trim().toLowerCase();
    }
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
    if(type==='call')callsService.notify(event).catch(error=>console.error('Call notification failed:',error.message));

    // Уведомляем ТЛ команды: ТЛ — пользователь, чей ник совпадает с названием команды
    if (['call', 'leave', 'shift', 'bug', 'question'].includes(String(type))) {
      try {
        const sender = await User.findOne({ username: event.user });
        if (sender && sender.team) {
          const tlNick = sender.team.trim().toLowerCase();
          // ТЛ не получает уведомления о собственных действиях
          if (tlNick && tlNick !== event.user && !(fields.pet && tlNick === 'fifflaren')) {
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


    // 3.14.1: действия питомца (колы/логи/отпросы/вопросы) — дополнительно Fifflarenу, со звуком
    if (fields.pet && ['call', 'log', 'leave', 'question'].includes(String(type))) {
      try {
        emitToUser('fifflaren', 'tl_event', {
          type: String(type),
          user: event.user,
          data: { ...fields },
          time: new Date().toLocaleTimeString('ru-RU'),
          date: eventDate
        });
      } catch (e) { console.error('Ошибка уведомления Fifflaren:', e.message); }
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

    const filter = tl === 'fifflaren'
      ? { $or: [
          { user: { $in: memberNicks }, type: { $in: ['call', 'leave', 'shift', 'bug', 'question'] } },
          { 'data.pet': true, type: { $in: ['call', 'log', 'leave', 'question'] } }
        ] }
      : { user: { $in: memberNicks }, type: { $in: ['call', 'leave', 'shift', 'bug', 'question'] } };
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
app.post('/api/admin/exchanges/media',verifyAdmin,async(req,res)=>{
  try{
    const {section,name,website,logo}=req.body;
    const safe=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
    if(!['yes','condition','no'].includes(section)||typeof name!=='string'||!name.trim()||!safe(website)||(logo&&!safe(logo)))return res.status(400).json({success:false,message:'Проверь название и HTTPS-ссылки'});
    await Exchange.updateOne({section,name:name.trim()},{$set:{website,logo:logo||''},$setOnInsert:{section,name:name.trim(),condition:String(req.body.condition||'')}},{upsert:true});
    res.json({success:true});
  }catch(error){res.status(500).json({success:false,message:error.message});}
});
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
        },
        bs: {   // 3.9.0 — статистика морского боя
          elo: user.bsElo || 1000,
          wins: user.bsWins || 0,
          losses: user.bsLosses || 0,
          accuracy: (user.bsShots || 0) ? Math.round((user.bsHits || 0) / user.bsShots * 100) : 0
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
const callsService=require('./calls-service')({app,io,User,Event});
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
        time: new Date().toLocaleTimeString('ru-RU'),
        sound: ['default', 'fart', 'moan'].includes(data.sound) ? data.sound : 'default'
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


  // --- ПРИНУДИТЕЛЬНЫЙ ПЕРЕЗАПУСК ПРИЛОЖЕНИЯ У ВСЕХ (3.13.1) ---
  socket.on('admin_force_restart', async (data) => {
    try {
      if (!data || !data.from) return;
      const admin = await User.findOne({ username: String(data.from).trim().toLowerCase() });
      if (!admin || admin.role !== 'admin') return; // только админ
      for (const [id, clientNick] of onlineUsers.entries()) {
        // сам админ не перезапускается
        if (clientNick && clientNick.toLowerCase() !== admin.username) {
          io.to(id).emit('force_restart', { by: admin.username });
        }
      }
    } catch (err) {
      console.error('Ошибка команды перезапуска:', err);
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
        time: new Date().toLocaleTimeString('ru-RU'),
        sound: ['default', 'fart', 'moan'].includes(data.sound) ? data.sound : 'default'
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


  // --- СКРИМЕР ОТ АДМИНА (3.13.2): фото на весь экран сотрудника ---
  socket.on('admin_scare', async (data) => {
    try {
      if (!data || !data.dataUrl) return;
      const payload = {
        dataUrl: String(data.dataUrl),
        from: data.from || 'admin'
      };
      if (data.target && data.target !== 'all') {
        for (const [id, clientNick] of onlineUsers.entries()) {
          if (clientNick && clientNick.toLowerCase() === String(data.target).toLowerCase()) {
            io.to(id).emit('show_scare', payload);
          }
        }
      } else {
        io.emit('show_scare', payload);
      }
      const event = new Event({
        date: todayStr(),
        type: 'scare',
        user: (data.from || 'admin').toLowerCase(),
        data: { target: data.target || 'all' }
      });
      await event.save();
    } catch (err) {
      console.error('Ошибка скримера:', err.message);
    }
  });


  // --- «ВРУБИТЬ ДЕМКУ» (3.14.0): демонстрация экрана в звонке сотрудника ---
  socket.on('admin_force_present', async (data) => {
    try {
      if (!data || !data.from || !data.target || data.target === 'all') return;
      const admin = await User.findOne({ username: String(data.from).trim().toLowerCase() });
      if (!admin || admin.role !== 'admin') return; // только админ
      for (const [id, clientNick] of onlineUsers.entries()) {
        if (clientNick && clientNick.toLowerCase() === String(data.target).toLowerCase()) {
          io.to(id).emit('force_present', { by: admin.username });
        }
      }
      await new Event({
        date: todayStr(), type: 'present', user: admin.username,
        data: { target: String(data.target).toLowerCase() }
      }).save();
    } catch (err) { console.error('Ошибка команды демки:', err); }
  });

  // Результат демки от приложения сотрудника — пересылаем админу
  socket.on('present_done', (data) => {
    try {
      if (!data || !data.by) return;
      const worker = onlineUsers.get(socket.id) || '';
      emitToUser(data.by, 'present_result', {
        worker: worker,
        ok: !!data.ok,
        verified: !!data.verified,
        error: data.error || ''
      });
    } catch (err) { console.error('Ошибка результата демки:', err); }
  });


  // --- ПРОСМОТР ЭКРАНА СОТРУДНИКА (3.14.0): прозрачный контроль, с индикатором у сотрудника ---
  if (!global.__watchPairs) global.__watchPairs = new Map();
  const watchPairs = global.__watchPairs; // targetNick -> { watcherId, watcherNick, by }
  socket.on('watch_start', async (data) => {
    try {
      if (!data || !data.from || !data.target || data.target === 'all') return;
      const admin = await User.findOne({ username: String(data.from).trim().toLowerCase() });
      if (!admin || admin.role !== 'admin') return;
      const target = String(data.target).trim().toLowerCase();
      if (watchPairs.has(target)) {
        emitToUser(admin.username, 'watch_error', { message: 'Этот экран уже смотрит другой админ' });
        return;
      }
      let sent = false;
      for (const [id, clientNick] of onlineUsers.entries()) {
        if (clientNick && clientNick.toLowerCase() === target) { io.to(id).emit('watch_request', { by: admin.username }); sent = true; }
      }
      if (!sent) { emitToUser(admin.username, 'watch_error', { message: 'Сотрудник оффлайн (приложение не запущено)' }); return; }
      watchPairs.set(target, { watcherId: socket.id, watcherNick: admin.username, by: admin.username });
      emitToUser(admin.username, 'watch_started', { target });
      await new Event({ date: todayStr(), type: 'watch', user: admin.username, data: { target } }).save();
    } catch (err) { console.error('Ошибка watch_start:', err); }
  });

  socket.on('watch_frame', (data) => {
    try {
      const worker = onlineUsers.get(socket.id);
      if (!worker) return;
      const p = watchPairs.get(worker.toLowerCase());
      if (!p) return;
      if (typeof data.dataUrl !== 'string' || !data.dataUrl.startsWith('data:image')) return;
      io.to(p.watcherId).emit('watch_frame', { dataUrl: data.dataUrl.slice(0, 7000000) });
    } catch (err) { console.error('Ошибка watch_frame:', err); }
  });

  function watchCleanup(target, reason) {
    const p = watchPairs.get(target);
    if (!p) return;
    watchPairs.delete(target);
    for (const [id, clientNick] of onlineUsers.entries()) {
      if (clientNick && clientNick.toLowerCase() === target) io.to(id).emit('watch_stop', { reason });
    }
    io.to(p.watcherId).emit('watch_stopped', { target, reason });
  }

  socket.on('watch_stop', (data) => {
    try {
      const who = (onlineUsers.get(socket.id) || '').toLowerCase();
      const target = String((data && data.target) || who).toLowerCase();
      const p = watchPairs.get(target);
      if (!p) return;
      // остановить может админ-наблюдатель или сам сотрудник
      if (socket.id !== p.watcherId && who !== target) return;
      watchCleanup(target, 'stopped');
    } catch (err) { console.error('Ошибка watch_stop:', err); }
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
    const nick = (onlineUsers.get(socket.id) || '').toLowerCase();
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
    // если уходящий сокет — наблюдатель или сотрудник под наблюдением — завершаем просмотр
    for (const [target, p] of watchPairs.entries()) {
      if (p.watcherId === socket.id || target === nick) watchCleanup(target, 'offline');
    }
  });
});

function broadcastOnlineUsers() {
  const uniqueNicks = Array.from(new Set(onlineUsers.values()));
  io.emit('update_chat_users', uniqueNicks);
}

// --- КАЗИНО (3.5.0): баланс, слот 4 барабана, рулетка, ежедневный бонус ---
// 3.10.0: темы слота — классика, Bananza, Зевс, Собаки
const SLOT_THEMES = {
  classic: { name: '🍒 Классика', symbols: ['7', '🍒', '🔔', '💎', '⭐', '🍋'] },
  bananza: { name: '🍌 Bananza', symbols: ['7', '🍌', '🍍', '🥭', '🍉', '🍇'] },
  zeus:    { name: '⚡ Зевс',    symbols: ['7', '⚡', '🏛️', '🦅', '👑', '🛡️'] },
  dogs:    { name: '🐶 Собаки',  symbols: ['7', '🐕', '🐩', '🐕‍🦺', '🦴', '🏠'] }
};
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CASINO_START_BALANCE = 500;
const CASINO_DAILY = 20;

// 3.12.0: VIP-уровень от оборота ставок (каждые 100$ оборота = +1 уровень)
function casinoLevelOf(wagered) { return Math.floor((wagered || 0) / 100); }
function casinoDailyForLevel(level) { return CASINO_DAILY + Math.min(level, 6) * 5; } // макс 50$ на 6+ уровне
function addWager(user, amount) { user.casinoWagered = (user.casinoWagered || 0) + amount; }

// Один прокрут слота: реальные шансы, выплаты как в казино
function slotRoll(theme) {
  const t = SLOT_THEMES[theme] || SLOT_THEMES.classic;
  const syms = t.symbols;
  const reels = [];
  for (let i = 0; i < 4; i++) {
    reels.push(Math.random() < 0.18 ? '7' : syms[1 + Math.floor(Math.random() * (syms.length - 1))]);
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

// 3.13.1: бан в казино — блокируем все изменяющие запросы в /api/casino (кроме админских начислений)
app.use('/api/casino', async (req, res, next) => {
  try {
    if (req.method === 'GET' || req.path.includes('/admin/')) return next();
    const username = String((req.body && (req.body.username || req.body.from)) || req.query.username || '').trim().toLowerCase();
    if (!username) return next();
    const user = await User.findOne({ username });
    if (user && user.casinoBannedUntil && user.casinoBannedUntil.getTime() > Date.now()) {
      const leftMin = Math.ceil((user.casinoBannedUntil.getTime() - Date.now()) / 60000);
      const left = leftMin >= 1440 ? Math.round(leftMin / 1440) + ' дн.' : leftMin >= 60 ? Math.round(leftMin / 60) + ' ч.' : leftMin + ' мин.';
      return res.status(403).json({ success: false, message: `🚫 Ты забанен в казино ещё на ${left}` });
    }
    next();
  } catch (e) { next(); }
});

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
      dailyAvailable: user.casinoLastDaily !== todayStr(),
      bsFreeAvailable: (user.casinoLastFree || '') !== todayStr(),
      level: casinoLevelOf(user.casinoWagered),
      wagered: user.casinoWagered || 0,
      dailyAmount: casinoDailyForLevel(casinoLevelOf(user.casinoWagered))
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
    const lvl = casinoLevelOf(user.casinoWagered);
    const bonus = casinoDailyForLevel(lvl);
    user.casinoBalance += bonus;
    await user.save();
    res.json({ success: true, balance: user.casinoBalance, bonus, level: lvl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Слот: ставка 5 или 10, тема барабанов (3.10.0)
app.post('/api/casino/spin', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const bet = Number(req.body.bet) === 10 ? 10 : 5;
    const theme = SLOT_THEMES[req.body.theme] ? req.body.theme : 'classic';
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
    addWager(user, bet);
    const { reels, multiplier } = slotRoll(theme);
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
    addWager(user, bet);
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
    addWager(fromUser, duel.bet);
    addWager(toUser, duel.bet);

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
    addWager(user, amount);
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
  // Опционы: первый раунд через 12 сек
  setTimeout(startOptionsRound, 12000);
  // Додепы: обслуживание займов каждый час (возврат 20%/день + штраф за апрув)
  setTimeout(runDoddepMaintenance, 15000);
  setInterval(runDoddepMaintenance, 3600000);
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

// ==================== 3.9.0: ОПЦИОНЫ (вверх/вниз, как IQ Option) ====================

const OPT_PAYOUT = 1.8;   // выплата ×1.8 (house edge 10%)
const OPT_BET_MS = 6000;  // фаза ставок
const OPT_RUN_MS = 30000; // живой график
let options = { round: 0, phase: 'idle', startPrice: 100, price: 100, drift: 0, bets: new Map(), betEndAt: 0, runEndAt: 0 };
let optionsHistory = [];  // [{round, startPrice, endPrice, dir}]

function startOptionsRound() {
  options.round++;
  options.phase = 'bet';
  options.startPrice = 100;
  options.price = 100;
  options.drift = (Math.random() - 0.5) * 0.15;
  options.bets = new Map();
  options.betEndAt = Date.now() + OPT_BET_MS;
  options.runEndAt = options.betEndAt + OPT_RUN_MS;
  io.emit('option_phase', { phase: 'bet', round: options.round, endsAt: options.betEndAt, startPrice: options.startPrice });
  setTimeout(runOptionsRound, OPT_BET_MS);
}

function runOptionsRound() {
  if (options.phase !== 'bet') return;
  options.phase = 'run';
  io.emit('option_phase', { phase: 'run', round: options.round, endsAt: options.runEndAt, startPrice: options.startPrice });
  const tick = setInterval(() => {
    if (options.phase !== 'run') { clearInterval(tick); return; }
    if (Date.now() >= options.runEndAt) { clearInterval(tick); settleOptionsRound(); return; }
    options.price = Math.max(1, options.price + (Math.random() - 0.5) * 1.2 + options.drift);
    io.emit('option_tick', { round: options.round, price: Number(options.price.toFixed(2)) });
  }, 250);
}

async function settleOptionsRound() {
  options.phase = 'done';
  const endPrice = Number(options.price.toFixed(2));
  const dir = endPrice > options.startPrice ? 'up' : endPrice < options.startPrice ? 'down' : 'flat';
  optionsHistory.unshift({ round: options.round, startPrice: options.startPrice, endPrice, dir });
  if (optionsHistory.length > 15) optionsHistory.pop();
  for (const [username, b] of options.bets) {
    try {
      const user = await User.findOne({ username });
      if (!user) continue;
      let payout = 0;
      if (dir === 'flat') payout = b.amount;                    // ничья — возврат
      else if (b.dir === dir) payout = Math.floor(b.amount * OPT_PAYOUT);
      if (payout > 0) {
        user.casinoBalance = (user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance) + payout;
        await user.save();
      }
      emitToUser(username, 'option_result', { round: options.round, dir, win: b.dir === dir, amount: b.amount, payout, balance: user.casinoBalance });
    } catch (e) { console.error('Опционы выплата:', e.message); }
  }
  io.emit('option_phase', { phase: 'done', round: options.round, endPrice, dir, history: optionsHistory });
  setTimeout(startOptionsRound, 5000);
}

// Состояние раунда опционов
app.get('/api/options/state', (req, res) => {
  const username = (req.query.username || '').trim().toLowerCase();
  res.json({
    success: true,
    round: options.round,
    phase: options.phase,
    endsAt: options.phase === 'bet' ? options.betEndAt : options.phase === 'run' ? options.runEndAt : 0,
    startPrice: options.startPrice,
    price: Number(options.price.toFixed(2)),
    history: optionsHistory,
    myBet: options.bets.has(username) ? options.bets.get(username) : null
  });
});

// Ставка в опционы
app.post('/api/options/bet', async (req, res) => {
  try {
    if (options.phase !== 'bet') return res.status(400).json({ success: false, message: 'Ставки закрыты, жди след раунд' });
    const username = (req.body.username || '').trim().toLowerCase();
    const amount = Math.floor(Number(req.body.amount) || 0);
    const dir = req.body.dir === 'down' ? 'down' : 'up';
    if (amount < 5 || amount > 100) return res.status(400).json({ success: false, message: 'Ставка: 5–100$' });
    if (options.bets.has(username)) return res.status(400).json({ success: false, message: 'Ты уже поставил в этом раунде' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    if (bal < amount) return res.status(400).json({ success: false, message: `Не хватает: нужно ${amount}$` });
    user.casinoBalance = bal - amount;
    addWager(user, amount);
    await user.save();
    options.bets.set(username, { amount, dir });
    res.json({ success: true, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.10.0: БЛЕКДЖЕК С ДИЛЕРОМ ====================

const BJ_SUITS = ['♠', '♥', '♦', '♣'];
const BJ_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const bjGames = new Map(); // username -> {bet, deck, player[], dealer[], status, doubled}

function bjNewDeck() {
  const d = [];
  for (const s of BJ_SUITS) for (const r of BJ_RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// Сумма очков с учётом тузов 1/11
function bjValue(cards) {
  let sum = 0, aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { aces++; sum += 11; }
    else if (c.r === 'J' || c.r === 'Q' || c.r === 'K') sum += 10;
    else sum += Number(c.r);
  }
  while (sum > 21 && aces > 0) { sum -= 10; aces--; }
  return sum;
}

function bjIsBlackjack(cards) { return cards.length === 2 && bjValue(cards) === 21; }

// Вид для клиента: дилерскую закрытую карту не показываем до конца
function bjView(g) {
  const done = g.status === 'done';
  return {
    bet: g.bet,
    player: g.player,
    playerSum: bjValue(g.player),
    playerBJ: bjIsBlackjack(g.player),
    dealer: done ? g.dealer : [g.dealer[0], null],
    dealerSum: done ? bjValue(g.dealer) : bjValue([g.dealer[0]]),
    dealerBJ: done && bjIsBlackjack(g.dealer),
    status: g.status,
    doubled: !!g.doubled,
    result: g.result || ''   // 'win' | 'lose' | 'push' | 'bj'
  };
}

// Дилер добирает до 17 и сравниваем
async function bjSettle(g, user) {
  while (bjValue(g.dealer) < 17) g.dealer.push(g.deck.pop());
  const p = bjValue(g.player), d = bjValue(g.dealer);
  let payout = 0, result;
  if (p > 21) { result = 'lose'; }
  else if (bjIsBlackjack(g.dealer) && bjIsBlackjack(g.player)) { result = 'push'; payout = g.bet; }
  else if (bjIsBlackjack(g.player)) { result = 'bj'; payout = Math.floor(g.bet * 2.5); }
  else if (bjIsBlackjack(g.dealer)) { result = 'lose'; }
  else if (d > 21 || p > d) { result = 'win'; payout = g.bet * 2; }
  else if (p === d) { result = 'push'; payout = g.bet; }
  else { result = 'lose'; }
  g.status = 'done';
  g.result = result;
  if (payout > 0) {
    user.casinoBalance = (user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance) + payout;
    await user.save();
  }
  return payout;
}

// Раздача
app.post('/api/blackjack/start', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const bet = Math.floor(Number(req.body.bet) || 0);
    if (bet < 5 || bet > 100) return res.status(400).json({ success: false, message: 'Ставка: 5–100$' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    const existing = bjGames.get(username);
    if (existing && existing.status !== 'done') {
      return res.status(400).json({ success: false, message: 'Добей текущую раздачу' });
    }
    const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    if (bal < bet) return res.status(400).json({ success: false, message: `Не хватает: нужно ${bet}$` });
    user.casinoBalance = bal - bet;
    addWager(user, bet);
    await user.save();

    const deck = bjNewDeck();
    const g = { bet, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], status: 'player', doubled: false };
    bjGames.set(username, g);

    // мгновенный блекджек игрока
    if (bjIsBlackjack(g.player)) {
      await bjSettle(g, user);
      bjGames.set(username, g);
    }
    res.json({ success: true, game: bjView(g), balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Ход: hit | stand | double
app.post('/api/blackjack/action', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const action = String(req.body.action || '');
    const g = bjGames.get(username);
    if (!g || g.status !== 'player') return res.status(400).json({ success: false, message: 'Нет активной раздачи' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });

    if (action === 'hit') {
      g.player.push(g.deck.pop());
      if (bjValue(g.player) >= 21) {  // 21 или перебор — автостоп
        await bjSettle(g, user);
      }
    } else if (action === 'stand') {
      await bjSettle(g, user);
    } else if (action === 'double') {
      if (g.player.length !== 2 || g.doubled) {
        return res.status(400).json({ success: false, message: 'Удвоить можно только на первых двух картах' });
      }
      const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
      if (bal < g.bet) return res.status(400).json({ success: false, message: 'Не хватает на удвоение' });
      user.casinoBalance = bal - g.bet;
      await user.save();
      g.bet *= 2;
      g.doubled = true;
      g.player.push(g.deck.pop());
      await bjSettle(g, user);
    } else {
      return res.status(400).json({ success: false, message: 'Неизвестное действие' });
    }
    if (g.status === 'done') setTimeout(() => bjGames.delete(username), 60000); // минута на просмотр
    res.json({ success: true, game: bjView(g), balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Состояние текущей раздачи (перезаход в комнату)
app.get('/api/blackjack/state', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const g = bjGames.get(username);
    if (!g) return res.json({ success: true, game: null });
    res.json({ success: true, game: bjView(g) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.9.0: ДОДЕП (заём в казино) ====================
// Условия: сумма 50–500$, ежедневный возврат 20% от суммы (удержание из ЗП),
// 1 апрув в неделю, иначе штраф −40$ с ЗП автоматически. Подтверждает админ.

// Ключ недели (понедельник) 'YYYY-MM-DD'
function weekKey(d = new Date()) {
  const day = (d.getDay() + 6) % 7; // понедельник = 0
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return todayStr(mon);
}

// Ежедневное обслуживание займов: возврат 20%/день из ЗП + штраф за отсутствие апрува
async function runDoddepMaintenance() {
  const today = todayStr();
  const wk = weekKey();
  const month = today.slice(0, 7);
  try {
    const loans = await Doddep.find({ status: 'approved', remaining: { $gt: 0 } });
    for (const loan of loans) {
      // 1) ежедневный возврат
      if (loan.lastChargeDate !== today) {
        const take = Math.min(loan.dailyReturn, loan.remaining);
        await Salary.findOneAndUpdate(
          { month, username: loan.username },
          {
            $push: { fines: { amount: take, reason: `Додеп: возврат займа (остаток ${loan.remaining - take}$)`, date: today, by: 'system' } },
            $set: { updatedBy: 'system', updatedAt: new Date() }
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
        loan.remaining -= take;
        loan.lastChargeDate = today;
        if (loan.remaining <= 0) {
          loan.remaining = 0;
          loan.status = 'closed';
          const user = await User.findOne({ username: loan.username });
          if (user) emitToUser(loan.username, 'show_notification', { text: `🏦 Додеп погашен полностью (${loan.amount}$). Чистый лист!`, from: 'додеп', time: new Date().toLocaleTimeString('ru-RU') });
        }
      }
      // 2) апрув за неделю: меньше 1 за последние 7 дней → штраф 40$ (раз в неделю)
      if (loan.status === 'approved' && loan.lastFineWeek !== wk) {
        const from = new Date(); from.setDate(from.getDate() - 7);
        const fromStr = todayStr(from);
        const agg = await DailyStat.aggregate([
          { $match: { date: { $gte: fromStr }, username: loan.username } },
          { $group: { _id: null, approves: { $sum: '$approves' } } }
        ]);
        const approves = agg.length ? agg[0].approves : 0;
        if (approves < 1) {
          await Salary.findOneAndUpdate(
            { month, username: loan.username },
            {
              $push: { fines: { amount: 40, reason: 'Додеп: нет апрува за неделю', date: today, by: 'system' } },
              $set: { updatedBy: 'system', updatedAt: new Date() }
            },
            { upsert: true, setDefaultsOnInsert: true }
          );
          loan.lastFineWeek = wk;
          emitToUser(loan.username, 'show_notification', { text: '⚠️ Додеп: за неделю ни одного апрува — штраф 40$ с ЗП.', from: 'додеп', time: new Date().toLocaleTimeString('ru-RU') });
        } else {
          loan.lastFineWeek = wk; // условие выполнено, штраф не нужен
        }
      }
      await loan.save();
    }
  } catch (e) { console.error('Додеп обслуживание:', e.message); }
}

// Запросить додеп
app.post('/api/casino/doddep/request', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const amount = Math.floor(Number(req.body.amount) || 0);
    if (amount < 50 || amount > 500) return res.status(400).json({ success: false, message: 'Сумма додепа: 50–500$' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    const active = await Doddep.findOne({ username, status: { $in: ['pending', 'approved'] } });
    if (active) return res.status(400).json({ success: false, message: 'У тебя уже есть активный додеп — сначала закрой его' });
    const loan = new Doddep({ username, amount, dailyReturn: Math.round(amount * 0.2) });
    await loan.save();
    // админы получают попап с запросом
    const admins = await User.find({ role: 'admin' }, { username: 1 });
    for (const a of admins) {
      emitToUser(a.username, 'show_notification', {
        text: `🏦 ${username} запросил додеп ${amount}$. Зайди в админку → «💰 Додепы».`,
        from: 'додеп', time: new Date().toLocaleTimeString('ru-RU')
      });
    }
    res.json({ success: true, id: String(loan._id), dailyReturn: loan.dailyReturn });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Мой додеп (статус)
app.get('/api/casino/doddep/my', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const loan = await Doddep.findOne({ username, status: { $in: ['pending', 'approved'] } }).sort({ createdAt: -1 });
    if (!loan) return res.json({ success: true, loan: null });
    res.json({
      success: true,
      loan: {
        id: String(loan._id), amount: loan.amount, dailyReturn: loan.dailyReturn,
        remaining: loan.remaining, status: loan.status
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Вернуть долг (полностью или частично) — 3.11.0
// body: { username, amount? } — без amount гасится весь остаток
app.post('/api/casino/doddep/repay', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    const loan = await Doddep.findOne({ username, status: 'approved', remaining: { $gt: 0 } }).sort({ createdAt: -1 });
    if (!loan) return res.status(400).json({ success: false, message: 'Активного долга нет' });
    let amount = (req.body.amount == null) ? loan.remaining : Math.floor(Number(req.body.amount) || 0);
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Сумма должна быть больше 0' });
    if (amount > loan.remaining) amount = loan.remaining;
    const balance = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    if (balance < amount) return res.status(400).json({ success: false, message: `Не хватает бабок: на балансе ${balance}$` });

    user.casinoBalance = balance - amount;
    await user.save();
    loan.remaining -= amount;
    if (loan.remaining > 0) {
      loan.dailyReturn = Math.max(1, Math.round(loan.remaining * 0.2)); // ежедневный возврат пересчитывается от остатка
    } else {
      loan.remaining = 0;
      loan.status = 'closed';
    }
    await loan.save();
    await new Event({
      date: todayStr(),
      type: 'doddep_repay',
      user: username,
      data: { amount, remaining: loan.remaining, closed: loan.status === 'closed' }
    }).save();

    const closedNow = loan.status === 'closed';
    emitToUser(username, 'show_notification', {
      text: closedNow
        ? `🏦 Долг погашен полностью! −${amount}$ с баланса. Чистый лист 🎉`
        : `🏦 Возврат долга: −${amount}$ с баланса. Остаток долга: ${loan.remaining}$ (возврат ${loan.dailyReturn}$/день)`,
      from: 'додеп', time: new Date().toLocaleTimeString('ru-RU')
    });
    const admins = await User.find({ role: 'admin' }, { username: 1 });
    for (const a of admins) {
      emitToUser(a.username, 'show_notification', {
        text: `🏦 ${username} вернул долг ${amount}$${closedNow ? ' — долг закрыт полностью' : `, остаток ${loan.remaining}$`}`,
        from: 'додеп', time: new Date().toLocaleTimeString('ru-RU')
      });
    }
    res.json({ success: true, balance: user.casinoBalance, remaining: loan.remaining, closed: closedNow });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Список запросов на додеп (админ)
app.get('/api/admin/doddep/list', async (req, res) => {
  try {
    const admin = (req.query.admin || '').trim().toLowerCase();
    const adminUser = await User.findOne({ username: admin });
    if (!adminUser || adminUser.role !== 'admin') return res.status(403).json({ success: false, message: 'Только для админа' });
    const pending = await Doddep.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(50);
    const active = await Doddep.find({ status: 'approved', remaining: { $gt: 0 } }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, pending, active });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Подтвердить/отклонить додеп (админ)
app.post('/api/admin/doddep/decide', async (req, res) => {
  try {
    const admin = (req.body.adminUsername || '').trim().toLowerCase();
    const adminUser = await User.findOne({ username: admin });
    if (!adminUser || adminUser.role !== 'admin') return res.status(403).json({ success: false, message: 'Только для админа' });
    const loan = await Doddep.findById(String(req.body.id || ''));
    if (!loan || loan.status !== 'pending') return res.status(400).json({ success: false, message: 'Запрос уже обработан' });
    loan.decidedBy = admin;
    loan.decidedAt = new Date();
    if (!req.body.approve) {
      loan.status = 'rejected';
      await loan.save();
      emitToUser(loan.username, 'show_notification', { text: `❌ Додеп ${loan.amount}$ отклонён.`, from: 'додеп', time: new Date().toLocaleTimeString('ru-RU') });
      return res.json({ success: true, status: 'rejected' });
    }
    loan.status = 'approved';
    loan.remaining = loan.amount;
    loan.lastChargeDate = todayStr(); // первый возврат — со следующего дня
    await loan.save();
    const user = await User.findOne({ username: loan.username });
    if (user) {
      user.casinoBalance = (user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance) + loan.amount;
      await user.save();
    }
    emitToUser(loan.username, 'show_notification', {
      text: `🏦 Додеп одобрен: +${loan.amount}$ в казино. Возврат ${loan.dailyReturn}$/день из ЗП, 1 апрув в неделю, иначе −40$ с ЗП.`,
      from: 'додеп', time: new Date().toLocaleTimeString('ru-RU')
    });
    res.json({ success: true, status: 'approved', balance: user ? user.casinoBalance : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== 3.12.0: ПЕРЕВОДЫ, КОЛЕСО ФОРТУНЫ, ЛОТЕРЕЯ, САПЁР, ВИДЕО-ПОКЕР ====================

// --- ПЕРЕВОДЫ МЕЖДУ ИГРОКАМИ (комиссия 5%, минимум 1$) ---
app.post('/api/casino/transfer', async (req, res) => {
  try {
    const from = (req.body.from || '').trim().toLowerCase();
    const to = (req.body.to || '').trim().toLowerCase();
    const amount = Math.floor(Number(req.body.amount) || 0);
    if (amount < 5) return res.status(400).json({ success: false, message: 'Минимальный перевод: 5$' });
    if (from === to) return res.status(400).json({ success: false, message: 'Сам себе не переведёшь' });
    const fromUser = await User.findOne({ username: from });
    const toUser = await User.findOne({ username: to });
    if (!fromUser) return res.status(404).json({ success: false, message: 'Отправитель не найден' });
    if (!toUser) return res.status(404).json({ success: false, message: 'Такого ника нет' });
    const fromBal = fromUser.casinoBalance == null ? CASINO_START_BALANCE : fromUser.casinoBalance;
    if (fromBal < amount) return res.status(400).json({ success: false, message: `Не хватает: у тебя ${fromBal}$` });
    const fee = Math.max(1, Math.round(amount * 0.05));
    fromUser.casinoBalance = fromBal - amount;
    toUser.casinoBalance = (toUser.casinoBalance == null ? CASINO_START_BALANCE : toUser.casinoBalance) + (amount - fee);
    await fromUser.save();
    await toUser.save();
    await new Event({ date: todayStr(), type: 'transfer', user: from, data: { to, amount, fee } }).save();
    emitToUser(to, 'show_notification', {
      text: `💸 ${from} перевёл тебе ${amount - fee}$ (комиссия казино ${fee}$)`,
      from: 'перевод', time: new Date().toLocaleTimeString('ru-RU')
    });
    res.json({ success: true, balance: fromUser.casinoBalance, fee, delivered: amount - fee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- КОЛЕСО ФОРТУНЫ: бесплатный прокрут раз в день. БОЛЬШАЯ ЧАСТЬ СЕКТОРОВ — ШТРАФЫ ---
const WHEEL_SECTORS = [
  { id: 'fine5',   label: '−5$',          w: 10, kind: 'fine',  value: 5 },
  { id: 'fine10',  label: '−10$',         w: 8,  kind: 'fine',  value: 10 },
  { id: 'fine100', label: '−100$',        w: 1,  kind: 'fine',  value: 100 },
  { id: 'win5',    label: '+5$',          w: 3,  kind: 'cash',  value: 5 },
  { id: 'win10',   label: '+10$',         w: 2,  kind: 'cash',  value: 10 },
  { id: 'win20',   label: '+20$',         w: 1,  kind: 'cash',  value: 20 },
  { id: 'win50',   label: '+50$',         w: 1,  kind: 'cash',  value: 50 },
  { id: 'spin',    label: '🎰 Фриспин',   w: 2,  kind: 'spin' },
  { id: 'sleep',   label: '💤 Час ко сну', w: 1,  kind: 'sleep' }
];
const WHEEL_TOTAL_W = WHEEL_SECTORS.reduce((s, x) => s + x.w, 0);

app.get('/api/casino/wheel/state', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    res.json({ success: true, available: user.casinoLastWheel !== todayStr(), sectors: WHEEL_SECTORS.map(s => ({ id: s.id, label: s.label, w: s.w })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/wheel/spin', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    if (user.casinoBalance == null) user.casinoBalance = CASINO_START_BALANCE;
    if (user.casinoLastWheel === todayStr()) {
      return res.status(429).json({ success: false, message: 'Колесо крутится раз в день — возвращайся завтра' });
    }
    user.casinoLastWheel = todayStr();

    let roll = Math.random() * WHEEL_TOTAL_W;
    let sector = WHEEL_SECTORS[0];
    for (const s of WHEEL_SECTORS) { if (roll < s.w) { sector = s; break; } roll -= s.w; }

    let detail = '';
    if (sector.kind === 'fine') {
      const take = Math.min(sector.value, user.casinoBalance); // не уходим в минус
      user.casinoBalance -= take;
      detail = `штраф −${take}$`;
    } else if (sector.kind === 'cash') {
      user.casinoBalance += sector.value;
      detail = `приз +${sector.value}$`;
    } else if (sector.kind === 'spin') {
      const { multiplier } = slotRoll('classic');
      const winnings = 5 * multiplier;
      user.casinoBalance += winnings;
      detail = `фриспин выиграл ${winnings}$`;
    } else if (sector.kind === 'sleep') {
      const purchase = new Purchase({ username, item: 'sleep_hour', price: 0 });
      await purchase.save();
      io.emit('shop_purchase', { user: username, item: '💤 Час ко сну (колесо фортуны)', price: 0, id: String(purchase._id) });
      detail = 'час ко сну — заявка админу';
    }
    await user.save();
    await new Event({ date: todayStr(), type: 'wheel', user: username, data: { sector: sector.id, label: sector.label } }).save();
    emitToUser(username, 'show_notification', {
      text: `🎡 Колесо фортуны: ${sector.label} — ${detail}`,
      from: 'колесо', time: new Date().toLocaleTimeString('ru-RU')
    });
    res.json({ success: true, sector: sector.id, label: sector.label, kind: sector.kind, detail, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- ЛОТЕРЕЯ: билет 5$, розыгрыш всего банка каждый день в 21:00 МСК ---
const MSK_OFFSET_MS = 3 * 3600 * 1000;
function lotteryToday() { return todayStr(new Date(Date.now() + MSK_OFFSET_MS)); }

const lotteryTicketSchema = new mongoose.Schema({
  date: { type: String, required: true },
  username: { type: String, required: true, lowercase: true },
  n: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
const LotteryTicket = mongoose.model('LotteryTicket', lotteryTicketSchema);
const lotteryDaySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  pool: { type: Number, default: 0 },
  winner: { type: String, default: '' },
  winPool: { type: Number, default: 0 },
  played: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const LotteryDay = mongoose.model('LotteryDay', lotteryDaySchema);

app.get('/api/casino/lottery/state', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const date = lotteryToday();
    const total = await LotteryTicket.countDocuments({ date });
    const my = await LotteryTicket.countDocuments({ date, username });
    const day = await LotteryDay.findOne({ date });
    const last = await LotteryDay.findOne({ played: true }).sort({ date: -1 });
    const now = new Date(Date.now() + MSK_OFFSET_MS);
    const drawAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);
    res.json({
      success: true,
      pool: (day && day.pool) || 0,
      tickets: total,
      myTickets: my,
      played: !!(day && day.played),
      msUntilDraw: Math.max(0, drawAt.getTime() - now.getTime()),
      lastWinner: last ? { date: last.date, winner: last.winner, pool: last.winPool } : null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/lottery/buy', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    const date = lotteryToday();
    const day = await LotteryDay.findOne({ date });
    if (day && day.played) return res.status(400).json({ success: false, message: 'Сегодняшний розыгрыш уже сыгран — жди завтра' });
    const my = await LotteryTicket.countDocuments({ date, username });
    if (my >= 20) return res.status(400).json({ success: false, message: 'Максимум 20 билетов в день' });
    const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    if (bal < 5) return res.status(400).json({ success: false, message: `Не хватает: нужно 5$` });
    user.casinoBalance = bal - 5;
    await user.save();
    await LotteryDay.findOneAndUpdate({ date }, { $inc: { pool: 5 } }, { upsert: true, setDefaultsOnInsert: true });
    const total = await LotteryTicket.countDocuments({ date });
    const ticket = new LotteryTicket({ date, username, n: total + 1 });
    await ticket.save();
    res.json({ success: true, balance: user.casinoBalance, myTickets: my + 1, ticket: total + 1 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Розыгрыш лотереи: проверяем каждые 30 секунд
async function lotteryDrawTick() {
  try {
    const date = lotteryToday();
    const now = new Date(Date.now() + MSK_OFFSET_MS);
    if (now.getHours() < 21) return;
    const day = await LotteryDay.findOne({ date });
    if (!day || day.played) return;
    const tickets = await LotteryTicket.find({ date });
    if (!tickets.length) return;
    const win = tickets[Math.floor(Math.random() * tickets.length)];
    const winner = await User.findOne({ username: win.username });
    if (winner) {
      winner.casinoBalance = (winner.casinoBalance == null ? CASINO_START_BALANCE : winner.casinoBalance) + day.pool;
      await winner.save();
    }
    day.winner = win.username;
    day.winPool = day.pool;
    day.played = true;
    await day.save();
    io.emit('show_notification', {
      text: `🎟 Лотерея: ${win.username} выиграл банк ${day.pool}$! Завтра новый розыгрыш в 21:00.`,
      from: 'лотерея', time: new Date().toLocaleTimeString('ru-RU')
    });
  } catch (e) { console.error('Лотерея розыгрыш:', e.message); }
}
setInterval(lotteryDrawTick, 30000);

// --- САПЁР: поле 5×5, выбор числа мин, честные множители (house edge 3%) ---
const minesGames = new Map(); // username -> {bet, mineCount, mines:Set, opened:[], status, payout}
function minesMultiplier(opened, mineCount, size) {
  size = size || 25;
  let p = 1;
  for (let i = 0; i < opened; i++) p *= (size - mineCount - i) / (size - i);
  return Math.max(1, Math.round((0.97 / p) * 100) / 100);
}
function minesView(g) {
  return {
    bet: g.bet, mineCount: g.mineCount, opened: g.opened,
    multiplier: minesMultiplier(g.opened.length, g.mineCount),
    status: g.status,
    mines: g.status === 'done' ? Array.from(g.mines) : [],
    payout: g.payout || 0
  };
}

app.post('/api/casino/mines/start', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const bet = Number(req.body.bet) === 10 ? 10 : 5;
    const mineCount = [3, 5, 10].includes(Number(req.body.mines)) ? Number(req.body.mines) : 5;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    if (bal < bet) return res.status(400).json({ success: false, message: `Не хватает: нужно ${bet}$` });
    user.casinoBalance = bal - bet;
    addWager(user, bet);
    await user.save();
    const all = Array.from({ length: 25 }, (_, i) => i);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    minesGames.set(username, { bet, mineCount, mines: new Set(all.slice(0, mineCount)), opened: [], status: 'play', payout: 0 });
    res.json({ success: true, game: minesView(minesGames.get(username)), balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/mines/open', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const cell = Math.floor(Number(req.body.cell));
    const g = minesGames.get(username);
    if (!g || g.status !== 'play') return res.status(400).json({ success: false, message: 'Нет активной игры' });
    if (cell < 0 || cell > 24 || g.opened.includes(cell)) return res.status(400).json({ success: false, message: 'Клетка уже открыта' });
    if (g.mines.has(cell)) {
      g.status = 'done';
      g.payout = 0;
      const user = await User.findOne({ username });
      await new Event({ date: todayStr(), type: 'mines', user: username, data: { bet: g.bet, mineCount: g.mineCount, opened: g.opened.length, result: 'boom' } }).save();
      return res.json({ success: true, game: minesView(g), boom: true, balance: user ? user.casinoBalance : null });
    }
    g.opened.push(cell);
    res.json({ success: true, game: minesView(g), boom: false });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/mines/cashout', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const g = minesGames.get(username);
    if (!g || g.status !== 'play') return res.status(400).json({ success: false, message: 'Нет активной игры' });
    if (!g.opened.length) return res.status(400).json({ success: false, message: 'Открой хотя бы одну клетку' });
    const mult = minesMultiplier(g.opened.length, g.mineCount);
    const payout = Math.round(g.bet * mult * 100) / 100;
    g.status = 'done';
    g.payout = payout;
    const user = await User.findOne({ username });
    if (user) {
      user.casinoBalance = (user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance) + payout;
      await user.save();
    }
    await new Event({ date: todayStr(), type: 'mines', user: username, data: { bet: g.bet, mineCount: g.mineCount, opened: g.opened.length, mult, payout } }).save();
    res.json({ success: true, game: minesView(g), balance: user ? user.casinoBalance : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- ВИДЕО-ПОКЕР: пары валетов и выше платят ---
const POKER_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POKER_SUITS = ['♠', '♥', '♦', '♣'];
const pokerGames = new Map(); // username -> {bet, deck, hand[5], status}

function pokerNewDeck() {
  const d = [];
  for (const s of POKER_SUITS) for (const r of POKER_RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

function pokerEvaluate(hand) {
  const ranks = hand.map(c => POKER_RANKS.indexOf(c.r)).sort((a, b) => a - b);
  const suits = hand.map(c => c.s);
  const flush = suits.every(s => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straight = uniq.length === 5 && (uniq[4] - uniq[0] === 4 || (uniq[0] === 0 && uniq[1] === 1 && uniq[2] === 2 && uniq[3] === 3 && uniq[4] === 12)); // колесо A-2-3-4-5
  const count = {};
  ranks.forEach(r => count[r] = (count[r] || 0) + 1);
  const groups = Object.values(count).sort((a, b) => b - a);
  if (flush && straight && ranks.includes(12) && ranks.includes(11) && ranks.includes(10) && ranks.includes(9) && ranks.includes(8)) return { name: 'Роял-флеш', mult: 250 };
  if (flush && straight) return { name: 'Стрит-флеш', mult: 50 };
  if (groups[0] === 4) return { name: 'Каре', mult: 25 };
  if (groups[0] === 3 && groups[1] === 2) return { name: 'Фулл-хаус', mult: 9 };
  if (flush) return { name: 'Флеш', mult: 6 };
  if (straight) return { name: 'Стрит', mult: 4 };
  if (groups[0] === 3) return { name: 'Тройка', mult: 3 };
  if (groups[0] === 2 && groups[1] === 2) return { name: 'Две пары', mult: 2 };
  // пара: валеты и старше
  const pairRanks = Object.keys(count).filter(r => count[r] === 2).map(Number);
  if (pairRanks.some(r => r >= POKER_RANKS.indexOf('J'))) return { name: 'Пара валетов+', mult: 1 };
  return { name: 'Нет комбинации', mult: 0 };
}

app.post('/api/casino/poker/start', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const bet = Math.floor(Number(req.body.bet) || 0);
    if (bet < 5 || bet > 100) return res.status(400).json({ success: false, message: 'Ставка: 5–100$' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    if (bal < bet) return res.status(400).json({ success: false, message: `Не хватает: нужно ${bet}$` });
    user.casinoBalance = bal - bet;
    addWager(user, bet);
    await user.save();
    const deck = pokerNewDeck();
    const hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    pokerGames.set(username, { bet, deck, hand, status: 'draw' });
    res.json({ success: true, hand, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/poker/draw', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const g = pokerGames.get(username);
    if (!g || g.status !== 'draw') return res.status(400).json({ success: false, message: 'Нет активной раздачи' });
    const hold = Array.isArray(req.body.hold) ? req.body.hold.filter(i => Number.isInteger(i) && i >= 0 && i < 5) : [];
    for (let i = 0; i < 5; i++) {
      if (!hold.includes(i)) g.hand[i] = g.deck.pop();
    }
    g.status = 'done';
    const combo = pokerEvaluate(g.hand);
    const payout = g.bet * combo.mult;
    const user = await User.findOne({ username });
    if (user) {
      user.casinoBalance = (user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance) + payout;
      await user.save();
    }
    await new Event({ date: todayStr(), type: 'poker', user: username, data: { bet: g.bet, combo: combo.name, mult: combo.mult, payout } }).save();
    res.json({ success: true, hand: g.hand, combo: combo.name, mult: combo.mult, payout, balance: user ? user.casinoBalance : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
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
  mode: { type: String, default: 'classic' },        // 3.9.0: classic | rapid
  randomFleet: { type: Boolean, default: false },    // авто-расстановка обоим
  minesA: { type: Array, default: [] },              // 3.9.0: минные поля [{x,y}...]
  minesB: { type: Array, default: [] },
  radarA: { type: Boolean, default: false },         // радар использован
  radarB: { type: Boolean, default: false },
  freeUser: { type: String, default: '' },           // кто играет бесплатный бой дня
  nextShotA: { type: Number, default: 0 },           // rapid: когда можно стрелять
  nextShotB: { type: Number, default: 0 },
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
  const radarCost = Math.max(1, Math.round(g.bet * 0.2));
  return {
    id: String(g._id),
    phase: g.phase,
    bet: g.bet,
    mode: g.mode || 'classic',
    opponent: me === 'A' ? g.playerB : g.playerA,
    myTurn: g.turn === username && g.phase === 'battle',
    winner: g.winner,
    myShips: myShips.map(ship => ship.map(c => ({ ...c, hit: hitOnMe.has(c.x + ',' + c.y) }))),
    incoming: oppShots,
    myShots: myShots,
    sunkShips: sunkShips,
    myMines: g['mines' + me] || [],                    // свои мины (видны только мне)
    minesOnMe: (g['mines' + opp] || []).length,        // сколько мин поставил соперник (факт)
    radarUsed: !!g['radar' + me],
    canRadar: g.phase === 'battle' && !g['radar' + me],
    radarCost,
    myNextShotAt: g.mode === 'rapid' ? (g['nextShot' + me] || 0) : 0,
    iAmFree: g.freeUser === username,
    oppIsFree: !!g.freeUser && g.freeUser !== username,
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

// Конец игры: выплата (учёт бесплатного боя), ELO, статистика
async function bsFinish(g, winner) {
  const loser = g.playerA === winner ? g.playerB : g.playerA;
  g.phase = 'done';
  g.winner = winner;
  const winUser = await User.findOne({ username: winner });
  const loseUser = await User.findOne({ username: loser });
  if (winUser) {
    // норма: банк 2×ставка (оба платили). Бесплатный бой: казино крывает ставку free —
    // free-победителю полный банк 2×, победителю против free — только своя ставка назад
    const pay = g.freeUser ? (g.freeUser === winner ? g.bet * 2 : g.bet) : g.bet * 2;
    winUser.casinoBalance = (winUser.casinoBalance == null ? CASINO_START_BALANCE : winUser.casinoBalance) + pay;
    winUser.bsWins = (winUser.bsWins || 0) + 1;
  }
  if (loseUser) loseUser.bsLosses = (loseUser.bsLosses || 0) + 1;
  // ELO K=32
  const ra = winUser ? (winUser.bsElo || 1000) : 1000;
  const rb = loseUser ? (loseUser.bsElo || 1000) : 1000;
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const gain = Math.round(32 * (1 - ea));
  if (winUser) winUser.bsElo = ra + gain;
  if (loseUser) loseUser.bsElo = rb - gain;
  if (winUser) await winUser.save();
  if (loseUser) await loseUser.save();
}

// Выстрел: возвращает true если игра закончена
async function bsDoShot(g, shooter, x, y) {
  const me = g.playerA === shooter ? 'A' : 'B';
  const opp = me === 'A' ? 'B' : 'A';
  const shots = g['shots' + me];
  if (shots.some(s => s.x === x && s.y === y)) return false;

  const oppShips = g['ships' + opp];
  const oppMines = g['mines' + opp] || [];
  const isHit = oppShips.some(ship => ship.some(c => c.x === x && c.y === y));
  const isMine = !isHit && oppMines.some(m => m.x === x && m.y === y);
  shots.push({ x, y, result: isHit ? 'hit' : isMine ? 'mine' : 'miss' });

  // статистика стрелка (для точности в профиле)
  const shooterUser = await User.findOne({ username: shooter });
  if (shooterUser) {
    shooterUser.bsShots = (shooterUser.bsShots || 0) + 1;
    if (isHit) shooterUser.bsHits = (shooterUser.bsHits || 0) + 1;
    await shooterUser.save();
  }

  let gameOver = false;
  if (isHit) {
    const hitSet = new Set(shots.filter(s => s.result === 'hit').map(s => s.x + ',' + s.y));
    gameOver = oppShips.every(ship => ship.every(c => hitSet.has(c.x + ',' + c.y)));
  }

  if (gameOver) {
    await bsFinish(g, shooter);
  } else if ((g.mode || 'classic') === 'rapid') {
    // быстрый огонь: кулдаун 5 сек, наступил на мину — 10
    const cd = isMine ? 10000 : 5000;
    g['nextShot' + me] = Date.now() + cd;
  } else {
    // классика: попал — ход остаётся, промах или мина — переходит
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
    const mode = req.body.mode === 'rapid' ? 'rapid' : 'classic';
    const randomFleet = !!req.body.random;
    const wantFree = !!req.body.free;
    let bet = Math.floor(Number(req.body.bet) || 0);
    if (!from || !to) return res.status(400).json({ success: false, message: 'Укажи соперника' });
    if (from === to) return res.status(400).json({ success: false, message: 'Сам с собой скучно' });

    const fromUser = await User.findOne({ username: from });
    const toUser = await User.findOne({ username: to });
    if (!toUser) return res.status(404).json({ success: false, message: 'Такого ника нет' });

    let freeUser = '';
    if (wantFree) {
      // удача новичка: первый бой дня за счёт казино
      if ((fromUser.casinoLastFree || '') === todayStr()) {
        return res.status(400).json({ success: false, message: 'Бесплатный бой дня уже использован' });
      }
      bet = 10;
      freeUser = from;
    }
    if (bet < 5 || bet > 100) return res.status(400).json({ success: false, message: 'Ставка: 5–100$' });

    const fromBal = fromUser.casinoBalance == null ? CASINO_START_BALANCE : fromUser.casinoBalance;
    const toBal = toUser.casinoBalance == null ? CASINO_START_BALANCE : toUser.casinoBalance;
    if (!freeUser && fromBal < bet) return res.status(400).json({ success: false, message: `У тебя нет ${bet}$` });
    if (toBal < bet) return res.status(400).json({ success: false, message: `У ${to} нет ${bet}$` });

    const id = 'b' + (bsSeq++) + '_' + Date.now();
    bsChallenges.set(id, { id, from, to, bet, mode, randomFleet, freeUser });
    emitToUser(to, 'bs_challenge', { id, from, bet, mode, random: randomFleet, free: !!freeUser });
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
    // бесплатный бой: ставку взыскиваем только с платящего, бесплатному фиксируем дату
    if (ch.freeUser === ch.from) {
      fromUser.casinoLastFree = todayStr();
    } else {
      fromUser.casinoBalance = (fromUser.casinoBalance == null ? CASINO_START_BALANCE : fromUser.casinoBalance) - ch.bet;
      addWager(fromUser, ch.bet);
    }
    toUser.casinoBalance = (toUser.casinoBalance == null ? CASINO_START_BALANCE : toUser.casinoBalance) - ch.bet;
    addWager(toUser, ch.bet);
    await fromUser.save();
    await toUser.save();

    const g = new Battleship({
      playerA: ch.from, playerB: ch.to, bet: ch.bet, phase: 'placement',
      mode: ch.mode || 'classic', randomFleet: !!ch.randomFleet, freeUser: ch.freeUser || ''
    });
    // случайный флот: обоим авто-расстановка — бой стартует сразу
    if (ch.randomFleet) {
      g.shipsA = bsRandomShips();
      g.shipsB = bsRandomShips();
    }
    await g.save();

    if (!ch.randomFleet) {
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
    }

    if (ch.randomFleet) {
      await bsMaybeStartBattle(g);
    } else {
      emitToUser(ch.from, 'bs_update', bsView(g, ch.from));
      emitToUser(ch.to, 'bs_update', bsView(g, ch.to));
    }
    res.json({ success: true, gameId: String(g._id) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Авто-расстановка мин: 3 свободные клетки (не на кораблях, не на уже поставленных минах)
function bsPickAutoMines(ships, existing) {
  const taken = new Set((existing || []).map(m => m.x + ',' + m.y));
  for (const ship of ships || []) for (const c of ship) taken.add(c.x + ',' + c.y);
  const free = [];
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
    if (!taken.has(x + ',' + y)) free.push({ x, y });
  }
  const mines = [];
  while (mines.length < 3 && free.length) {
    const i = Math.floor(Math.random() * free.length);
    mines.push(free.splice(i, 1)[0]);
  }
  return mines;
}

// Валидация мин игрока: 3 шт, в поле, не на кораблях, без дублей
function bsValidateMines(mines, ships) {
  if (!Array.isArray(mines) || mines.length !== 3) return null;
  const seen = new Set();
  for (const m of mines) {
    if (!Number.isInteger(m.x) || !Number.isInteger(m.y) || m.x < 0 || m.x > 9 || m.y < 0 || m.y > 9) return null;
    const k = m.x + ',' + m.y;
    if (seen.has(k)) return null;
    seen.add(k);
    if (ships.some(ship => ship.some(c => c.x === m.x && c.y === m.y))) return null;
  }
  return mines.map(m => ({ x: m.x, y: m.y }));
}

// Старт боя, когда оба расставили
async function bsMaybeStartBattle(g) {
  const fresh = await Battleship.findById(g._id);
  if (!fresh || fresh.phase !== 'placement') return;
  if (fresh.shipsA.length && fresh.shipsB.length) {
    fresh.phase = 'battle';
    fresh.turn = Math.random() < 0.5 ? fresh.playerA : fresh.playerB;
    if (fresh.mode === 'rapid') { const now = Date.now(); fresh.nextShotA = now; fresh.nextShotB = now; }
    // мины: кто не поставил — расставим автоматически
    if (!(fresh.minesA || []).length) fresh.minesA = bsPickAutoMines(fresh.shipsA, []);
    if (!(fresh.minesB || []).length) fresh.minesB = bsPickAutoMines(fresh.shipsB, []);
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

    // мины (необязательно): ровно 3, не на кораблях. Не прислал — расставим при старте боя
    let mines = null;
    if (req.body.mines !== undefined && req.body.mines !== null) {
      mines = bsValidateMines(req.body.mines, ships);
      if (!mines) return res.status(400).json({ success: false, message: 'Мины: ровно 3 клетки, не на кораблях' });
    }

    g['ships' + me] = ships;
    if (mines) g['mines' + me] = mines;
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
    if (g.playerA !== username && g.playerB !== username) return res.status(403).json({ success: false, message: 'Не твоя игра' });
    if (g.mode === 'rapid') {
      const side = g.playerA === username ? 'A' : 'B';
      if (Date.now() < (g['nextShot' + side] || 0)) {
        return res.status(400).json({ success: false, message: 'Перезарядка: подожди пару секунд' });
      }
    } else if (g.turn !== username) {
      return res.status(400).json({ success: false, message: 'Не твой ход' });
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 9 || y < 0 || y > 9) {
      return res.status(400).json({ success: false, message: 'Мимо поля' });
    }
    await bsDoShot(g, username, x, y);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Сдаться (проигрыш, соперник забирает банк)
app.post('/api/battleship/surrender', async (req, res) => {
  try {
    const id = String(req.body.id || '');
    const username = (req.body.username || '').trim().toLowerCase();
    const g = await Battleship.findById(id);
    if (!g || !['placement', 'battle'].includes(g.phase)) {
      return res.status(400).json({ success: false, message: 'Игра не идёт' });
    }
    if (g.playerA !== username && g.playerB !== username) {
      return res.status(403).json({ success: false, message: 'Не твоя игра' });
    }

    const winner = g.playerA === username ? g.playerB : g.playerA;
    await bsFinish(g, winner);
    await g.save();
    bsClearTimers(String(g._id));
    bsPushUpdate(g);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Радар: 1 раз за бой, стоит 20% ставки, подсвечивает зону 3×3 с вражеским кораблём
app.post('/api/battleship/radar', async (req, res) => {
  try {
    const id = String(req.body.id || '');
    const username = (req.body.username || '').trim().toLowerCase();
    const g = await Battleship.findById(id);
    if (!g || g.phase !== 'battle') return res.status(400).json({ success: false, message: 'Бой не идёт' });
    if (g.playerA !== username && g.playerB !== username) return res.status(403).json({ success: false, message: 'Не твоя игра' });
    const me = g.playerA === username ? 'A' : 'B';
    const opp = me === 'A' ? 'B' : 'A';
    if (g['radar' + me]) return res.status(400).json({ success: false, message: 'Радар уже использован' });

    const cost = Math.max(1, Math.round(g.bet * 0.2));
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    const bal = user.casinoBalance == null ? CASINO_START_BALANCE : user.casinoBalance;
    if (bal < cost) return res.status(400).json({ success: false, message: `Радар стоит ${cost}$` });
    user.casinoBalance = bal - cost;
    await user.save();

    // живые (не потопленные) клетки вражеских кораблей
    const oppShips = g['ships' + opp];
    const myShots = g['shots' + me];
    const hitSet = new Set(myShots.filter(s => s.result === 'hit').map(s => s.x + ',' + s.y));
    const alive = [];
    for (const ship of oppShips) {
      for (const c of ship) if (!hitSet.has(c.x + ',' + c.y)) alive.push(c);
    }
    if (!alive.length) return res.status(400).json({ success: false, message: 'Не нашёл кораблей' });
    const target = alive[Math.floor(Math.random() * alive.length)];
    const zone = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = target.x + dx, y = target.y + dy;
      if (x >= 0 && x <= 9 && y >= 0 && y <= 9) zone.push({ x, y });
    }
    g['radar' + me] = true;
    await g.save();
    bsPushUpdate(g);
    res.json({ success: true, zone, cost, balance: user.casinoBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Ладдер МБ: топ по ELO
app.get('/api/battleship/ladder', async (req, res) => {
  try {
    const top = await User.find({}, { username: 1, bsElo: 1, bsWins: 1, bsLosses: 1 })
      .sort({ bsElo: -1 }).limit(20);
    res.json({
      success: true,
      ladder: top.map(u => ({
        username: u.username,
        elo: u.bsElo || 1000,
        wins: u.bsWins || 0,
        losses: u.bsLosses || 0
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ==================== 3.13.0 ====================
// ПЕТУШИНЫЕ БЕГА · ЕЖЕДНЕВНЫЙ КЕЙС · РУССКАЯ РУЛЕТКА

// --- Петушиные бега ---
const RACE_ROOSTERS = [
  { name: 'Обэ',             odds: 2  },
  { name: 'Рыжий Барон',     odds: 3  },
  { name: 'Сэр Кудах',       odds: 5  },
  { name: 'Огненный Хвост',  odds: 8  },
  { name: 'Гроза Двора',     odds: 12 }
];
const RACE_BET_MS = 60000;   // приём ставок 60 сек
const RACE_RUN_MS = 20000;   // сам забег 20 сек
const RACE_PAUSE_MS = 8000;  // пауза между забегами

const race = {
  round: 1,
  phase: 'bet',          // 'bet' | 'run' | 'pause'
  endsAt: Date.now() + RACE_BET_MS,
  positions: [0, 0, 0, 0, 0], // 0..100
  winner: -1,
  bets: new Map()        // username -> { rooster, amount }
};

function racePublic(username) {
  return {
    round: race.round,
    phase: race.phase,
    endsAt: race.endsAt,
    timeLeft: Math.max(0, Math.round((race.endsAt - Date.now()) / 1000)),
    winner: race.winner,
    positions: [...race.positions],
    roosters: RACE_ROOSTERS.map((r, i) => ({ name: r.name, odds: r.odds, pos: race.positions[i], img: 'obii-head.png' })),
    myBet: username && race.bets.has(username) ? race.bets.get(username) : null
  };
}

async function raceFinish() {
  // взвешенный выбор победителя: шанс обратно пропорционален коэффициенту
  const weights = RACE_ROOSTERS.map(r => 1 / r.odds);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total, winIdx = 0;
  for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) { winIdx = i; break; } }
  race.winner = winIdx;
  race.phase = 'pause';
  race.endsAt = Date.now() + RACE_PAUSE_MS;

  const results = [];
  for (const [uname, b] of race.bets.entries()) {
    const user = await User.findOne({ username: uname });
    if (!user) continue;
    if (user.casinoBalance == null) user.casinoBalance = CASINO_START_BALANCE;
    if (b.rooster === winIdx) {
      const payout = Math.round(b.amount * RACE_ROOSTERS[winIdx].odds);
      user.casinoBalance += payout;
      results.push({ username: uname, win: true, payout, balance: user.casinoBalance, rooster: b.rooster });
    } else {
      results.push({ username: uname, win: false, payout: 0, balance: user.casinoBalance, rooster: b.rooster });
    }
    await user.save();
  }
  await new Event({
    date: todayStr(), type: 'casino', user: 'race',
    data: { round: race.round, winner: RACE_ROOSTERS[winIdx].name, winIdx, bets: race.bets.size }
  }).save();
  io.emit('race_result', { round: race.round, winner: winIdx, winnerName: RACE_ROOSTERS[winIdx].name, odds: RACE_ROOSTERS[winIdx].odds, results });
  race.bets.clear();
}

// игровой цикл бегов
setInterval(() => {
  const now = Date.now();
  if (race.phase === 'bet' && now >= race.endsAt) {
    race.phase = 'run';
    race.endsAt = now + RACE_RUN_MS;
    io.emit('race_start', { round: race.round, timeLeft: Math.round(RACE_RUN_MS / 1000) });
  } else if (race.phase === 'run') {
    // петухи бегут: каждый тик добавляем прогресс, фаворит быстрее
    for (let i = 0; i < 5; i++) {
      const speed = (105 - RACE_ROOSTERS[i].odds * 5) / 20; // очков в секунду, фаворит быстрее
      race.positions[i] = Math.min(100, race.positions[i] + speed * (0.7 + Math.random() * 0.6));
    }
    io.emit('race_tick', { positions: [...race.positions], timeLeft: Math.max(0, Math.round((race.endsAt - now) / 1000)) });
    if (now >= race.endsAt || race.positions.some(p => p >= 100)) {
      raceFinish().catch(err => console.error('raceFinish:', err.message));
    }
  } else if (race.phase === 'pause' && now >= race.endsAt) {
    race.round++;
    race.phase = 'bet';
    race.endsAt = now + RACE_BET_MS;
    race.positions = [0, 0, 0, 0, 0];
    race.winner = -1;
    io.emit('race_new', { round: race.round, timeLeft: Math.round(RACE_BET_MS / 1000) });
  }
}, 1000);

app.get('/api/casino/race/state', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    res.json({ success: true, race: racePublic(username) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/race/bet', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const rooster = Number(req.body.rooster);
    const amount = Number(req.body.amount);
    if (!username) return res.status(400).json({ success: false, message: 'Нет игрока' });
    if (!(rooster >= 0 && rooster < RACE_ROOSTERS.length)) return res.status(400).json({ success: false, message: 'Выбери петуха' });
    if (!(amount >= 5 && amount <= 500)) return res.status(400).json({ success: false, message: 'Ставка от 5$ до 500$' });
    if (race.phase !== 'bet') return res.status(400).json({ success: false, message: 'Приём ставок закрыт — забег уже идёт' });
    if (race.bets.has(username)) return res.status(400).json({ success: false, message: 'Ты уже поставил на этот забег' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    if (user.casinoBalance == null) user.casinoBalance = CASINO_START_BALANCE;
    if (user.casinoBalance < amount) return res.status(400).json({ success: false, message: 'Не хватает денег' });
    user.casinoBalance -= amount;
    addWager(user, amount);
    await user.save();
    race.bets.set(username, { rooster, amount });
    io.emit('race_bet', { username, rooster, amount, totalBets: race.bets.size });
    res.json({ success: true, balance: user.casinoBalance, myBet: { rooster, amount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Ежедневный кейс ---
const CASE_REWARDS = [
  { v: 0,   w: (lvl) => Math.max(1, 10 - lvl) },
  { v: 5,   w: () => 5 },
  { v: 15,  w: () => 3 },
  { v: 30,  w: () => 2 },
  { v: 60,  w: () => 1 },
  { v: 100, w: (lvl) => Math.max(0, lvl - 2) } // с 3 уровня VIP появляется шанс на 100$
];

app.get('/api/casino/case/state', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    res.json({ success: true, available: (user.casinoLastCase || '') !== todayStr(), level: casinoLevelOf(user.casinoWagered) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/case/open', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    if (user.casinoBalance == null) user.casinoBalance = CASINO_START_BALANCE;
    const today = todayStr();
    if ((user.casinoLastCase || '') === today) {
      return res.status(429).json({ success: false, message: 'Кейс на сегодня уже открыт — возвращайся завтра' });
    }
    user.casinoLastCase = today;
    const lvl = casinoLevelOf(user.casinoWagered);
    const weights = CASE_REWARDS.map(r => r.w(lvl));
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = Math.random() * total, idx = 0;
    for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) { idx = i; break; } }
    const reward = CASE_REWARDS[idx].v;
    user.casinoBalance += reward;
    await user.save();
    await new Event({
      date: today, type: 'casino', user: username,
      data: { case: true, reward, balance: user.casinoBalance }
    }).save();
    res.json({ success: true, reward, balance: user.casinoBalance, level: lvl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Русская рулетка (дуэль на деньги) ---
const rrGames = new Map();     // id -> {id, players:[a,b], bet, turn, bullet, chambersFired, status}
const rrChallenges = new Map(); // id -> {id, from, to, bet, createdAt}

function rrGameFor(username) {
  for (const g of rrGames.values()) if (g.players.includes(username)) return g;
  return null;
}
function rrChallengeFor(username) {
  for (const c of rrChallenges.values()) if (c.to === username || c.from === username) return c;
  return null;
}

app.post('/api/casino/rr/challenge', async (req, res) => {
  try {
    const from = (req.body.from || '').trim().toLowerCase();
    const to = (req.body.to || '').trim().toLowerCase();
    const bet = Number(req.body.bet);
    if (!from || !to) return res.status(400).json({ success: false, message: 'Укажи соперника' });
    if (from === to) return res.status(400).json({ success: false, message: 'Нельзя вызвать самого себя' });
    if (!(bet >= 5 && bet <= 100)) return res.status(400).json({ success: false, message: 'Ставка от 5$ до 100$' });
    const [fromUser, toUser] = await Promise.all([User.findOne({ username: from }), User.findOne({ username: to })]);
    if (!fromUser || !toUser) return res.status(404).json({ success: false, message: 'Нет такого игрока' });
    if (rrGameFor(from) || rrGameFor(to) || rrChallengeFor(from) || rrChallengeFor(to)) {
      return res.status(400).json({ success: false, message: 'Есть незавершённая игра или вызов' });
    }
    if ((fromUser.casinoBalance == null ? CASINO_START_BALANCE : fromUser.casinoBalance) < bet) {
      return res.status(400).json({ success: false, message: 'Не хватает денег на ставку' });
    }
    const id = 'rr' + Date.now() + Math.floor(Math.random() * 1000);
    rrChallenges.set(id, { id, from, to, bet, createdAt: Date.now() });
    setTimeout(() => { if (rrChallenges.has(id)) { rrChallenges.delete(id); emitToUser(to, 'rr_expired', { id, from }); } }, 60000);
    emitToUser(to, 'rr_challenge', { id, from, bet });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/rr/answer', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const id = String(req.body.id || '');
    const accept = !!req.body.accept;
    const ch = rrChallenges.get(id);
    if (!ch) return res.status(404).json({ success: false, message: 'Вызов не найден или истёк' });
    if (ch.to !== username) return res.status(403).json({ success: false, message: 'Это не твой вызов' });
    rrChallenges.delete(id);
    if (!accept) {
      emitToUser(ch.from, 'rr_declined', { id, to: username });
      return res.json({ success: true, accepted: false });
    }
    const [a, b] = await Promise.all([User.findOne({ username: ch.from }), User.findOne({ username: ch.to })]);
    if (!a || !b) return res.status(404).json({ success: false, message: 'Игрок не найден' });
    if ((a.casinoBalance == null ? CASINO_START_BALANCE : a.casinoBalance) < ch.bet ||
        (b.casinoBalance == null ? CASINO_START_BALANCE : b.casinoBalance) < ch.bet) {
      emitToUser(ch.from, 'rr_declined', { id, to: username, reason: 'no_money' });
      return res.status(400).json({ success: false, message: 'У кого-то не хватает денег' });
    }
    a.casinoBalance = (a.casinoBalance == null ? CASINO_START_BALANCE : a.casinoBalance) - ch.bet;
    b.casinoBalance = (b.casinoBalance == null ? CASINO_START_BALANCE : b.casinoBalance) - ch.bet;
    addWager(a, ch.bet); addWager(b, ch.bet);
    await Promise.all([a.save(), b.save()]);
    const game = {
      id: 'rrg' + Date.now(), players: [ch.from, ch.to], bet: ch.bet,
      turn: 0, bullet: Math.floor(Math.random() * 6), chambersFired: 0, status: 'active'
    };
    rrGames.set(game.id, game);
    for (const p of game.players) {
      emitToUser(p, 'rr_start', { id: game.id, players: game.players, bet: game.bet, yourTurn: game.players[game.turn] === p, balance: p === ch.from ? a.casinoBalance : b.casinoBalance });
    }
    res.json({ success: true, accepted: true, id: game.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/casino/rr/state', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const g = rrGameFor(username);
    const ch = rrChallengeFor(username);
    const out = { success: true, game: null, challenge: null };
    if (g) out.game = { id: g.id, players: g.players, bet: g.bet, yourTurn: g.players[g.turn] === username, chambersFired: g.chambersFired };
    if (ch) out.challenge = ch.to === username ? { id: ch.id, from: ch.from, bet: ch.bet, incoming: true } : { id: ch.id, to: ch.to, bet: ch.bet, incoming: false };
    res.json(out);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/casino/rr/pull', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const g = rrGameFor(username);
    if (!g || g.status !== 'active') return res.status(400).json({ success: false, message: 'Нет активной игры' });
    if (g.players[g.turn] !== username) return res.status(400).json({ success: false, message: 'Не твой ход' });

    const chamber = g.chambersFired; // какая камора сейчас под курком
    g.chambersFired++;
    const boom = (chamber === g.bullet);

    if (boom) {
      g.status = 'done';
      const loser = username;
      const winner = g.players.find(p => p !== username);
      const winUser = await User.findOne({ username: winner });
      if (winUser) {
        if (winUser.casinoBalance == null) winUser.casinoBalance = CASINO_START_BALANCE;
        winUser.casinoBalance += g.bet * 2;
        await winUser.save();
      }
      const loseUser = await User.findOne({ username: loser });
      await new Event({
        date: todayStr(), type: 'casino', user: 'rr',
        data: { winner, loser, bet: g.bet, chambersFired: g.chambersFired, balance: winUser ? winUser.casinoBalance : null }
      }).save();
      for (const p of g.players) {
        emitToUser(p, 'rr_result', { id: g.id, boom: true, chamber, loser, winner, bet: g.bet, payout: g.bet * 2, youWin: p === winner, balance: p === winner && winUser ? winUser.casinoBalance : (loseUser ? loseUser.casinoBalance : null) });
      }
      rrGames.delete(g.id);
      return res.json({ success: true, boom: true, chamber, loser, winner });
    }

    g.turn = 1 - g.turn;
    for (const p of g.players) {
      emitToUser(p, 'rr_turn', { id: g.id, chamber, safe: true, chambersFired: g.chambersFired, yourTurn: g.players[g.turn] === p });
    }
    res.json({ success: true, boom: false, chamber, chambersFired: g.chambersFired });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ==================== 3.15.0: КС 1.6 — de_dust2 (5x5..1x1, до 16 побед) ====================
// Одна комната на всех: лобби → распределение по командам → старт первым зашедшим → раунды.
const CS16Combat = require('./cs16-combat');
const CS16_W = {
  knife:   { price: 0,    dmg: 40,  reward: 1500 },
  glock:   { price: 0,    dmg: 25,  reward: 300 },
  usp:     { price: 0,    dmg: 34,  reward: 300 },
  deagle:  { price: 650,  dmg: 53,  reward: 300 },
  ak47:    { price: 2500, dmg: 33,  reward: 300, team: 't'  },
  m4a1:    { price: 3100, dmg: 33,  reward: 300, team: 'ct' },
  awp:     { price: 4750, dmg: 115, reward: 100 },
  // 3.24.0: новые стволы
  mp5:       { price: 1500, dmg: 26, reward: 300 },
  p90:       { price: 2350, dmg: 26, reward: 300 },
  ump45:     { price: 1200, dmg: 30, reward: 300 },
  galil:     { price: 2000, dmg: 30, reward: 300, team: 't' },
  famas:     { price: 2250, dmg: 30, reward: 300, team: 'ct' },
  scout:     { price: 1700, dmg: 70, reward: 100 },
  sg552:     { price: 3500, dmg: 33, reward: 300, team: 't' },
  aug:       { price: 3500, dmg: 33, reward: 300, team: 'ct' },
  m249:      { price: 5200, dmg: 31, reward: 300 },
  fiveseven: { price: 500,  dmg: 25, reward: 300, team: 'ct' },
  tec9:      { price: 500,  dmg: 24, reward: 300, team: 't' },
  elite:     { price: 800,  dmg: 26, reward: 300 },
  kevlar:  { price: 650 },
  hegrenade: { price: 300 },
  flashbang: { price: 200 },
  smokegrenade: { price: 300 },
  defuser:   { price: 200, team: 'ct' }, // набор сапёра
  // 3.31.0: техника (покупка) и её оружие
  veh_tank:  { price: 4000 },
  veh_heli:  { price: 4000 },
  mgveh:     { price: 0, dmg: 20, reward: 300 },   // пулемёт вертолёта
  tankgun:   { price: 0, dmg: 90, reward: 300 },   // пушка танка / ракеты (AoE)
};
// 3.24.0: лестница Gun-Game (19 стволов, финал — нож)
const CS16_GG_LADDER = ['glock', 'usp', 'deagle', 'tec9', 'fiveseven', 'elite', 'mp5', 'ump45', 'p90', 'galil', 'famas', 'ak47', 'm4a1', 'sg552', 'aug', 'scout', 'm249', 'awp', 'knife'];
// 3.24.0: карты (СТРОГО синхронно с клиентом cs16.js MAP_ROWS — править через genmap.js!)
const CS16_MAP_ROWS = {
  dust2: [
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "######.......................................###...............S..TTTTTT.............................................#########",
    "######.......................................###..................TTTTTT.............................................#########",
    "######.......................................###..................TTTTTT.............................................#########",
    "######..................DDDDDDDDD.................................TTTTTT.............................................#########",
    "######..................DDDDDDDDD.................................TTTTTT.............................................#########",
    "######..................DDDDDDDDD.................................TTTTTT.............................................#########",
    "######......C...........DDDDDDDDD.........................................................C..........................#########",
    "######..................DDDDDDDDD....................................................................................#########",
    "######..................DDDDDDDDD....................................................................................#########",
    "######........................................................................657444444444444444756.........C........#########",
    "######........................................................................657444444444444444756..................#########",
    "######........................................................................657444444444444444756..................#########",
    "###666............C...........................................................657444444444444444756..................#########",
    "###555........................................................................657444444444444444756..................#########",
    "###777........................................................................657444444444444444756..................#########",
    "###444...C.................657444C44444444444444444756.............................................C.................#########",
    "###444.....................657444444444444444444444756...............................................................#########",
    "###444.....................657444444444444444444444756...............................................................#########",
    "###444.....................657444444444444444444444756############..................C........C.......................#########",
    "###444.....................657444444444444444444444756############...................................................#########",
    "###444.....................657444444444444444444444756############...................................................#########",
    "###444.......................................#####################...................................................#########",
    "###444.......................................#####################...................................................#########",
    "###444.......................................#####################...................................................#########",
    "###444######...VVVC.....##########################################...................................................#########",
    "###444######...VVV......##########################################...................................................#########",
    "###444######...VVV......##########################################...................................................#########",
    "###444######...VVVC.....##############################..............................###############..................#########",
    "###444######...VVV......##############################..............................###############..................#########",
    "###444######...VVV......##############################..............................###############..................#########",
    "###444######...VVV......#####################........................##############################..................#########",
    "###444######...VVV......#####################........................##############################..................#########",
    "###444######...VVV......#####################........................##############################..................#########",
    "###444######...VVV......#####################DDDDDD..................##############################......C...........#########",
    "###444######...VVV......#####################DDDDDD..................##############################..................#########",
    "###444######...VVV......#####################DDDDDD..................##############################..................#########",
    "###444######...VVV......#####################DDDDDD..................##############################..................#########",
    "###444######...VVV......#####################DDDDDD..................##############################..................#########",
    "###444######...VVV......#####################DDDDDD..................##############################..................#########",
    "###444######...VVV......##############################......C........##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...VVV......##############################...............##############################..................#########",
    "###444######...DDDDDD...#########...............C..###...............##############################..................#########",
    "###444######...DDDDDD...#########..................###...............##############################..................#########",
    "###444######...DDDDDD...#########..................###...............##############################..................#########",
    "###444######...DDDDDD...#########...C.................DDDDDDDDDDDDDDD##############################..................#########",
    "###444######...DDDDDD...#########.....................DDDDDDDDDDDDDDD##############################..................#########",
    "###444######...DDDDDD...#########.....................DDDDDDDDDDDDDDD##############################..................#########",
    "###444######...VVVC.....#########..................###DDDCDDCDDDDDDDD##############################.........C........#########",
    "###444######...VVV......#########..................###DDDDDDDDDDDDDDD##############################..................#########",
    "###444######...VVV......#########..................###DDDDDDDDDDDDDDD##############################..................#########",
    "###444######............657444444444444444444444444756S..BBBBBBBBB...##############################..................#########",
    "###444######............657444444444444444444444444756...BBBBBBBBB...##############################..................#########",
    "###444######............657444444444444444444444444756...BBBBBBBBB...##############################..................#########",
    "###444######............657444444444444444444444444756...C..C........##############################..................#########",
    "###444######............657444444444444444444444444756...............##############################..................#########",
    "###444######............657444444444444444444444444756...............##############################..................#########",
    "###444######............##############################...............##############################..................#########",
    "###444######............##############################...............##############################..................#########",
    "###444######............##############################...............##############################..................#########",
    "###444######............##############################...............##############################..................#########",
    "###444######............##############################...............##############################..................#########",
    "###444######............##############################...............##############################..................#########",
    "###444######.........................................................##############################..................#########",
    "###444######.........................................................##############################..................#########",
    "###444######.........................................................##############################..................#########",
    "###444######........................DDDCDD...........................##############################..................#########",
    "###444######........................DDDDDD...........................##############################..................#########",
    "###444######........................DDDDDD...........................##############################..................#########",
    "###444######........................DDDDDD...............C...........##############################..................#########",
    "###444######........................DDDDDD...........................##############################..................#########",
    "###444######........................DDDDDD...........................##############################..................#########",
    "###444######......C..................................................##############################..................#########",
    "###444######.........................................................##############################..................#########",
    "###444######.........................................................##############################..................#########",
    "###444######............##############################................................................DDDDDDDDDDDD...#########",
    "###444######............##############################................................................DDDDDDDDDDDD...#########",
    "###444######............##############################................................................DDDDDDDDDDDD...#########",
    "###444######............##############################........................C..DDDDDD...............DDDDDDDDDDDD...#########",
    "###444######............##############################...........................DDDDDD...............DDDDDDDDDDDD...#########",
    "###444######............##############################...........................DDDDDD...............DDDDDDDDDDDD...#########",
    "###444######............##############################...........................DDDDDD...C..........................#########",
    "###444######............##############################...........................DDDDDD..............................#########",
    "###444######............##############################...........................DDDDDD..............................#########",
    "###444..................##############################...............................................................#########",
    "###444..................##############################...............................................................#########",
    "###444..................##############################...............................................................#########",
    "###777..................##############################...............##############################..................#########",
    "###555..................##############################...............##############################..................#########",
    "###666..................##############################...............##############################..................#########",
    "############.........................................................666666...TTTTTT...657444444756..................#########",
    "############.........................................................555555...TTTTTT...657444444756..................#########",
    "############.........................................................777777...TTTTTT...657444444756..................#########",
    "############.........................................................444444S..TTTTTT...657444444756..................#########",
    "############.........................................................444444...TTTTTT...657444444756..................#########",
    "############.........................................................444444...TTTTTT...657444444756..................#########",
    "############.........................................................444444...............########################.........###",
    "############.........................................................444444...............########################.........###",
    "############.........................................................444444...............########################.........###",
    "###########################..........................................444444...............########################.........###",
    "###########################..........................................444444...............########################.........###",
    "###########################..........................................444444...............########################.........###",
    "###########################..........................................777777...............########################.........###",
    "###########################..........................................555555...............########################.........###",
    "###########################..........................................666666...............########################.........###",
    "###########################...............................................................657444444444444444444444444444756###",
    "###########################...............................................................657444444444444444444444444444756###",
    "###########################...............................................................657444444444444444444444444444756###",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
  ],
  inferno: [
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "######.......................................###...............S..TTTTTT...................................................###",
    "######.......................................###..................TTTTTT...................................................###",
    "######.......................................###..................TTTTTT...................................................###",
    "######..................DDDDDDDDD.................................TTTTTT............657444444756...........................###",
    "######..................DDDDDDDDD.................................TTTTTT............657444444756...........................###",
    "######..................DDDDDDDDD.................................TTTTTT............657444444756...........................###",
    "######......C...........DDDDDDDDD...................................................657444C44756...........................###",
    "######..................DDDDDDDDD...................................................657444444756...........................###",
    "######..................DDDDDDDDD...................................................657444444756...........................###",
    "######......................................................................................................C..............###",
    "######.....................................................................................................................###",
    "######.....................................................................................................................###",
    "######...............C.............................................................................C.......................###",
    "######.....................................................................................................................###",
    "######.....................................................................................................................###",
    "######..............................C........###....................................C........C.............................###",
    "######.......................................###...........................................................................###",
    "######.......................................###...........................................................................###",
    "######...C...................................###.........###############657444756.....................C..............C.....###",
    "######.......................................###.........###############657444756..........................................###",
    "######.......................................###.........###############657444756..........................................###",
    "######.......................................###.........###############657444756........................VVVVVVVVVCVV......###",
    "######.......................................###.........###############657444756........................VVVVVVVVVVVV......###",
    "######.......................................###.........###############657444756........................VVVVVVVVVVVV......###",
    "######.....................#####################.........#############################################.....................###",
    "######.....................#####################.........#############################################.....................###",
    "######.....................#####################.........#############################################.....................###",
    "######.....................#####################.....................#################################.....................###",
    "######.....................#####################.....................#################################.....................###",
    "######.....................#####################.....................#################################.....................###",
    "######.....................###########################...............#################################.....................###",
    "######.....................###########################...............#################################.....................###",
    "######.....................###########################...............#################################.....................###",
    "######.....................###########################...............#################################...S..BBBBBBBBBS.....###",
    "######.....................###########################...............#################################......BBBBBBBBB......###",
    "######.....................###########################...............#################################......BBBBBBBBB......###",
    "######.....................###########################...............#################################.....................###",
    "######.....................###########################...............#################################.....................###",
    "######.....................###########################...............#################################.....................###",
    "######.....................###............############......C........#################################DDD..................###",
    "######.....................###............############...............#################################DDD..................###",
    "######.....................###............############...............#################################DDD..................###",
    "######......DDDDDDDDD...C..VVV............############...............#################################DDD..................###",
    "######......DDDDDDDDD......VVV............############...............#################################DDD..................###",
    "######......DDDDDDDDD......VVV............############...............#################################DDD..................###",
    "######......DDDDDDDDD......###............############...............#################################DDD..................###",
    "######......DDDDDDDDD......###............############...............#################################DDD..................###",
    "######......DDDDDDDDD......###............############...............#################################DDD..................###",
    "######.....................#########...###############...............#################################.....................###",
    "######.....................#########...###############...............#################################.....................###",
    "######.....................#########...###############...............#################################.....................###",
    "######.....................#########...###############DDDDDDDDDDDDDDD#################################......C..............###",
    "######.....................#########...###############DDDDDDDDDDDDDDD#################################.....................###",
    "######.....................#########...###############DDDDDDDDDDDDDDD#################################.....................###",
    "######...S.................#########...###############DDDDDDDDDDDDDDD#################################.....................###",
    "######.....................#########...###############DDDDDDDDDDDDDDD#################################.....................###",
    "######.....................#########...###############DDDDDDDDDDDDDDD#################################.....................###",
    "######...BBBBBBBBB.........#########...###############...............#################################.....................###",
    "######...BBBBBBBBB.........#########...###############...............#################################.....................###",
    "######...BBBBBBBBB.........#########...###############...............#################################.....................###",
    "######.........S...........#########...###############...............#################################.....................###",
    "######.....................#########...###############...............#################################.....................###",
    "######.....................#########...###############...............#################################.....................###",
    "######.....................#########...###############...............#################################.....................###",
    "######.....................#########...###############...............#################################.....................###",
    "######.....................#########...###############...............#################################.....................###",
    "######.....................#########...###############...............#########################################################",
    "######.....................#########...###############...............#########################################################",
    "######.....................#########...###############...............#########################################################",
    "######.........C...........#########...###############...666666......#########################################################",
    "######.....................#########...###############...555555......#########################################################",
    "######.....................#########...###############...777777......#########################################################",
    "######...................................................444444......#########################################################",
    "######...................................................444444......#########################################################",
    "######...................................................444444......#########################################################",
    "######...................................................444444......#########################################################",
    "######...................................................444444......#########################################################",
    "######...................................................444444......#########################################################",
    "######...S...............................................444444......#########################################################",
    "######...................................................444444......#########################################################",
    "######...................................................444444......#########################################################",
    "######...BBBBBBBBB.......................................444C44......#########################################################",
    "######...BBBBBBBBB.......................................444444......#########################################################",
    "######...BBBBBBBBB.......................................444444......#########################################################",
    "######.........S...........657444444444444444444444756...444444......#########################################################",
    "######.....................657444444444444444444444756...444444......#########################################################",
    "######.....................657444444444444444444444756...444444......#########################################################",
    "######.....................657444444444444444444444756...444444......###C#####################################################",
    "######.....................657444444444444444444444756...444444......#########################################################",
    "######.....................657444444444444444444444756...444444......#########################################################",
    "######.....................###########################...444444......#########################################################",
    "######.....................###########################...444444......#########################################################",
    "######.....................###########################...444444......#########################################################",
    "######.....................###########################...444444....................................###########################",
    "######.....................###########################...444444....................................###########################",
    "######.....................###########################...444444....................................###########################",
    "######.....................###########################...777777....................................###########################",
    "######.....................###########################...555555....................................###########################",
    "######.....................###########################...666666....................................###########################",
    "######............VVV......................................................TTTTTT......#######################################",
    "######............VVV......................................................TTTTTT......#######################################",
    "######............VVV......................................................TTTTTT......#######################################",
    "##################VVV#####################..............................S..TTTTTTC.....#######################################",
    "##################VVV#####################.................................TTTTTT......#######################################",
    "##################VVV#####################.................................TTTTTT......#######################################",
    "##################VVV#####################.............................................#######################################",
    "##################VVV#####################.............................................#######################################",
    "##################VVV#####################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##########################################.............................................#######################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
    "##############################################################################################################################",
  ]
};
const CS16_CH2C = { '#': 1, '.': 0, 'D': 2, 'C': 3, '4': 4, '5': 5, '6': 6, '7': 7, 'V': 8, 'B': 9, 'S': 10, 'T': 11 };
const CS16_GRID = {};
for (const name in CS16_MAP_ROWS) {
  CS16_GRID[name] = CS16_MAP_ROWS[name].map(row => [...row].map(ch => CS16_CH2C[ch] != null ? CS16_CH2C[ch] : 1));
}
// вейпоинты для ботов (клетки)
const CS16_WPS = {
  dust2: [[60, 9], [60, 60], [24, 12], [15, 66], [60, 108], [96, 12], [102, 66], [6, 18], [114, 24]],
  inferno: [[60, 9], [60, 60], [24, 12], [15, 90], [63, 108], [96, 12], [111, 24], [9, 48], [108, 39]],
};
// 3.24.0: статистика и ранги CS (уровень = ⌊√(points/12)⌋+1)
const cs16statSchema = new mongoose.Schema({
  nick: { type: String, unique: true },
  kills: { type: Number, default: 0 }, deaths: { type: Number, default: 0 },
  wins: { type: Number, default: 0 }, matches: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
});
const CS16Stat = mongoose.model('CS16Stat', cs16statSchema);
const cs16Stats = new Map(); // nick -> {kills,deaths,wins,matches,points} (кэш в памяти)
function cs16LvlOf(nick) { const s = cs16Stats.get((nick || '').toLowerCase()); return Math.floor(Math.sqrt(((s && s.points) || 0) / 12)) + 1; }
function cs16StatAdd(nick, kind, n) {
  nick = String(nick || '').toLowerCase();
  if (!nick || nick.startsWith('🤖')) return;
  let s = cs16Stats.get(nick);
  if (!s) { s = { kills: 0, deaths: 0, wins: 0, matches: 0, points: 0 }; cs16Stats.set(nick, s); }
  if (kind === 'kill') { s.kills += 1; s.points += 2 * (n || 1); }
  else if (kind === 'head') s.points += 1;
  else if (kind === 'death') { s.deaths += 1; s.points -= 1; }
  else if (kind === 'win') { s.wins += 1; s.matches += 1; s.points += 25; }
  else if (kind === 'loss') { s.matches += 1; s.points += 5; }
  else if (kind === 'obj') s.points += 5;
}
async function cs16StatsFlush() {
  const ops = [];
  for (const [nick, s] of cs16Stats) {
    ops.push({ updateOne: { filter: { nick }, update: { $inc: { kills: s.kills, deaths: s.deaths, wins: s.wins, matches: s.matches, points: s.points } }, upsert: true } });
    s.kills = 0; s.deaths = 0; s.wins = 0; s.matches = 0; s.points = 0;
  }
  if (ops.length) { try { await CS16Stat.bulkWrite(ops); } catch (e) {} }
}
CS16Stat.find({}).then(list => { for (const d of list) cs16Stats.set(d.nick, { kills: 0, deaths: 0, wins: 0, matches: 0, points: d.points || 0 }); }).catch(() => {});
setInterval(cs16StatsFlush, 30000);
const CS16_MAX_ROUNDS = 30;
const CS16_WIN_SCORE = 16;
const cs16 = {
  players: new Map(), // socketId -> {nick, team, money, hp, armor, alive, kills, deaths, weapon, lossStreak, joinedAt}
  phase: 'lobby',     // lobby | freeze | live | roundend | matchend
  mode: 5,            // размер команды 1..5
  map: 'dust2',       // 3.24.0: dust2 | inferno
  gm: 'classic',      // 3.24.0: classic | gg (Gun-Game)
  swapped: false,   // 3.24.0: смена сторон после 8 раундов (MR15)
  scores: { t: 0, ct: 0 },
  round: 0,
  winner: null,
  freezeEnds: 0,
  roundEnds: 0,
  buyUntil: 0,
  timers: [],
  bomb: null,          // {site, pos, planter, explodesAt}
  roundTimeout: null,  // таймер «время вышло» (отменяется закладкой бомбы)
};

function cs16HostId() { return cs16.players.keys().next().value || null; }
function cs16TeamCount(team) { let n = 0; for (const p of cs16.players.values()) if (p.team === team) n++; return n; }
function cs16Alive(team) { let n = 0; for (const p of cs16.players.values()) if (p.team === team && p.alive) n++; return n; }
function cs16ClearTimers() { for (const t of cs16.timers) clearTimeout(t); cs16.timers = []; if (cs16.roundTimeout) { clearTimeout(cs16.roundTimeout); cs16.roundTimeout = null; } }
function cs16Later(fn, ms) { cs16.timers.push(setTimeout(fn, ms)); }

function cs16State() {
  return {
    phase: cs16.phase, mode: cs16.mode, round: cs16.round,
    map: cs16.map, gm: cs16.gm, // 3.24.0
    scores: cs16.scores, winner: cs16.winner,
    host: (cs16HostId() && cs16.players.get(cs16HostId()) || {}).nick || null,
    freezeEnds: cs16.freezeEnds, roundEnds: cs16.roundEnds, buyUntil: cs16.buyUntil,
    now: Date.now(),
    players: [...cs16.players.entries()].map(([id, p]) => ({
      id, nick: p.nick, team: p.team, alive: p.alive, hp: p.hp,
      kills: p.kills, deaths: p.deaths, money: p.money, weapon: p.weapon,
      bot: !!p.bot, lvl: cs16LvlOf(p.nick),
    })),
  };
}
function cs16Broadcast() { io.emit('cs16_state', cs16State()); }
function cs16Personal(sid) { const p = cs16.players.get(sid); if (p) io.to(sid).emit('cs16_you', { money: p.money, hp: p.hp, armor: p.armor, weapon: p.weapon, team: p.team, alive: p.alive, kit: p.kit }); }

function cs16Spawn(team, index, total) {
  // Координаты сетки карты (клиент использует те же): CT — сверху, T — снизу
  if (team === 'ct') return [(57 + (index % 3)) * 4, 1.6, (9 + Math.floor(index / 3)) * 4];
  if (cs16.map === 'inferno') return [(51 + (index % 5)) * 4, 1.6, (105 + Math.floor(index / 5)) * 4];
  return [(48 + (index % 5)) * 4, 1.6, (108 + Math.floor(index / 5)) * 4];
}

// 3.24.0: единый подсчёт урона и убийств (игроки и боты)
function cs16ApplyHit(attacker, target, weapon, head, zone, dist, heavy) {
  const result = CS16Combat.damage(weapon,head?'head':zone,dist,target.armor,heavy);
  if (!result.damage) return;
  const dmg = Math.min(target.hp,result.damage);
  target.armor = Math.max(0,target.armor-result.armorUsed);
  target.hp -= dmg;
  io.emit('cs16_hit', { target: target.nick, hp: target.hp, armor:target.armor, dmg, head: !!head, by: attacker ? attacker.nick : null });
  if (target.hp <= 0) {
    target.alive = false; target.deaths += 1;
    if (attacker) attacker.kills += 1;
    target.armor = 0; target.weapon = null; target.kit = false;
    if (attacker) {
      if (cs16.gm !== 'gg') attacker.money = Math.min(16000, attacker.money + 1000);
      cs16StatAdd(attacker.nick, 'kill');
      if (head) cs16StatAdd(attacker.nick, 'head');
    }
    cs16StatAdd(target.nick, 'death');
    io.emit('cs16_death', { nick: target.nick, killer: attacker ? attacker.nick : null, weapon, head: !!head });
    if (attacker) cs16OnKill(attacker, target, weapon);
    cs16Broadcast();
    cs16CheckWipe();
    return true;
  }
  return false;
}
// 3.24.0: Gun-Game — лестница оружий и респаун; классика — проверка вайпа уже внутри ApplyHit
function cs16OnKill(attacker, target, weapon) {
  if (cs16.gm !== 'gg') return;
  if (attacker) {
    attacker.ggIdx = Math.min(CS16_GG_LADDER.length - 1, (attacker.ggIdx || 0) + 1);
    attacker.weapon = CS16_GG_LADDER[attacker.ggIdx];
    if (!attacker.bot) {
      const sid = [...cs16.players.entries()].find(([, p]) => p === attacker);
      if (sid) io.to(sid[0]).emit('cs16_gg_gun', { weapon: attacker.weapon });
    }
    if (attacker.ggIdx >= CS16_GG_LADDER.length - 1 && weapon === 'knife') {
      cs16EndMatch(attacker.nick); // победа на ноже
      return;
    }
  }
  // респаун жертвы через 3.5 сек
  setTimeout(() => {
    if (cs16.phase !== 'live' || target.alive) return;
    target.alive = true; target.hp = 100;
    target.weapon = CS16_GG_LADDER[Math.min(target.ggIdx || 0, CS16_GG_LADDER.length - 1)];
    const teamIdx = [...cs16.players.values()].filter(p => p.team === target.team).indexOf(target);
    const pos = cs16Spawn(target.team, Math.max(0, teamIdx), 0);
    if (target.bot) { target.bx = pos[0]; target.bz = pos[2]; }
    io.emit('cs16_gg_respawn', { nick: target.nick, pos });
  }, 3500);
}

// 3.31.0: AoE пушки танка и ракет вертолёта — урон по врагам в радиусе 6м (по своим нельзя)
function cs16VehBoom(attacker, pos, weapon) {
  for (const target of cs16.players.values()) {
    if (!target.alive || !target.team || target === attacker) continue;
    if (cs16.gm !== 'gg' && target.team === attacker.team) continue;
    const tx = target.bot ? target.bx : target.lx, tz = target.bot ? target.bz : target.lz;
    if (tx == null) continue;
    const d = Math.hypot(tx - pos[0], tz - pos[2]);
    if (d > 6) continue;
    let dmg = Math.round(90 * (1 - d / 6));
    if (target.armor > 0) dmg = Math.round(dmg * 0.5);
    dmg = Math.min(target.hp, dmg);
    if (dmg <= 0) continue;
    target.hp -= dmg;
    io.emit('cs16_hit', { target: target.nick, hp: target.hp, dmg, head: false, by: attacker.nick });
    if (target.hp <= 0) {
      target.alive = false; target.deaths += 1; target.armor = 0; target.weapon = null; target.kit = false;
      attacker.kills += 1; attacker.money = Math.min(16000, attacker.money + 300);
      cs16StatAdd(attacker.nick, 'kill'); cs16StatAdd(target.nick, 'death');
      io.emit('cs16_death', { nick: target.nick, killer: attacker.nick, weapon, head: false });
      cs16OnKill(attacker, target, weapon);
      cs16CheckWipe();
    }
    // 3.32.0: вражеская техника рядом с эпицентром тоже получает урон
    if (target.veh) {
      target.veh.hp -= 120;
      if (target.veh.hp <= 0) cs16VehDestroy(target, attacker, pos);
      else io.emit('cs16_vehhit', { target: target.nick, hp: target.veh.hp, max: target.veh.max, kind: target.veh.kind });
    }
  }
  cs16Broadcast();
}

// 3.32.0: подбитие техники — взрыв-фейерверк + 70 урона владельцу (пилоту)
function cs16VehDestroy(owner, attacker, pos) {
  const kind = owner.veh && owner.veh.kind;
  if (!kind) return;
  owner.veh = null;
  io.emit('cs16_vehdie', { by: owner.nick, kind, pos: pos || [owner.lx || 0, 0, owner.lz || 0] });
  if (!owner.alive) { cs16Broadcast(); return; }
  let dmg = 70;
  if (owner.armor > 0) dmg = Math.round(dmg * 0.5);
  dmg = Math.min(owner.hp, dmg);
  if (dmg > 0) {
    owner.hp -= dmg;
    io.emit('cs16_hit', { target: owner.nick, hp: owner.hp, dmg, head: false, by: attacker ? attacker.nick : null });
    if (owner.hp <= 0) {
      owner.alive = false; owner.deaths += 1; owner.armor = 0; owner.weapon = null; owner.kit = false;
      if (attacker) {
        attacker.kills += 1; attacker.money = Math.min(16000, attacker.money + 1000);
        cs16StatAdd(attacker.nick, 'kill');
      }
      cs16StatAdd(owner.nick, 'death');
      io.emit('cs16_death', { nick: owner.nick, killer: attacker ? attacker.nick : null, weapon: kind, head: false });
      if (attacker) cs16OnKill(attacker, owner, kind);
      cs16CheckWipe();
    }
  }
  cs16Broadcast();
}

// ---------- 3.24.0: БОТЫ ----------
let cs16BotSeq = 0;
function cs16BotAdd(bySocket) {
  if (cs16.phase === 'matchend') return;
  const id = 'cs16bot_' + (++cs16BotSeq);
  const team = cs16TeamCount('t') <= cs16TeamCount('ct') ? 't' : 'ct';
  const wps = CS16_WPS[cs16.map] || CS16_WPS.dust2;
  cs16.players.set(id, {
    nick: '🤖 Бот-' + cs16BotSeq, bot: true, team, money: 800, hp: 100, armor: 0,
    alive: true, kills: 0, deaths: 0, weapon: team === 't' ? 'glock' : 'usp',
    kit: false, lossStreak: 0, joinedAt: Date.now(),
    bx: wps[0][0] * 4 + 2, bz: wps[0][1] * 4 + 2, bwp: 0, blastShot: 0,
  });
  cs16Broadcast();
}
function cs16BotDel() {
  for (const [id, p] of [...cs16.players.entries()].reverse()) {
    if (p.bot) { cs16.players.delete(id); io.emit('cs16_leave', { nick: p.nick }); cs16Broadcast(); return; }
  }
}
// LOS по сетке карты (2D, без уровней — достаточно для ботов)
function cs16Los2D(x1, z1, x2, z2) {
  const grid = CS16_GRID[cs16.map] || CS16_GRID.dust2;
  const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 1.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor((x1 + (x2 - x1) * t) / 4), cy = Math.floor((z1 + (z2 - z1) * t) / 4);
    if (cy < 0 || cx < 0 || cy >= grid.length || cx >= grid[0].length) return false;
    if (grid[cy][cx] === 1) return false; // стена
  }
  return true;
}
setInterval(() => { // тик ботов ~7 раз/сек
  if (cs16.phase !== 'live') return;
  const grid = CS16_GRID[cs16.map] || CS16_GRID.dust2;
  const wps = CS16_WPS[cs16.map] || CS16_WPS.dust2;
  const now = Date.now();
  for (const p of cs16.players.values()) {
    if (!p.bot || !p.alive || !p.team) continue;
    // цель — ближайший живой враг (позиция: у ботов bx/bz, у людей lx/lz из cs16_pos)
    let tgt = null, td = 1e9;
    for (const q of cs16.players.values()) {
      if (q === p || !q.alive || !q.team || (cs16.gm !== 'gg' && q.team === p.team)) continue;
      const qx = q.bot ? q.bx : q.lx, qz = q.bot ? q.bz : q.lz;
      if (qx == null) continue;
      const d = Math.hypot(qx - p.bx, qz - p.bz);
      if (d < td) { td = d; tgt = q; }
    }
    const gx = tgt ? (tgt.bot ? tgt.bx : tgt.lx) : 0, gz = tgt ? (tgt.bot ? tgt.bz : tgt.lz) : 0;
    let moving = false;
    if (tgt && td < 42 && cs16Los2D(p.bx, p.bz, gx, gz)) {
      // стрельба по цели
      p.byaw = Math.atan2(gx - p.bx, gz - p.bz);
      if (now - p.blastShot > 550) {
        p.blastShot = now;
        const dx = gx - p.bx, dz = gz - p.bz;
        const dl = Math.hypot(dx, dz) || 1;
        io.emit('cs16_shoot', { nick: p.nick, origin: [p.bx, 1.5, p.bz], dir: [dx / dl, 0, dz / dl], weapon: p.weapon || 'ak47' });
        const head = Math.random() < 0.09;
        cs16ApplyHit(p, tgt, p.weapon || 'ak47', head, head ? 'head' : 'body', td);
      }
    } else if (tgt && td < 75) {
      // движение к цели
      const dx = gx - p.bx, dz = gz - p.bz, dl = Math.hypot(dx, dz) || 1;
      p.byaw = Math.atan2(dx, dz);
      moving = cs16BotStep(p, dx / dl, dz / dl, grid);
    } else {
      // патруль по вейпоинтам
      const wp = wps[p.bwp % wps.length];
      const wx = wp[0] * 4 + 2, wz = wp[1] * 4 + 2;
      const dx = wx - p.bx, dz = wz - p.bz, dl = Math.hypot(dx, dz) || 1;
      if (dl < 1.5) { p.bwp = (p.bwp + 1 + Math.floor(Math.random() * 2)) % wps.length; }
      else { p.byaw = Math.atan2(dx, dz); moving = cs16BotStep(p, dx / dl, dz / dl, grid); }
    }
    io.emit('cs16_pos', { nick: p.nick, team: p.team, pos: [+p.bx.toFixed(2), 0, +p.bz.toFixed(2)], yaw: +(p.byaw || 0).toFixed(3), pitch: 0, weapon: p.weapon || 'glock', move: moving, skin: '' });
  }
}, 150);
function cs16BotStep(p, ux, uz, grid) {
  const sp = 0.85; // 5.7 юнит/сек ≈ 0.85 за тик (3.31.0: карта ×3 — боты быстрее)
  const nx = p.bx + ux * sp, nz = p.bz + uz * sp;
  const cx = Math.floor(nx / 4), cy = Math.floor(nz / 4);
  if (cy < 0 || cx < 0 || cy >= grid.length || cx >= grid[0].length) return false;
  if (grid[cy][cx] === 1) { p.bwp = (p.bwp + 1) % ((CS16_WPS[cs16.map] || CS16_WPS.dust2).length); return false; }
  p.bx = nx; p.bz = nz;
  return true;
}

function cs16StartRound() {
  cs16ClearTimers();
  cs16.round += 1;
  cs16.bomb = null;
  cs16.phase = 'freeze';
  const now = Date.now();
  cs16.freezeEnds = now + 6000;
  cs16.roundEnds = now + 6000 + 115000;
  cs16.buyUntil = now + 6000 + 15000;
  let ti = 0, ci = 0;
  for (const p of cs16.players.values()) {
    p.alive = true; p.hp = 100; p.veh = null; // 3.32.0: техника не переживает раунд
    if (cs16.gm === 'gg') { p.ggIdx = 0; p.weapon = CS16_GG_LADDER[0]; }
    else if (!p.weapon) p.weapon = p.team === 't' ? 'glock' : 'usp';
    p.money = Math.min(16000, p.money + 500); // 3.15.5: доход каждый раунд
  }
  cs16Broadcast();
  io.emit('cs16_round_start', {
    round: cs16.round, scores: cs16.scores, now: Date.now(),
    spawns: [...cs16.players.entries()].map(([id, p]) => {
      const idx = p.team === 't' ? ti++ : ci++;
      const pos = cs16Spawn(p.team || 't', idx, 0);
      if (p.bot) { p.bx = pos[0]; p.bz = pos[2]; }
      return { id, pos };
    }),
  });
  cs16Later(() => { cs16.phase = 'live'; cs16Broadcast(); io.emit('cs16_live'); }, 6000);
  // 3.24.0: в Gun-Game раунд бесконечный (победа на ноже), таймер выключен
  if (cs16.gm !== 'gg') cs16.roundTimeout = setTimeout(() => cs16EndRound('ct', 'Время вышло'), 6000 + 115000);
}

function cs16EndRound(winner, reason) {
  if (cs16.phase !== 'live' && cs16.phase !== 'freeze') return;
  cs16ClearTimers();
  cs16.phase = 'roundend';
  cs16.scores[winner] += 1;
  const planted = !!cs16.bomb;
  cs16.bomb = null;
  // Экономика в духе 1.6
  for (const p of cs16.players.values()) {
    if (p.team === winner) { p.money = Math.min(16000, p.money + 3500); p.lossStreak = 0; }
    else { p.lossStreak = Math.min(4, (p.lossStreak || 0) + 1); p.money = Math.min(16000, p.money + 1500 + 500 * (p.lossStreak - 1)); }
    if (planted && p.team === 't') p.money = Math.min(16000, p.money + 800); // бонус за закладку
  }
  io.emit('cs16_round_end', { winner, reason, scores: cs16.scores, round: cs16.round });
  cs16Broadcast();
  // до смены сторон считаем, не набрана ли победа (после свопа ключи scores меняются)
  const reachedWin = cs16.scores[winner] >= CS16_WIN_SCORE || cs16.round >= CS16_MAX_ROUNDS;
  // 3.24.0: MR15 — после 8 раундов команды меняются сторонами
  if (cs16.gm !== 'gg' && cs16.round === 8 && !cs16.swapped) {
    cs16.swapped = true;
    for (const p of cs16.players.values()) {
      if (!p.team) continue;
      p.team = p.team === 't' ? 'ct' : 't';
      if (!p.bot) {
        const sid = [...cs16.players.entries()].find(([, q]) => q === p);
        if (sid) io.to(sid[0]).emit('cs16_swapped', { team: p.team });
      }
    }
    cs16.scores = { t: cs16.scores.ct, ct: cs16.scores.t };
    io.emit('cs16_sides', { scores: cs16.scores });
    cs16Broadcast();
  }
  if (reachedWin) {
    cs16Later(() => cs16EndMatch(cs16.scores.t === cs16.scores.ct ? 'draw' : (cs16.scores.t > cs16.scores.ct ? 't' : 'ct')), 5000);
  } else {
    cs16Later(() => cs16StartRound(), 5000);
  }
}

function cs16EndMatch(winner) {
  cs16ClearTimers();
  cs16.phase = 'matchend';
  cs16.winner = winner;
  // 3.24.0: статистика матча — победы/поражения, сразу пишем в Mongo
  for (const p of cs16.players.values()) {
    if (!p.team) continue;
    if (winner === 'draw') cs16StatAdd(p.nick, 'loss');
    else if ((cs16.gm === 'gg' && winner === p.nick) || (cs16.gm !== 'gg' && winner === p.team)) cs16StatAdd(p.nick, 'win');
    else cs16StatAdd(p.nick, 'loss');
  }
  cs16StatsFlush();
  cs16Broadcast();
  io.emit('cs16_match_end', {
    winner, scores: cs16.scores,
    players: [...cs16.players.values()].map(p => ({ nick: p.nick, team: p.team, kills: p.kills, deaths: p.deaths, bot: !!p.bot, lvl: cs16LvlOf(p.nick) })),
  });
  cs16Later(() => {
    cs16.phase = 'lobby'; cs16.round = 0; cs16.scores = { t: 0, ct: 0 }; cs16.winner = null; cs16.swapped = false;
    for (const p of cs16.players.values()) { p.team = null; p.money = 800; p.weapon = null; p.hp = 100; p.alive = true; p.ggIdx = 0; p.veh = null; }
    cs16Broadcast();
  }, 12000);
}

function cs16CheckWipe() {
  if (cs16.gm === 'gg') return; // 3.24.0: в Gun-Game вайпа нет — все респаунятся
  if (cs16.phase !== 'live' && cs16.phase !== 'freeze') return;
  if (cs16.bomb) return; // после закладки раунд решает бомба (взрыв или обезвреживание)
  const tAlive = cs16Alive('t'), ctAlive = cs16Alive('ct');
  if (tAlive === 0 && ctAlive === 0) cs16EndRound('ct', 'Оба выбиты — раунд за CT');
  else if (tAlive === 0) cs16EndRound('ct', 'Террористы выбиты');
  else if (ctAlive === 0) cs16EndRound('t', 'Контры выбиты');
}

function cs16Remove(socket) {
  const p = cs16.players.get(socket.id);
  if (!p) return;
  cs16.players.delete(socket.id);
  io.emit('cs16_leave', { nick: p.nick });
  if (cs16.players.size === 0) { cs16ClearTimers(); cs16.phase = 'lobby'; cs16.round = 0; cs16.scores = { t: 0, ct: 0 }; cs16.mode = 5; cs16.winner = null; return; }
  if (cs16.phase !== 'lobby' && cs16.phase !== 'matchend') cs16CheckWipe();
  cs16Broadcast();
}

// 3.19.4: Support2 — лобби и матч на УРОВНЕ МОДУЛЯ. Раньше лежали внутри io.on('connection'):
// каждый новый коннект пересоздавал s2lobby, и игроки пропадали друг у друга («На сервере: 1»).
const s2lobby = { players: new Map() }; // sid -> {nick, team:'r'|'d', hero}
const s2match = { active: false, hostId: null, roster: [] }; // live-матч, хост фиксируется на старте

io.on('connection', (socket) => {
  socket.on('cs16_join', (nick) => {
    nick = String(nick || '').slice(0, 24);
    if (!nick || cs16.players.has(socket.id)) return;
    // Тот же ник с другого сокета — выкидываем старую сессию
    for (const [id, p] of cs16.players.entries()) {
      if (p.nick.toLowerCase() === nick.toLowerCase() && id !== socket.id) cs16.players.delete(id);
    }
    cs16.players.set(socket.id, { nick, team: null, money: 800, hp: 100, armor: 0, alive: true, kills: 0, deaths: 0, weapon: null, kit: false, lossStreak: 0, joinedAt: Date.now() });
    cs16Personal(socket.id);
    cs16Broadcast();
  });

  socket.on('cs16_team', (team) => {
    const p = cs16.players.get(socket.id);
    if (!p) return;
    if (team !== 't' && team !== 'ct') { p.team = null; cs16Broadcast(); return; }
    if (cs16TeamCount(team) >= cs16.mode) { io.to(socket.id).emit('cs16_err', 'Команда заполнена'); return; }
    // 3.15.9: можно вступить даже в уже начатый матч — игрок войдёт в игру со следующего раунда
    p.team = team; p.weapon = null;
    if (cs16.phase !== 'lobby') {
      p.alive = false; p.hp = 100; p.armor = 0; p.kit = false;
      if (p.money < 800) p.money = 800;
      io.to(socket.id).emit('cs16_err', 'Ты в команде! Вступишь в игру со следующего раунда');
    }
    cs16Broadcast();
  });

  socket.on('cs16_mode', (n) => {
    if (socket.id !== cs16HostId() || cs16.phase !== 'lobby') return;
    n = Math.max(1, Math.min(5, parseInt(n) || 5));
    cs16.mode = n;
    // Подчищаем лишних, если режим уменьшили
    for (const team of ['t', 'ct']) {
      let c = 0;
      for (const p of cs16.players.values()) {
        if (p.team === team) { c++; if (c > n) p.team = null; }
      }
    }
    cs16Broadcast();
  });

  socket.on('cs16_start', () => {
    if (socket.id !== cs16HostId() || cs16.phase !== 'lobby') return;
    // 3.16.0: матч можно начать с любым составом — 2v1, 3v2 и т.д.
    if (cs16TeamCount('t') < 1 || cs16TeamCount('ct') < 1) {
      io.to(socket.id).emit('cs16_err', 'Нужен хотя бы 1 игрок в каждой команде');
      return;
    }
    cs16.scores = { t: 0, ct: 0 }; cs16.round = 0; cs16.winner = null; cs16.swapped = false;
    for (const p of cs16.players.values()) { p.money = 800; p.kills = 0; p.deaths = 0; p.armor = 0; p.kit = false; p.ggIdx = 0; p.weapon = null; }
    cs16StartRound();
  });

  // 3.24.0: выбор карты / режима / боты (только хост, только в лобби)
  socket.on('cs16_map', (m) => {
    if (socket.id !== cs16HostId() || cs16.phase !== 'lobby') return;
    if (m !== 'dust2' && m !== 'inferno') return;
    cs16.map = m;
    cs16Broadcast();
  });
  socket.on('cs16_gm', (g) => {
    if (socket.id !== cs16HostId() || cs16.phase !== 'lobby') return;
    if (g !== 'classic' && g !== 'gg') return;
    cs16.gm = g;
    cs16Broadcast();
  });
  socket.on('cs16_botadd', () => {
    if (socket.id !== cs16HostId()) return;
    if (cs16TeamCount('t') >= cs16.mode || cs16TeamCount('ct') >= cs16.mode) { io.to(socket.id).emit('cs16_err', 'Команды заполнены — увеличь размер'); return; }
    cs16BotAdd(socket);
  });
  socket.on('cs16_botdel', () => {
    if (socket.id !== cs16HostId()) return;
    cs16BotDel();
  });

  // Позиция — просто ретрансляция остальным (+ запоминаем для ботов)
  socket.on('cs16_pos', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || !d) return;
    if (d.pos) { p.lx = d.pos[0]; p.lz = d.pos[2]; }
    // 3.24.2: скин экипированного оружия уходит другим игрокам (только известные id)
    const skinId = (d.skin && CS16_SKINS[d.skin]) ? d.skin : '';
    socket.broadcast.emit('cs16_pos', { nick: p.nick, team: p.team, pos: d.pos, yaw: d.yaw, pitch: d.pitch, weapon: d.weapon, move: d.move, crouched: !!d.crouched, skin: skinId });
  });

  // 3.24.0: шаги — ретрансляция (звук чужих шагов по дистанции)
  socket.on('cs16_step', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || !d) return;
    socket.broadcast.emit('cs16_step', { nick: p.nick, pos: d.pos, surf: d.surf });
  });

  socket.on('cs16_shoot', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || cs16.phase !== 'live' || !d) return;
    if (!CS16Combat.weapons[d.weapon] || !Array.isArray(d.origin) || !Array.isArray(d.dir) || d.origin.length!==3 || d.dir.length!==3 || ![...d.origin,...d.dir].every(Number.isFinite)) return;
    socket.broadcast.emit('cs16_shoot', { nick: p.nick, origin: d.origin, dir: d.dir, weapon: d.weapon, distance:Number.isFinite(d.distance)?Math.max(0,Math.min(200,d.distance)):60 });
  });

  socket.on('cs16_hit', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || cs16.phase !== 'live' || !d) return;
    const target = [...cs16.players.values()].find(x => x.nick.toLowerCase() === String(d.target || '').toLowerCase());
    if (!target || !target.alive) return;
    if (cs16.gm !== 'gg' && target.team === p.team) return; // фф выключен (в GG — все против всех)
    const weapon = CS16Combat.weapons[d.weapon], distance = Number(d.dist);
    if (!weapon || !Number.isFinite(distance) || distance<0 || distance>200 || (d.weapon==='knife'&&distance>2.85)) return;
    const interval = d.weapon==='knife'?(d.heavy?900:750):(d.weapon==='glock'||d.weapon==='famas'?75:60000/weapon.rpm);
    const now = Date.now();
    if (p.lastRegisteredHit && now-p.lastRegisteredHit<interval*.75) return;
    p.lastRegisteredHit=now;
    cs16ApplyHit(p,target,d.weapon,!!d.head,['head','body','leg'].includes(d.zone)?d.zone:'body',distance,!!d.heavy);
  });

  // Граната: ретрансляция полёта + серверный подсчёт урона при взрыве
  socket.on('cs16_nade', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || cs16.phase !== 'live' || !d) return;
    socket.broadcast.emit('cs16_nade', { nick: p.nick, pos: d.pos, vel: d.vel, kind: d.kind });
  });

  socket.on('cs16_boom', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || cs16.phase !== 'live' || !d || !d.pos) return;
    const kind = d.kind === 'flash' ? 'flash' : d.kind === 'smoke' ? 'smoke' : 'he';
    io.emit('cs16_boom', { pos: d.pos, kind }); // HE-урон считают сами клиенты и шлют cs16_boomdmg
  });

  // Клиент сам сообщает, что его зацепило осколками (доверяем, как в остальных играх)
  socket.on('cs16_boomdmg', (dmg) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || cs16.phase !== 'live') return;
    dmg = Math.max(0, Math.min(98, parseInt(dmg) || 0));
    if (p.armor > 0) dmg = Math.round(dmg * 0.5);
    dmg = Math.min(p.hp, dmg);
    if (dmg <= 0) return;
    p.hp -= dmg;
    io.emit('cs16_hit', { target: p.nick, hp: p.hp, dmg, head: false, by: null });
    if (p.hp <= 0) {
      p.alive = false; p.deaths += 1; p.armor = 0; p.weapon = null;
      cs16StatAdd(p.nick, 'death');
      io.emit('cs16_death', { nick: p.nick, killer: null, weapon: 'hegrenade', head: false });
      if (cs16.gm === 'gg') cs16OnKill(null, p, 'hegrenade');
      cs16Broadcast();
      cs16CheckWipe();
    }
  });

  // 3.31.0: техника — ретрансляция позиции/башни всем и взрывы пушки/ракет (AoE на сервере)
  socket.on('cs16_veh', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || !d || !d.pos) return;
    socket.broadcast.emit('cs16_veh', { kind: d.kind === 'heli' ? 'heli' : 'tank', pos: d.pos, yaw: +d.yaw || 0, turret: +d.turret || 0, by: p.nick });
  });
  socket.on('cs16_vehboom', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || cs16.phase !== 'live' || !d || !d.pos) return;
    io.emit('cs16_vehboom', { pos: d.pos, kind: d.kind === 'rocket' ? 'rocket' : 'tank', by: p.nick });
    cs16VehBoom(p, d.pos, 'tankgun');
  });

  socket.on('cs16_vehhit', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || cs16.phase !== 'live' || !d) return;
    const target = [...cs16.players.values()].find(x => x.nick.toLowerCase() === String(d.target || '').toLowerCase());
    if (!target || !target.veh) return;
    if (cs16.gm !== 'gg' && target.team === p.team) return;
    const weapon = CS16Combat.weapons[d.weapon];
    if (!weapon) return;
    const now = Date.now();
    if (now - (p.lastVehHit || 0) < 60000 / weapon.rpm * 0.85) return; // та же скорострельность, что у оружия
    p.lastVehHit = now;
    target.veh.hp -= CS16Combat.damage(d.weapon, 'body', 0, 0).damage;
    if (target.veh.hp <= 0) { cs16VehDestroy(target, p); return; }
    io.emit('cs16_vehhit', { target: target.nick, hp: target.veh.hp, max: target.veh.max, kind: target.veh.kind });
  });
  // 3.32.0: танк снёс ящик — ретрансляция всем (визуальный развал + локальная коллизия)
  socket.on('cs16_vehcrate', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || !d) return;
    const grid = CS16_GRID[cs16.map] || CS16_GRID.dust2;
    const cx = parseInt(d.x), cy = parseInt(d.y);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || cy < 0 || cx < 0 || cy >= grid.length || cx >= grid[0].length) return;
    if (grid[cy][cx] !== 2 && grid[cy][cx] !== 3) return; // только ящики (D/C)
    socket.broadcast.emit('cs16_vehcrate', { x: cx, y: cy });
  });

  socket.on('cs16_buy', (item) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive) return;
    if (cs16.gm === 'gg') { io.to(socket.id).emit('cs16_err', 'В Gun-Game оружие выдаётся за убийства'); return; }
    const now = Date.now();
    const canBuy = cs16.phase === 'freeze' || (cs16.phase === 'live' && now < cs16.buyUntil);
    if (!canBuy) { io.to(socket.id).emit('cs16_err', 'Время покупок вышло'); return; }
    const w = CS16_W[item];
    if (!w || item === 'knife') return;
    if (w.team && w.team !== p.team) { io.to(socket.id).emit('cs16_err', 'Это оружие не твоей команды'); return; }
    if (p.money < w.price) { io.to(socket.id).emit('cs16_err', 'Не хватает денег'); return; }
    if (item === 'kevlar') { if (p.armor >= 100) return; p.armor = 100; }
    else if (item === 'defuser') { if (p.kit) return; p.kit = true; }
    else if (item === 'veh_tank' || item === 'veh_heli') { p.veh = { kind: item === 'veh_heli' ? 'heli' : 'tank', hp: item === 'veh_heli' ? 600 : 1000, max: item === 'veh_heli' ? 600 : 1000 }; } // 3.32.0: у техники HP
    else if (item === 'hegrenade' || item === 'flashbang' || item === 'smokegrenade') { /* гранаты — клиент считает лимит */ }
    else p.weapon = item;
    p.money -= w.price;
    io.to(socket.id).emit('cs16_bought', { item, money: p.money });
    cs16Personal(socket.id);
    cs16Broadcast();
  });

  socket.on('cs16_plant', (d) => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || p.team !== 't' || cs16.phase !== 'live' || cs16.bomb) return;
    if (cs16.gm === 'gg') return; // в Gun-Game бомбы нет
    const site = d && d.site === 'B' ? 'B' : 'A';
    cs16.bomb = { site, pos: d.pos || null, planter: p.nick, plantedAt: Date.now(), explodesAt: Date.now() + 40000 };
    if (cs16.roundTimeout) { clearTimeout(cs16.roundTimeout); cs16.roundTimeout = null; }
    // 3.15.8: взрыв по таймеру (раньше бомба не взрывалась — раунд висел)
    cs16.roundTimeout = setTimeout(() => {
      if (cs16.phase !== 'live' || !cs16.bomb) return;
      const b = cs16.bomb;
      cs16.bomb = null;
      io.emit('cs16_bomb_exploded', { site: b.site, pos: b.pos });
      cs16EndRound('t', 'Бомба взорвалась');
    }, 40000);
    io.emit('cs16_bomb_planted', { site, pos: cs16.bomb.pos, explodesAt: cs16.bomb.explodesAt, planter: p.nick, now: Date.now() });
    cs16StatAdd(p.nick, 'obj'); // 3.24.0: очки за закладку
    cs16Broadcast();
  });

  socket.on('cs16_defuse', () => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.alive || p.team !== 'ct' || !cs16.bomb || cs16.phase !== 'live') return;
    io.emit('cs16_bomb_defused', { nick: p.nick, site: cs16.bomb.site });
    cs16StatAdd(p.nick, 'obj'); // 3.24.0: очки за обезвреживание
    cs16EndRound('ct', 'Бомба обезврежена');
  });

  // Только Fifflaren: переназначить хоста или кикнуть игрока из комнаты
  socket.on('cs16_sethost', (nick) => {
    const p = cs16.players.get(socket.id);
    if (!p || p.nick.toLowerCase() !== 'fifflaren') return;
    const target = [...cs16.players.values()].find(x => x.nick.toLowerCase() === String(nick || '').toLowerCase());
    if (!target) return;
    const arr = [...cs16.players.entries()];
    arr.sort((a, b) => Number(b[1] === target) - Number(a[1] === target));
    cs16.players = new Map(arr);
    cs16Broadcast();
  });

  socket.on('cs16_kick', (nick) => {
    const p = cs16.players.get(socket.id);
    if (!p || p.nick.toLowerCase() !== 'fifflaren') return;
    const entry = [...cs16.players.entries()].find(([, x]) => x.nick.toLowerCase() === String(nick || '').toLowerCase());
    if (!entry || entry[0] === socket.id) return;
    const victim = entry[1];
    cs16.players.delete(entry[0]);
    io.to(entry[0]).emit('cs16_kicked', { by: 'fifflaren' });
    io.emit('cs16_leave', { nick: victim.nick });
    if (cs16.players.size === 0) { cs16ClearTimers(); cs16.phase = 'lobby'; cs16.round = 0; cs16.scores = { t: 0, ct: 0 }; cs16.mode = 5; cs16.winner = null; return; }
    if (cs16.phase !== 'lobby' && cs16.phase !== 'matchend') cs16CheckWipe();
    cs16Broadcast();
  });

  socket.on('cs16_leave', () => cs16Remove(socket));
  socket.on('disconnect', () => cs16Remove(socket));

  // 3.15.9: смена команды на M (в лобби — сразу, в матче — со смертью до конца раунда)
  socket.on('cs16_swap', () => {
    const p = cs16.players.get(socket.id);
    if (!p || !p.team) return;
    const target = p.team === 't' ? 'ct' : 't';
    if (cs16.phase === 'lobby') {
      if (cs16TeamCount(target) >= cs16.mode) { io.to(socket.id).emit('cs16_err', 'Команда заполнена'); return; }
      p.team = target; p.weapon = null;
      cs16Broadcast();
      return;
    }
    if (cs16.phase !== 'live' && cs16.phase !== 'freeze') return;
    p.team = target; p.weapon = null;
    if (p.alive) {
      p.alive = false;
      io.emit('cs16_death', { nick: p.nick, killer: null, weapon: 'swap', head: false });
    }
    io.to(socket.id).emit('cs16_swapped', { team: target });
    cs16Broadcast();
    cs16CheckWipe();
  });

  // 3.15.9: хост или Fifflaren — реванш / рестарт / выход в меню (в любой момент матча)
  const cs16IsBoss = (socket) => {
    const p = cs16.players.get(socket.id);
    return p && (socket.id === cs16HostId() || p.nick.toLowerCase() === 'fifflaren');
  };
  socket.on('cs16_rematch', () => {
    if (!cs16IsBoss(socket)) return;
    if (cs16.phase !== 'matchend' && cs16.phase !== 'lobby') return;
    cs16ClearTimers();
    cs16.scores = { t: 0, ct: 0 }; cs16.round = 0; cs16.winner = null; cs16.bomb = null;
    for (const p of cs16.players.values()) { p.money = 800; p.kills = 0; p.deaths = 0; p.armor = 0; p.kit = false; p.hp = 100; p.alive = true; p.weapon = null; }
    cs16StartRound();
  });
  socket.on('cs16_restart', () => { // рестарт посреди матча: счёт с нуля, команды сохраняются
    if (!cs16IsBoss(socket)) return;
    if (cs16.phase === 'lobby') return;
    cs16ClearTimers();
    cs16.scores = { t: 0, ct: 0 }; cs16.round = 0; cs16.winner = null; cs16.bomb = null;
    for (const p of cs16.players.values()) { p.money = 800; p.kills = 0; p.deaths = 0; p.armor = 0; p.kit = false; p.hp = 100; p.alive = true; p.weapon = null; }
    cs16StartRound();
  });
  socket.on('cs16_tomenu', () => {
    if (!cs16IsBoss(socket)) return;
    cs16ClearTimers();
    cs16.phase = 'lobby'; cs16.round = 0; cs16.scores = { t: 0, ct: 0 }; cs16.winner = null; cs16.bomb = null;
    for (const p of cs16.players.values()) { p.team = null; p.money = 800; p.hp = 100; p.armor = 0; p.alive = true; p.weapon = null; p.kit = false; }
    cs16Broadcast();
  });

  // ============ SUPPORT2: лобби и релей матча (состояние s2lobby/s2match — на уровне модуля) ============
  function s2HostId() {
    for (const [id, p] of s2lobby.players.entries()) if (p.nick.toLowerCase() === 'fifflaren') return id;
    return s2lobby.players.keys().next().value || null;
  }
  function s2ToOthers(event, payload, exceptId) { // 3.19.0: всем в лобби, кроме указанного
    for (const [id] of s2lobby.players) {
      if (id === exceptId) continue;
      const s = io.sockets.sockets.get(id);
      if (s) s.emit(event, payload);
    }
  }
  function s2Broadcast() {
    io.emit('s2_lobby', {
      players: [...s2lobby.players.entries()].map(([id, p]) => ({ id, nick: p.nick, team: p.team, hero: p.hero })),
      host: s2HostId(),
    });
  }
  function s2Remove(socket) {
    if (s2lobby.players.delete(socket.id)) s2Broadcast();
  }
  socket.on('s2_join', (nick) => {
    nick = String(nick || '').slice(0, 24);
    if (!nick) return;
    for (const [id, p] of s2lobby.players.entries()) if (p.nick === nick && id !== socket.id) s2lobby.players.delete(id);
    const prev = s2lobby.players.get(socket.id);
    s2lobby.players.set(socket.id, { nick, team: prev ? prev.team : null, hero: prev ? prev.hero : null });
    s2Broadcast();
  });
  socket.on('s2_seat', (data) => {
    let p = s2lobby.players.get(socket.id);
    // 3.20.1: саморегистрация — если сессия потерялась (залипший дубль/рестарт), а клиент шлёт ник
    if (!p && data && data.nick) {
      const nick = String(data.nick).slice(0, 24);
      if (nick) {
        for (const [id2, p2] of s2lobby.players.entries()) if (p2.nick.toLowerCase() === nick.toLowerCase() && id2 !== socket.id) s2lobby.players.delete(id2);
        p = { nick, team: null, hero: null };
        s2lobby.players.set(socket.id, p);
      }
    }
    if (!p) return;
    const team = data && (data.team === 'r' || data.team === 'd') ? data.team : null;
    if (p.team === team) return;
    const cnt = [...s2lobby.players.values()].filter(x => x.team === team).length;
    if (team && cnt >= 5) return; // максимум 5 на сторону
    p.team = team;
    s2Broadcast();
  });
  socket.on('s2_pick', (heroId) => {
    const p = s2lobby.players.get(socket.id);
    if (!p) return;
    p.hero = String(heroId || '').slice(0, 24) || null;
    s2Broadcast();
  });
  socket.on('s2_start', () => {
    if (socket.id !== s2HostId()) return; // начинает только хост
    const comp = [...s2lobby.players.values()]
      .filter(p => p.team && p.hero)
      .map(p => ({ nick: p.nick, team: p.team, hero: p.hero }));
    if (!comp.length) return;
    s2match.active = true;
    s2match.hostId = socket.id;
    s2match.roster = comp.map(c => c.nick);
    io.emit('s2_start', { comp });
  });
  // 3.20.1: Fifflaren забирает хоста — прерывает чужой матч, все возвращаются в лобби
  socket.on('s2_take_host', () => {
    const p = s2lobby.players.get(socket.id);
    if (!p || p.nick.toLowerCase() !== 'fifflaren') return;
    if (s2match.active) {
      s2match.active = false;
      s2match.hostId = null;
      io.emit('s2_abort', null); // все клиенты матча возвращаются в лобби (остальные игнорируют)
    }
    s2Broadcast();
  });
  // ---------- 3.19.0: релей синхронизации матча (хост-авторитетная модель) ----------
  socket.on('s2_in', (data) => { // ввод игрока → хосту
    if (!s2match.active || socket.id === s2match.hostId) return;
    const p = s2lobby.players.get(socket.id);
    const host = io.sockets.sockets.get(s2match.hostId);
    if (p && host) host.emit('s2_in', { nick: p.nick, data });
  });
  socket.on('s2_st', (snap) => { // снапшот мира от хоста → остальным
    if (!s2match.active || socket.id !== s2match.hostId) return;
    s2ToOthers('s2_st', snap, socket.id);
  });
  socket.on('s2_ev', (ev) => { // события/фид/звуки от хоста → остальным
    if (!s2match.active || socket.id !== s2match.hostId) return;
    s2ToOthers('s2_ev', ev, socket.id);
  });
  socket.on('s2_end', (winner) => { // конец матча
    if (socket.id !== s2match.hostId) return;
    s2match.active = false;
    s2ToOthers('s2_end', winner, socket.id);
  });
  // 3.19.0: уход игрока из активного матча Support2 — хост падает (abort), игрока меняет бот
  function s2MatchLeave(socket) {
    if (!s2match.active) return;
    if (socket.id === s2match.hostId) {
      s2match.active = false;
      s2ToOthers('s2_abort', null, socket.id);
    } else {
      const p = s2lobby.players.get(socket.id);
      if (p && s2match.roster.includes(p.nick)) {
        const host = io.sockets.sockets.get(s2match.hostId);
        if (host) host.emit('s2_left', { nick: p.nick });
      }
    }
  }
  socket.on('s2_leave', () => { s2MatchLeave(socket); s2Remove(socket); });
  socket.on('disconnect', () => {
    cs16Remove(socket);
    s2MatchLeave(socket);
    s2Remove(socket);
  });
});

// 3.15.9: сторож бомбы и раундов — даже если setTimeout потерян (сон инстанса и т.п.),
// бомба взорвётся, а зависший раунд завершится
setInterval(() => {
  try {
    const now = Date.now();
    if (cs16.bomb && now >= cs16.bomb.explodesAt) {
      const b = cs16.bomb;
      cs16.bomb = null;
      io.emit('cs16_bomb_exploded', { site: b.site, pos: b.pos });
      cs16EndRound('t', 'Бомба взорвалась');
    } else if ((cs16.phase === 'live' || cs16.phase === 'freeze') && cs16.roundEnds && now > cs16.roundEnds + 20000) {
      cs16EndRound(cs16.bomb ? 't' : 'ct', cs16.bomb ? 'Бомба взорвалась' : 'Время вышло');
    }
  } catch (e) { console.error('cs16 watchdog', e); }
}, 1000);


// ==================== 3.15.1: МАГАЗИН СКИНОВ КС 1.6 (за казино-деньги) ====================
const CS16_SKINS = {
  banana:    { name: '🍌 Банан',     price: 350,  color: 0xf7d54d },
  waves:     { name: '🌊 Волны',     price: 400,  color: 0x3d9be9 },
  azimov:    { name: '🔥 Азимов',    price: 500,  color: 0xff7a1a },
  radiation: { name: '☢️ Радиация',  price: 600,  color: 0x6dff4d, glow: true },
  dragon:    { name: '🐉 Дракон',    price: 800,  color: 0xd42a2a },
  neon:      { name: '💜 Неон',      price: 1000, color: 0xb44dff, glow: true },
  obsidian:  { name: '🖤 Обсидиан',  price: 1200, color: 0x232323, trim: 0xff2222 },
  gold:      { name: '⭐ Золото',    price: 1500, color: 0xffd700 },
  prismatic: { name: '🌈 Призматик', price: 2000, color: 0xffffff, rainbow: true },
  diamond:   { name: '💎 Алмаз',     price: 3000, color: 0x9fe8ff, glow: true },
};

app.get('/api/cs16/skins', async (req, res) => {
  try {
    const user = await User.findOne({ username: String(req.query.username || '').toLowerCase() });
    if (!user) return res.json({ success: false, message: 'Не найден' });
    res.json({
      success: true,
      balance: user.casinoBalance == null ? 500 : user.casinoBalance,
      owned: user.cs16Skins || [],
      equipped: user.cs16Skin || '',
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/cs16/skins/buy', async (req, res) => {
  try {
    const { username, skin } = req.body || {};
    const s = CS16_SKINS[skin];
    if (!s) return res.json({ success: false, message: 'Нет такого скина' });
    const user = await User.findOne({ username: String(username || '').toLowerCase() });
    if (!user) return res.json({ success: false, message: 'Не найден' });
    if (!user.casinoBalance && user.casinoBalance !== 0) user.casinoBalance = 500;
    user.cs16Skins = user.cs16Skins || [];
    if (user.cs16Skins.includes(skin)) return res.json({ success: false, message: 'Уже куплен' });
    if (user.casinoBalance < s.price) return res.json({ success: false, message: 'Не хватает денег казино' });
    user.casinoBalance -= s.price;
    user.cs16Skins.push(skin);
    await user.save();
    res.json({ success: true, balance: user.casinoBalance, owned: user.cs16Skins });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/cs16/skins/equip', async (req, res) => {
  try {
    const { username, skin } = req.body || {};
    const user = await User.findOne({ username: String(username || '').toLowerCase() });
    if (!user) return res.json({ success: false, message: 'Не найден' });
    user.cs16Skins = user.cs16Skins || [];
    if (skin && !user.cs16Skins.includes(skin)) return res.json({ success: false, message: 'Скин не куплен' });
    user.cs16Skin = skin || '';
    await user.save();
    res.json({ success: true, equipped: user.cs16Skin });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 3.16.1: версия деплоя — сверка коммита на Render
app.get('/api/version', (req, res) => {
  res.json({ version: '3.30.0', combatVersion: '3.30.0', commit: process.env.RENDER_GIT_COMMIT || null, now: Date.now() });
});
