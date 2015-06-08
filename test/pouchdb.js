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

    // NOTE: Pouch seems to re-use a database if the name is the same. If that ever changes, def_db will be missing doc_a.
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
    t.match(er && (er.name || er.message), /not_found/, 'Error on unknown doc ID')
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

tap.test('Preloaded doc with no conflicts', function(t) {
  txn({id:'doc_b', create:true}, setter('type','first'), function(er, doc_b, txr) {
    if(er) throw er;
    t.equal(doc_b.type, 'first', 'Create doc for preload')
    t.equal(txr.tries, 1, 'Takes 1 try for doc update')
    t.equal(txr.fetches, 1, 'Takes 1 fetch for doc update')

    var ops = 0;
    function update_b(doc, to_txn) {
      ops += 1;
      doc.type = 'preloaded';
      return to_txn();
    }

    txn({doc:doc_b}, update_b, function(er, doc, txr) {
      if(er) throw er;

      t.equal(doc.type, 'preloaded', 'Preloaded operation runs normally')
      t.equal(ops, 1, 'Only one op for preloaded doc without conflicts')
      t.equal(txr.tries, 1, 'One try for preloaded doc without conflicts')
      t.equal(txr.fetches, 0, 'No fetches for preloaded doc without conflicts')

      state.doc_b = doc
      t.end()
    })
  })
})

tap.test('Preloaded doc with funny name', function(t) {
  var doc1 = {'_id':'this_doc', 'is':'nothing'}
  var doc2 = {'_id':'this_doc/has:slashes!youknow?'}

  if (POUCH)
    state.db.bulkDocs([doc1, doc2], function(er, body) {
      if (er)
        throw er
      if (!body || !body[0] || body[0].ok !== true)
        throw new Error('Bad bulk docs store: ' + JSON.stringify(body))
      if (!body || !body[1] || body[1].ok !== true)
        throw new Error('Bad bulk docs store: ' + JSON.stringify(body))
      stored()
    })
  else if (COUCH)
    request({method:'POST', uri:COUCH+'/'+DB+'/_bulk_docs', json:{docs:[doc1,doc2]}}, function(er, res) {
      if (er)
        throw er
      if (!res.body || !res.body[0] || res.body[0].ok !== true)
        throw new Error('Bad bulk docs store: ' + JSON.stringify(res.body))
      if (!res.body || !res.body[1] || res.body[1].ok !== true)
        throw new Error('Bad bulk docs store: ' + JSON.stringify(res.body))
      stored()
    })

  function stored() {
    if (POUCH)
      state.db.get('this_doc/has:slashes!youknow?', function(er, doc) {
        if (er) throw er
        ready(doc)
      })
    else if (COUCH)
      request({url:COUCH+'/'+DB+'/this_doc%2fhas:slashes!youknow%3f', json:true}, function(er, res) {
        if(er) throw er;
        ready(res.body)
      })
  }

  function ready(doc) {
    var ops = 0;
    function updater(doc, to_txn) {
      ops += 1;
      doc.type = 'preloaded slashy';
      return to_txn();
    }

    txn({doc:doc}, updater, function(er, this_doc, txr) {
      if(er) throw er;

      t.equal('preloaded slashy', this_doc.type, 'Create doc for preload');
      t.equal(ops, 1, 'One op for preloaded doc with funny name')
      t.equal(txr.tries, 1, 'One try for doc update')
      t.equal(txr.fetches, 0, 'No fetches for preloaded doc with funny name')

      t.end()
    })
  }
})

tap.test('Preloaded doc with conflicts', function(t) {
  var old_rev = state.doc_b._rev;
  var old_type = state.doc_b.type;

  var old_b = JSON.parse(JSON.stringify(state.doc_b));
  var new_b = {_id:'doc_b', _rev:old_rev, 'type':'manual update'};

  var url = COUCH + '/' + DB + '/doc_b';
  if (COUCH)
    request({method:'PUT', uri:url, json:new_b}, function(er, res) {
      if (er) throw er
      if (res.statusCode != 201)
        throw new Error('Bad PUT ' + JSON.stringify(res.body))
      ready(res.body.rev)
    })
  else if (POUCH)
    state.db.put(new_b, function(er, result) {
      if (er) throw er
      ready(result.rev)
    })

  function ready(new_rev) {
    // Lots of stuff going on, so make a plan.
    var updater_tests = 3
    var post_tests = 4
    t.plan(updater_tests*2 + post_tests)

    // At this point, the new revision is committed but tell Txn to assume otherwise.
    var new_type = 'manual update'

    var ops = 0;
    function updater(doc, to_txn) {
      ops += 1;
      t.equal(ops == 1 || ops == 2, true, "Should take 2 ops to commit a preload conflict: " + ops)

      if(ops == 1) {
        t.equal(old_rev , doc._rev, "First op should still have old revision")
        t.equal(old_type, doc.type, "First op should still have old value")
      } else {
        t.equal(new_rev , doc._rev, "Second op should have new revision")
        t.equal(new_type, doc.type, "Second op should have new type")
      }

      doc.type = 'preload txn';
      return to_txn();
    }

    txn({id:'doc_b', doc:old_b}, updater, function(er, final_b, txr) {
      if(er) throw er;

      t.equal(ops, 2, 'Two ops for preloaded txn with conflicts')
      t.equal(txr.tries, 2, 'Two tries for preloaded doc with conflicts')
      t.equal(txr.fetches, 1, 'One fetch for preloaded doc with conflicts')
      t.equal(final_b.type, 'preload txn', 'Preloaded operation runs normally')

      state.doc_b = final_b
      t.end()
    })
  }
})

tap.test('Preloaded doc creation', function(t) {
  var doc = {_id: "preload_create", worked: false};

  txn({doc:doc, create:true}, setter('worked', true), function(er, doc, txr) {
    if(er) throw er;

    t.equal(txr.tries, 1, "One try to create a doc with preload")
    t.equal(txr.fetches, 0, "No fetches to create a doc with preload")
    t.equal(true, doc.worked, "Operation runs normally for preload create")
    t.end()
  })
})

tap.test('Concurrent transactions', function(t) {
  var doc = { _id:'conc' }
  var bad_rev = '1-abc'

  if (COUCH)
    request({method:'PUT', uri:COUCH+'/'+DB+'/conc', json:doc}, function(er, res) {
      if (er) throw er
      t.equal(res.statusCode, 201, 'Good conc creation')
      t.notEqual(res.body.rev, bad_rev, 'Make sure '+bad_rev+' is not the real revision in CouchDB')
      ready(res.body.rev)
    })
  else if (POUCH)
    state.db.put(doc, function(er, result) {
      if (er) throw er
      ready(result.rev)
    })

  function ready(rev) {
    t.notEqual(rev, bad_rev, 'The real revision is not '+bad_rev)

    // Looks like this isn't necessary just yet.
    var _txn = txn
    if (COUCH)
      _txn = txn.defaults({ 'delay':8, 'request':track_request })

    var opts = {id:'conc'}
    _txn({id:'conc'}, setter('done', true), function(er, doc, txr) {
      if(er) throw er

      t.equal(doc.done, true, 'Setter should have worked')

      // TODO: Really, there should be a similar mechanism to fool PouchDB. Perhaps a plugin to override .get().
      if (COUCH)
        t.equal(txr.tries, 5, 'The faux request wrapper forced this to require many tries')

      t.end()
    })

    // Return the same response for the document over and over.
    var gets = 0;
    function track_request(req, callback) {
      if(req.method != 'GET' || ! req.uri.match(/\/conc$/))
        return request.apply(this, arguments);

      gets += 1;
      if(gets > 3)
        return request.apply(this, arguments);

      // Return the same thing over and over to produce many conflicts in a row.
      return callback(null, {statusCode:200}, JSON.stringify({_id:'conc', _rev:bad_rev}));
    }
  }
})

tap.test('After delay', function(t) {
  var set = setter('x', 1);
  var start, end, duration;

  var num = 0;
  function doc() {
    num += 1;
    return {"_id":"after_"+num};
  }

  start = new Date;
  txn({doc:doc(), create:true, after:null}, set, function(er) {
    if(er) throw er;

    end = new Date;
    var base_duration = end - start;

    start = new Date;
    txn({doc:doc(), create:true, after:0}, set, function(er) {
      if(er) throw er;

      end = new Date;
      duration = end - start;

      if(base_duration < 10)
        t.equal(duration < 10, true, 'after=0 should run immediately')
      else
        t.equal(almost(0.25, duration, base_duration), true, 'after=0 should run immediately (about ' + base_duration + ')')

      start = new Date;
      txn({doc:doc(), create:true, after:250}, set, function(er) {
        if(er) throw er;

        end = new Date;
        duration = end - start;
        var delay_duration = duration - base_duration;
        t.equal(almost(0.10, delay_duration, 250), true, "after parameter delays the transaction")

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

//
// Utilities
//

function almost(margin, actual, expected) {
  var delta = Math.abs(actual - expected)
  var real_margin = delta / expected
  return (real_margin <= margin)
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
