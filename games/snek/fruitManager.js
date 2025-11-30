function FruitManager() {
	return {
		fruitSize: 25,
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
			var randX = getRandomInt(50, width - 50),
				randY = getRandomInt(50, height - 50),
				fruitColor = color(0, 100, 100, 1);
			this.myDeliciousFruits.push(Point(randX, randY, this.fruitSize, this.fruitSize, fruitColor, true));
		}
	};
};
