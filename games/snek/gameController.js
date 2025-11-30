//Controls the state of the game. Passes information between the various systems as they need it
function GameController() {
	return {
		snek: new Snake(),
		fruitManager: new FruitManager(),

		currentlyNotAFailure: true,
		lengthPerFruit: 7,

		update: function() {
			if(this.isUpdateFrame()) {
				this.snek.update();
			}
			var numFruitEt = this.fruitManager.update(this.snek.getHead());
			this.snek.addLength(numFruitEt * this.lengthPerFruit);
		},

		isUpdateFrame: function() {
			return frameCount % 5 == 0;
		},

		draw: function() {
			if(this.currentlyNotAFailure && this.lost()) {
				this.drawAll();
				this.snek.stahp();
				this.showFail();
				this.currentlyNotAFailure = false;
			} 
			if(!this.currentlyNotAFailure) {
				return;
			}
			this.drawAll();
		},

		drawAll: function() {
			//Note to self: can do same thing as this.snek.update() for lag-mode
			this.snek.draw();
			this.fruitManager.draw();
			this.drawScore(this.getScore());
		},

		onKeyPressed: function(keyCode) {
			if (keyCode === LEFT_ARROW) {
				this.snek.moveLeft();
			} else if (keyCode === RIGHT_ARROW) {
				this.snek.moveRight();
			} else if (keyCode === UP_ARROW) {
				this.snek.moveUp();
			} else if (keyCode === DOWN_ARROW) {
				this.snek.moveDown();
			} else if (keyCode === 173 || keyCode === 189) { //-
				this.snek.moveSpeed -= 1;
			} else if (keyCode === 61 || keyCode === 187) { //=
				this.snek.moveSpeed += 1;
			}
		},

		lost: function() {
			var head = this.snek.getHead();

			outsideArena = head.x + (head.w / 2) > width || head.x - (head.w / 2) < 0 || head.y + (head.h / 2) > height || head.y - (head.h / 2) < 0;
			collidesWithTail = this.snek.collidesWithTail();

			return outsideArena || collidesWithTail;
		},

		showFail: function() {
			var disappointments = ["you suck", 
				"i'm disappointed in you",
				"that didn't seem like it was your best effort",
				"maybe next time you won't let me down",
				"this is worse than the spaghetti incident",
				"just wait until you father hears about this"],
			chosenDisappointment = disappointments[getRandomInt(0, disappointments.length-1)];

			textSize(32);
			fill(0);
			textAlign(CENTER);
			text(chosenDisappointment, width/2, height/2);
		},

		getScore: function() {
			return this.snek.mySnek.length * this.snek.moveSpeed;
		},

		//TODO: Only draw if not lost
		drawScore: function(currScore) {
			textSize(24);
			fill(0, 0, 0, 1);
			text("Self worth: " + currScore, 10, 30);
		}
	};
};
