/**
 * Created by Hongcai Deng on 2015/12/28.
 */

'use strict';

let shortid = require('shortid');
let mailin = require('./mailin');

let onlines = new Map();

module.exports = function(io) {
  mailin.on('message', function(connection, data) {
    let to = data.headers.to.toLowerCase();
    let exp = /[\w\._\-\+]+@[\w\._\-\+]+/i;
    if(exp.test(to)) {
      let matches = to.match(exp);
      let shortid = matches[0].substring(0, matches[0].indexOf('@'));
      if(onlines.has(shortid)) {
        onlines.get(shortid).emit('mail', data);
      }
    }
  });

  io.on('connection', socket => {
    socket.shortid = shortid.generate().toLowerCase(); // generate shortid for an incomming connection
    onlines.set(socket.shortid, socket); // add incomming connection to online table
    socket.emit('shortid', socket.shortid);
  });

  io.on('disconnect', socket => {
    onlines.delete(socket.shortid);
  });
};