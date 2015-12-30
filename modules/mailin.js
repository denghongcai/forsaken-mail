/**
 * Created by Hongcai Deng on 2015/12/28.
 */

'use strict';

let path = require('path');
let mailin = require('mailin');
let config = require(path.join(__dirname, '..', 'config-default.json'));

mailin.start(config.mailin);

module.exports = mailin;