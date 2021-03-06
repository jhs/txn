# Transaction: JavaScript ACID objects

[![build
status](https://secure.travis-ci.org/nodejitsu/txn.png)](http://travis-ci.org/nodejitsu/txn)

Transaction (or *Txn*) is a library to load, modify, and commit JavaScript objects in atomic, all-or-nothing operations. It comes from internal Iris Couch tooling, inspired by Google [App Engine transactions][app_engine_txn].

Transaction is great for making discrete changes to CouchDB, Cloudant, and PouchDB documents.

## Objective

Txn **guarantees** that data modifications either *commit* completely, or *roll back* completely ([MVCC][mvcc]). Txn automatically and transparently retries the operation a few times until it commits. I like me some transaction and you should too:

1. Write a simple, clear *operation* function to process a chunk of data (JavaScript object)
1. Other parts of the program trigger the operation for various objects with various IDs.
1. Operations might accidently run *multiple times*, even *concurrently*, perhaps behaving *unpredictably*, probably *timing out* when web sites go down. In other words, it is working within the real world.
1. No matter. Transaction ensures that, for a given object ID, changes are atomic, consistent, isolated, and durable (ACID guarantees).

## Easy transactions

Install Transaction with NPM

    $ npm install txn

Usage:

```javascript
var txn = require("txn");
var request = require('request');

var url = "https://example.cloudant.com/my_db/my_doc";

txn({uri:url}, change_the_doc, change_done);

function change_the_doc(doc, to_txn) {
  // I run on the doc that is fetched. Usually, I run once. But, if Txn detects
  // a document conflict, I may run multiple times as Txn retries.
  doc.awesome = (doc.type == "teacher") ? true : 'maybe';
  request("http://twitter.com/" + doc.twitter, function(er, resp, body) {
    if(er)
      return to_txn(er);
    doc.twitter_feed = body;
    return to_txn();
  })
}

function change_done(error, newDoc) {
  // I run once, after the transaction is complete.
  if(error)
    return console.log("Sorry, the change didn't stick: " + error);
  else
    console.log("Yay! The new doc is: " + JSON.stringify(newDoc));
})
```

<a name="pouchdb"></a>
## PouchDB

Txn supports PouchDB. The npm package provides a PouchDB plugin.

```javascript
var PouchDB = require('PouchDB');
var Txn = require('txn');

// Load Txn support into PouchDB.
PouchDB.plugin(Txn.PouchDB);

// Now your PouchDB database has transaction support!
var db = new PouchDB('example');

// This operation adds 5 to a "count" field.
function add_five(doc, to_txn) {
  if (!doc.count) {
    doc.count = 0;
  }

  doc.count = doc.count + 5;
  return to_txn();
}

db.txn({id:'my_doc', create:true, timestamps:true}, add_five, function(er, doc) {
  if (er)
    console.log('Problem creating my_doc: ' + er);
  else
    console.log('Document created ' + doc.created_at + ' count = ' + doc.count);
})
```

<a name="serial"></a>
## Serial Transactions

Txn eliminates a classic mistake when using an MVCC database: lost concurrent updates. Txn is here to simplify and clarify concurrent updates.

```javascript
var PouchDB = require('PouchDB');
var Txn = require('txn');
PouchDB.plugin(Txn.PouchDB);

var db = new PouchDB('example');

// Add five points. What could be simpler?
function add_five(doc, to_txn) {
  doc.points = (doc.points || 0) + 5;
  return to_txn();
}

// Run add_five three times, at the same time! The result will always be 15.
db.txn({id:'points', create:true}, add_five, add_done);
db.txn({id:'points', create:true}, add_five, add_done);
db.txn({id:'points', create:true}, add_five, add_done);

function add_done(er, doc, txr) {
  if (er) {
    console.log('PouchDB error while tabulating points: ' + er);
  } else {
    // txr is the "transaction result" which you can usually ignore.
    console.log('It took '+txr.tries+' tries to give you '+doc.points+' points');
  }
}
```

Example output:

```
It took 1 tries to give you 5 points
It took 2 tries to give you 10 points
It took 3 tries to give you 15 points
```

What that means:

1. One Txn call stored `{"points":5}` on the first try. The others both failed with a conflict. So they each retried.
2. A second Txn call then succeeded, storing `{"points":10}` on its second try. But the third failed yet again.
3. The third Txn call finally succeeded, storing `{"points":10}` on its third try.

If this example is confusing or uninteresting to you, not to worry! In any case, Txn is usually simpler than writing your own fetching and storing code for your database. Just provide a document ID, and a function to change the document.

<a name="api"></a>
## API

### Setting default options

Transaction uses [Defaultable][def]. You can set defaults which will always apply. You can also set defaults based on previous defaults.

```javascript
// Global defaults for everything.
var txn = require('txn').defaults({"timestamps":false, "couch":"http://localhost:5984"});

// Specific defaults for different databases. (timestamps and couch from above still apply.)
var user_txn = txn.defaults({"db":"users", "delay":1000, "timeout":45000});
var jobs_txn = txn.defaults({"db":"jobs" , "delay":100 , "create": true});

// Now things look much better.
user_txn({id:"bob"}, do_user, on_user_txn);
jobs_txn({id:"cleanup"}, do_job, on_job_txn);
```

### Basic idea

Transaction helps you *fetch, modify, then store* some JSON. It has a simple call signature, and you can set temporary or permanent defaults (see below).

txn(**request_obj**, **operation_func**, **txn_callback_func**)

### request_obj

The **request_obj** is for the [request][req] module. (Txn uses *request* internally.) Txn supports some additional optional fields in this object.

* Mandatory: Some location of the data. Everything else is optional.
  * For **CouchDB**, including **Cloudant**:
    * *either* **uri** | Location to GET the data and PUT it back. Example: `"https://me:secret@example.iriscouch.com/my_db/my_doc"`
    * *or* broken into parts:
       * **couch** | URI of the CouchDB server. Example: `"https://me:secret@example.iriscouch.com"`
       * **db** | Name of the Couch database. Example: `"my_db"`
       * **id** | ID of the Couch document. Example: `"my_doc"`
  * For **PouchDB**, only the **id** field is needed.
* **create** | If `true`, missing documents are considered empty objects, `{}`, passed to the operation. If `false`, missing documents are considered errors, passed to the callback. Newly-created objects will not have a `_rev` field.
* **doc** | Skip the first fetch, assume *doc* is initial data value. Notes:
  * This is useful with `_changes?include_docs=true`
  * The `._id` can substitute for *id* above. Thus, given a `_changes` event, just use `txn({doc:change.doc}, ...)`
  * If there is a conflict, Txn will re-fetch the document as usual! To avoid this, set `max_tries=1`.
  * Not supported by `.defaults()`
* **timestamps** | Automatically add an `updated_at` field when updating and `created_at` when creating. Default: `false`
* **max_tries** | How many times to run the fetch/operation/store cycle before giving up. An MVCC conflict triggers a retry. Default: `5`
* **after** | Milliseconds to postpone the *first* operation. (A random value is a good way to load-balance job consumers). Default: `null` i.e. run immediately
* **delay** | Milliseconds to wait before *retrying* after a conflict. Each retry doubles the wait time. Default: `100`
* **timeout** | Milliseconds to wait for the **operation** to finish. Default: `15000` (15 seconds)
* **log** | Logger object to use. Default is a debug function in the namespace "txn"

For example:

```javascript
{ uri       : "https://me:secret@example.iriscouch.com/_users/org.couchdb.user:bob"
, create    : true          // Use missing doc IDs to create new docs
, timestamps: true          // Automatic created_at and updated_at fields
, timeout   : 5 * 60 * 1000 // Five minutes before assuming the operation failed.
}
```

### operation_func

This is your primary *worker function* to receive, react-to, and modify the data object. **Txn will wrap this function in fetch/store requests.** If there is an MVCC conflict, **Txn will fetch again, re-run this function, and store again**. If you give this function a name, it will be reflected in Txn's logs. So make it count!

The function receives two parameters.

1. The fetched JSON object, often called **doc**
2. A callback to return processing to Txn, often called **to_txn**. The callback takes two parameters:
  1. An error object
  2. An optional *replacement object*. If provided, modifications to **doc** are ignored and this object is used instead.

```javascript
function make_a_contestant(user, to_txn) {
  if(! user._rev) {
    // Creating a user.
    user.type = "user";
    user.name = "bob";
    user.roles = [];
  }

  // Demonstrate sending an Error to the transaction callback function.
  if(require("os").hostname() == "staging")
    return to_txn(new Error("Making contestants may not run on the staging server"));

  // People named Joe may not play. Demonstrates sending a replacement object.
  if(user.name == "joe")
    return to_txn(null, {"_deleted": true});

  user.roles.push("contestant");
  if(Math.random() < 0.5)
    user.roles.push("red_team");
  else
    user.roles.push("blue_team");

  return to_txn();
}
```

Note, Txn automatically sets the `_id` and `_rev` fields. The operation function needn't bother.

### txn_callback_func

When Txn is all done, it will run your final callback function with the results.

The callback function receives three parameters:

1. An error object, either from Txn (e.g. too many conflicts, operation timeout, HTTP error) or the one sent by *operation_func*. Txn will set various fields depending on the type of error.
  * `timeout` if the operation function timed out.
  * `conflict` and `tries` if there was an MVCC conflict and the number of retries was exhausted
2. The final committed object.
3. A transaction result object with information about the process. Useful fields:
  * `tries`: The number of tries the entire run took (`1` means the operation worked on the first try)
  * `name`: The name of this transaction (your operation function name)

```javascript
function after_txn(error, doc, txr) {
  if(error) {
    console.error("Failed to run transaction after " + txr.tries + " attempts");
    throw error;
  }

  console.log("Transaction success: " + doc._id);

  // Application code continues.
}
```

### Transaction Result: txr

Your callback receives a third argument, `txr`, the transaction result. Usually, you simply check the error argument to see if the transaction succeeded or failed. But the `txr` object contains the details about the execution. Properties:

* **tries**: Integer, the number of times the full transaction cycle ran (fetch, modify, store)
* **fetches**: Integer, the number of times Txn fetched the document from the database; usually the same as *tries* unless you provide a `doc` parameter, telling Txn to skip the first fetch
* **stores**: Integer, the number of times Txn attempted to store the document in the database; usually the same as *tries* unless Txn encountered an error
* **is_create**: Boolean, `true` if the document was created for the first time; `false` if the document was updated from a prior revision

For example, if you already know of a document in the database and you try to update it

``` javascript
// My application already knows this, perhaps from a _changes feed.
var doc = {_id:"my_doc", _rev:"3-0f3e848a3249737d5814bdd60228ae77", count:3};

txn({doc:doc}, increment, on_done);

function increment(doc, to_txn) {
  doc.count = doc.count + 1;
  return to_txn();
}

function on_done(er, doc, txr) {
  console.log('Tries:' + txr.tries + ' Fetches:' + txr.fetches);
}
```

The above example tells Txn to be optimistic, and to assume that we already know the document "my_doc". If the update runs with no conflicts, the output will be:

    Fetches:0 Tries:1

And thus we saved a full GET round-trip! However, if the document was out of date, *the code still works as-is*:

    Fetches:1 Tries:2

Txn tried the update, encountered a conflict, then fetched the latest document revision to process.

## Example: account signup

Consider account signup as a stateful workflow:

* **requested** (performed by user): User submits their username and email address
* **emailed** (performed by server): Approved the request and emailed the user
* **confirmed**: (performed by user): User clicked the email link and confirmed signup
* **done**: (performed by server): Initial account is set up and ready to use.

The code:

```javascript
// Usage: signup.js <username>
var txn = require("txn");
var username = process.env.username;
var user_uri = "http://example.iriscouch.com/users/" + username;

// Execute the signup processor and react to what happens.
txn({"uri":user_uri}, process_signup, function(error, newData) {
  if(!error)
    return console.log("Processed " + username + " to state: " + newData.state);

  // These errors can be sent by Txn.
  if(error.timeout)
    return console.log("Gave up after " + error.tries + " conflicts");
  if(error.conflict)
    return console.log("process_signup never completed. Troubleshoot and try again");

  // App-specific errors, made by process_signup below.
  if(error.email)
    return console.log('Failed to email: ' + username);
  if(error.account)
    return console.log('Failed to create account: ' + username);

  throw error; // Unknown error
})

function process_signup(doc, to_txn) {
  if(doc.state == 'requested') {
    if(! valid_request(doc))
      return to_txn(null, {"_deleted":true}); // Return a whole new doc.

    doc.emailed_by = require('os').hostname();
    doc.signup_key = Math.random();
    send_email(doc.email, doc.signup_key, function(error) {
      if(error) {
        error.email = true;
        return to_txn(error); // Roll back
      }
      doc.state = 'emailed';
      return to_txn();
    })
  }

  // If the data is unchanged, Txn will not write to the back-end. This operation is thus read-only.
  else if(doc.state == 'emailed') {
    console.log('Still waiting on user to click email link.');
    return to_txn();
  }

  else if(doc.state == 'confirmed') {
    doc.confirmed_at = new Date;
    create_account(doc.username, function(error) {
      if(error) {
        error.account = true;
        return to_txn(error);
      }
      doc.confirmed_by = require('os').hostname();
      doc.state = 'done';
      return to_txn();
    })
  }
}
```

## Considerations

Transaction is great for job processing, from a CouchDB `_changes` feed for example. Unfortunately, jobs are for *doing stuf* (create an account, save a file, send a tweet) and the useful "stuff" are all side-effects. But Txn only provides atomic *data*. It cannot roll-back side-effects your own code made.

Thus the best Txn functions are [reentrant][reent]: At any time, for any reason, a txn function might begin executing anew, concurrent to the original execution, perhaps with the same input parameters or perhaps with different ones. Either execution path could finish first. (The race loser will be rolled back and re-executed, this time against the winner's updated data.)

[app_engine_txn]: http://code.google.com/appengine/docs/python/datastore/transactions.html
[mvcc]: http://en.wikipedia.org/wiki/Multiversion_concurrency_control
[reent]: http://en.wikipedia.org/wiki/Reentrancy_(computing)
[follow]: https://github.com/iriscouch/follow
[req]: https://github.com/mikeal/request
[def]: https://github.com/iriscouch/defaultable
