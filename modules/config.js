/**
 * Created by Hongcai Deng on 2015/12/28.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const defaultConfigJsonPath = path.join(__dirname, '..', 'config-default.json')
const defaultConfigPath = path.join(__dirname, '..', 'config-default.js')

let config = {};

if (fs.existsSync(defaultConfigJsonPath)) {
    config = require(defaultConfigJsonPath);
} else {
    config = require(defaultConfigPath);
}

module.exports = config;