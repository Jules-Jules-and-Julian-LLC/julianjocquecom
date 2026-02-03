var gameController;
var touchStartX = 0;
var touchStartY = 0;
var minSwipeDistance = 30;

function setup() {
  frameRate(60);
  // Use full window on mobile, slight margin on desktop
  var isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  var margin = isMobile ? 10 : 50;
  createCanvas(windowWidth - margin, windowHeight - margin);
  colorMode(HSB, 360, 100, 100, 1);
  gameController = new GameController();

  // Setup D-pad button listeners
  setupDpadControls();
}

function draw() {
  gameController.update();
  gameController.draw();
}

function keyPressed() {
  gameController.onKeyPressed(keyCode);
}

// Touch/swipe controls
function touchStarted() {
  touchStartX = mouseX;
  touchStartY = mouseY;
  return false; // Prevent default
}

function touchEnded() {
  var deltaX = mouseX - touchStartX;
  var deltaY = mouseY - touchStartY;

  // Only register as swipe if moved enough
  if (Math.abs(deltaX) < minSwipeDistance && Math.abs(deltaY) < minSwipeDistance) {
    return false;
  }

  // Determine swipe direction based on which axis had more movement
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    // Horizontal swipe
    if (deltaX > 0) {
      gameController.onKeyPressed(RIGHT_ARROW);
    } else {
      gameController.onKeyPressed(LEFT_ARROW);
    }
  } else {
    // Vertical swipe
    if (deltaY > 0) {
      gameController.onKeyPressed(DOWN_ARROW);
    } else {
      gameController.onKeyPressed(UP_ARROW);
    }
  }
  return false; // Prevent default
}

// D-pad button setup
function setupDpadControls() {
  var buttons = document.querySelectorAll('.dpad-btn');
  buttons.forEach(function(btn) {
    btn.addEventListener('touchstart', function(e) {
      e.preventDefault();
      var dir = this.getAttribute('data-dir');
      handleDpadInput(dir);
    });
    btn.addEventListener('mousedown', function(e) {
      var dir = this.getAttribute('data-dir');
      handleDpadInput(dir);
    });
  });
}

function handleDpadInput(direction) {
  switch(direction) {
    case 'UP':
      gameController.onKeyPressed(UP_ARROW);
      break;
    case 'DOWN':
      gameController.onKeyPressed(DOWN_ARROW);
      break;
    case 'LEFT':
      gameController.onKeyPressed(LEFT_ARROW);
      break;
    case 'RIGHT':
      gameController.onKeyPressed(RIGHT_ARROW);
      break;
  }
}

// Handle window resize
function windowResized() {
  var isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  var margin = isMobile ? 10 : 50;
  resizeCanvas(windowWidth - margin, windowHeight - margin);
}

// function keyReleased() {
//   var theresAKeyPressed = [LEFT_ARROW, RIGHT_ARROW, UP_ARROW, DOWN_ARROW].some(keyIsDown);
//   if(!theresAKeyPressed) {
//     snek.stahp();
//   }
// }