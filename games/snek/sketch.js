var gameController;

function setup() {
  frameRate(60);
  createCanvas(windowWidth - 50, windowHeight - 50);
  colorMode(HSB, 360, 100, 100, 1);
  gameController = new GameController();
}

function draw() {
  gameController.update();
  gameController.draw();
}

function keyPressed() {
  gameController.onKeyPressed(keyCode);
}

// function keyReleased() {
//   var theresAKeyPressed = [LEFT_ARROW, RIGHT_ARROW, UP_ARROW, DOWN_ARROW].some(keyIsDown);
//   if(!theresAKeyPressed) {
//     snek.stahp(); 
//   }
// }