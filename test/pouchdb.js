// Txn PouchDB unit tests
//
// Copyright 2011 Jason Smith, Jarrett Cruger and contributors
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

var tap = require('tap')
var util = require('util')
var request = require('request')
var PouchDB = require('pouchdb')
var memdown = require('memdown')

var Txn = require('..')
var Txn_lib = require('../lib.js')

var TICK = typeof global.setImmediate !== 'function' ? process.nextTick : setImmediate;
var DB = process.env.db || 'txn_test';
var state = {};

// If $couchdb is defined, then test against Apache CouchDB. Otherwise, test against PouchDB.
var COUCH = process.env.couchdb
var POUCH = !COUCH

// This will be set in setup_*() and used throughout the tests.
var txn = function() { throw new Error('txn not set yet') }

tap.test('PouchDB plugin API', function(t) {
  t.type(Txn.PouchDB, 'object', 'Txn PouchDB plugin in the API')
  t.type(Txn.PouchDB.Transaction, 'function', 'Transaction initializer in the API')
  t.type(Txn.PouchDB.txn        , 'function', 'Transaction shortcut in the API')
  t.end()
})

tap.test('Setup', function(t) {
  var doc = {_id:'doc_a', val:23}

  if (COUCH)
    setup_couchdb()
  else
    setup_pouchdb()

  function done() {
    if (!state.db)
      throw new Error('Failed to create test DB')

    if (typeof txn != 'function')
      throw new Error('txn() not in the global state for further use in testing')

    if (POUCH) {
      t.type(state.db.Transaction, 'function', 'PouchDB plugin loaded Transaction class')
      t.type(state.db.txn        , 'function', 'PouchDB plugin loaded txn shortcut')
    }

    t.end()
  }

  function setup_pouchdb() {
    PouchDB.plugin(Txn.PouchDB)
    var db = new PouchDB(DB, {db:memdown})
    db.put(doc, function(er, body) {
      if (er) throw er
      if (!body || !body.ok)
        throw new Error('Cannot create doc: ' + JSON.stringify(body))

      state.db = db
      state.doc_a = doc
      state.doc_a._rev = body.rev
      txn = state.db.txn.bind(state.db)
      done()
    })
  }

  function setup_couchdb() {
    var url = COUCH + '/' + DB;
    request({method:'DELETE', uri:url}, function(er, resp, body) {
      if(er) throw er;
      var json = JSON.parse(body);

      var already_gone = (resp.statusCode === 404 && json.error === 'not_found');
      var deleted      = (resp.statusCode === 200 && json.ok    === true);

      if(! (already_gone || deleted))
        throw new Error('Unknown DELETE response: ' + resp.statusCode + ' ' + body);

      request({method:'PUT', uri:url}, function(er, resp, body) {
        if(er) throw er;
        var json = JSON.parse(body);

        if(resp.statusCode !== 201 || json.ok !== true)
          throw new Error('Unknown PUT response: ' + resp.statusCode + ' ' + body);

        request({method:'POST', uri:url, json:doc}, function(er, resp, body) {
          if(er) throw er;

          if(resp.statusCode !== 201 || body.ok !== true)
            throw new Error("Cannot store doc: " + resp.statusCode + ' ' + JSON.stringify(body));

          // CouchDB just uses the main API from require().
          txn = Txn

          doc._rev = body.rev;
          state.doc_a = doc;
          state.db = COUCH + '/' + DB
          done();
        })
      })
    })
  }
})

tap.test('Required params', function(t) {
  var ID = state.doc_a._id;
  var orig = state.doc_a.val;

  var noop_ran = false;
  var noop = function(_doc, to_txn) { noop_ran = true; to_txn() }

  t.throws(function() { txn({}, noop, noop) }, "Mandatory uri");

  t.throws(function() { txn({couch:COUCH}, noop, noop) }, "Mandatory uri; missing db,id");
  t.throws(function() { txn({db   :DB   }, noop, noop) }, "Mandatory uri; missing couch,id");
  t.throws(function() { txn({couch:COUCH, db:DB}, noop, noop) }, "Mandatory uri; missing id");

  if (COUCH) {
    t.throws(function() { txn({id   :ID   }, noop, noop) }, "Mandatory uri; missing couch,db");
    t.throws(function() { txn({couch:COUCH, id:ID}, noop, noop) }, "Mandatory uri");
    t.throws(function() { txn({db:DB      , id:ID}, noop, noop) }, "Mandatory uri");
    assert.equal(false, noop_ran, "CouchDB: Should never have called noop");
    t.equal(orig, state.doc_a.val, "Val should not have been updated");
    t.end()
  } else {
    t.throws(function() { txn({id:ID, uri:'http://127.0.0.1:5984/db/doc'}, noop, noop) }, 'PouchDB call with uri')
    t.throws(function() { txn({id:ID, url:'http://127.0.0.1:5984/db/doc'}, noop, noop) }, 'PouchDB call with url')
    t.doesNotThrow(function() { txn({id:ID}, noop, end) }, 'PouchDB call, only id')
  }

  function end() {
    t.equal(noop_ran, true, 'PouchDB call with id runs noop()')
    t.end()
  }
})

tap.test('Clashing parameters', function(t) {
  var url = 'http://127.0.0.1:4321/db/doc';
  var noop_ran = false;
  var noop = function(_doc, to_txn) { noop_ran = true; to_txn() }

  thrown(function() { txn({uri:url, couch:COUCH}, noop, noop) }, "Clashing params: uri,couch");
  thrown(function() { txn({url:url, couch:COUCH}, noop, noop) }, "Clashing params: url,couch");
  thrown(function() { txn({uri:url, db   :DB   }, noop, noop) }, "Clashing params: uri,db");
  thrown(function() { txn({url:url, id   :'foo'}, noop, noop) }, "Clashing params: url,id");

  thrown(function() { txn({uri:url, couch:COUCH, db:DB, id:'doc_a'}, noop, noop) }, "Clashing params, uri,couch,db,id");

  t.equal(false, noop_ran, "Noop should never run");
  t.end()

  function thrown(func, label) {
    var exception = null;
    try       { func()        }
    catch (e) { exception = e }

    var msg = COUCH ? /Clashing/ : /PouchDB disallows/
    t.ok(exception, 'Exception thrown: ' + label)
    t.match(exception && exception.message, msg, 'Exception message ' + msg + ': ' + label)
  }
})

tap.test('Update with URI', function(t) {
  function opts() {
    return COUCH ? {url: COUCH + '/' + DB + '/doc_a'}
                 : {id:'doc_a'}
  }

  txn(opts(), plus(3), function(er, doc) {
    if(er) throw er;
    t.equal(26, doc.val, "Update value in doc_a");

    txn(opts(), plus(6), function(er, doc) {
      if(er) throw er;
      t.equal(32, doc.val, "Second update value in doc_a");

      state.doc_a = doc;
      t.end()
    })
  })
})

tap.test('Update with parameters', function(t) {
  var opts = {id:state.doc_a._id}
  if (COUCH) {
    opts.db = DB
    opts.couch = COUCH
  }

  txn(opts, plus(-7), function(er, doc) {
    if(er) throw er;

    t.equal(25, doc.val, "Update via couch args");
    t.end()
  })
})

tap.test('Update with defaults', function(t) {
  // Set TXN to use for these tests, to test defaultable for CouchDB and PouchDB. All subsequent tests will assume txn()
  // has these defaults. Since PouchDB needs only the id option, it is harder to confirm its defaultable behavior. So
  // use the test_callback feature.
  if (COUCH) {
    txn = txn.defaults({couch:COUCH, db:DB})
    var TXN = txn
  } else if (POUCH) {
    PouchDB.plugin(Txn.defaults({test_callback:checker}).PouchDB)

    // XXX Pouch seems to re-use a database if the name is the same. If that ever changes, def_db will be missing doc_a.
    var def_db = new PouchDB(DB, {db:memdown})
    var TXN = def_db.txn.bind(def_db)
  }

  var op_ran = false
  function checker() { op_ran = true }

  TXN({id:'doc_a'}, plus(11), function(er, doc) {
    if(er) throw er;

    t.equal(36, doc.val, "Defaulted parameters: couch and db")

    if (POUCH)
      t.equal(op_ran, true, 'Defaultable PouchDB plugin ran test_callback')

    state.doc_a = doc;
    t.end()
  })
})

tap.test('Operation timeout', function(t) {
  var val = state.doc_a.val;
  txn({id:'doc_a', timeout:200}, waitfor(100), function(er, doc) {
    t.equal(er, null, 'No problem waiting 200ms for a 100ms operation')

    txn({id:'doc_a', timeout:200}, waitfor(300), function(er, doc) {
      t.match(er && er.message, /timeout/, 'Expect a timeout error for a long operation')
      t.end()
    })
  })
})

tap.test('Create a document', function(t) {
  txn({id:'no_create'}, setter('foo', 'nope'), function(er, doc) {
    t.match(er && er.message, /not_found/, 'Error on unknown doc ID')
    t.equal(doc, undefined, "Should not have a doc to work with")

    txn({id:'create_me', create:true}, setter('foo', 'yep'), function(er, doc) {
      t.equal(er, null, 'No problem creating a doc with create:true')
      t.equal(doc.foo, 'yep', 'Created doc data looks good')
      t.equal(Object.keys(doc).length, 3, "No unexpected fields in doc create")
      t.end()
    })
  })
})

tap.test('Timestamps', function(t) {
  txn({id:'doc_a'}, plus(-6), function(er, doc) {
    if(er) throw er;

    t.equal(doc.val, 30, "Normal update works")
    t.equal(doc.created_at, undefined, 'Normal update has no create timestamp')
    t.equal(doc.updated_at, undefined, 'Normal update has no update timestamp')

    txn({id:'doc_a', timestamps:true}, plus(2), function(er, doc) {
      if(er) throw er;

      t.equal(doc.val, 32, "Timestamps update works")
      t.equal(doc.created_at, undefined, "Updating existing docs does not add creation timestamp")
      t.type(doc.updated_at, 'string', "Update with timestamps")

      state.doc_a = doc

      txn({id:'stamps', create:true, timestamps:true}, setter('val', 10), function(er, doc) {
        if(er) throw er;

        t.equal(doc.val, 10, "Timestamps create works")
        t.type(doc.created_at, 'string', "Create with created_at")
        t.type(doc.updated_at, 'string', "Create with updated_at")
        t.equal(doc.updated_at, doc.created_at, "Creation and update stamps are equal")

        t.end()
      })
    })
  })
})


//
// Some helper operations
//

function plus(X) {
  return adder;
  function adder(doc, to_txn) {
    if(!doc.val)
      return to_txn(new Error('No value'));
    doc.val += X;
    return to_txn();
  }
}

function setter(K, V) {
  return set;
  function set(doc, to_txn) {
    doc[K] = V;
    return to_txn();
  }
}

function waitfor(X) {
  return finisher;
  function finisher(doc, to_txn) {
    setTimeout(finish, X);
    function finish() {
      return to_txn();
    }
  }
}

function thrower(er) {
  return thrower;
  function thrower() {
    if(er) throw er;
  }
}

// TODO
//
// db.txn('doc_id', operation, callback)
// db.txn({_id:'foo'}) throws because it is probably a bad call
// db.txn({doc:{_id:'foo'}}) works with the standard shortcut
//
// t = require('txn')
// db = new PouchDB('foo')
// t({db:db, id:'blah'}) works because it checks (db instanceof PouchDB)

function I(obj) {
  return util.inspect(obj, {colors:true, depth:10})
}
