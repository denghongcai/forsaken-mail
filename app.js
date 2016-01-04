/**
 * Created by Hongcai Deng on 2015/12/28.
 */

'use strict';

let express = require('express');
let path = require('path');
let debug = require('debug')('app');
let bodyParser = require('body-parser');

let api = require(path.join(__dirname, 'routes/api'));
let app = express();

app.set('x-powered-by', false);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 3600000}));

app.use('/api', api);

app.use(function(req, res, next) {
  let err = new Error('Not Found');
  err.status = 404;
  next(err);
});

app.use(err => debug(err));

module.exports = app;
