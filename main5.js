'use strict';

var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var localStream;
var pc;
var remoteStream;
var turnReady;
var SpeechRecognition = SpeechRecognition 
var SpeechGrammarList = SpeechGrammarList 
var SpeechRecognitionEvent = SpeechRecognitionEvent 
var needTranslation = false;


var pcConfig = {
  'iceServers': [{
    'urls': 'stun:stun.l.google.com:19302'
  }]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

/////////////////////////////////////////////
// Socket Events:

var username = location.pathname.split('&username=')[1];
var room = location.pathname.split('&username=')[0].split('/room')[1];
// Could prompt for room name:
// var room = prompt('Enter room name:');

var socket = io.connect();

if (room !== '') {
  socket.emit('create or join',username, room);
  console.log('Attempted to create or  join room', room);
}


socket.on('created', function(room) {
  console.log('Created room ' + room);
  isInitiator = true;
});

socket.on('full', function(room) {
  console.log('Room ' + room + ' is full');
});

socket.on('join', function (user, room){
  console.log(user, 'made a request to join room ' + room);
  isChannelReady = true;
});

socket.on('joined', function(room) {
  console.log('joined: ' + room);
  isChannelReady = true;
});

socket.on('log', function(array) {
  console.log.apply(console, array);
});

socket.on('subtitles request', function(message, fromUser, language) {
  console.log('>>>>>', fromUser, 'request subtitles from', username);
  if (message === 'start') {
    console.log('subtitles requested from my peer');
    dataChannel.isRemoteUserRequestingSubtitles = true;
    //dataChannel.remoteLanguage = language;
    if (isSpeechRecognitionEnabled === false) {
      recognition.start();
      console.log('try to start recognition on requesting subtitles by user', fromUser);
    }
  }
  else if (message === 'stop') {
    dataChannel.isRemoteUserRequestingSubtitles = false;
    dataChannel.remoteLanguage = '';
  }
});

socket.on('receipt', function(message) {
  console.log(message);
});

socket.on('translation request', function(fromUser, language) {
  console.log('receive tranlation request from', fromUser);
  dataChannel.remoteLanguage = language;
  needTranslation = true;
});

socket.on('translation', function(translatedText, fromUser, isFinal) {
  console.log('>>>>> in receiving translated text.');
  var translatedSubtitle = document.getElementById("remoteUserTrans");
  translatedSubtitle.innerHTML = translatedText;
  console.log('>>>>> translated:', translatedText);
});

////////////////////////////////////////////////

function sendMessage(message) {
  console.log('Client sending message: ', message);
  socket.emit('message', message);
}

// This client receives a message
socket.on('message', function(message) {
  console.log('Client received message:', message);
  if (message === 'got user media') {
    maybeStart();
  } else if (message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      maybeStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    pc.addIceCandidate(candidate);
  } else if (message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});

////////////////////////////////////////////////////
// Get User Media:

var localVideo = document.getElementById('localVideo');
var remoteVideo = document.getElementById('remoteVideo');


navigator.mediaDevices.getUserMedia({
  video: {
    width: { min: 640, ideal: 1920 },
    height: { min: 400, ideal: 1080 },
    aspectRatio: { ideal: 1.7777777778 }
  },
  audio: {
    sampleRate: 16000,
    echoCancellation: true,
    noiseSuppression: true
  }
})
.then(gotStream)
.catch(function(e) {
  alert('getUserMedia() error: ' + e.name);
});

function gotStream(stream) {
  console.log('Adding local stream.');
  localStream = stream;
  localVideo.srcObject = stream;
  sendMessage('got user media');
  //  console.log("isStartToGetAudioTrack");
  if (isInitiator) {
    maybeStart();
  }
}

var constraints = {
  audio: true,
  video: true
};

console.log('Getting user media with constraints', constraints);

if (location.hostname !== 'localhost') {
  requestTurn(
    'https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913'
  );
}

function maybeStart() {
  console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
  if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
    console.log('>>>>>> creating peer connection');
    createPeerConnection();
    createDataChannel();
    pc.addStream(localStream);
    isStarted = true;
    console.log('isInitiator', isInitiator);
    if (isInitiator) {
      doCall();
    }
  }
}

window.onbeforeunload = function() {
  sendMessage('bye');
};

/////////////////////////////////////////////////////////
// Peer Connection:

function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(null);
    pc.onicecandidate = handleIceCandidate;
    pc.onaddstream = handleRemoteStreamAdded;
    pc.onremovestream = handleRemoteStreamRemoved;
    pc.ondatachannel = handleDataChannel;
    console.log(username, 'is creating RTCPeerConnnection');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function handleIceCandidate(event) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    });
  } else {
    console.log('End of candidates.');
  }
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function handleDataChannel(event) {
  dataChannel = event.channel;
  setDataChannelEvents(username);
  dataChannel.isRemoteUserRequestingSubtitles = false;
  dataChannel.remoteLanguage = '';
  dataChannel.isLocalUserRequestingSubtitles = false;
  dataChannel.isLocalUserRequestingTranslatedSubtitles = false;
}

function doCall() {
  console.log('Sending offer to peer');
  pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer().then(
    setLocalAndSendMessage,
    onCreateSessionDescriptionError
  );
}

function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription);
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function requestTurn(turnURL) {
  var turnExists = false;
  for (var i in pcConfig.iceServers) {
    if (pcConfig.iceServers[i].urls.substr(0, 5) === 'turn:') {
      turnExists = true;
      turnReady = true;
      break;
    }
  }
  if (!turnExists) {
    console.log('Getting TURN server from ', turnURL);
    // No TURN server. Get one from computeengineondemand.appspot.com:
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4 && xhr.status === 200) {
        var turnServer = JSON.parse(xhr.responseText);
        console.log('Got TURN server: ', turnServer);
        pcConfig.iceServers.push({
          'urls': 'turn:' + turnServer.username + '@' + turnServer.turn,
          'credential': turnServer.password
        });
        turnReady = true;
      }
    };
    xhr.open('GET', turnURL, true);
    xhr.send();
  }
}

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  remoteStream = event.stream;
  remoteVideo.srcObject = remoteStream;

}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

function stop() {
  isStarted = false;
  pc.close();
  pc = null;
}

/////////////////////////////////////////////////////////
// Data Channel:
var dataChannel;

var DATACHANNEL_CONFIG = {
  ordered: true // Ordered and reliable by default in most browsers
};

function createDataChannel() {
  try {
    dataChannel = pc.createDataChannel('dataChannelFor'+username, DATACHANNEL_CONFIG);
    setDataChannelEvents(username);
    dataChannel.isRemoteUserRequestingSubtitles = false;
    dataChannel.remoteLanguage = '';
    dataChannel.isLocalUserRequestingSubtitles = false;
    dataChannel.isLocalUserRequestingTranslatedSubtitles = false;
  }
  catch (e) {
    alert('Failed to create data channel');
  }
}

function setDataChannelEvents(user) {
  dataChannel.onopen = function() {
    console.log('>>>>>', user, 'established data channel');
  };
  dataChannel.onclose = function() {
    console.log('>>>>> data channel closed');
  };
  dataChannel.onerror = function(){
    console.log('>>>>> data channel error');
  };
  dataChannel.onmessage = function(event){
    var subtitles = JSON.parse(event.data)
    console.log('subtitles.text' , subtitles.text);
    //var remoteArea = document.getElementById('remoteMedia');
    var elem = document.getElementById('remoteUserSubtitles');
    elem.innerHTML = subtitles.text;
    // remoteArea.removeChild(elem);
    // var remoteUserSubtitles = document.createElement('div');
    // remoteUserSubtitles.innerText = subtitles.text;
    // remoteUserSubtitles.className = 'remoteUserSubtitles row';
    // remoteUserSubtitles.id = 'remoteUserSubtitles';
    // remoteArea.appendChild(remoteUserSubtitles);
  }
}
/////////////////////////////////////////////////////////
// Subtitles:
var subtitleButton = document.getElementById("subtitleButton");
var subLanguageSelector = document.getElementById("subLanguageSelector");
var translationButton = document.getElementById('tranlationButton');
var subtitleLang = navigator.language;

subLanguageSelector.onchange = function updateSubLanguage() {
  subtitleLang = subLanguageSelector.selectedOptions[0].value;
  console.log('translation subtitle Language', subtitleLang);
}

translationButton.onclick = function() {
  socket.emit('translation start request', subtitleLang);
}

subtitleButton.onclick = function() {
  requestSubtitles(username, '');
}

function requestSubtitles(user, language) {
  dataChannel.isLocalUserRequestingSubtitles = true;
  socket.emit('subtitles request', 'start', language);
  if (language === '') {
    console.log('>>>>>', user, 'requesting original subtitles');
  }
  else {
    console.log('>>>>>', user, 'requesting tanslated subtitles.');
  }
}

function sendSubtitles(subtitle) {
  if (dataChannel.isRemoteUserRequestingSubtitles === true) {
    console.log('datachannel remotelang', dataChannel.remoteLanguage, 'recognition', recognition.lang);
    //if (dataChannel.remoteLanguage.substring(0, 2) === recognition.lang.substring(0, 2)) {
          dataChannel.send(JSON.stringify(subtitle));
    // } else if (subtitle.isFinal) {
    //   if (subtitle.text !== ' ') {
    //     var fromLang = recognition.lang;
    //     var toLang = dataChannel.remoteLanguage;

    //     if (fromLang === 'cmn') {
    //       fromLang = 'zh';
    //     } else if (fromLang === 'en-US') {
    //       fromLang = 'en';
    //     }

    //     if (toLang === 'cmn') {
    //       toLang = 'zh';
    //     } else if (toLang === 'en-US') {
    //       toLang = 'en';
    //     }

    //     socket.emit('translation request', subtitle, fromLang, toLang, username);
    //   }
    // }
  }
}
/////////////////////////////////////////////////////////
// Speech Recognition:

// VARIABLES:
var isSpeechRecognitionEnabled = false;
var isSpeechRecognitionInitiated = false;
var isSpeechRecognitionCrashed = false;
var speechRecognitionIndicator = document.getElementById('speechRecognitionIndicator');
var languageSelector = document.getElementById('languageSelector');
var speechRecognitionAbort = document.getElementById('startButton');
var languagesIndex = {
    'en': 0,
    'cmn': 1,
    'es': 2, 'es-AR': 2, 'es-BO': 2, 'es-CL': 2, 'es-CO': 2, 'es-CR': 2, 'es-EC': 2, 'es-SV': 2, 'es-ES': 2, 'es-US': 2,
    'es-GT': 2, 'es-HN': 2, 'es-MX': 2, 'es-NI': 2, 'es-PA': 2, 'es-PY': 2, 'es-PE': 2, 'es-PR': 2, 'es-DO': 2, 'es-UY': 2,
    'es-VE': 2,
    'fr': 3, 'fr-FR': 3,
    'it': 4, 'it-IT': 4, 'it-CH': 4,
    'hu': 5, 'hu-HU': 5,
    'no': 6, 'no-NO': 6,
    'nb': 6, 'nb-NO': 6,
    'pl': 7, 'pl-PL': 7,
    'pt': 8, 'pt-BR': 8, 'pt-PT': 8,
    'sv': 9, 'sv-SE': 9,
    'ar': 10,
    'he': 11, 'he-IL': 11,
    'iw': 11, 'iw-IL': 11,
    'ja': 12, 'ja-JP': 12,
    'ko': 13, 'ko-KR': 13,
    'ru': 14, 'ru-RU': 14
};



console.log('User\'s browser language is ', navigator.language);
if (languagesIndex[navigator.language] === undefined) {
  languageSelector.options.seletedIndex = 1;
  console.log('Setting local language to English');
} else {
  languageSelector.options.seletedIndex = languagesIndex[navigator.language];
  console.log('Setting language to', languageSelector.selectedOptions[0].text);
}

if (('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window)) {
  if ('webkitSpeechRecognition' in window) {
    var recognition = new webkitSpeechRecognition();
    console.log('>>>>> recognition created');
  }
  else if ('SpeechRecognition' in window) {
    var recognition = new SpeechRecognition();
    console.log('>>>>> recognition created');
  }
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = languageSelector.selectedOptions[0].value;

  recognition.onstart = function() {
    console.log('recognition started.')
    speechRecognitionIndicator.classList.remove('speechRecognitionIndicatorOff');
    speechRecognitionIndicator.classList.add('speechRecognitionIndicatorOn');
    isSpeechRecognitionEnabled = true;
    sendSubtitles({text: ' ', isFinal: false});
    // Speech recognition initiation so no later permissions are required
    if (isSpeechRecognitionInitiated === false) {
      recognition.stop();
      isSpeechRecognitionInitiated = true;
    }
  };

  recognition.onresult = function(event) {
        var transcription = '';
        for (var i = event.resultIndex; i < event.results.length; ++i) {
            transcription += event.results[i][0].transcript;
        }
        console.log('recognition.onresult, transcription', transcription);
        sendSubtitles({text: transcription, isFinal: event.results[event.results.length - 1].isFinal})

        console.log('Need Translation? ', needTranslation);
        if (needTranslation) {
          console.log('begin transfer subtitles to server to translate');
          if (dataChannel.remoteLanguage === 'cmn') {
            dataChannel.remoteLanguage = 'zh';
          } else if (dataChannel.remoteLanguage === 'en-US') {
            dataChannel.remoteLanguage = 'en';
          }
          console.log('translation ', transcription, ' to ', username, ' in ', dataChannel.remoteLanguage);
          socket.emit('translation request', transcription, dataChannel.remoteLanguage, username);
        }
        // console.log('transcription', transcription);
  };

  recognition.onerror = function(error) {
    console.error('Speech recognition error:', error);
    if (error.error === 'aborted') {
      isSpeechRecognitionCrashed = true;
      alert('Speech recognition aborted. Only one instance per client is supported.');
      // TODO
      //window.location = '/error.html';
    }
  };

  recognition.onend = function() {
    speechRecognitionIndicator.classList.add('speechRecognitionIndicatorOff');
    speechRecognitionIndicator.classList.remove('speechRecognitionIndicatorOn');
    isSpeechRecognitionEnabled = false;
    console.log('Speech recognition has stopped.');
    keepSpeechRecognitionAliveIfNeeded();
  }
}

// Keeps the speech recognition alive
function keepSpeechRecognitionAliveIfNeeded() {
  if (!isSpeechRecognitionCrashed) {
    if (isSpeechRecognitionEnabled === false) {
      recognition.start();
      console.log('try to restart speech recognition after disconnection');
    }
  }
}

// Updates the local user's language
languageSelector.onchange = function updateLanguage() {
  recognition.lang = languageSelector.selectedOptions[0].value;
  console.log('Language changed to', languageSelector.selectedOptions[0].text);
  recognition.stop();
  //try to give a bit delay and then start again with the same instance
  setTimeout(function(){ recognition.start(); }, 400);
  console.log('will restart recognition soon')
}