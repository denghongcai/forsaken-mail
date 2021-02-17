/**
 * Created by Hongcai Deng on 2015/12/28.
 */

'use strict';

let path = require('path');
let mailin = require('mailin');
let config = require('./config');

mailin.start(config.mailin);

mailin.on('error', function(err) {
  console.error(err.stack);
});

module.exports = mailin;
