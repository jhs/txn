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


tap.test('PouchDB plugin API', function(t) {
  t.type(Txn.PouchDB, 'object', 'Txn PouchDB plugin in the API')
  t.type(Txn.PouchDB.Transaction, 'function', 'Transaction initializer in the API')
  t.type(Txn.PouchDB.txn        , 'function', 'Transaction shortcut in the API')
  t.end()
})

// If $couchdb is defined, then test against Apache CouchDB. Otherwise, test against PouchDB.
var COUCH = process.env.couchdb
var POUCH = !COUCH

tap.test('Setup', function(t) {
  var doc = {_id:'doc_a', val:23}

  if (COUCH)
    setup_couchdb()
  else
    setup_pouchdb()

  function done() {
    if (!state.db)
      throw new Error('Failed to create test DB')

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
  var noop = function() { noop_ran = true; };

  var TXN = COUCH ? Txn : state.db.txn.bind(state.db)

  t.throws(function() { TXN({}, noop, noop) }, "Mandatory uri");

  t.throws(function() { TXN({couch:COUCH}, noop, noop) }, "Mandatory uri; missing db,id");
  t.throws(function() { TXN({db   :DB   }, noop, noop) }, "Mandatory uri; missing couch,id");
  t.throws(function() { TXN({couch:COUCH, db:DB}, noop, noop) }, "Mandatory uri; missing id");

  if (COUCH) {
    t.throws(function() { TXN({id   :ID   }, noop, noop) }, "Mandatory uri; missing couch,db");
    t.throws(function() { TXN({couch:COUCH, id:ID}, noop, noop) }, "Mandatory uri");
    t.throws(function() { TXN({db:DB      , id:ID}, noop, noop) }, "Mandatory uri");
    assert.equal(false, noop_ran, "CouchDB: Should never have called noop");
  } else {
    t.doesNotThrow(function() { TXN({id:ID}, noop, noop) }, 'PouchDB call, only id')
    t.equal(noop_ran, true, 'PouchDB call with id runs noop()')
  }

  t.equal(orig, state.doc_a.val, "Val should not have been updated");
  t.end()
})
//
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
