'use strict';

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
