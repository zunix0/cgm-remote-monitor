'use strict';

var nconf = require('nconf');
var Emitter = require('events').EventEmitter;
var bootevent = require('bootevent');

function configure (cb) {
  nconf.use('memory');
  nconf.use('config', { type: 'file', file: './drywall_config.json' });
  nconf.defaults({
    port: 3000
  });
  nconf.argv({
    "mongodb.uri": ""
  });
  return bootevent( ).acquire(function db (ctx, next) {
    console.log('context during acquiring db', ctx, arguments);
    var now = new Date( );
    console.log('starting acquire', arguments);
    setTimeout(function done ( ) {
      ctx.timeout = (new Date( )) - now;
      console.log('simulated later', arguments);
      next( );
    }, 2000)
    ;

  })
  .boot(function booted ( ) {
    console.log('START PROCESS', arguments);
  });
  ;
  
  return nconf;
}
exports.port = process.env.PORT || 3000;
exports.mongodb = {
  uri: process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || 'localhost/drywall'
};
exports.companyName = 'Nightscout contributors';
exports.projectName = 'Nightscout';
exports.systemEmail = process.env.NIGHTSCOUT_EMAIL || 'nightscout.core@gmail.com';
exports.cryptoKey = process.env.CRYPTO_KEY || 'f1ng3rp1nt3d';
exports.loginAttempts = {
  forIp: 30,
  forIpAndUser: 6,
  logExpiration: '60m'
};
exports.requireAccountVerification = false;
exports.smtp = {
  from: {
    name: process.env.SMTP_FROM_NAME || exports.projectName +' [web]',
    address: process.env.SMTP_FROM_ADDRESS || 'nightscout.core@gmail.com'
  },
  credentials: {
    user: process.env.SMTP_USERNAME || 'nightscout.core@gmail.com',
    password: process.env.SMTP_PASSWORD,
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    ssl: true
  }
};
exports.oauth = {
  twitter: {
    key: process.env.TWITTER_OAUTH_KEY || '',
    secret: process.env.TWITTER_OAUTH_SECRET || ''
  },
  facebook: {
    key: process.env.FACEBOOK_OAUTH_KEY || '',
    secret: process.env.FACEBOOK_OAUTH_SECRET || ''
  },
  github: {
    key: process.env.GITHUB_OAUTH_KEY || '',
    secret: process.env.GITHUB_OAUTH_SECRET || ''
  },
  google: {
    key: process.env.GOOGLE_OAUTH_KEY || '',
    secret: process.env.GOOGLE_OAUTH_SECRET || ''
  },
  tumblr: {
    key: process.env.TUMBLR_OAUTH_KEY || '',
    secret: process.env.TUMBLR_OAUTH_SECRET || ''
  }
};
if (!module.parent) {
  var proc = configure( );
  console.log(proc);

}
