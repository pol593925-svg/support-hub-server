const {test}=require('node:test'),assert=require('node:assert/strict'),{links}=require('./cinema-snacks');
test('drink destinations accept ordinary websites, allow disabling, reject executable URLs and credentials',()=>{
  assert.deepEqual(links({cola:'https://example.com/c?a=1',sprite:'',fanta:' http://example.org '}),{cola:'https://example.com/c?a=1',sprite:'',fanta:'http://example.org/'});
  for(const cola of ['javascript:alert(1)','file:///C:/test.cmd','data:text/html,test','supporthub://x','https://user:pass@example.com/','https://example.com/\nx',null,'https://'+ 'x'.repeat(2050)])
    assert.throws(()=>links({cola,sprite:'',fanta:''}),e=>e.status===400);
});
