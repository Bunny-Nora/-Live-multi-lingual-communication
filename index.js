document.getElementById('access-form').onkeypress = function() {
    console.log('onclick点击 ' + window.event.keyCode);
    if (window.event.keyCode === 13) {
      goToRoom(username.value, room.value);
    }
  }
  
  function goToRoom(username, room)
  {
    
    if (room === '' || username === '') {
        console.log('onclick点击 ' + window.event.keyCode);
    } else {
        window.location = '/room=' + room + '&username=' + username;
    }
  }
  