
(function( Popcorn, window, document ) {

  var

  CURRENT_TIME_MONITOR_MS = 16,
  EMPTY_STRING = "",
  messageListeners = {};

  // Utility wrapper around postMessage interface
  function SolidtangoPlayer( solidtangoIFrame ) {
    var self = this,
      url = solidtangoIFrame.src.split('?')[0],
      muted = 0;

    if( url.substr(0, 2) === '//' ) {
      url = window.location.protocol + url;
    }

    function sendMessage( method, params ) {
      var data = {
        'event': 'message',
        'func': method
      };
      if (typeof params !== "undefined" ) { data['args'] = params; }

      // The iframe has been destroyed, it just doesn't know it.
      if ( !solidtangoIFrame.contentWindow ) {
        return;
      }

      solidtangoIFrame.contentWindow.postMessage( JSON.stringify(data), url );
    }

    var methods = ( "ready playing togglePlay seek position" ).split(" ");
    methods.forEach( function( method ) {
      self[ method ] = function (arg0) {
        sendMessage(method, arg0);
      }
    });
  }


  function HTMLSolidtangoVideoElement( id ) {
    // Solidtango Embed API requires postMessage
    if( !window.postMessage ) {
      throw "ERROR: HTMLSolidtangoVideoElement requires window.postMessage";
    }
    var self = new Popcorn._MediaElementProto(),
      parent = typeof id === "string" ? Popcorn.dom.find( id ) : id,
      elem = document.createElement( "iframe" ),
      impl = {
        src: EMPTY_STRING,
        networkState: self.NETWORK_EMPTY,
        readyState: self.HAVE_NOTHING,
        seeking: false,
        autoplay: EMPTY_STRING,
        preload: EMPTY_STRING,
        controls: false,
        loop: false,
        poster: EMPTY_STRING,
        volume: 1,
        // The player has no concept of muted, store volume values
        // such that muted===0 is unmuted, and muted>0 is muted.
        muted: 0,
        currentTime: 0,
        duration: NaN,
        ended: false,
        paused: true,
        error: null
      },
      mediaHost = null,
      playerReady = false,
      playerUID = Popcorn.guid(),
      player,
      playerPaused = true,
      delayedPauseEvent = false,
      playerReadyCallbacks = [],
      timeUpdateInterval,
      currentTimeInterval,
      statusPollInterval = 500,
      statusPollTimer,
      initialPlayForced = false,
      lastPlayingStatus = false,
      reportedDuration = false;

    // Namespace all events we'll produce
    self._eventNamespace = Popcorn.guid( "HTMLSolidtangoVideoElement::" );

    self.parentNode = parent;

    // Mark type as Solidtango
    self._util.type = "Solidtango";


    function startStatusPoll() {
      statusPollTimer = window.setInterval(function(e){
        requestStatusUpdate();
      }, statusPollInterval);
    }

    function requestStatusUpdate(){
      // The iframe has been destroyed, it just doesn't know it
      if ( !elem.contentWindow ) {
        window.removeEventListener('message', onStateChange);
        clearInterval(statusPollTimer);
        statusPollTimer = null;
        clearInterval( currentTimeInterval );
        currentTimeInterval = null;
        clearInterval(timeUpdateInterval);
        timeUpdateInterval = null;
        return;
      }
      else {
        player.ready();
      }
    }

    function addPlayerReadyCallback( callback ) {
      playerReadyCallbacks.unshift( callback );
    }

    function onPlayerReady( event ) {

      // There's no duration metadata, so fake that for now.
      // Must use NaN or Popcorn stops running events once past the last one.
      var newDuration = NaN;
      var oldDuration = impl.duration;
      //if( oldDuration !== newDuration ) {
      if (!reportedDuration) {
        reportedDuration = true;
        impl.duration = newDuration;
        self.dispatchEvent( "durationchange" );

        // Deal with first update of duration
        if( isNaN( oldDuration ) ) {
          impl.networkState = self.NETWORK_IDLE;
          if (impl.autoplay) {
            // Begin autoplaying if needed so impl.paused is false on
            // on the loadedmetadata event.
            self.play();
          }
          impl.readyState = self.HAVE_METADATA;
          self.dispatchEvent( "loadedmetadata" );
          self.dispatchEvent( "loadeddata" );
          impl.readyState = self.HAVE_FUTURE_DATA;
          self.dispatchEvent( "canplay" );
          if (!impl.paused || impl.autoplay) {
            // Emit play/playing events once data is said to be loaded.
            onPlay();
          }
          // Can't determine the amount of data available, so have to make this
          // assumption.
          impl.readyState = self.HAVE_ENOUGH_DATA;
          self.dispatchEvent( "canplaythrough" );
        }
      }

      var i = playerReadyCallbacks.length;
      while( i-- ) {
        playerReadyCallbacks[ i ]();
        delete playerReadyCallbacks[ i ];
      }

    }

    // Currently not used.
    function getDuration() {
      if( !playerReady ) {
        // Queue a getDuration() call so we have correct duration info for loadedmetadata
        addPlayerReadyCallback( function() { getDuration(); } );
      }
      //player.getDuration();
    }

    function destroyPlayer() {
      if( !( playerReady && player ) ) {
        return;
      }
      clearInterval( currentTimeInterval );
      player.pause();

      window.removeEventListener( 'message', onStateChange);
      parent.removeChild( elem );
      elem = document.createElement( "iframe" );
    }

    // Call to tell the player to play and update internal state.
    self.play = function() {
      impl.paused = false;
      if( !playerReady ) {
        addPlayerReadyCallback( function() { self.play(); } );
        return;
      }

      player.togglePlay();
    };

    function changeCurrentTime( aTime ) {
      if( !playerReady ) {
        addPlayerReadyCallback( function() { changeCurrentTime( aTime ); } );
        return;
      }
      impl.currentTime = aTime;
      onSeeking();
      player.seek( aTime );
    }

    function onSeeking() {
      impl.seeking = true;
      self.dispatchEvent( "seeking" );
    }

    function onSeeked() {
      impl.seeking = false;
      self.dispatchEvent( "timeupdate" );
      self.dispatchEvent( "seeked" );
      self.dispatchEvent( "canplay" );
      impl.readyState = self.HAVE_ENOUGH_DATA;
      self.dispatchEvent( "canplaythrough" );
    }

    // Call to tell the player to pause and update internal state.
    self.pause = function() {
      impl.paused = true;
      if( !playerReady ) {
        addPlayerReadyCallback( function() { self.pause(); } );
        return;
      }
      player.togglePlay();
    };

    function onPause() {
      impl.paused = true;
      if ( !playerPaused ) {
        playerPaused = true;
        // Ask for position one more time before triggering the pause event in
        // case it was triggered by the video ending.
        delayedPauseEvent = true;
      }
      else if (delayedPauseEvent){
        delayedPauseEvent = false;
        if (impl.currentTime === 0) {
          // When position is 0, the player paused because it hit the end.
          if ( impl.loop ) {
            // The player jumps back to the beginning so just play again.
            self.play();
          } 
          else {
            // Keep track of current state in case it's already ended.
            var hadEnded = impl.ended;
            // The player has ended and jumped back to the beginning.
            impl.ended = true;
            // Pause and timeupdate must come before ended.
            self.dispatchEvent( "pause" );
            // Only emit these events once until after next play start.
            if (!hadEnded) {
              self.dispatchEvent( "timeupdate" );
              self.dispatchEvent( "ended" );
            }
          }
        }
        else {
          // This was a simple pause event.
          self.dispatchEvent( "pause" );
        }
        // Stop polling for position as it won't change now anyway.
        clearInterval( timeUpdateInterval );
      }
    }

    function onTimeUpdate() {
      self.dispatchEvent( "timeupdate" );
    }

    function onPlay() {

      impl.paused = false;
      impl.ended = false;

      // Set up player position poll.
      if ( !currentTimeInterval ) {
        currentTimeInterval = setInterval( monitorCurrentTime,
                                           CURRENT_TIME_MONITOR_MS ) ;

        // Only 1 play when video.loop=true
        if ( impl.loop ) {
          self.dispatchEvent( "play" );
        }
      }

      // Set up regular timeupdated event emitter.
      if (!timeUpdateInterval) {
        timeUpdateInterval = setInterval( onTimeUpdate,
                                        self._util.TIMEUPDATE_MS );
      }

      if( playerPaused ) {
        playerPaused = false;

        // Only 1 play when video.loop=true
        if ( !impl.loop ) {
          self.dispatchEvent( "play" );
        }
        self.dispatchEvent( "playing" );
      }
    }

    // Called when position data is returned from the player.
    function onCurrentTime( aTime ) {
      // The player sometimes returns the position as below 0.02 after ending.
      if (impl.ended && !impl.playing && aTime < 0.03) {
        aTime = 0;
      }
      var currentTime = aTime;
      var timeDiff = currentTime - impl.currentTime;

      // The player does not report seeked events. Detect using position diff.
      if (!impl.seeking) {
        if ( currentTime != 0 && Math.abs(timeDiff) > CURRENT_TIME_MONITOR_MS) {
          // Manual seek using controls, emit both seeking and seeked.
          onSeeking();
          onSeeked();
        }
      }
      else if(Math.abs(timeDiff < 1)) {
        // Seeking with currenTime() sets impl.currentTime to the target before
        // the player reports its position. It's not exact, but within a second..
        onSeeked();
      }
      impl.currentTime = currentTime;
    }

    // Called on a timer to poll for position info while playing.
    function monitorCurrentTime() {
      player.position();
    }

    // Called when the src property is set.
    function changeSrc( aSrc ) {
      if( !self._canPlaySrc( aSrc ) ) {
        impl.error = {
          name: "MediaError",
          message: "Media Source Not Supported",
          code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        };
        self.dispatchEvent( "error" );
        return;
      }

      impl.src = aSrc;

      if( playerReady ) {
        destroyPlayer();
      }

      playerReady = false;

      var src = self._util.parseUri( aSrc ),
        queryKey = src.queryKey,
        key,
        optionsArray = ['api=true'];

      mediaHost = src.protocol + '://' + src.host;
      // Sync loop and autoplay based on URL params, and delete.
      // We'll manage both internally.
      impl.loop = queryKey.loop === "1" || impl.loop;
      delete queryKey.loop;
      impl.autoplay = queryKey.autoplay === "1" || impl.autoplay;
      delete queryKey.autoplay;

      // Create the base player string. It will always have query string options
      src = mediaHost + src.path + "?";
      for( key in queryKey ) {
        if ( queryKey.hasOwnProperty( key ) ) {
          optionsArray.push( encodeURIComponent( key ) + "=" +
                             encodeURIComponent( queryKey[ key ] ) );
        }
      }
      src += optionsArray.join( "&" );

      elem.id = playerUID;
      elem.style.width = "100%";
      elem.style.height = "100%";
      elem.frameBorder = 0;
      elem.webkitAllowFullScreen = true;
      elem.mozAllowFullScreen = true;
      elem.allowFullScreen = true;
      parent.appendChild( elem );
      elem.src = src;

      // Listen for player events.
      window.addEventListener( "message", startupMessage, false );
      // Create the interface for sending player messages.
      player = new SolidtangoPlayer( elem );
      // Begin polling the player or it won't send any events.
      startStatusPoll();
    }

    function onVolume( aValue ) {
      if( impl.volume !== aValue ) {
        impl.volume = aValue;
        self.dispatchEvent( "volumechange" );
      }
    }

    function setVolume( aValue ) {
      impl.volume = aValue;

      if( !playerReady ) {
        addPlayerReadyCallback( function() {
          setVolume( aValue );
        });
        return;
      }
      console.warn('Ignoring set volume call');
      //player.setVolume( aValue );
      self.dispatchEvent( "volumechange" );
    }

    function getVolume() {
      // If we're muted, the volume is cached on impl.muted.
      return impl.muted > 0 ? impl.muted : impl.volume;
    }

    function setMuted( aMute ) {
      if( !playerReady ) {
        impl.muted = aMute ? 1 : 0;
        addPlayerReadyCallback( function() {
          setMuted( aMute );
        });
        return;
      }

      // Move the existing volume onto muted to cache
      // until we unmute, and set the volume to 0.
      if( aMute ) {
        impl.muted = impl.volume;
        setVolume( 0 );
      } else {
        impl.muted = 0;
        setVolume( impl.muted );
      }
    }

    function getMuted() {
      return impl.muted > 0;
    }

    // We deal with the startup load messages differently than
    // we will once the player is fully ready and loaded.
    function startupMessage( event) {
      if( event.origin !== mediaHost ) {
        return;
      }

      var data;
      try {
        data = JSON.parse( event.data );
      } catch ( ex ) {
        console.warn( ex );
      }

      switch ( data.func) {
        case "ready":
          // Start playing to trigger preloading. Call the player directly to
          // not emit events or mess up internal state in the startup phase.
          if (data.args && !initialPlayForced) {
            initialPlayForced = true;
            player.togglePlay();
          }
          // Check if we're playing yet.
          player.playing();
          break;
        case "playing":
          if (data.args && !playerReady) {
            // Playing and preloading has begun.
            self.dispatchEvent( "loadstart" );
            self.dispatchEvent( "progress" );
            // Stop playing and go back to the beginning.
            player.togglePlay();
            player.seek(0);
            playerReady = true;
          }
          else if (!data.args && playerReady) {
            // We've now paused after the initial play.
            // Switch message pump to use run-time message callback vs. startup
            window.removeEventListener( "message", startupMessage);
            window.addEventListener( "message", onStateChange, false );
            onPlayerReady();
          }
        break;
        default:
          console.warn(data, 'Unhandled startup event');
      }
    }

    // The runtime messag pump.
    function onStateChange ( event) {
      if( event.origin !== mediaHost) {
        return;
      }

      var data;
      try {
        data = JSON.parse( event.data );
      } catch ( ex ) {
        console.warn( ex );
      }

      switch(data.func){
        case "ready":
          playerReady = data.args;
          if (playerReady) {
            player.playing();
          }
          else if (!data.args) {
            console.warn('Player no longer ready');
            // For now assume the player was removed.
            return;
          }
        break;
        case "position":
          onCurrentTime(parseFloat(data.args, 10));
        break;
        case "playing":
          if (data.args) {
            onPlay();
          }
          else {
            onPause();
          }
        break;
        default:
          console.warn(data, 'Unhandled runtime event');
        break;
      }
    }

    Object.defineProperties( self, {

      src: {
        get: function() {
          return impl.src;
        },
        set: function( aSrc ) {
          if( aSrc && aSrc !== impl.src ) {
            changeSrc( aSrc );
          }
        }
      },

      autoplay: {
        get: function() {
          return impl.autoplay;
        },
        set: function( aValue ) {
          impl.autoplay = self._util.isAttributeSet( aValue );
        }
      },

      loop: {
        get: function() {
          return impl.loop;
        },
        set: function( aValue ) {
          impl.loop = self._util.isAttributeSet( aValue );
        }
      },

      width: {
        get: function() {
          return self.parentNode.offsetWidth;
        }
      },

      height: {
        get: function() {
          return self.parentNode.offsetHeight;
        }
      },

      currentTime: {
        get: function() {
          return impl.currentTime;
        },
        set: function( aValue ) {
          changeCurrentTime( aValue );
        }
      },

      duration: {
        get: function() {
          return impl.duration;
        }
      },

      ended: {
        get: function() {
          return impl.ended;
        }
      },

      paused: {
        get: function() {
          return impl.paused;
        }
      },

      seeking: {
        get: function() {
          return impl.seeking;
        }
      },

      readyState: {
        get: function() {
          return impl.readyState;
        }
      },

      networkState: {
        get: function() {
          return impl.networkState;
        }
      },

      volume: {
        get: function() {
          return getVolume();
        },
        set: function( aValue ) {
          if( aValue < 0 || aValue > 1 ) {
            throw "Volume value must be between 0.0 and 1.0";
          }

          setVolume( aValue );
        }
      },

      muted: {
        get: function() {
          return getMuted();
        },
        set: function( aValue ) {
          setMuted( self._util.isAttributeSet( aValue ) );
        }
      },

      error: {
        get: function() {
          return impl.error;
        }
      }
    });

    self._canPlaySrc = Popcorn.HTMLSolidtangoVideoElement._canPlaySrc;
    self.canPlayType = Popcorn.HTMLSolidtangoVideoElement.canPlayType;

    return self;
  }

  Popcorn.HTMLSolidtangoVideoElement = function( id ) {
    return new HTMLSolidtangoVideoElement( id );
  };

  // Helper for identifying URLs we know how to play.
  Popcorn.HTMLSolidtangoVideoElement._canPlaySrc = function( url ) {
    return (/[\w-]+\.solidtango.com\/widgets\/embed\/\w+/).test( url ) ? "probably" : EMPTY_STRING;
  };

  // We'll attempt to support a mime type of video/x-solidtango, just in case...
  Popcorn.HTMLSolidtangoVideoElement.canPlayType = function( type ) {
    return type === "video/x-solidtango" ? "probably" : EMPTY_STRING;
  };

}( Popcorn, window, document ));
