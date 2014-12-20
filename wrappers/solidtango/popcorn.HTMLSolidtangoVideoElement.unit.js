
var testData = {

  videoSrc: "https://okv.solidtango.com/widgets/embed/rvgy5ai8?api=true",
  expectedDuration: 446,

  createMedia: function( id ) {
    return Popcorn.HTMLSolidtangoVideoElement( id );
  },

  // We need to test Solidtango's URL params, which not all
  // wrappers mimic.  Do it as a set of tests specific
  // to Solidtango.
  playerSpecificAsyncTests: function() {
	// @todo, add tests for URL params
  },

  playerSpecificSyncTests: function() {
  }
};

// Players tend to fail when the iframes live in the qunit-fixture
// div. Simulate the same effect by deleting all iframes under #video
// after each test ends.
var qunitStart = start;
start = function() {
  // Give the video time to finish loading so callbacks don't throw
  setTimeout( function() {
    qunitStart();
    var video = document.querySelector( "#video" );
    while( video.hasChildNodes() ) {
      video.removeChild( video.lastChild );
    }
  }, 10 );
};
