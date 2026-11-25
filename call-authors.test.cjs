'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {authorsFor,avatar}=require('./call-authors');

test('author batch projects only photos, deduplicates names and handles special keys safely',async()=>{
  let calls=0;const photo='data:image/png;base64,aGVsbG8=';
  const User={async find(filter,projection){calls++;assert.deepEqual(filter,{username:{$in:['member','__proto__','deleted']}});assert.deepEqual(projection,{username:1,avatar:1});return[{username:'member',avatar:photo,secret:'hidden'},{username:'__proto__',avatar:photo},{username:'unrequested',avatar:photo}];}};
  const authors=await authorsFor(User,[{user:'Member'},{user:'member'},{user:'__proto__'},{user:'deleted'}]);
  assert.equal(calls,1);assert.deepEqual(Object.keys(authors),['member','__proto__','deleted']);
  assert.deepEqual(authors.member,{avatar:photo});assert.equal(authors.__proto__.avatar,photo);assert.deepEqual(authors.deleted,{avatar:''});
  assert.equal(Object.getPrototypeOf(authors),Object.prototype);
});

test('invalid or unavailable photos become initials without blocking call history',async()=>{
  for(const raw of ['https://example.com/avatar.png','data:image/svg+xml;base64,PHN2Zz4=',null,'data:image/png;base64,'+'A'.repeat(400001)])assert.equal(avatar(raw),'');
  assert.deepEqual(await authorsFor({find:async()=>{throw Error('down');}},[{user:'member'}]),{member:{avatar:''}});
  assert.deepEqual(await authorsFor({find:()=>{throw Error('must not query empty');}},[]),{});
});
