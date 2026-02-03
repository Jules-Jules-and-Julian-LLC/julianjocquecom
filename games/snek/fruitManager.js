function FruitManager() {
	// Scale fruit size based on screen size for mobile
	var baseSize = Math.min(width, height);
	var scaledFruitSize = Math.max(15, Math.min(25, Math.floor(baseSize / 25)));
	return {
		fruitSize: scaledFruitSize,
		myDeliciousFruits: [],

		//Updates the fruit manager by checking if the snake's head has eaten any of its delicious fruit
		update: function(head) {
			var numCollisions = this.checkForCollision(head);
			if(this.myDeliciousFruits.length === 0) {
				this.addFruit();
			}

			return numCollisions;
		},

		draw: function() {
			this.myDeliciousFruits.forEach(function(point) {
				point.draw();
			});
		},

		checkForCollision: function(head) {
			var	currFruit,
				numCollisions = 0;
			for(var i = this.myDeliciousFruits.length - 1; i >= 0; i--) {
				currFruit = this.myDeliciousFruits[i];
				if(head.collides(currFruit)) {
					this.myDeliciousFruits.splice(i, 1);
					numCollisions++;
				}
			}

			return numCollisions;
		},

		addFruit: function() {
			// Use smaller margins on smaller screens
			var margin = Math.max(20, Math.min(50, Math.floor(Math.min(width, height) / 10)));
			var randX = getRandomInt(margin, width - margin),
				randY = getRandomInt(margin, height - margin),
				fruitColor = color(0, 100, 100, 1);
			this.myDeliciousFruits.push(Point(randX, randY, this.fruitSize, this.fruitSize, fruitColor, true));
		}
	};
};
