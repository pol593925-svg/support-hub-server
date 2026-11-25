'use strict';

const key = value => String(value || '').trim().toLowerCase();
function avatar(value) {
  return typeof value === 'string' && value.length <= 400000 &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
}

// Callers pass only records already authorized for the viewer. Photos are returned once
// per author and are never copied into the permanent work history.
async function authorsFor(User, events) {
  const names = [...new Set(events.map(event => key(event.user)).filter(Boolean))];
  const authors = Object.fromEntries(names.map(name => [name, { avatar: '' }]));
  if (!names.length) return authors;
  try {
    const users = await User.find({ username: { $in: names } }, { username: 1, avatar: 1 });
    for (const user of users) {
      const name = key(user.username);
      if (Object.hasOwn(authors, name)) authors[name] = { avatar: avatar(user.avatar) };
    }
  } catch {
    // A cosmetic lookup must not prevent employees from reading or submitting work.
  }
  return authors;
}

module.exports = { authorsFor, avatar };
