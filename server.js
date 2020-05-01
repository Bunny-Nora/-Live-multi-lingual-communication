'use strict';

var os = require('os');
var nodeStatic = require('node-static');
var http = require('http');
var socketIO = require('socket.io');
var https = require('https');
var fs = require('fs');
// Imports the Google Cloud client library
const { Translate } = require('@google-cloud/translate').v2;

// Creates a client
var client = new Translate();

var fileServer = new(nodeStatic.Server)();
var app = http.createServer(function(req, res) {
  if (req.url.substring(1,6) === 'room=' && req.url.indexOf('&username=') !== 6) {
    fileServer.serveFile('/main.html', 200, {}, req, res);
  } else {
    fileServer.serve(req, res);
  }
  
}).listen(8080, () => {
  console.log('listening on *:8080');
});

// var httpwebserver = http.createServer(function(req,res) {
//   res.writeHead(301,{'Location': 'https://noracnr.github.io/' + req.url});
//   res.end();
// }).listen(80);

var rooms = {};

var io = socketIO.listen(app);
io.sockets.on('connection', function(socket) {

  var clientAddress = socket.handshake.address;
  console.log(new Date(), '- Client connected: {', socket.id, '} @', clientAddress);

  // convenience function to log server messages on the client
  function log() {
    var array = ['Message from server:'];
    array.push.apply(array, arguments);
    socket.emit('log', array);
  }

  socket.on('message', function(message) {
    log('Client said: ', message);
    // for a real app, would be room-only (not broadcast)
    socket.broadcast.emit('message', message);
  });

  socket.on('create or join', function(username, room) {
    if (!room || !username) {
      console.log('No room id or username', socket.id);
      socket.disconnect();
    } else {
      console.log('Received '+username+'\'s request to create or join room ' + room);

      if (rooms[room] === undefined) {
        console.log(username + ' created room ' + room);
        rooms[room] = {};
        socket.join(room);
        socket.socketID = username+'@'+room;
        socket.emit('created', room, socket.id);
        rooms[room][username] = socket;
      } else if (Object.keys(rooms[room]).indexOf(username) !== -1) {
        console.log('-User ', username, ' already in room ', room);
        log('-User ', username, ' already in room ', room);
        socket.disconnect();
      } else if (Object.keys(rooms[room]).length >= 2) {
        log('Larger than numClients', socket.id);
        socket.emit('full', room);
        socket.disconnect();
      } else {
        console.log(username + ' joined room ' + room);
        io.sockets.in(room).emit('join', username, room);
        socket.join(room);
        socket.socketID = username+ '@' + room;
        socket.emit('joined', room, socket.id);
        rooms[room][username] = socket;
        io.sockets.in(room).emit('ready');
      }
    }
  });

  socket.on('ipaddr', function() {
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details) {
        if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
          socket.emit('ipaddr', details.address);
        }
      });
    }
  });

  socket.on('bye', function(){
    console.log('received bye');
  });

  socket.on('subtitles request', function(message, language) {
    var fromUser = socket.socketID.split('@')[0];
    var room = socket.socketID.split('@')[1];

    Object.keys(rooms[room]).forEach(function(user) {
      console.log('subtitle request user:', user);
      if (user !== fromUser) {
        if (rooms[room][user] !== 'undefined') {
          rooms[room][user].emit('subtitles request', message, fromUser, language);
        }
        else {
          console.log('- BAD PARAMS FROM SOCKET ID', socket.id, 'due to toUser socket in this room',room,' not exist');
          socket.disconnect();
        }
      }
      else {
        rooms[room][user].emit('receipt', 'server have received your request.');
      }
    });
  });

  socket.on('translation start request', function(language){
    var fromUser = socket.socketID.split('@')[0];
    var room = socket.socketID.split('@')[1];
    Object.keys(rooms[room]).forEach(function(user) {
      if (user !== fromUser) {
        if (rooms[room][user] !== 'undefined') {
          console.log('emit translation request to', user);
          rooms[room][user].emit('translation request', fromUser, language);
        }
        else {
          console.log('- BAD PARAMS FROM SOCKET ID', socket.id, 'due to toUser socket in this room',room,' not exist');
          socket.disconnect();
        }
      }
    });
  });

  socket.on('translation request', async function(subtitle, toLang, username) {
    console.log('translation request subtitle:', subtitle);
    //console.log('translation request subtitle.text:', subtitle.text);
    console.log('translation request toLang:', toLang);
    if (subtitle === undefined) {
      console.log('>> BaBL:', new Date(), '- BAD PARAMS FROM SOCKET ID', socket.id);
      log('TALK！ or  Networking is TOOOOOOO BAD!!!!!!!!');
      socket.disconnect();
    }
    else {
      var fromUser = socket.socketID.split('@')[0];
      var room = socket.socketID.split('@')[1];
      try {
        var [translations] = await client.translate(subtitle, toLang);
        console.log('>>>>>:', new Date(), '-', subtitle.length,
              'characters are translated');
      } catch(e) {
        console.log('>>>>>:',new Date(),'translate error info:',e);
      }
      var translatedText = '';
      if (Array.isArray(translations)) {
        console.log('translateText is array');
        translations.forEach(function(str) {
          translatedText += str;
        });
      } else {
        translatedText = translations;
      }
      console.log('translateText', translatedText);
      Object.keys(rooms[room]).forEach(function(user) {
        if (user !== fromUser) {
          if (rooms[room][user] !== 'undefined') {
            console.log('transfer tranlate result to user:', user);
            rooms[room][user].emit('translation', translatedText, fromUser, subtitle.isFinal);
          }
          else {
            console.log('- BAD PARAMS FROM SOCKET ID', socket.id, 'due to toUser socket in this room',room,' not exist');
            socket.disconnect();
          }
        }
        else {
          rooms[room][user].emit('receipt', 'server have received your request.');
        }
      });
    }
  });
});
