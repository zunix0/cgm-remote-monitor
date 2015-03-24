
var express = require('express');
var compression = require('compression');
function create (env, ctx) {
  ///////////////////////////////////////////////////
  // api and json object variables
  ///////////////////////////////////////////////////
  var api = require('./lib/api/')(env, ctx.entries, ctx.settings, ctx.treatments, ctx.profiles, ctx.devicestatus);
  var pebble = ctx.pebble;

  var app = express();
  app.entries = ctx.entries;
  app.treatments = ctx.treatments;
  app.profiles = ctx.profiles;
  app.devicestatus = ctx.devicestatus;
  var appInfo = env.name + ' ' + env.version;
  app.set('title', appInfo);
  app.enable('trust proxy'); // Allows req.secure test on heroku https connections.

  app.use(compression({filter: shouldCompress}));

  function shouldCompress(req, res) {
      //TODO: return false here if we find a condition where we don't want to compress
      // fallback to standard filter function
      return compression.filter(req, res);
  }

  //if (env.api_secret) {
  //    console.log("API_SECRET", env.api_secret);
  //}
  app.use('/api/v1', api);


  // pebble data
  app.get('/pebble', pebble(ctx.entries, ctx.treatments, ctx.profiles, ctx.devicestatus, env));

  //app.get('/package.json', software);

  // define static server
  //TODO: JC - changed cache to 1 hour from 30d ays to bypass cache hell until we have a real solution
  var staticFiles = express.static(env.static_files, {maxAge: 60 * 60 * 1000});

  // serve the static content
  app.use(staticFiles);

  var bundle = require('./bundle')();
  app.use(bundle);

// Handle errors with express's errorhandler, to display more readable error messages.

  // Handle errors with express's errorhandler, to display more readable error messages.
  var errorhandler = require('errorhandler');
  //if (process.env.NODE_ENV === 'development') {
    app.use(errorhandler());
  //}
  return app;
}
module.exports = create;

